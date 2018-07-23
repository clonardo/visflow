import { Component, Vue } from 'vue-property-decorator';
import VueRouter from 'vue-router';
import $ from 'jquery';
import '@/common/jquery-ui';

import AppHeader from '@/components/app-header/app-header';
import AppModals from './app-modals/app-modals';
import SystemMessage from '@/components/system-message/system-message';
import ContextMenu from '@/components/context-menu/context-menu';
import NodePanel from '@/components/node-panel/node-panel';
import DataflowCanvas from '@/components/dataflow-canvas/dataflow-canvas';
import QuickNodePanel from '@/components/quick-node-panel/quick-node-panel';
import ns from '@/store/namespaces';
import { systemMessageErrorHandler } from '@/common/util';

@Component({
  components: {
    AppHeader,
    SystemMessage,
    ContextMenu,
    NodePanel,
    QuickNodePanel,
    DataflowCanvas,
    AppModals,
  },
})
export default class App extends Vue {
  @ns.dataflow.Mutation('setCanvas') private setCanvas!: (canvas: Vue) => void;
  @ns.dataflow.Action('loadDiagram') private dispatchLoadDiagram!: (filename: string) => Promise<string>;
  @ns.panels.Mutation('setOptionPanelMount') private setOptionPanelMount!: (mount: Vue) => void;
  @ns.panels.Mutation('setPortPanelMount') private setPortPanelMount!: (mount: Vue) => void;
  @ns.panels.Mutation('openQuickNodePanel') private openQuickNodePanel!: () => void;
  @ns.modals.Mutation('setNodeModalMount') private setNodeModalMount!: (mount: Vue) => void;
  @ns.contextMenu.Mutation('setMount') private setContextMenuMount!: (mount: Vue) => void;
  @ns.interaction.State('isSystemInVisMode') private isSystemInVisMode!: boolean;
  @ns.interaction.Mutation('keydown') private interactionKeydown!: (key: string) => void;
  @ns.interaction.Mutation('keyup') private interactionKeyup!: (key: string) => void;
  @ns.router.Mutation('setRouter') private setRouter!: (router: VueRouter) => void;

  get diagramShareLink(): string {
    return this.$route.params.shareLink;
  }

  get diagramFilename(): string {
    return this.$route.params.filename;
  }

  private created() {
    this.setRouter(this.$router);
  }

  private mounted() {
    this.setCanvas(this.$refs.dataflowCanvas as Vue);
    this.setOptionPanelMount(this.$refs.optionPanelMount as Vue);
    this.setPortPanelMount(this.$refs.portPanelMount as Vue);
    this.setContextMenuMount(this.$refs.contextMenuMount as Vue);
    this.setNodeModalMount(this.$refs.nodeModalMount as Vue);

    this.initKeyHandlers();

    // On page load check if we need to load diagram.
    if (this.diagramFilename) {
      this.dispatchLoadDiagram(this.diagramFilename)
        .catch(systemMessageErrorHandler(this.$store));
    }
  }

  /** Adds event handlers to global keystrokes. */
  private initKeyHandlers() {
    $(document)
      .keydown(this.onKeydown)
      .keyup(this.onKeyup);
  }

  private removeKeyHandlers() {
    $(document)
      .off('keydown', this.onKeydown)
      .off('keyup', this.onKeyup);
  }

  private onKeydown(evt: JQuery.Event) {
    // On initial mouse click, form-control keydown event (from modal) may be bubbled up without key value set.
    // The reason for !evt.key is unknown. We ignore event with falsy evt.key.
    if (!evt.key || $(evt.target).is('input')) {
      return;
    }
    this.interactionKeydown(evt.key as string);
  }

  private onKeyup(evt: JQuery.Event) {
    if (!evt.key || $(evt.target).is('input')) {
      return;
    }
    this.interactionKeyup(evt.key as string);
  }

  private addNode() {
    this.openQuickNodePanel();
  }

  private beforeDestroy() {
    this.removeKeyHandlers();
  }
}