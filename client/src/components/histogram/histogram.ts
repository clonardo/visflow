import { Component } from 'vue-property-decorator';
import { histogram, Bin } from 'd3-array';
import { scaleLinear, ScaleBand } from 'd3-scale';
import { select } from 'd3-selection';
import _ from 'lodash';

import {
  injectVisualizationTemplate,
  Visualization,
  drawBrushBox,
  getBrushBox,
  Scale,
  isPointInBox,
  PlotMargins,
  DEFAULT_PLOT_MARGINS,
  AnyScale,
  getScale,
  drawAxis,
  LABEL_OFFSET_PX,
  multiplyVisuals,
} from '@/components/visualization';
import FormInput from '@/components/form-input/form-input';
import template from './histogram.html';
import { isNumericalType, isContinuousDomain } from '@/data/util';
import { ValueType } from '@/data/parser';
import { VisualProperties, visualsComparator } from '@/data/visuals';
import { SELECTED_COLOR } from '@/common/constants';
import { getTransform, fadeOut } from '@/common/util';
import ColumnSelect from '@/components/column-select/column-select';

const DOMAIN_MARGIN = .2;
const BAR_INTERVAL = 1;

interface HistogramSave {
  column: number | null;
  numBins: number;
  selectedBars: string[];
}

interface HistogramBinProps {
  id: string;
  x0: number;
  x1: number;
  y: number;
  bars: HistogramBarProps[];
}

interface HistogramBarProps {
  id: string;
  x: number;
  y: number;
  dx: number;
  dy: number;
  originalVisuals: VisualProperties; // Original visual properties are kept intact during rendering.
  visuals: VisualProperties; // Rendered isual properties can be modified based on whether bars are selected.
  members: number[];
  hasVisuals: boolean;
  selected: boolean;
}

interface HistogramValueBinProps {
  value: number;
  index: number;
}

const DEFAULT_ITEM_VISUALS: VisualProperties = {
  color: '#555',
  opacity: 1,
};

const SELECTED_ITEM_VISUALS: VisualProperties = {
  color: 'white',
  border: SELECTED_COLOR,
  width: 1.5,
};

@Component({
  template: injectVisualizationTemplate(template),
  components: {
    FormInput,
    ColumnSelect,
  },
})
export default class Histogram extends Visualization {
  protected NODE_TYPE = 'histogram';
  protected DEFAULT_WIDTH = 350;
  protected DEFAULT_HEIGHT = 200;

  private column: number | null = null;
  private numBins = 10;
  private xScale!: Scale;
  private yScale!: Scale;
  private valueBins: Array<Bin<HistogramValueBinProps, number>> = [];
  private bins: HistogramBinProps[] = [];
  private selectedBars: Set<string> = new Set();

  private margins: PlotMargins = _.extend({}, DEFAULT_PLOT_MARGINS, { bottom: 20 });

  protected created() {
    this.serializationChain.push((): HistogramSave => ({
      column: this.column,
      numBins: this.numBins,
      selectedBars: Array.from(this.selectedBars),
    }));
    this.deserializationChain.push(nodeSave => {
      const save = nodeSave as HistogramSave;
      this.selectedBars = new Set(save.selectedBars);
    });
  }
  protected onDatasetChange() {
    const dataset = this.getDataset();
    const numericalColumns = dataset.getColumns().filter(column => isNumericalType(column.type));
    this.column = numericalColumns.length ? numericalColumns[0].index : null;
  }

  protected brushed(brushPoints: Point[], isBrushStop?: boolean) {
    if (isBrushStop) {
      this.computeBrushedItems(brushPoints);
      this.computeSelection();
      this.drawHistogram();
      this.propagateSelection();
    }
    drawBrushBox(this.$refs.brush as SVGElement, !isBrushStop ? brushPoints : []);
  }

  protected selectAll() {
    const items = this.inputPortMap.in.getSubsetPackage().getItemIndices();
    this.selection.addItems(items);
    this.bins.forEach(bin => {
      bin.bars.forEach(bar => {
        this.selectedBars.add(bar.id);
      });
    });
    this.draw();
    this.computeSelection();
    this.propagateSelection();
  }

  protected deselectAll() {
    this.selectedBars.clear();
    this.selection.clear();
    this.draw();
    this.computeSelection();
    this.propagateSelection();
  }

  protected draw() {
    this.drawHistogram();
    this.drawXAxis();
    this.drawYAxis();
  }

  private drawHistogram() {
    // First compute the x scale which is solely based on data.
    this.computeXScale();
    // Then compute histogram bins using D3.
    this.computeBins();
    // Based on the bins we can compute the y scale.
    this.computeYScale();
    this.updateLeftMargin();

    this.assignItemsIntoBins();
    this.applyItemProps();

    this.drawBars();
    this.moveSelectedBarsToFront();
  }

  private moveSelectedBarsToFront() {
    const svgBars = $(this.$refs.bars);
    svgBars.find('rect[has-visuals=true]').each((index, element) => {
      $(element).appendTo($(element as HTMLElement).closest('g'));
    });
    svgBars.find('rect[selected=true]').each((index, element) => {
      $(element).appendTo($(element as HTMLElement).closest('g'));
    });
  }

  private computeBrushedItems(brushPoints: Point[]) {
    if (!this.isShiftPressed || !brushPoints.length) {
      this.selection.clear(); // reset selection if shift key is not down
      this.selectedBars.clear();
      if (!brushPoints.length) {
        return;
      }
    }
    const box = getBrushBox(brushPoints);
    this.bins.forEach(bin => {
      const xl = this.xScale(bin.x0);
      const xr = this.xScale(bin.x1);
      if (xr < box.x || xl > box.x + box.width) {
        return;
      }
      bin.bars.forEach(bar => {
        const yl = this.yScale(bar.y + bar.dy);
        const yr = this.yScale(bar.y);
        if (yr < box.y || yl > box.y + box.height) {
          return;
        }
        this.selectedBars.add(bar.id);
        this.selection.addItems(bar.members);
      });
    });
  }

  private computeXScale() {
    const items = this.inputPortMap.in.getSubsetPackage().getItemIndices();
    const dataset = this.getDataset();
    const xDomain = dataset.getDomain(this.column as number, items);
    this.xScale = getScale(dataset.getColumnType(this.column as number), xDomain,
      [this.margins.left, this.svgWidth - this.margins.right],
      { domainMargin: DOMAIN_MARGIN },
    );
  }

  private computeBins() {
    // Histogram range.
    let range: Array<number | string> = [];
    // Bins value for histogram layout.
    let thresholds: number[] = [];

    const dataset = this.getDataset();
    const columnType = dataset.getColumnType(this.column as number);
    const continuousDomain = isContinuousDomain(columnType);
    if (continuousDomain) {
      range = this.xScale.domain() as Array<number | string>;
      // If xScale domain has only a single value, the ticks will return empty
      // array. That is bins = [].
      thresholds = (this.xScale as AnyScale).ticks(this.numBins);
    }
    // Map dates to POSIX.
    if (columnType === ValueType.DATE) {
      range = range.map(date => new Date(date).getTime());
      thresholds = thresholds.map(date => new Date(date).getTime());
    } else if (!isContinuousDomain) {
      const ordinals = this.xScale.domain();
      thresholds = ordinals.map(value => this.xScale(value)) as number[];
      thresholds.push(this.xScale(_.last(ordinals) as string) + (this.xScale as ScaleBand<string>).bandwidth());
      range = this.xScale.range();
    }
    const pkg = this.inputPortMap.in.getSubsetPackage();

    const values = pkg.getItemIndices().map(itemIndex => {
      let value = dataset.getCellForScale(itemIndex, this.column as number);
      if (!continuousDomain) {
        value = this.xScale(value);
      }
      return {
        value: +value,
        index: itemIndex,
      };
    });

    this.valueBins = histogram<HistogramValueBinProps, number>()
      .value(d => d.value)
      .domain(this.xScale.domain() as [number, number])
      .thresholds(thresholds)(values);
  }

  private computeYScale() {
    this.yScale = scaleLinear()
      .domain([0, _.max(this.valueBins.map(d => d.length)) as number])
      .nice()
      .range([this.svgHeight - this.margins.bottom, this.margins.top]) as Scale;
  }

  private assignItemsIntoBins() {
    const pkg = this.inputPortMap.in.getSubsetPackage();
    this.bins = this.valueBins.map((valueBin, binIndex) => {
      // Get d3 histogram coordinates.
      const x0 = valueBin.x0;
      const x1 = valueBin.x1;
      const binLength = valueBin.length;

      const sorted = valueBin.map(item => ({
        visuals: pkg.getItem(item.index).visuals,
        index: item.index,
      })).sort((a, b) => visualsComparator(a.visuals, b.visuals));

      const bars: HistogramBarProps[] = [];
      let y = 0;
      let groupCount = 0;
      for (let j = 0; j < sorted.length; j++) {
        let k = j;
        const members = [];
        // Get all group members with the same rendering properties.
        while (k < sorted.length && visualsComparator(sorted[k].visuals, sorted[j].visuals) === 0) {
          members.push(sorted[k++].index);
        }
        bars.push({
          id: 'g' + (++groupCount),
          x: x0,
          y,
          dx: x1 - x0,
          dy: k - j,
          originalVisuals: sorted[j].visuals,
          visuals: sorted[j].visuals,
          hasVisuals: false,
          selected: false,
          members,
        });
        y += k - j; // The current accumulative bar height
        j = k - 1;
      }
      return {
        id: 'b' + binIndex,
        x0,
        x1,
        y: binLength,
        bars,
      };
    });
  }

  private applyItemProps() {
    this.bins.forEach(bin => {
      bin.bars.forEach(bar => {
        const id = bin.id + ',' + bar.id;
        _.extend(bar, {
          id,
          visuals: _.extend({}, DEFAULT_ITEM_VISUALS, bar.originalVisuals),
          hasVisuals: !_.isEmpty(bar.originalVisuals),
          selected: this.selectedBars.has(id),
        });
        if (this.selectedBars.has(id)) {
          _.extend(bar.visuals, SELECTED_ITEM_VISUALS);
          multiplyVisuals(bar.visuals);
        }
      });
    });
  }

  private drawBars() {
    const numItems = this.inputPortMap.in.getSubsetPackage().numItems();

    const binTransform = (bin: HistogramBinProps) => getTransform([this.xScale(bin.x0), 0]);
    let bins = select(this.$refs.bars as SVGGElement).selectAll<SVGGElement, {}>('g')
      .data(this.bins);
    fadeOut(bins.exit());
    bins = bins.enter().append<SVGGElement>('g')
      .attr('id', d => d.id as string)
      .style('opacity', 0)
      .attr('transform', binTransform)
      .merge(bins);

    const updatedBins = this.isTransitionFeasible(numItems) ? bins.transition() : bins;
    updatedBins
      .attr('transform', binTransform)
      .style('opacity', 1);

    const barTransform = (group: HistogramBarProps) =>
      getTransform([BAR_INTERVAL, Math.floor(this.yScale(group.y + group.dy))]);

    let bars = bins.selectAll<SVGGraphicsElement, HistogramBarProps>('rect')
      .data<HistogramBarProps>(d => d.bars, bar => bar.id);

    fadeOut(bars.exit());

    bars = bars.enter().append<SVGGraphicsElement>('rect')
      .style('opacity', 0)
      .attr('id', d => d.id)
      .attr('transform', barTransform)
      .merge(bars)
      .attr('has-visuals', d => d.hasVisuals)
      .attr('selected', d => d.selected);

    const updatedBars = this.isTransitionFeasible(numItems) ? bars.transition() : bars;
    updatedBars
      .attr('transform', barTransform)
      .attr('width', group => {
        const width = this.xScale(group.dx) - this.xScale(0) - BAR_INTERVAL;
        // In case interval is larger than width. At least 1 pixel wide.
        return width < 0 ? 1 : width;
      })
      .attr('height', group => {
        return Math.ceil(this.yScale(0) - this.yScale(group.dy));
      })
      .style('fill', d => d.visuals.color as string)
      .style('stroke', d => d.visuals.border as string)
      .style('stroke-width', d => d.visuals.width + 'px')
      .style('opacity', d => d.visuals.opacity as number);
  }

  private drawXAxis() {
    drawAxis(this.$refs.xAxis as SVGElement, this.xScale, {
      classes: 'x',
      orient: 'bottom',
      transform: getTransform([0, this.svgHeight - this.margins.bottom]),
      label: {
        text: this.getDataset().getColumnName(this.column as number),
        transform: getTransform([
          this.svgWidth - this.margins.right,
          -this.svgHeight + this.margins.bottom + this.margins.top + LABEL_OFFSET_PX,
        ]),
      },
    });
  }

  private drawYAxis() {
    drawAxis(this.$refs.yAxis as SVGElement, this.yScale, {
      classes: 'y',
      orient: 'left',
      transform: getTransform([this.margins.left, 0]),
    });
  }

  /**
   * Determines the maximum length of the y axis ticks and sets the left margin accordingly.
   */
  private updateLeftMargin() {
    this.drawYAxis();
    const $content = $(this.$refs.content);
    const isVisible = $content.is(':visible');
    if (!isVisible) {
      // getBBox() requires the SVG to be visible to return valid sizes
      $content.show();
    }
    const maxTickWidth = _.max($(this.$refs.yAxis as SVGGElement)
      .find('.y > .tick > text')
      .map((index: number, element: SVGGraphicsElement) => element.getBBox().width)) || 0;
    this.margins.left = DEFAULT_PLOT_MARGINS.left + maxTickWidth;
    (this.xScale as AnyScale).range([this.margins.left, this.svgWidth - this.margins.right]);
    if (!isVisible) {
      $content.hide();
    }
  }
}