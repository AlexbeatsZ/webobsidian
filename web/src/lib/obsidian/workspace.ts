import { Events, Component } from './events';
import { createDiv, createEl } from './dom';
import { useStore } from '../store';
import { getActiveEditor } from '../activeEditor';
import { Editor, editorEntries, refreshPluginExtensions } from './editor';
import type { TFile } from './vault';
import { Modal } from './ui';

export class View extends Component {
  containerEl = createDiv({ cls: 'workspace-leaf-content' });
  scope: any;
  constructor(public leaf: WorkspaceLeaf) {
    super();
  }
  getViewType() {
    return 'view';
  }
  getDisplayText() {
    return this.getViewType();
  }
  getIcon() {
    return 'file';
  }
  async onOpen() {}
  async onClose() {}
  async setState(_state: any, _result?: any) {}
  getState(): any {
    return {};
  }
}
export class ItemView extends View {
  contentEl = createDiv({ cls: 'view-content', parent: this.containerEl });
  addAction(icon: string, title: string, cb: (e: MouseEvent) => void) {
    const el = createEl('button', {
      title,
      text: icon,
      parent: this.containerEl,
    });
    el.onclick = cb;
    return el;
  }
}
export class MarkdownView extends ItemView {
  file: TFile | null = null;
  editor!: Editor;
  getViewType() {
    return 'markdown';
  }
  getMode() {
    return this.editor?.cm.state.readOnly ? 'preview' : 'source';
  }
  get sourceMode() {
    return { cmEditor: this.editor, editor: this.editor };
  }
  get previewMode() {
    return {
      containerEl: this.containerEl,
      rerender: () => this.editor?.cm.requestMeasure(),
      renderer: { getSectionInfo: () => null },
    };
  }
  get data() {
    return this.editor?.getValue() ?? '';
  }
  getViewData() {
    return this.data;
  }
  setViewData(data: string) {
    this.editor.setValue(data);
  }
  async save() {
    await useStore.getState().save();
  }
}
export class WorkspaceLeaf extends Events {
  id = crypto.randomUUID();
  pinned = false;
  view: View;
  parent: any;
  private modal?: Modal;
  constructor(
    public workspace: Workspace,
    public slot: 'main' | 'split' | 'custom' = 'main'
  ) {
    super();
    this.view = new MarkdownView(this);
  }
  get containerEl() {
    return this.view.containerEl;
  }
  async openFile(file: TFile, state?: any) {
    if (this.slot === 'split') await useStore.getState().openToSide(file.path);
    else await useStore.getState().openFile(file.path);
    this.view =
      this.workspace.markdown(this.slot === 'split' ? 'split' : 'main') ??
      this.view;
    if (state?.eState?.line != null)
      (this.view as MarkdownView).editor?.setCursor(state.eState.line, 0);
  }
  async setViewState(state: any) {
    if (state.type === 'markdown') {
      const file = this.workspace.app.vault.getFileByPath(state.state?.file);
      if (file) await this.openFile(file);
      return;
    }
    const creator = this.workspace.viewRegistry.get(state.type);
    if (!creator) throw new Error(`Unsupported view type: ${state.type}`);
    await this.closeView();
    this.slot = 'custom';
    this.view = creator(this);
    this.workspace.custom.add(this);
    await this.view.load();
    this.modal = new Modal(this.workspace.app);
    this.modal.setTitle(this.view.getDisplayText());
    this.modal.contentEl.append(this.view.containerEl);
    this.modal.onClose = () => {
      void this.closeView();
    };
    this.modal.open();
    await this.view.setState(state.state ?? {}, {});
    await this.view.onOpen();
    this.workspace.trigger('layout-change');
  }
  getViewState() {
    return { type: this.view.getViewType(), state: this.view.getState() };
  }
  async closeView() {
    const modal = this.modal;
    this.modal = undefined;
    if (this.workspace.custom.delete(this)) {
      await this.view.onClose();
      this.view.unload();
    }
    if (modal) {
      modal.onClose = () => {};
      modal.close();
    }
  }
  detach() {
    if (this.slot === 'custom') void this.closeView();
    else {
      const file = (this.view as MarkdownView).file;
      if (file) useStore.getState().closeTab(file.path);
    }
  }
  setEphemeralState(state: any) {
    if (state.line != null)
      (this.view as MarkdownView).editor?.setCursor(state.line, 0);
  }
  getEphemeralState() {
    return {};
  }
  setPinned(value: boolean) {
    this.pinned = value;
    this.workspace.trigger('layout-change');
  }
  getRoot() {
    return this.workspace.rootSplit;
  }
}
export class Workspace extends Events {
  editorSuggest: { suggests: any[] } = { suggests: [] };
  hoverLinkSources = new Map<string, any>();
  registerHoverLinkSource(id: string, info: any) {
    this.hoverLinkSources.set(id, info);
  }
  unregisterHoverLinkSource(id: string) {
    this.hoverLinkSources.delete(id);
  }
  viewRegistry = new Map<string, (leaf: WorkspaceLeaf) => View>();
  custom = new Set<WorkspaceLeaf>();
  private main: WorkspaceLeaf;
  private split: WorkspaceLeaf;
  private ready = false;
  private readyQueue: (() => void)[] = [];
  constructor(public app: any) {
    super();
    this.main = new WorkspaceLeaf(this);
    this.split = new WorkspaceLeaf(this, 'split');
  }
  get containerEl() {
    return document.querySelector('.app') ?? document.body;
  }
  get rootSplit(): any {
    return {
      children: this.getLeavesOfType('markdown'),
      getRoot: () => this.rootSplit,
    };
  }
  get leftSplit(): any {
    return {
      collapsed: !useStore.getState().leftOpen,
      expand: () => {
        if (!useStore.getState().leftOpen) useStore.getState().toggleLeft();
      },
      collapse: () => {
        if (useStore.getState().leftOpen) useStore.getState().toggleLeft();
      },
    };
  }
  get rightSplit(): any {
    return {
      collapsed: !useStore.getState().rightOpen,
      expand: () => {
        if (!useStore.getState().rightOpen) useStore.getState().toggleRight();
      },
    };
  }
  get layoutReady() {
    return this.ready;
  }
  onLayoutReady(cb: () => void) {
    if (this.ready) queueMicrotask(cb);
    else this.readyQueue.push(cb);
  }
  markReady() {
    this.ready = true;
    for (const cb of this.readyQueue.splice(0)) {
      try {
        cb();
      } catch (e) {
        console.error(e);
      }
    }
    this.trigger('layout-ready');
  }
  reset() {
    this.ready = false;
    this.readyQueue = [];
    for (const leaf of this.custom) leaf.detach();
  }
  getActiveFile() {
    const active = getActiveEditor();
    const path =
      active?.dom.closest<HTMLElement>('[data-document-id]')?.dataset
        .documentId ?? useStore.getState().activePath;
    return path ? this.app.vault.getFileByPath(path) : null;
  }
  markdown(slot: 'main' | 'split'): MarkdownView | null {
    const path =
      slot === 'split'
        ? useStore.getState().splitPath
        : useStore.getState().activePath;
    const entry =
      editorEntries().find(
        (e) =>
          e.info.file?.path === path &&
          (slot === 'split' ? e.cm.state.readOnly : !e.cm.state.readOnly)
      ) ?? editorEntries().find((e) => e.info.file?.path === path);
    if (!entry) return null;
    const leaf = slot === 'main' ? this.main : this.split;
    const view = leaf.view as MarkdownView;
    view.file = entry.info.file;
    view.editor = new Editor(entry.cm);
    view.containerEl =
      entry.cm.dom.closest<HTMLElement>('.cm-host') ?? entry.cm.dom;
    view.contentEl = view.containerEl;
    return view;
  }
  get activeLeaf() {
    const cm = getActiveEditor();
    return cm && cm === this.markdown('split')?.editor?.cm
      ? this.split
      : this.main;
  }
  getActiveViewOfType<T>(Type: new (...args: any[]) => T): T | null {
    const view = this.markdown(
      this.activeLeaf.slot === 'split' ? 'split' : 'main'
    );
    return view instanceof Type ? view : null;
  }
  getMostRecentLeaf() {
    return this.activeLeaf;
  }
  getLastOpenFiles() {
    return useStore.getState().recent;
  }
  getLeaf(newLeaf?: boolean | string) {
    return newLeaf === 'split'
      ? this.split
      : newLeaf
        ? new WorkspaceLeaf(this, 'custom')
        : this.activeLeaf;
  }
  getLeftLeaf(_split?: boolean) {
    return new WorkspaceLeaf(this, 'custom');
  }
  getRightLeaf(_split?: boolean) {
    return new WorkspaceLeaf(this, 'custom');
  }
  getLeavesOfType(type: string) {
    const leaves: WorkspaceLeaf[] = [...this.custom];
    for (const slot of ['main', 'split'] as const)
      if (this.markdown(slot))
        leaves.push(slot === 'main' ? this.main : this.split);
    return leaves.filter((l) => l.view.getViewType() === type);
  }
  iterateAllLeaves(cb: (leaf: WorkspaceLeaf) => void) {
    this.getLeavesOfType('markdown').forEach(cb);
    this.custom.forEach(cb);
  }
  getUnpinnedLeaf() {
    return this.getLeaf();
  }
  async revealLeaf(leaf: WorkspaceLeaf) {
    await this.setActiveLeaf(leaf);
  }
  async setActiveLeaf(leaf: WorkspaceLeaf, _options?: any) {
    const file = (leaf.view as MarkdownView).file;
    if (file) await useStore.getState().openFile(file.path);
    leaf.view instanceof MarkdownView && leaf.view.editor?.focus();
    this.trigger('active-leaf-change', leaf);
  }
  async openLinkText(
    link: string,
    source: string,
    newLeaf?: boolean,
    state?: any
  ) {
    const file = this.app.metadataCache.getFirstLinkpathDest(link, source);
    if (file) await (newLeaf ? this.split : this.main).openFile(file, state);
    else await useStore.getState().openWikilink(link, source);
  }
  detachLeavesOfType(type: string) {
    this.getLeavesOfType(type).forEach((l) => l.detach());
  }
  updateOptions() {
    refreshPluginExtensions();
    for (const e of editorEntries()) e.cm.requestMeasure();
    this.trigger('layout-change');
  }
  requestSaveLayout() {
    this.trigger('layout-change');
  }
}
