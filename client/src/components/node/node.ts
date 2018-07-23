import { Component, Vue, Watch } from 'vue-property-decorator';
import { TweenLite } from 'gsap';
import $ from 'jquery';
import _ from 'lodash';

import { checkEdgeConnectivity } from '@/store/dataflow';
import { CreateNodeData } from '@/store/dataflow/types';
import { DEFAULT_ANIMATION_DURATION_S, PORT_SIZE_PX, PORT_MARGIN_PX, ICONIZED_NODE_SIZE_PX } from '@/common/constants';
import { DragNodePayload } from '@/store/interaction';
import { NodeSave } from './types';
import { Port, InputPort, OutputPort } from '@/components/port';
import ContextMenu from '@/components/context-menu/context-menu';
import Edge from '@/components/edge/edge';
import GlobalClick from '@/directives/global-click';
import NodeCover from './node-cover.vue';
import NodeLabel from './node-label.vue';
import ns from '@/store/namespaces';
import OptionPanel, { OptionPanelInitialState } from '@/components/option-panel/option-panel';
import template from './node.html';

const GRID_SIZE = 10;

@Component({
  components: {
    NodeLabel,
    NodeCover,
    ContextMenu,
    OptionPanel,
    Port,
  },
  directives: {
    GlobalClick,
  },
  template,
})
export default class Node extends Vue {
  public id!: string;
  public layer = 0;
  // whether the node is focused and its option panel is shown
  public isActive = false;
  // whether the node is among the current selection, which may contain multiple nodes
  public isSelected = false;
  // whether the propagation should start from this node
  public isPropagationSource = false;

  public get isVisible(): boolean {
    return !this.isSystemInVisMode || this.isInVisMode;
  }

  public get nodeType(): string {
    return this.NODE_TYPE;
  }

  @ns.dataflow.Mutation('portUpdated') protected portUpdated!: (port: Port) => void;

  protected NODE_TYPE = 'node';
  protected DEFAULT_WIDTH = 50;
  protected DEFAULT_HEIGHT = 50;
  protected MIN_WIDTH = 30;
  protected MIN_HEIGHT = 30;
  protected RESIZABLE = false;
  protected ENLARGEABLE = false; // if the node can be enlarged to fullscreen modal

  protected label = '';

  // ports: input/output port id's must be unique
  protected inputPorts: InputPort[] = [];
  protected outputPorts: OutputPort[] = [];
  // Maps port id to port.
  protected inputPortMap: { [id: string]: InputPort } = {};
  protected outputPortMap: { [id: string]: OutputPort } = {};

  // Layout related properties.
  // Changing width and height will resize the node.
  protected width = 0; // initialized in created()
  protected height = 0; // initialized in created()
  protected dataflowX = 0; // CSS "left" in the dataflow, when not iconized
  protected dataflowY = 0; // CSS "top" in the dataflow, when not iconized
  protected dataflowWidth = 0; // width when not iconized
  protected dataflowHeight = 0; // height when not iconized
  // Changing x and y will change the position of the node.
  protected x = 0; // CSS "left" of top-left corner
  protected y = 0; // CSS "top" of top-left corner
  protected isIconized = false;
  protected isInVisMode = false;
  protected isLabelVisible = false;
  protected isEnlarged = false;

  // These are the options passed to the node on node creation, and are only used once in created().
  protected dataOnCreate: CreateNodeData = {};

  protected isDragging = false;

  /**
   * The serialization chain is a list of functions to be called to generate the serialized NodeSave.
   * The functions are pushed to the list in the created() call of base node and inheritting node sequentially.
   * We utilize the Vue design that all created() of base and inheritting node classes are called.
   *
   * The deserialization chain is similar and assigns values in NodeSave to the deserialized node.
   * Each function in the chain is called sequentially after the NodeSave is written to the node.
   */
  protected serializationChain: Array<() => {}> = [];
  protected deserializationChain: Array<(save: {}) => void> = [];

  protected coverText: string = '';

  // A list of classes to be added to the node container. Push to this list on inheritting node's created() call.
  protected containerClasses: string[] = ['node'];

  // Flag to indicate the node is in transition to its next position / size. When this is true, the node should avoid
  // costly operation such as re-rendering.
  protected isAnimating = false;

  @ns.interaction.Getter('isShiftPressed') protected isShiftPressed!: boolean;

  private isDragged = false;
  private isMousedowned = false;

  private visModeX = 0;
  private visModeY = 0;
  private visModeWidth = 0;
  private visModeHeight = 0;

  private isIconizedBeforeVisMode = false;

  get numInputPorts(): number {
    return this.inputPorts.length;
  }

  get numOutputPorts(): number {
    return this.outputPorts.length;
  }

  get allPorts(): Port[] {
    return _.concat(this.inputPorts as Port[], this.outputPorts);
  }

  get optionPanelInitialState(): OptionPanelInitialState {
    return {
      isIconized: this.isIconized,
      isInVisMode: this.isInVisMode,
      isLabelVisible: this.isLabelVisible,
    };
  }

  get getIconPath() {
    return this.getImgSrc(this.NODE_TYPE);
  }

  get isContentVisible(): boolean {
    return !this.coverText && !this.isAnimating && this.isExpanded;
  }

  get isIconVisible(): boolean {
    return !this.isExpanded && !this.isAnimating;
  }

  get isExpanded(): boolean {
    return this.isEnlarged || !this.isIconized || (this.isSystemInVisMode && this.isInVisMode);
  }

  get arePortsVisible(): boolean {
    return !this.isEnlarged && !this.isSystemInVisMode;
  }

  get displayX(): number {
    if (this.isSystemInVisMode) {
      return this.visModeX;
    }
    if (this.isIconized) {
      return this.dataflowX + this.dataflowWidth / 2 - ICONIZED_NODE_SIZE_PX / 2;
    }
    return this.dataflowX;
  }

  get displayY(): number {
    if (this.isSystemInVisMode) {
      return this.visModeY;
    }
    if (this.isIconized) {
      return this.dataflowY + this.dataflowHeight / 2 - ICONIZED_NODE_SIZE_PX / 2;
    }
    return this.dataflowY;
  }

  get displayWidth(): number {
    if (this.isSystemInVisMode) {
      return this.visModeWidth;
    }
    return this.isIconized ? ICONIZED_NODE_SIZE_PX : this.dataflowWidth;
  }

  get displayHeight(): number {
    if (this.isSystemInVisMode) {
      return this.visModeHeight;
    }
    return this.isIconized ? ICONIZED_NODE_SIZE_PX : this.dataflowHeight;
  }

  get displayCss(): { left: number, top: number, width: number, height: number} {
    return {
      left: this.displayX,
      top: this.displayY,
      width: this.displayWidth,
      height: this.displayHeight,
    };
  }

  @ns.dataflow.Getter('topNodeLayer') private topNodeLayer!: number;
  @ns.dataflow.Getter('getImgSrc') private getImgSrc!: (type: string) => string;
  @ns.dataflow.Mutation('incrementNodeLayer') private incrementNodeLayer!: () => void;
  @ns.dataflow.Mutation('removeNode') private dataflowRemoveNode!: (node: Node) => void;
  @ns.interaction.State('isSystemInVisMode') private isSystemInVisMode!: boolean;
  @ns.interaction.Mutation('dropPortOnNode') private dropPortOnNode!: (node: Node) => void;
  @ns.interaction.Mutation('dragNode') private dragNode!: (payload: DragNodePayload) => void;
  @ns.interaction.Mutation('clickNode') private clickNode!: (node: Node) => void;
  @ns.systemOptions.State('nodeLabelsVisible') private nodeLabelsVisible!: boolean;
  @ns.panels.Mutation('mountOptionPanel') private mountOptionPanel!: (panel: Vue) => void;

  public findConnectablePort(port: Port): Port | null {
    if (port.isInput) {
      for (const output of this.outputPorts) {
        const connectivity = checkEdgeConnectivity(output, port);
        if (connectivity.connectable) {
          return output;
        }
      }
    } else {
      for (const input of this.inputPorts) {
        const connectivity = checkEdgeConnectivity(port, input);
        if (connectivity.connectable) {
          return input;
        }
      }
    }
    return null;
  }

  /** Retrieves the ids of the nodes that this node connects to via output ports. */
  public getOutputNodes(): Node[] {
    const nodes: Set<Node> = new Set();
    for (const port of this.outputPorts) {
      const outputs = port.getConnectedNodes();
      for (const node of outputs) {
        nodes.add(node);
      }
    }
    return Array.from(nodes);
  }

  public getBoundingBox(): Box {
    const $node = $(this.$refs.node);
    const width = $node.width() as number;
    const height = $node.height() as number;
    const offset = $node.offset() as JQueryCoordinates;
    return {
      x: offset.left,
      y: offset.top,
      width,
      height,
    };
  }

  /** Makes the node activated. This is typically auto-triggered by mouse click on the node. */
  public activate() {
    this.isActive = true;
    // Activating the node implies selecting it.
    // Must use $nextTick because $refs.optionPanel appears asynchronously after isActive becomes true.
    this.$nextTick(() => this.mountOptionPanel(this.$refs.optionPanel as Vue));
  }

  /** Makes the node deactivated. This is typically auto-triggered by clicking outside the node. */
  public deactivate() {
    this.isActive = false;
  }

  public select() {
    this.isSelected = true;
  }

  public deselect() {
    this.isSelected = false;
  }

  public getAllEdges(): Edge[] {
    let edges: Edge[] = [];
    for (const port of this.allPorts) {
      edges = edges.concat(port.getAllEdges());
    }
    return edges;
  }

  public getOutputEdges(): Edge[] {
    let edges: Edge[] = [];
    for (const port of this.outputPorts) {
      edges = edges.concat(port.getAllEdges());
    }
    return edges;
  }

  /** Moves the node to a given position. */
  public moveTo(x: number, y: number) {
    this.x = x;
    this.y = y;
  }

  /** Moves the node by the given (dx, dy) from its current position. */
  public moveBy(dx: number, dy: number) {
    this.x += dx;
    this.y += dy;
  }

  /**
   * Starts a node update by first checking if the update is necessary.
   * An update is necessary when some input port has changed package.
   */
  public startUpdate() {
    if (this.isUpdateNecessary()) {
      this.update();
    }
  }

  /** Clears the updated flags of all ports. */
  public clearUpdatedPorts() {
    for (const port of this.inputPorts) {
      // Packages of input ports solely depend on its connected output ports. So there are no packge update
      // flags to clear.
      port.clearConnectionUpdate();
    }
    for (const port of this.outputPorts) {
      port.clearPackageUpdate();
      port.clearConnectionUpdate();
    }
  }

  public getInputPort(id: string): InputPort {
    if (!(id in this.inputPortMap)) {
      console.error(`port "${id}" is not an input port of node "${id}"`);
    }
    return this.inputPortMap[id] as InputPort;
  }

  public getOutputPort(id: string): OutputPort {
    if (!(id in this.outputPortMap)) {
      console.error(`port "${id}" is not an output port of node "${id}"`);
    }
    return this.outputPortMap[id] as OutputPort;
  }

  /**
   * Serializes the node into a NodeSave object.
   * serialize() shall not be overridden from its base class implementation.
   */
  public serialize(): NodeSave {
    // Call each function in the serialization chain to store node attributes into the save object.
    return this.serializationChain.reduce((save, f) => {
      return _.extend(save, f());
    }, {}) as NodeSave;
  }

  /**
   * Deserializes the node from a NodeSave object.
   * deserialize() shall not be overridden from its base class implementation.
   */
  public deserialize(save: NodeSave) {
    // _.extend(this, save);
    this.deserializationChain.forEach(f => f(save));
  }

  /**
   * Updates all outputs based on the (possibly) new inputs. This is called by dataflow propagation.
   * Inheriting node types should implement this method to define how they output data.
   *
   * Each node type is responsible for setting the packages of output ports and notify the global store
   * to propagate the changes.
   *
   * @abstract
   */
  protected update() {
    console.error(`update() is not implemented for node type "${this.NODE_TYPE}"`);
  }

  protected created() {
    this.label = this.id;

    this.createPorts();
    this.createPortMap();

    this.update(); // Update to show proper coverText even when there is no connection

    // Base serialization
    this.serializationChain.push((): NodeSave => ({
        id: this.id,
        type: this.NODE_TYPE,
        layer: this.layer,
        label: this.label,
        isIconized: this.isIconized,
        isInVisMode: this.isInVisMode,
        isLabelVisible: this.isLabelVisible,

        dataflowX: this.dataflowX,
        dataflowY: this.dataflowY,
        dataflowWidth: this.dataflowWidth,
        dataflowHeight: this.dataflowHeight,
        visModeX: this.visModeX,
        visModeY: this.visModeY,
        visModeWidth: this.visModeWidth,
        visModeHeight: this.visModeHeight,
    }));
  }

  /**
   * Defines the input ports for the node. Inheriting nodes may override this method.
   */
  protected createInputPorts() {
    this.inputPorts = [];
  }

  /**
   * Defines the output ports for the node. Inheriting nodes may override this method.
   */
  protected createOutputPorts() {
    this.outputPorts = [];
  }

  /**
   * Displays the node in fullscreen.
   */
  protected enlarge() {}

  /**
   * Responds to width/height changes.
   */
  protected onResizeStart() {}
  protected onResize() {}
  protected onResizeStop() {}

  /**
   * Responds to node enlarge.
   */
  protected onEnlarge() {}

  /**
   * Determintes whether the node should respond to dragging.
   * Override this method to disable dragging under some conditions, e.g. when visualization selection is prioritized.
   */
  protected isDraggable(evt: Event, ui: JQueryUI.DraggableEventUIParams) {
    return true;
  }

  protected enableDraggable() {
    $(this.$refs.node).draggable('enable');
  }
  protected disableDraggable() {
    $(this.$refs.node).draggable('disable');
  }
  protected enableResizable() {
    if (this.RESIZABLE) {
      $(this.$refs.node).resizable('enable');
    }
  }
  protected disableResizable() {
    if (this.RESIZABLE) {
      $(this.$refs.node).resizable('disable');
    }
  }

  /** Checks if there is an input port that has updated package. */
  protected isUpdateNecessary(): boolean {
    for (const port of this.inputPorts) {
      if (port.isPackageUpdated() || port.isConnectionUpdated()) {
        return true;
      }
    }
    return false;
  }

  /**
   * We make mounted() private so that inheriting class cannot add mounted behavior.
   * Though vue supports all mounted() to be called sequentially, any inheriting class should update their
   * type-specific data and properties in created() rather than mounted().
   * ExtendedNode.created() is called before Node.mounted(), so that the updates can take effect
   * before we set up things here.
   */
  private mounted() {
    this.initDragAndResize();
    this.initDrop();
    this.initPositionAndSize();
    this.mountPorts();
    this.initDeserializedProperties();
    this.appear(); // animate node appearance
  }

  private createPorts() {
    this.createInputPorts();
    this.createOutputPorts();
  }

  /** Creates a mapping from port id to port component. */
  private createPortMap() {
    this.inputPorts.forEach(port => {
      this.inputPortMap[port.id] = port;
    });
    this.outputPorts.forEach(port => {
      this.outputPortMap[port.id] = port;
    });
  }

  /** Update the ports' coordinates when the node moves. */
  private updatePortCoordinates() {
    if (!this.arePortsVisible) {
      return;
    }
    // Port coordinates are Vue reactive and async.
    // We must update coordinates till Vue updates the ports.
    this.$nextTick(() => {
      for (const port of this.allPorts) {
        port.updateCoordinates();
      }
    });
  }

  private initDragAndResize() {
    const $node = $(this.$refs.node);
    let lastDragPosition: { left: number, top: number };
    let alreadySelected: boolean;
    $node.draggable({
      grid: [GRID_SIZE, GRID_SIZE],
      start: (evt: Event, ui: JQueryUI.DraggableEventUIParams) => {
        if (!this.isDraggable(evt, ui)) {
          return false;
        }
        this.isDragging = true;
        lastDragPosition = ui.position;
        alreadySelected = this.isSelected;
      },
      drag: (evt: Event, ui: JQueryUI.DraggableEventUIParams) => {
        const x = ui.position.left;
        const y = ui.position.top;
        if (x !== lastDragPosition.left || y !== lastDragPosition.top) {
          this.isDragged = true;
          if (!alreadySelected) {
            if (!this.isShiftPressed) {
              this.clickNode(this);
            }
            this.select();
          }
          this.dragNode({
            node: this,
            dx: x - lastDragPosition.left,
            dy: y - lastDragPosition.top,
          });
          lastDragPosition.left = x;
          lastDragPosition.top = y;
          this.x = x;
          this.y = y;
        }
      },
      stop: (evt: Event, ui: JQueryUI.DraggableEventUIParams) => {
        this.x = ui.position.left;
        this.y = ui.position.top;
        this.isDragged = false;
        this.isDragging = false;
        this.activate();
      },
    });

    if (this.RESIZABLE) {
      $node.resizable({
        handles: 'all',
        grid: GRID_SIZE,
        minWidth: this.MIN_WIDTH,
        minHeight: this.MIN_HEIGHT,
        start: () => {
          this.onResizeStart();
        },
        resize: (evt: Event, ui: JQueryUI.ResizableUIParams) => {
          this.x = ui.position.left;
          this.y = ui.position.top;
          this.width = ui.size.width;
          this.height = ui.size.height;
        },
        stop: () => {
          this.onResizeStop();
        },
      });
    }
  }

  private initDrop() {
    // Ports can be dropped on nodes to create an edge.
    $(this.$refs.background).droppable({
      /**
       * General note on using jquery callback within vue components:
       * "this" of the callback function is the Vue component.
       * If we add console.log(this) in the callback function, it may print the Vue component.
       * However in chrome debugger console if we set a breakpoint and use the debugger console to print "this",
       * the DOM element may be incorrectly printed.
       */
      drop: (evt: Event, ui: JQueryUI.DroppableEventUIParam) => {
        if (ui.draggable.hasClass('port')) {
          this.dropPortOnNode(this);
        }
      },
    });
  }

  private mountPorts() {
    const $node = $(this.$refs.node);
    for (const port of this.allPorts) {
      const container = $node.find(`#port-container-${port.id}`);
      port.$mount();
      container.append(port.$el);
    }
  }

  private initPositionAndSize() {
    const $node = $(this.$refs.node);
    $node.addClass(this.containerClasses);

    if (this.dataflowWidth === 0) {
      this.dataflowWidth = this.DEFAULT_WIDTH;
      this.dataflowHeight = this.DEFAULT_HEIGHT;
    }
    if (this.dataOnCreate.dataflowX !== undefined && this.dataOnCreate.dataflowY !== undefined) {
      this.dataflowX = this.dataOnCreate.dataflowX;
      this.dataflowY = this.dataOnCreate.dataflowY;
    } else if (this.dataOnCreate.dataflowCenterX !== undefined && this.dataOnCreate.dataflowCenterY !== undefined) {
      this.dataflowX = this.dataOnCreate.dataflowCenterX - this.dataflowWidth / 2;
      this.dataflowY = this.dataOnCreate.dataflowCenterY - this.dataflowHeight / 2;
    }
    // jQuery.draggable sets position to relative, we override here.
    $node.css({
      position: 'absolute',
    });

    this.updateDisplay();
  }

  private initDeserializedProperties() {
    this.onIconizedChangeResizable();
    // When the node is deserialized, layer is never changed and we trigger z-index setting manually.
    this.onLayerChange();
  }

  private appear() {
    TweenLite.from(this.$refs.node, DEFAULT_ANIMATION_DURATION_S, {
      scale: 1.5,
      // When the node is deserialized, without this the port coordinates are never computed after scaling.
      onComplete: this.updatePortCoordinates,
    });
  }

  private contextMenuRemove() {
    this.dataflowRemoveNode(this);
  }

  private onMousedown(evt: MouseEvent) {
    this.isMousedowned = true;
  }


  private onMouseup(evt: MouseEvent) {
    if (!this.isMousedowned) {
      return;
    }
    this.isMousedowned = false;
    if (!this.isDragged) {
      if (this.isShiftPressed) {
        // When shift is pressed, clicking a node toggles its selection.
        this.toggleSelected();
      } else {
        this.clickNode(this);
        this.select();
        this.activate();
      }
    }
  }

  private toggleSelected() {
    if (this.isSelected) {
      this.deselect();
      this.deactivate();
    } else {
      this.select();
      this.activate();
    }
  }

  private globalClick(evt: MouseEvent) {
    if (!this.isActive) {
      return;
    }
    const element = evt.target as Element;
    if (
      // If the click is on the node or its option panel, do nothing.
      this.$el.contains(element) ||
      // If the click is on a modal, do nothing.
      $(element).parents('.modal-dialog').length ||
      // If the click is on modal backdrop, do nothing.
      $(element).hasClass('modal-backdrop') ||
      // If the click is on the node's own option panel, do nothing.
      this.$refs.optionPanel && (this.$refs.optionPanel as Vue).$el.contains(evt.target as Element)) {
      return;
    }
    this.deactivate();
  }

  private onToggleIconized(val: boolean) {
    this.isIconized = val;
  }

  private onToggleInVisMode(val: boolean) {
    this.isInVisMode = val;
  }

  private onToggleLabelVisible(val: boolean) {
    this.isLabelVisible = val;
  }

  @Watch('isActive')
  private onActivatedChange(newVal: boolean) {
    if (newVal) {
      this.incrementNodeLayer();
      this.layer = this.topNodeLayer;
    }
  }

  @Watch('layer')
  private onLayerChange() {
    $(this.$refs.node).css('z-index', this.layer);
  }

  private recordX() {
    if (this.isSystemInVisMode) {
      this.visModeX = this.x;
      return;
    }
    if (!this.isIconized) {
      this.dataflowX = this.x;
    } else {
      this.dataflowX = this.x + (ICONIZED_NODE_SIZE_PX - this.dataflowWidth) / 2;
    }
  }

  private recordY() {
    if (this.isSystemInVisMode) {
      this.visModeY = this.y;
      return;
    }
    if (!this.isIconized) {
      this.dataflowY = this.y;
    } else {
      this.dataflowY = this.y + (ICONIZED_NODE_SIZE_PX - this.dataflowHeight) / 2;
    }
  }

  private recordWidth() {
    if (!this.isIconized) {
      if (!this.isSystemInVisMode) {
        this.dataflowWidth = this.width;
      } else {
        this.visModeWidth = this.width;
      }
    }
  }

  private recordHeight() {
    if (!this.isIconized) {
      if (!this.isSystemInVisMode) {
        this.dataflowHeight = this.height;
      } else {
        this.visModeHeight = this.height;
      }
    }
  }

  // Watch layout parameter changes to re-position the node and its ports reactively.
  @Watch('x')
  private onXChange() {
    $(this.$refs.node).css('left', this.x);
    this.updatePortCoordinates();
    this.recordX();
  }

  @Watch('y')
  private onYChange() {
    $(this.$refs.node).css('top', this.y);
    this.updatePortCoordinates();
    this.recordY();
  }

  @Watch('width')
  private onWidthChange() {
    $(this.$refs.node).css('width', this.width);
    this.updatePortCoordinates();
    this.onResize();
    this.recordWidth();
  }

  @Watch('height')
  private onHeightChange() {
    $(this.$refs.node).css('height', this.height);
    this.updatePortCoordinates();
    this.onResize();
    this.recordHeight();
  }

  @Watch('isEnlarged')
  private onEnlargedChange(isEnlarged: boolean) {
  }

  @Watch('isIconized')
  private onIconizedChange() {
    this.onIconizedChangeResizable();
    if (this.isSystemInVisMode) {
      return;
    }
    const $node = $(this.$refs.node);
    this.isAnimating = true;
    TweenLite.to(this.$refs.node, DEFAULT_ANIMATION_DURATION_S, {
      ...this.displayCss,
      // allow Vue transition to complete, otherwise elements will scatter when fading out
      delay: DEFAULT_ANIMATION_DURATION_S,
      onUpdate: () => {
        this.width = $node.width() as number;
        this.height = $node.height() as number;
        const offset = $node.offset() as JQuery.Coordinates;
        this.x = offset.left;
        this.y = offset.top;
        this.updatePortCoordinates();
      },
      onComplete: () => {
        this.isAnimating = false;
        this.updatePortCoordinates();
        this.onResize();
      },
    });
  }

  private onIconizedChangeResizable() {
    if (this.isIconized) {
      this.disableResizable();
    } else {
      this.enableResizable();
    }
  }

  @Watch('isSystemInVisMode')
  private onSystemVisModeChange() {
    if (!this.isInVisMode) {
      return;
    }
    if (this.isSystemInVisMode && this.visModeWidth === 0) {
      // First time entering visMode. Initialize the size and location.
      this.visModeX = this.x;
      this.visModeY = this.y;
      this.visModeWidth = this.width;
      this.visModeHeight = this.height;
    }
    if (this.isIconized) {
      // Turn on animating flag to hide rendered node in transition (which looks awkward).
      this.isAnimating = true;
      if (this.isSystemInVisMode) {
        this.isIconizedBeforeVisMode = this.isIconized;
        this.isIconized = false;
      }
    }
    TweenLite.to(this.$refs.node, DEFAULT_ANIMATION_DURATION_S, {
      ...this.displayCss,
      onComplete: () => {
        this.isAnimating = false;
        if (!this.isSystemInVisMode && this.isIconizedBeforeVisMode) {
          this.isIconized = true; // This will animate and we thus do not updateDisplay.
        } else {
          this.updateDisplay();
        }
      },
    });
  }

  /** Sets the locations of ports. */
  private portStyles(port: Port, index: number, isInputPort: boolean): { left: string, top: string } {
    const length = isInputPort ? this.inputPorts.length : this.outputPorts.length;
    const totalHeight = length * PORT_SIZE_PX + (length - 1) * PORT_MARGIN_PX;
    return {
      left: (isInputPort ? -PORT_SIZE_PX : this.width) + 'px',
      top: (this.height / 2 - totalHeight / 2 + index * (PORT_SIZE_PX + PORT_MARGIN_PX)) + 'px',
    };
  }

  private updateDisplay() {
    this.x = this.displayX;
    this.y = this.displayY;
    this.width = this.displayWidth;
    this.height = this.displayHeight;
  }
}