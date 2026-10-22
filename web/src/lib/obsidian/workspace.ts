import { Events, Component } from './events';
import { createDiv, createEl } from './dom';
import { useStore } from '../store';
import { getActiveEditor } from '../activeEditor';
import { Editor, editorEntries, refreshPluginExtensions } from './editor';
import type { TFile } from './vault';
import { Modal } from './ui';
import type { SidebarTab } from '../sidebarTabs';

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
    if (this.file) await (await import('../writing/format')).manualSave(this.file.path);
  }
}
export class WorkspaceLeaf extends Events {
  id: string = crypto.randomUUID();
  pinned = false;
  view: View;
  parent: any;
  private modal?: Modal;
  private generation = 0;
  private mounting: Promise<void> = Promise.resolve();
  private mountedState = '';
  constructor(
    public workspace: Workspace,
    public slot: 'main' | 'split' | 'custom' | 'right' = 'main'
  ) {
    super();
    this.view = new MarkdownView(this);
  }
  get containerEl() {
    return this.view.containerEl;
  }
  async openFile(file: TFile, state?: any) {
    if (this.slot === 'right') {
      await this.setViewState({ type: 'markdown', state: { file: file.path } });
      return;
    }
    if (this.slot === 'split') await useStore.getState().openToSide(file.path);
    else await useStore.getState().openFile(file.path);
    this.view =
      this.workspace.markdown(this.slot === 'split' ? 'split' : 'main') ??
      this.view;
    if (state?.eState?.line != null)
      (this.view as MarkdownView).editor?.setCursor(state.eState.line, 0);
  }
  async setViewState(state: any) {
    // The same view object/lifecycle can be hosted by a dock instead of a modal.
    if (state.type === 'webviewer' && this.slot !== 'right') {
      await this.closeView();
      this.slot = 'right';
    }
    if (this.slot === 'right') {
      const retained = this.workspace.custom.has(this);
      this.workspace.custom.add(this);
      if (!await useStore.getState().openRightTab(state.type, state.state ?? {}, this.id) && !retained) this.workspace.custom.delete(this);
      return;
    }
    if (state.type === 'markdown') {
      const file = this.workspace.app.vault.getFileByPath(state.state?.file);
      if (file) await this.openFile(file);
      return;
    }
    await this.closeView();
    this.slot = 'custom';
    this.modal = new Modal(this.workspace.app);
    this.modal.onClose = () => {
      void this.closeView();
    };
    this.modal.open();
    await this.mountView(state, this.modal.contentEl);
    this.modal?.setTitle(this.view.getDisplayText());
    this.workspace.trigger('layout-change');
  }
  mountView(state: { type: string; state: any }, host: HTMLElement): Promise<void> {
    const generation = this.generation;
    return this.mounting = this.mounting.catch(() => {}).then(async () => {
      if (generation === this.generation) await this.mountViewNow(state, host);
    });
  }
  private async mountViewNow(state: { type: string; state: any }, host: HTMLElement) {
    const generation = this.generation;
    if (this.workspace.custom.has(this) && this.view.getViewType() === state.type) {
      if (this.view.containerEl.parentElement !== host) host.replaceChildren(this.view.containerEl);
      const next = JSON.stringify(state.state ?? {});
      if (this.mountedState !== next) {
        await this.view.setState(state.state ?? {}, {});
        this.mountedState = next;
      }
      return;
    }
    const creator = this.workspace.viewRegistry.get(state.type);
    if (!creator) throw new Error(`视图尚未注册：${state.type}`);
    const previous = this.view;
    if (this.workspace.custom.delete(this)) { try { await previous.onClose(); } finally { previous.unload(); } }
    if (generation !== this.generation) return;
    const view = this.view = creator(this);
    this.workspace.custom.add(this);
    try {
      await view.load();
      if (generation !== this.generation) return;
      // A guest must have its validated URL before Electron attaches the element.
      if (state.type !== 'webviewer') host.replaceChildren(view.containerEl);
      await view.setState(state.state ?? {}, {});
      this.mountedState = JSON.stringify(state.state ?? {});
      if (generation !== this.generation) return;
      if (state.type === 'webviewer') host.replaceChildren(view.containerEl);
      await view.onOpen();
      if (generation === this.generation) this.workspace.updateRightLeaf(this);
    } catch (error) {
      if (generation === this.generation) {
        this.workspace.custom.delete(this);
        try { await view.onClose(); } finally { view.unload(); }
      }
      throw error;
    }
  }
  getViewState() {
    if (this.slot === 'right') {
      const tab = useStore.getState().rightTabs.find(tab => tab.id === this.id);
      if (tab) return { type: tab.type, state: tab.state };
    }
    return { type: this.view.getViewType(), state: this.view.getState() };
  }
  async closeView() {
    this.generation++;
    this.mountedState = '';
    const modal = this.modal;
    this.modal = undefined;
    const view = this.view;
    if (this.workspace.custom.delete(this)) {
      await this.mounting.catch(() => {});
      try { await view.onClose(); } finally { view.unload(); }
    }
    if (modal) {
      modal.onClose = () => {};
      modal.close();
    }
  }
  detach() {
    if (this.slot === 'right') void useStore.getState().closeRightTab(this.id);
    else if (this.slot === 'custom') void this.closeView();
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
  rightLeaf(tab: SidebarTab): WorkspaceLeaf {
    let leaf = [...this.custom].find(leaf => leaf.id === tab.id && leaf.slot === 'right');
    if (!leaf) { leaf = new WorkspaceLeaf(this, 'right'); leaf.id = tab.id; this.custom.add(leaf); }
    return leaf;
  }
  updateRightLeaf(leaf: WorkspaceLeaf) {
    if (leaf.slot !== 'right' || leaf.view instanceof MarkdownView) return;
    const tab = useStore.getState().rightTabs.find(tab => tab.id === leaf.id);
    if (!tab || tab.type !== leaf.view.getViewType()) return;
    const patch = { state: leaf.view.getState(), title: leaf.view.getDisplayText(), icon: leaf.view.getIcon() };
    if (JSON.stringify(patch) !== JSON.stringify({ state: tab.state, title: tab.title, icon: tab.icon })) useStore.getState().updateRightTab(leaf.id, patch);
  }
  getActiveFile() {
    const active = getActiveEditor();
    const path = active?.dom.closest<HTMLElement>('[data-document-id]')?.dataset.documentId ?? useStore.getState().activePath;
    return path ? this.app.vault.getFileByPath(path) : null;
  }
  markdown(slot: 'main' | 'split' | 'right', id?: string): MarkdownView | null {
    if (slot === 'right') {
      const tab = useStore.getState().rightTabs.find(tab => tab.id === id && tab.type === 'markdown');
      if (!tab) return null;
      const entry = editorEntries().find(entry => entry.cm.dom.closest<HTMLElement>('[data-sidebar-tab]')?.dataset.sidebarTab === id);
      if (!entry) return null;
      const view = this.rightLeaf(tab).view as MarkdownView;
      view.file = entry.info.file; view.editor = new Editor(entry.cm);
      view.containerEl = entry.cm.dom.closest<HTMLElement>('.cm-host') ?? entry.cm.dom; view.contentEl = view.containerEl;
      return view;
    }
    const path =
      slot === 'split'
        ? useStore.getState().splitPath
        : useStore.getState().activePath;
    const entries = editorEntries().filter(entry => !entry.cm.dom.closest('[data-sidebar-tab]'));
    const entry =
      entries.find(
        (e) =>
          e.info.file?.path === path &&
          (slot === 'split' ? e.cm.state.readOnly : !e.cm.state.readOnly)
      ) ?? entries.find((e) => e.info.file?.path === path);
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
    const id = (document.activeElement?.closest<HTMLElement>('[data-sidebar-tab]')
      ?? cm?.dom.closest<HTMLElement>('[data-sidebar-tab]'))?.dataset.sidebarTab;
    const tab = id && useStore.getState().rightTabs.find(tab => tab.id === id);
    if (tab) { const leaf = this.rightLeaf(tab); if (tab.type === 'markdown') this.markdown('right', tab.id); return leaf; }
    return cm && cm === this.markdown('split')?.editor?.cm
      ? this.split
      : this.main;
  }
  getActiveViewOfType<T>(Type: new (...args: any[]) => T): T | null {
    const leaf = this.activeLeaf;
    const view = leaf.slot === 'right' || leaf.slot === 'custom' ? leaf.view : this.markdown(leaf.slot);
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
    const state = useStore.getState();
    const tab = !_split && state.rightTabs.find(tab => tab.id === state.rightActiveId);
    return tab ? this.rightLeaf(tab) : new WorkspaceLeaf(this, 'right');
  }
  getLeavesOfType(type: string) {
    const leaves: WorkspaceLeaf[] = [...this.custom].filter(leaf => {
      if (leaf.slot !== 'right') return true;
      const tab = useStore.getState().rightTabs.find(tab => tab.id === leaf.id);
      if (tab?.type === 'markdown') return !!this.markdown('right', tab.id);
      return tab?.type === leaf.view.getViewType();
    });
    for (const slot of ['main', 'split'] as const)
      if (this.markdown(slot))
        leaves.push(slot === 'main' ? this.main : this.split);
    return leaves.filter((l) => l.view.getViewType() === type);
  }
  iterateAllLeaves(cb: (leaf: WorkspaceLeaf) => void) {
    new Set([...this.getLeavesOfType('markdown'), ...this.custom]).forEach(cb);
  }
  getUnpinnedLeaf() {
    return this.getLeaf();
  }
  async revealLeaf(leaf: WorkspaceLeaf) {
    await this.setActiveLeaf(leaf);
  }
  async setActiveLeaf(leaf: WorkspaceLeaf, _options?: any) {
    if (leaf.slot === 'right') {
      useStore.getState().selectRightTab(leaf.id);
      leaf.view instanceof MarkdownView && leaf.view.editor?.focus();
      this.trigger('active-leaf-change', leaf);
      return;
    }
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
    for (const leaf of this.custom) this.updateRightLeaf(leaf);
    this.trigger('layout-change');
  }
}
