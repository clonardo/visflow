import Node from '@/components/node/node';
import { DataflowState } from '@/store/dataflow';
import store from '../index';
import _ from 'lodash';

const dataflow = (): DataflowState => store.state.dataflow;

/** Drags all selected nodes by (dx, dy). The dragged node does not additionally move. */
export const dragSelectedNodes = (dragged: Node, dx: number, dy: number) => {
  _.each(dataflow().nodes.filter(node => node.isSelected && node !== dragged), node => {
    node.moveBy(dx, dy);
  });
};

/** Deselects all selected nodes. */
export const deselectAllNodes = (options?: { exception?: Node }) => {
  const exception = options && options.exception;
  _.each(dataflow().nodes.filter(node => node.isSelected && node !== exception), node => {
    node.deselect();
  });
};