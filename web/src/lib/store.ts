import { manualSave } from './writing/format';
import { create } from 'zustand';
import { api, pendingMutations, type TreeNode } from './api';
import { newFileFolder, newFilePath } from './filePlacement';
import { findNode, filePaths, patchFileStat, type FileStat } from './tree';
import { documents } from './documents';
import { publishVirtualDocuments } from './virtualDocuments';
import { isGlobalContentTarget, parseLinkTarget } from '@webobsidian/markdown-core';
import { resolveContentLink } from './contentReferences';
import { navigateTo, captureLocation, cancelNavigation, type NavigationLocation, type NavigationRequest, type LinkIntent } from './fragmentNavigation';
import { sidebarTab, restoreSidebarTabs, type SidebarTab } from './sidebarTabs';
import { getActiveEditor, activateNavigation, getActiveNavigationId } from './activeEditor';
import { contextOf } from './renderContext';
import type { MenuContext } from './configuredMenus/types';
import { TEXT_EXT_RE } from './media';
let openGeneration = 0;
let splitGeneration = 0;
const rightGenerations = new Map<string, number>();
let rightGeneration = 0;
const linkGenerations = new Map<string, number>();

async function saveLeavingSidebarTab(tab: SidebarTab | undefined): Promise<void> {
  await documents.saveLeaving(tab?.type === 'markdown' ? tab.state.file : undefined);
}

/** Per-tab id so we can ignore the echo of our own server-pushed state change. */
export const CLIENT_ID = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export type ViewMode = 'live' | 'source' | 'reading';
export type TreeSort =
  | 'name-asc' | 'name-desc'
  | 'mtime-desc' | 'mtime-asc'
  | 'ctime-desc' | 'ctime-asc';
const TREE_SORTS: TreeSort[] = ['name-asc', 'name-desc', 'mtime-desc', 'mtime-asc', 'ctime-desc', 'ctime-asc'];

/** Sentinel tab path for the Graph view (it lives in a tab, like Obsidian). */
export const GRAPH_PATH = 'graph://view';
export const isHomepagePath = (path: string | null): boolean => /^home:\/\/[\w-]+$/.test(path ?? '');
const tabTitle = (path: string) => isHomepagePath(path) ? 'Homepage' : path === GRAPH_PATH ? '关系图谱' : path.split('/').pop() ?? path;

export interface Tab {
  path: string;
  title: string;
}

/** A color group in the graph (nodes matching `query` are tinted `color`). */
export interface GraphGroup {
  query: string;
  color: string;
}

/** Persisted Graph view filters/display/forces — mirrors Obsidian's graph panel. */
export interface GraphSettings {
  // filters
  search: string;
  tags: boolean;
  attachments: boolean;
  existingOnly: boolean;
  orphans: boolean;
  // groups
  groups: GraphGroup[];
  // display (Obsidian's native ranges/defaults)
  arrows: boolean;
  textFade: number; // -3..3, default 0 — higher = labels need more zoom
  nodeSize: number; // 0.1..5, default 1
  linkThickness: number; // 0.1..5, default 1
  // forces (Obsidian's native ranges/defaults)
  centerForce: number; // 0..1, default 0.52
  repelForce: number; // 0..20, default 10
  linkForce: number; // 0..1, default 1
  linkDistance: number; // 30..500, default 250
}

export const DEFAULT_GRAPH_SETTINGS: GraphSettings = {
  search: '',
  tags: false,
  attachments: false,
  existingOnly: false,
  orphans: true,
  groups: [],
  arrows: false,
  textFade: 0,
  nodeSize: 1,
  linkThickness: 1,
  centerForce: 0.52,
  repelForce: 10,
  linkForce: 1,
  linkDistance: 250,
};

export interface ContextMenuItem {
  id?: string;
  label: string;
  disabled?: boolean;
  checked?: boolean;
  section?: string;
  group?: string;
  danger?: boolean;
  separator?: boolean;
  icon?: string;
  onClick?: (event?: MouseEvent) => void;
  submenu?: ContextMenuItem[];
}

export interface ContextMenuState {
  x: number;
  y: number;
  items: ContextMenuItem[];
  context?: MenuContext;
}

interface AppState {
  tree: TreeNode | null;
  filePaths: string[];
  lastFileChange: { path: string; stat: FileStat } | null;
  applyFileStat: (path: string, stat: FileStat) => boolean;
  loadTree: () => Promise<void>;

  tabs: Tab[];
  activePath: string | null;
  /** Back/forward navigation stack of visited paths (incl. GRAPH_PATH). */
  history: NavigationLocation[];
  viewHistories: Record<string, { history: NavigationLocation[]; histIndex: number }>;
  currentViewId: () => string;
  currentPath: (viewId?: string) => string | null;
  recordNavigation: (before: NavigationLocation, after: NavigationLocation) => void;
  navigate: (path: string, request?: NavigationRequest) => Promise<void>;
  histIndex: number;
  goBack: () => void;
  goForward: () => void;
  content: string;
  dirty: boolean;
  vaultSessionStale: boolean;
  viewMode: ViewMode;
  setViewMode: (m: ViewMode) => void;
  pdfToolbarOpen: boolean;
  setPdfToolbarOpen: (open: boolean) => void;
  togglePdfToolbar: () => void;

  // expanded folders in the file tree (persisted)
  expanded: string[];
  toggleFolder: (path: string) => void;
  setExpanded: (paths: string[]) => void;
  // file tree sort order + auto-reveal active file (both persisted)
  treeSort: TreeSort;
  setTreeSort: (s: TreeSort) => void;
  autoReveal: boolean;
  toggleAutoReveal: () => void;

  // split pane (open to the side)
  splitPath: string | null;
  splitContent: string;
  /** Which edge the split pane is docked to ('right' = columns, 'down' = rows). */
  splitDirection: 'right' | 'down';
  openToSide: (path: string, direction?: 'right' | 'down') => Promise<void>;
  /** Leave split view; both pages stay open as tabs. */
  closeSplit: () => Promise<void>;
  /** Browser-style split: keep `path` (default: the main page) and open a Homepage on the new side. */
  splitWithHomepage: (path?: string | null, direction?: 'right' | 'down') => Promise<void>;
  /** Close one central pane and its tab; the remaining pane fills the workspace. */
  closePane: (viewId: 'main' | 'split') => Promise<void>;
  /** A split group set aside while another tab is shown alone; selecting either member restores it. */
  parkedSplit: { main: string; side: string; direction: 'right' | 'down' } | null;
  /** Select a tab like a browser: a split group behaves as one tab. */
  showTab: (path: string) => Promise<void>;
  /** Put a tab into one pane of the visible split group; the page it replaces takes the tab's old place. */
  replacePane: (viewId: 'main' | 'split', path: string) => Promise<void>;

  recent: string[];
  removeRecent: (path: string) => void;
  bookmarks: string[];
  toggleBookmark: (path: string) => void;

  /** Path(s) the "Move to…" folder picker is acting on (null = closed). An array = bulk move. */
  movePath: string | string[] | null;
  setMovePath: (path: string | string[] | null) => void;

  /** Multi-selected file/folder paths in the tree (Shift/Cmd-click); never persisted. */
  selected: string[];
  setSelected: (paths: string[]) => void;
  /** Anchor row for Shift-click range selection. */
  selectAnchor: string | null;
  setSelectAnchor: (path: string | null) => void;

  /** File/folder copied or cut, awaiting paste (session-local, never persisted). */
  clipboard: { path: string; mode: 'copy' | 'cut' } | null;
  setClipboard: (c: { path: string; mode: 'copy' | 'cut' } | null) => void;

  leftPanel: 'files' | 'search';
  setLeftPanel: (p: 'files' | 'search') => void;
  rightPanel: 'properties' | 'backlinks' | 'outgoing' | 'tags' | 'outline' | 'minimap' | 'mcp';
  setRightPanel: (p: 'properties' | 'backlinks' | 'outgoing' | 'tags' | 'outline' | 'minimap' | 'mcp') => void;
  rightTabs: SidebarTab[];
  rightActiveId: string | null;
  leftActiveId: string | null;
  openSidebarTab: (side: 'left' | 'right', type: string, state?: Record<string, any>, id?: string) => Promise<string | null>;
  openRightTab: (type: string, state?: Record<string, any>, id?: string) => Promise<string | null>;
  updateRightTab: (id: string, patch: Partial<Omit<SidebarTab, 'id'>>) => void;
  selectRightTab: (id: string) => void;
  closeRightTab: (id: string) => Promise<void>;
  /** Query pushed into the search panel (e.g. clicking a tag node in the graph). */
  searchQuery: string;
  searchFor: (q: string) => void;
  leftOpen: boolean;
  rightOpen: boolean;
  toggleLeft: () => void;
  toggleRight: () => void;
  /** Mobile-only overlay drawer; device-local (never persisted/broadcast). */
  mobileDrawer: 'left' | 'right' | null;
  setMobileDrawer: (d: 'left' | 'right' | null) => void;

  paletteOpen: boolean;
  paletteMode: 'all' | 'commands' | 'files' | 'headings' | 'templates';
  setPalette: (v: boolean, mode?: 'all' | 'commands' | 'files' | 'headings' | 'templates') => void;
  paletteRightTab: string | null;
  pickRightNote: (id: string) => void;
  settingsOpen: boolean;
  setSettings: (v: boolean) => void;
  /** Open (true) or close (false) the Trash modal. */
  trashOpen: boolean;
  setTrash: (v: boolean) => void;
  /** Open (true) or close (false) the Graph view tab. */
  setGraph: (v: boolean) => void;
  openGraph: (recordHistory?: boolean) => Promise<void>;
  graphSettings: GraphSettings;
  setGraphSettings: (patch: Partial<GraphSettings>) => void;
  resetGraphSettings: () => void;

  contextMenu: ContextMenuState | null;
  openContextMenu: (m: ContextMenuState) => void;
  closeContextMenu: () => void;

  /** Note path whose Version history modal is open (null = closed). */
  versionHistoryPath: string | null;
  setVersionHistory: (path: string | null) => void;
  /** Expand ancestor folders + scroll the file into view in the file tree. */
  revealInTree: (path: string) => void;

  toast: string;
  /** Show a toast. ms=0 keeps it until another notify() replaces it. */
  notify: (msg: string, ms?: number) => void;

  openFile: (path: string, recordHistory?: boolean, viewId?: string) => Promise<void>;
  openHomepage: (viewId?: string) => Promise<void>;
  openWikilink: (target: string, sourcePath?: string, intent?: LinkIntent) => Promise<void>;
  closeTab: (path: string) => Promise<void>;
  renamePath: (from: string, to: string, expectedRevision?: string) => Promise<void>;
  removePath: (path: string) => ReturnType<typeof api.remove>;
  setContent: (c: string) => void;
  save: (cause?: 'manual' | 'background') => Promise<void>;
  createNote: (path: string, body?: string, applyTemplate?: boolean) => Promise<void>;
  /** Obsidian-style: create & open a fresh "Untitled" note (no prompt). `dir` = target folder, '' = vault root. */
  newNote: (dir?: string) => Promise<void>;
  /** Obsidian-style: create a fresh "Untitled" folder (no prompt) and start inline-renaming it. */
  newFolder: (dir?: string) => Promise<void>;
  /** Tree path currently being inline-renamed (null = none); FileTree shows an input for it. */
  renamingPath: string | null;
  setRenamingPath: (path: string | null) => void;
  /** Re-fetch content for the active/split tabs (after reload or remote sync). */
  hydrate: () => Promise<void>;
  /** Load persisted workspace state from the server and apply it. */
  loadUiState: () => Promise<void>;
  /** Apply a workspace state pushed from another tab/device. */
  applyRemoteState: (state: any, originId: string) => Promise<void>;
}

/** All file identities in the existing layout follow one explicit path change. */
function remapWorkspacePaths(state: AppState, from: string, to?: string): Partial<AppState> {
  const map = (value: string | null): string | null => value !== null && (value === from || value.startsWith(from + '/'))
    ? to === undefined ? null : to + value.slice(from.length) : value;
  const list = (values: string[]) => [...new Set(values.map(map).filter((value): value is string => value !== null))];
  const tabs = state.tabs.flatMap(tab => {
    const path = map(tab.path);
    return path === null ? [] : [{ ...tab, path, title: path === tab.path ? tab.title : path.split('/').pop()! }];
  });
  const rightTabs = state.rightTabs.flatMap(tab => {
    if (tab.type !== 'markdown') return [tab];
    const file = map(tab.state.file);
    return file === null ? [] : [{ ...tab, state: { ...tab.state, file }, title: file.split('/').pop()! }];
  });
  const activePath = state.activePath === null ? null : map(state.activePath) ?? tabs.at(-1)?.path ?? null, splitPath = map(state.splitPath);
  const parked = state.parkedSplit, parkedMain = parked && map(parked.main), parkedSide = parked && map(parked.side);
  const parkedSplit = parked && parkedMain && parkedSide ? { ...parked, main: parkedMain, side: parkedSide } : null;
  const snapshot = activePath ? documents.get(activePath)?.snapshot : undefined;
  return { tabs, rightTabs, activePath, splitPath, parkedSplit, content: snapshot?.raw ?? (activePath === state.activePath ? state.content : ''),
    dirty: snapshot?.dirty ?? (activePath === state.activePath ? state.dirty : false), splitContent: splitPath ? documents.get(splitPath)?.snapshot.raw ?? state.splitContent : '',
    rightActiveId: rightTabs.some(tab => tab.id === state.rightActiveId) ? state.rightActiveId : null,
    leftActiveId: rightTabs.some(tab => tab.id === state.leftActiveId) ? state.leftActiveId : null,
    recent: list(state.recent), bookmarks: list(state.bookmarks), expanded: list(state.expanded), selected: list(state.selected),
    history: state.history.flatMap(location => { const path = map(location.path); return path === null ? [] : [{ ...location, path }]; }),
    histIndex: state.history.slice(0, state.histIndex + 1).filter(location => map(location.path) !== null).length - 1,
    viewHistories: Object.fromEntries(Object.entries(state.viewHistories).map(([id, stack]) => [id, {
      history: stack.history.flatMap(location => { const path = map(location.path); return path === null ? [] : [{ ...location, path }]; }),
      histIndex: stack.history.slice(0, stack.histIndex + 1).filter(location => map(location.path) !== null).length - 1,
    }])),
    renamingPath: map(state.renamingPath), selectAnchor: map(state.selectAnchor), versionHistoryPath: map(state.versionHistoryPath),
    clipboard: state.clipboard && map(state.clipboard.path) ? { ...state.clipboard, path: map(state.clipboard.path)! } : null,
    movePath: Array.isArray(state.movePath) ? list(state.movePath) : map(state.movePath) };
}

// ---- server-side workspace persistence (shared across browsers/devices) ----
const PERSIST_KEYS = [
  'tabs', 'activePath', 'viewMode', 'expanded', 'splitPath', 'splitDirection', 'parkedSplit',
  'recent', 'bookmarks', 'leftPanel', 'rightPanel', 'leftOpen', 'rightOpen', 'graphSettings',
  'treeSort', 'autoReveal',
  'rightTabs', 'rightActiveId', 'leftActiveId',
] as const;

function pickPersisted(s: any): Record<string, unknown> {
  const o: Record<string, unknown> = {};
  for (const k of PERSIST_KEYS) o[k] = s[k];
  return o;
}

/**
 * Merge persisted graph settings over defaults. Settings saved before the move
 * to Obsidian-native slider units (all sliders were normalized 0..1) are detected
 * by linkDistance ≤ 1 — keep the filters/groups but reset display/forces.
 */
function migrateGraphSettings(gs: unknown): GraphSettings {
  if (!gs || typeof gs !== 'object') return DEFAULT_GRAPH_SETTINGS;
  const merged = { ...DEFAULT_GRAPH_SETTINGS, ...(gs as Partial<GraphSettings>) };
  if (typeof merged.linkDistance !== 'number' || merged.linkDistance <= 1) {
    const d = DEFAULT_GRAPH_SETTINGS;
    Object.assign(merged, {
      textFade: d.textFade, nodeSize: d.nodeSize, linkThickness: d.linkThickness,
      centerForce: d.centerForce, repelForce: d.repelForce, linkForce: d.linkForce,
      linkDistance: d.linkDistance,
    });
  }
  return merged;
}

function applyPersisted(s: any, set: (p: any) => void): void {
  rightGenerations.clear();
  const rightTabs = restoreSidebarTabs(s.rightTabs);
  if (s.leftPanel === 'bookmarks' && !rightTabs.some(tab => tab.type === 'bookmarks')) rightTabs.push(sidebarTab('bookmarks', {}, 'legacy-bookmarks'));
  set({
    tabs: Array.isArray(s.tabs) ? s.tabs : [],
    activePath: typeof s.activePath === 'string' ? s.activePath : null,
    viewMode: ['live', 'source', 'reading'].includes(s.viewMode) ? s.viewMode : 'live',
    expanded: Array.isArray(s.expanded) ? s.expanded : [],
    treeSort: TREE_SORTS.includes(s.treeSort) ? s.treeSort : 'name-asc',
    autoReveal: s.autoReveal === true,
    splitPath: typeof s.splitPath === 'string' ? s.splitPath : null,
    splitDirection: s.splitDirection === 'down' ? 'down' : 'right',
    parkedSplit: typeof s.splitPath !== 'string' && typeof s.parkedSplit?.main === 'string' && typeof s.parkedSplit?.side === 'string'
      ? { main: s.parkedSplit.main, side: s.parkedSplit.side, direction: s.parkedSplit.direction === 'down' ? 'down' : 'right' } : null,
    recent: Array.isArray(s.recent) ? s.recent : [],
    bookmarks: Array.isArray(s.bookmarks) ? s.bookmarks : [],
    leftPanel: s.leftPanel === 'search' ? 'search' : 'files',
    rightPanel: s.leftPanel === 'tags' ? 'tags' : ['properties', 'backlinks', 'outgoing', 'tags', 'outline', 'minimap', 'mcp'].includes(s.rightPanel) ? s.rightPanel : 'backlinks',
    rightTabs,
    leftActiveId: rightTabs.some(tab => tab.side === 'left' && tab.id === s.leftActiveId) ? s.leftActiveId : null,
    rightActiveId: s.leftPanel === 'bookmarks' ? rightTabs.find(tab => tab.type === 'bookmarks')!.id
      : rightTabs.some(tab => tab.side !== 'left' && tab.id === s.rightActiveId) ? s.rightActiveId : null,
    leftOpen: s.leftOpen !== false,
    rightOpen: s.rightOpen !== false,
    graphSettings: migrateGraphSettings(s.graphSettings),
  });
}

/** Push `path` onto the back/forward stack (truncating any forward entries). */
function historyFor(s: AppState, viewId: string) {
  return viewId === 'main' ? s : s.viewHistories[viewId] ?? { history: [], histIndex: -1 };
}
function historyPatch(s: AppState, viewId: string, history: NavigationLocation[], histIndex: number) {
  return viewId === 'main' ? { history, histIndex } : { viewHistories: { ...s.viewHistories, [viewId]: { history, histIndex } } };
}
function pushHistory(s: AppState, path: string, record = true, viewId = 'main', before?: NavigationLocation) {
  const stack = historyFor(s, viewId);
  if (!record || stack.history[stack.histIndex]?.path === path) return {};
  const prior = stack.history.slice(0, stack.histIndex + 1);
  before ??= s.currentPath(viewId) ? captureLocation(s.currentPath(viewId)!, viewId) : undefined;
  if (before) { if (prior.length) prior[prior.length - 1] = before; else prior.push(before); }
  const history = [...prior, { path, viewId }].slice(-100);
  return historyPatch(s, viewId, history, history.length - 1);
}

// Only start saving after the initial load; suppress while applying remote/initial state.
let canSave = false;
let suppressSave = false;
let saveTimer: number | undefined;
let lastSaved = '';
let desiredWorkspace = '';
let workspaceWrite: Promise<void> | undefined;
let workspaceDirty = false;
let workspaceSaveError = '';
let workspaceRetries = 0;
let remoteWorkspaceGeneration = 0;
let workspaceLoadGeneration = 0;

function scheduleSave(): void {
  window.clearTimeout(saveTimer);
  workspaceDirty = true;
  workspaceRetries = 0;
  saveTimer = window.setTimeout(() => { void flushWorkspaceState().catch(() => {}); }, 500);
}

export function workspaceHasUnsavedChanges(): boolean {
  return workspaceDirty || workspaceWrite !== undefined;
}

export async function flushWorkspaceState(): Promise<void> {
  window.clearTimeout(saveTimer);
  saveTimer = undefined;
  if (!canSave) {
    if (workspaceDirty) throw new Error('工作区尚未成功读取，已保留当前布局；请重新读取后再保存');
    return;
  }
  desiredWorkspace = JSON.stringify(pickPersisted(useStore.getState()));
  workspaceDirty = desiredWorkspace !== lastSaved;
  if (workspaceWrite) return workspaceWrite;
  if (!workspaceDirty) return;
  workspaceWrite = (async () => {
    try {
      while (desiredWorkspace !== lastSaved) {
        const sent = desiredWorkspace;
        await api.putUiState(JSON.parse(sent), CLIENT_ID);
        lastSaved = sent;
        desiredWorkspace = JSON.stringify(pickPersisted(useStore.getState()));
        workspaceDirty = desiredWorkspace !== lastSaved;
      }
      workspaceRetries = 0;
      if (workspaceSaveError && useStore.getState().toast === workspaceSaveError) useStore.getState().notify('工作区已保存');
      workspaceSaveError = '';
    } catch (error) {
      workspaceDirty = true;
      workspaceSaveError = `工作区保存失败，当前布局已保留：${String(error)}`;
      useStore.getState().notify(workspaceSaveError, 0);
      if (workspaceRetries < 3 && !useStore.getState().vaultSessionStale) {
        const delay = 1000 * 2 ** workspaceRetries++;
        saveTimer = window.setTimeout(() => { void flushWorkspaceState().catch(() => {}); }, delay);
      }
      throw error;
    } finally {
      workspaceWrite = undefined;
    }
  })();
  return workspaceWrite;
}

export async function saveWorkspaceBeforeExit(): Promise<void> {
  await documents.pathsSettled();
  for (const snapshot of documents.snapshots()) {
    if (!snapshot.dirty && !snapshot.saving && !snapshot.conflict && !snapshot.locked) continue;
    if (useStore.getState().vaultSessionStale) throw new Error('Vault 已切换，旧会话仍有未保存内容，请处理后再关闭');
    await documents.saveLeaving(snapshot.id);
  }
  await flushWorkspaceState();
  const state = useStore.getState();
  if (state.dirty || workspaceHasUnsavedChanges() || pendingMutations() ||
      documents.snapshots().some(snapshot => snapshot.dirty || snapshot.saving || snapshot.conflict || snapshot.locked))
    throw new Error('仍有未保存内容、冲突或写入请求，请处理后再关闭');
}

export const useStore = create<AppState>()(
    (set, get) => ({
      tree: null,
      filePaths: [],
      lastFileChange: null,
      applyFileStat: (path, stat) => {
        const tree = patchFileStat(get().tree, path, stat);
        if (!tree) return false;
        set({ tree, lastFileChange: { path, stat } });
        return true;
      },
      loadTree: async () => {
        let tree: TreeNode, generation: number;
        do {
          await documents.pathsSettled();
          generation = documents.pathVersion;
          tree = await api.tree();
        } while (generation !== documents.pathVersion || generation % 2 !== 0);
        const paths = filePaths(tree), prior = get().filePaths;
        publishVirtualDocuments(tree);
        set({ tree, filePaths: paths.length === prior.length && paths.every((path, i) => path === prior[i]) ? prior : paths });
      },

      tabs: [],
      activePath: null,
      history: [],
      histIndex: -1,
      viewHistories: {},
      currentViewId: () => {
        const id = getActiveNavigationId(), s = get();
        if (id === 'split') return s.splitPath ? id : 'main';
        if (id.startsWith('sidebar:')) {
          const tab = s.rightTabs.find(tab => 'sidebar:' + tab.id === id);
          return tab && ((tab.side === 'left' ? s.leftOpen && s.leftActiveId === tab.id : s.rightOpen && s.rightActiveId === tab.id)) ? id : 'main';
        }
        return 'main';
      },
      currentPath: (viewId) => {
        const s = get(), id = viewId ?? s.currentViewId();
        return id === 'split' ? s.splitPath : id.startsWith('sidebar:')
          ? s.rightTabs.find(tab => 'sidebar:' + tab.id === id)?.state.file ?? null : s.activePath;
      },
      recordNavigation: (before, after) => {
        if (before.viewId !== after.viewId) before = { path: after.path, viewId: after.viewId };
        set(state => {
          const stack = historyFor(state, after.viewId);
          const history = stack.history.slice(0, stack.histIndex + 1);
          const current = history.at(-1);
          if (current?.path === after.path && current.viewId === after.viewId && current.anchor === undefined
            && (before.path !== after.path || before.viewId !== after.viewId)) history[history.length - 1] = after;
          else {
            if (history.length) history[history.length - 1] = before; else history.push(before);
            if (before.path !== after.path || before.viewId !== after.viewId || before.anchor !== after.anchor || before.head !== after.head) history.push(after);
          }
          return historyPatch(state, after.viewId, history.slice(-100), Math.min(history.length, 100) - 1);
        });
      },
      navigate: async (path, request = {}) => {
        const source = request.source;
        let viewId = request.viewId ?? (source ? contextOf(source).navigationId : undefined) ?? get().currentViewId();
        const origin = source ? contextOf(source).sourcePath : get().currentPath(viewId) ?? path;
        const before = captureLocation(origin, viewId, source);
        if (request.disposition === 'side' || viewId === 'split') {
          viewId = 'split';
          await get().openToSide(path);
          if (get().splitPath !== path) return;
        }
        else if (request.disposition === 'tab' || viewId.startsWith('sidebar:')) {
          const id = await get().openRightTab('markdown', { file: path }, request.disposition === 'tab' ? undefined : viewId.slice(8));
          if (!id) return; viewId = 'sidebar:' + id;
        } else {
          viewId = 'main';
          await get().openFile(path, false, 'main');
          if (get().activePath !== path) return;
          if (request.location?.mode) get().setViewMode(request.location.mode);
        }
        if (!/\.(md|markdown)$/i.test(path)) return;
        const result = await navigateTo(path, { ...request, viewId, history: false });
        if (result.status === 'opened' && request.history !== false) get().recordNavigation(before, result.location);
      },
      goBack: () => {
        const viewId = get().currentViewId(), { history, histIndex } = historyFor(get(), viewId);
        if (histIndex <= 0) return;
        const captured = captureLocation(history[histIndex].path, history[histIndex].viewId);
        captured.fragment = history[histIndex].fragment;
        const updated = history.map((item, index) => index === histIndex && captured.anchor !== undefined ? captured : item);
        const target = history[histIndex - 1];
        set(s => historyPatch(s, viewId, updated, histIndex - 1));
        Promise.resolve(get().navigate(target.path, { viewId: target.viewId, location: target, history: false }))
          .catch(error => get().notify('恢复历史位置失败：' + String(error)));
      },
      goForward: () => {
        const viewId = get().currentViewId(), { history, histIndex } = historyFor(get(), viewId);
        if (histIndex >= history.length - 1) return;
        const captured = captureLocation(history[histIndex].path, history[histIndex].viewId);
        captured.fragment = history[histIndex].fragment;
        const updated = history.map((item, index) => index === histIndex && captured.anchor !== undefined ? captured : item);
        const target = history[histIndex + 1];
        set(s => historyPatch(s, viewId, updated, histIndex + 1));
        Promise.resolve(get().navigate(target.path, { viewId: target.viewId, location: target, history: false }))
          .catch(error => get().notify('恢复历史位置失败：' + String(error)));
      },
      content: '',
      dirty: false,
      vaultSessionStale: false,
      viewMode: 'live',
      setViewMode: (m) => set({ viewMode: m }),
      pdfToolbarOpen: false,
      setPdfToolbarOpen: (open) => set({ pdfToolbarOpen: open }),
      togglePdfToolbar: () => set((s) => ({ pdfToolbarOpen: !s.pdfToolbarOpen })),

      expanded: [],
      toggleFolder: (path) =>
        set((s) => ({
          expanded: s.expanded.includes(path)
            ? s.expanded.filter((p) => p !== path)
            : [...s.expanded, path],
        })),
      setExpanded: (paths) => set({ expanded: paths }),
      treeSort: 'name-asc',
      setTreeSort: (treeSort) => set({ treeSort }),
      autoReveal: false,
      toggleAutoReveal: () => set((s) => ({ autoReveal: !s.autoReveal })),

      splitPath: null,
      splitContent: '',
      splitDirection: 'right',
      openToSide: async (path, direction) => {
        cancelNavigation('split', path);
        const generation = ++splitGeneration;
        try { await documents.saveLeaving(get().splitPath); }
        catch (error) { if (generation === splitGeneration) get().notify(String(error)); return; }
        if (generation !== splitGeneration) return;
        const doc = TEXT_EXT_RE.test(path) ? await documents.open(path) : undefined;
        if (generation !== splitGeneration) return;
        set((s) => {
          // The side page is a tab like the main one. A side Homepage is replaced
          // by what it opens, like a browser new-tab page.
          const prev = s.splitPath, home = prev !== null && isHomepagePath(prev) && prev !== s.activePath && prev !== path;
          let tabs = home ? s.tabs.filter(t => t.path !== path) : s.tabs;
          if (!tabs.some(t => t.path === path)) {
            const tab = { path, title: tabTitle(path) }, homeAt = home ? tabs.findIndex(t => t.path === prev) : -1;
            const at = homeAt >= 0 ? homeAt : tabs.findIndex(t => t.path === s.activePath) + 1 || tabs.length;
            tabs = [...tabs.slice(0, at), tab, ...tabs.slice(homeAt >= 0 ? at + 1 : at)];
          } else if (home) tabs = tabs.filter(t => t.path !== prev);
          return {
            tabs,
            parkedSplit: null,
            splitPath: path,
            splitContent: doc?.snapshot.raw ?? '',
            splitDirection: direction ?? s.splitDirection,
          };
        });
      },
      closeSplit: async () => {
        const generation = ++splitGeneration;
        try { await documents.saveLeaving(get().splitPath); }
        catch (error) { get().notify(String(error)); return; }
        if (generation === splitGeneration) {
          if (getActiveNavigationId() === 'split') activateNavigation('main');
          set(s => ({ splitPath: null, splitContent: '', viewHistories: Object.fromEntries(Object.entries(s.viewHistories).filter(([id]) => id !== 'split')) }));
        }
      },
      splitWithHomepage: async (path, direction) => {
        if (path && path !== get().activePath) {
          await get().openFile(path, true, 'main');
          if (get().activePath !== path) return;
        }
        if (direction) set({ splitDirection: direction });
        await get().openHomepage('split');
      },
      parkedSplit: null,
      showTab: async (path) => {
        const s = get(), parked = s.parkedSplit;
        if (!s.splitPath && parked && (path === parked.main || path === parked.side)) {
          // Restore the whole group, focused on the member that was selected.
          set({ parkedSplit: null });
          await get().openFile(parked.main, true, 'main');
          if (get().activePath !== parked.main) return;
          await get().openToSide(parked.side, parked.direction);
          if (get().splitPath === parked.side) activateNavigation(path === parked.main ? 'main' : 'split');
          return;
        }
        if (s.splitPath && (path === s.activePath || path === s.splitPath)) {
          activateNavigation(path === s.activePath ? 'main' : 'split');
          return;
        }
        if (s.splitPath && s.activePath) {
          // Another tab is shown alone; the split group stays together as one tab.
          const group = { main: s.activePath, side: s.splitPath, direction: s.splitDirection };
          await get().closeSplit();
          if (get().splitPath !== null) return;
          set({ parkedSplit: group });
        }
        await get().openFile(path, true, 'main');
      },
      replacePane: async (viewId, path) => {
        const s = get(), old = viewId === 'split' ? s.splitPath : s.activePath, other = viewId === 'split' ? s.activePath : s.splitPath;
        if (!s.splitPath || !old || !other || old === path) return;
        if (viewId === 'split' && !isHomepagePath(path) && (path === GRAPH_PATH || findNode(s.tree, path)?.type === 'folder')) return;
        if (path === other) {
          // Dropping one member onto the other swaps the two panes.
          const main = viewId === 'main' ? other : old, side = viewId === 'main' ? old : other;
          await get().openFile(main, true, 'main');
          if (get().activePath !== main) return;
          await get().openToSide(side);
          if (get().splitPath !== side) return;
        } else {
          await get().openFile(path, true, viewId);
          if ((viewId === 'split' ? get().splitPath : get().activePath) !== path) return;
        }
        // [A,B],C with C dropped on B → [A,C],B: the group keeps its place and B goes where C was.
        set(st => {
          const i = st.tabs.findIndex(t => t.path === path), j = st.tabs.findIndex(t => t.path === old);
          if (i < 0 || j < 0) return {};
          const tabs = [...st.tabs]; [tabs[i], tabs[j]] = [tabs[j], tabs[i]];
          return { tabs };
        });
        activateNavigation(viewId);
      },
      closePane: async (viewId) => {
        const s = get(), path = viewId === 'split' ? s.splitPath : s.activePath, other = viewId === 'split' ? s.activePath : s.splitPath;
        if (path === null) return;
        if (other === null || s.splitPath === null) return get().closeTab(path);
        if (viewId === 'split') {
          await get().closeSplit();
          if (get().splitPath === null && path !== get().activePath) set(st => ({ tabs: st.tabs.filter(t => t.path !== path) }));
          return;
        }
        // Closing the main pane promotes the side page, so neither pane is subordinate.
        const generation = ++splitGeneration;
        try { await documents.saveLeaving(path); }
        catch (error) { get().notify(String(error)); return; }
        if (generation !== splitGeneration || get().splitPath !== other || get().activePath !== path) return;
        openGeneration++;
        cancelNavigation('main', other);
        activateNavigation('main');
        // The surviving page keeps its own live/source/reading mode as the workspace mode.
        const mode = document.querySelector<HTMLElement>('[data-view-id="split"] [data-mode]')?.dataset.mode as ViewMode | undefined;
        set(st => ({
          ...(mode && ['live', 'source', 'reading'].includes(mode) ? { viewMode: mode } : {}),
          tabs: path === other ? st.tabs : st.tabs.filter(t => t.path !== path),
          activePath: other, splitPath: null, splitContent: '',
          content: documents.get(other)?.snapshot.raw ?? st.splitContent, dirty: documents.get(other)?.snapshot.dirty ?? false,
          viewHistories: Object.fromEntries(Object.entries(st.viewHistories).filter(([id]) => id !== 'split')),
        }));
      },

      recent: [],
      removeRecent: (path) => set((s) => ({ recent: s.recent.filter((p) => p !== path) })),
      movePath: null,
      setMovePath: (path) => set({ movePath: path }),

      selected: [],
      setSelected: (selected) => set({ selected }),
      selectAnchor: null,
      setSelectAnchor: (selectAnchor) => set({ selectAnchor }),
      clipboard: null,
      setClipboard: (c) => set({ clipboard: c }),
      bookmarks: [],
      toggleBookmark: (path) =>
        set((s) => ({
          bookmarks: s.bookmarks.includes(path)
            ? s.bookmarks.filter((p) => p !== path)
            : [...s.bookmarks, path],
        })),

      leftPanel: 'files',
      setLeftPanel: (p) => set({ leftPanel: p, leftActiveId: null, leftOpen: true }),
      rightPanel: 'backlinks',
      setRightPanel: (p) => set({ rightPanel: p, rightActiveId: null, rightOpen: true }),
      rightTabs: [],
      rightActiveId: null,
      leftActiveId: null,
      openRightTab: (type, state = {}, id) => get().openSidebarTab(get().rightTabs.find(tab => tab.id === id)?.side ?? 'right', type, state, id),
      openSidebarTab: async (side, type, state = {}, id) => {
        const tab = { ...sidebarTab(type, state, id), side };
        cancelNavigation('sidebar:' + tab.id, type === 'markdown' ? state.file : undefined);
        const generation = ++rightGeneration;
        rightGenerations.set(tab.id, generation);
        const previous = get().rightTabs.find(item => item.id === tab.id);
        try {
          if (type !== previous?.type || state.file !== previous?.state.file) await saveLeavingSidebarTab(previous);
        } catch (error) {
          if (rightGenerations.get(tab.id) === generation) rightGenerations.delete(tab.id);
          get().notify(String(error)); return null;
        }
        if (rightGenerations.get(tab.id) !== generation) return null;
        set(s => ({ rightTabs: s.rightTabs.some(item => item.id === tab.id)
          ? s.rightTabs.map(item => item.id === tab.id ? tab : item) : [...s.rightTabs, tab],
          ...(side === 'left' ? { leftActiveId: tab.id, leftOpen: true } : { rightActiveId: tab.id, rightOpen: true }) }));
        rightGenerations.delete(tab.id);
        return tab.id;
      },
      updateRightTab: (id, patch) => set(s => ({ rightTabs: s.rightTabs.map(tab => tab.id === id ? { ...tab, ...patch } : tab) })),
      selectRightTab: (id) => set(s => {
        const tab = s.rightTabs.find(tab => tab.id === id);
        if (tab) activateNavigation('sidebar:' + id);
        return !tab ? {} : tab.side === 'left' ? { leftActiveId: id, leftOpen: true } : { rightActiveId: id, rightOpen: true };
      }),
      closeRightTab: async (id) => {
        const generation = ++rightGeneration;
        rightGenerations.set(id, generation);
        const tab = get().rightTabs.find(tab => tab.id === id);
        try { await saveLeavingSidebarTab(tab); }
        catch (error) {
          if (rightGenerations.get(id) === generation) rightGenerations.delete(id);
          get().notify(String(error)); return;
        }
        if (rightGenerations.get(id) !== generation) return;
        set(s => {
          const current = s.rightTabs.find(tab => tab.id === id);
          if (current?.type !== tab?.type || current?.state.file !== tab?.state.file) return {};
          const siblings = s.rightTabs.filter(item => (item.side ?? 'right') === (tab?.side ?? 'right'));
          const index = siblings.findIndex(tab => tab.id === id);
          const rightTabs = s.rightTabs.filter(tab => tab.id !== id);
          const remaining = siblings.filter(tab => tab.id !== id);
          const next = remaining[Math.min(index, remaining.length - 1)]?.id ?? null;
          if (getActiveNavigationId() === 'sidebar:' + id) activateNavigation(next ? 'sidebar:' + next : 'main');
          return { rightTabs, rightActiveId: s.rightActiveId === id ? next : s.rightActiveId,
            leftActiveId: s.leftActiveId === id ? next : s.leftActiveId,
            viewHistories: Object.fromEntries(Object.entries(s.viewHistories).filter(([key]) => key !== 'sidebar:' + id)) };
        });
        rightGenerations.delete(id);
      },
      searchQuery: '',
      searchFor: (q) => set({ searchQuery: q, leftPanel: 'search', leftActiveId: null, leftOpen: true }),
      leftOpen: true,
      rightOpen: true,
      toggleLeft: () => set((s) => ({ leftOpen: !s.leftOpen })),
      toggleRight: () => set((s) => ({ rightOpen: !s.rightOpen })),
      mobileDrawer: null,
      setMobileDrawer: (d) => set({ mobileDrawer: d }),

      paletteOpen: false,
      paletteMode: 'all',
      paletteRightTab: null,
      pickRightNote: (id) => set({ paletteOpen: true, paletteMode: 'files', paletteRightTab: id }),
      setPalette: (v, mode = 'all') => set({ paletteOpen: v, paletteMode: mode, paletteRightTab: null }),
      settingsOpen: false,
      setSettings: (v) => set({ settingsOpen: v }),
      trashOpen: false,
      setTrash: (v) => set({ trashOpen: v }),
      setGraph: (v) => {
        if (v) get().openGraph();
        else get().closeTab(GRAPH_PATH);
      },
      openGraph: async (recordHistory = true) => {
        await documents.saveLeaving(get().activePath);
        set((s) => ({
          tabs: s.tabs.some((t) => t.path === GRAPH_PATH)
            ? s.tabs
            : [...s.tabs, { path: GRAPH_PATH, title: '关系图谱' }],
          activePath: GRAPH_PATH,
          content: '',
          dirty: false,
          ...pushHistory(s, GRAPH_PATH, recordHistory),
        }));
      },
      graphSettings: DEFAULT_GRAPH_SETTINGS,
      setGraphSettings: (patch) =>
        set((s) => ({ graphSettings: { ...s.graphSettings, ...patch } })),
      resetGraphSettings: () => set({ graphSettings: DEFAULT_GRAPH_SETTINGS }),

      contextMenu: null,
      openContextMenu: (m) => set({ contextMenu: m }),
      closeContextMenu: () => set({ contextMenu: null }),

      versionHistoryPath: null,
      setVersionHistory: (path) => set({ versionHistoryPath: path }),
      revealInTree: (path) => {
        // Expand every ancestor folder so the file's row is rendered, open the
        // Files panel, then let FileTree scroll the now-visible row into view.
        const segs = path.split('/');
        segs.pop();
        const ancestors: string[] = [];
        let acc = '';
        for (const s of segs) {
          acc = acc ? `${acc}/${s}` : s;
          ancestors.push(acc);
        }
        set((st) => ({
          expanded: Array.from(new Set([...st.expanded, ...ancestors])),
          leftPanel: 'files',
          leftActiveId: null,
          leftOpen: true,
        }));
        window.setTimeout(() => {
          window.dispatchEvent(new CustomEvent('wo-reveal-file', { detail: { path } }));
        }, 60);
      },

      toast: '',
      notify: (msg, ms = 2500) => {
        set({ toast: msg });
        if (ms > 0) {
          window.setTimeout(() => set((s) => (s.toast === msg ? { toast: '' } : {})), ms);
        }
      },

      // A central new tab is shown alone and leaves a split group intact, like selecting another tab;
      // only splitWithHomepage asks for a Homepage inside the split.
      openHomepage: (viewId) => {
        const path = `home://${crypto.randomUUID()}`, id = viewId ?? get().currentViewId();
        return id.startsWith('sidebar:') || viewId === 'split' ? get().openFile(path, true, id) : get().showTab(path);
      },
      openFile: async (path, recordHistory = true, viewId = get().currentViewId()) => {
        const origin = get().currentPath(viewId), before = origin ? captureLocation(origin, viewId) : undefined;
        if (viewId !== 'main') {
          if (viewId === 'split') {
            await get().openToSide(path);
            if (get().splitPath !== path) return;
          } else {
            const id = viewId.slice(8), tab = get().rightTabs.find(tab => tab.id === id);
            if (!tab || !await get().openSidebarTab(tab.side ?? 'right', isHomepagePath(path) ? 'empty' : 'markdown', { file: path }, id)) return;
          }
          activateNavigation(viewId);
          set(s => ({ recent: isHomepagePath(path) ? s.recent : [path, ...s.recent.filter(p => p !== path)].slice(0, 20), ...pushHistory(s, path, recordHistory, viewId, before) }));
          return;
        }
        const parked = get().parkedSplit;
        if (parked && !get().splitPath && (path === parked.main || path === parked.side)) return get().showTab(path);
        cancelNavigation('main', path);
        const generation = ++openGeneration;
        if (path === GRAPH_PATH) return get().openGraph(recordHistory);
        await documents.saveLeaving(get().activePath);
        const home = isHomepagePath(path);
        // A folder path (restored tab or folder link) opens a folder content
        // view — never read it as a note nor pollute Recent with it.
        const isFolder = !home && findNode(get().tree, path)?.type === 'folder';
        let content = '';
        if (!isFolder && TEXT_EXT_RE.test(path)) {
          const doc = await documents.open(path);
          content = doc.snapshot.raw;
        }
        if (generation !== openGeneration) return;
        activateNavigation('main');
        const title = tabTitle(path);
        set((s) => {
          const tabs = s.tabs.find((t) => t.path === path) ? s.tabs : [...s.tabs, { path, title }];
          const recent = isFolder || home ? s.recent : [path, ...s.recent.filter((p) => p !== path)].slice(0, 20);
          return { tabs, activePath: path, content, dirty: documents.get(path)?.snapshot.dirty ?? false, recent, ...pushHistory(s, path, recordHistory) };
        });
      },

      openWikilink: async (target, sourcePath, intent = {}) => {
        const viewId = intent.viewId ?? (intent.source ? contextOf(intent.source).navigationId : undefined) ?? get().currentViewId(), generation = (linkGenerations.get(viewId) ?? 0) + 1;
        linkGenerations.set(viewId, generation);
        try {
          const origin = sourcePath ?? get().currentPath(viewId) ?? '';
          const resolved = target.startsWith('#') ? { path: origin } : await resolveContentLink(target, origin);
          if (linkGenerations.get(viewId) !== generation) return;
          const { path } = resolved;
          if (resolved.status === 'ambiguous' || resolved.status === 'denied') {
            get().notify(resolved.status === 'ambiguous' ? '链接有歧义：' + target : '不允许打开该链接');
            return;
          }
          if (path) {
            const fragment = parseLinkTarget(target).fragment;
            await get().navigate(path, { ...intent, viewId, fragment });
          }
          else {
            if (isGlobalContentTarget(target)) { get().notify('未找到引用目标：' + target); return; }
            // Only append `.md` when the target has no extension at all — a target
            // like `Foo.canvas` must stay `Foo.canvas`, not become `Foo.canvas.md`.
            const destination = resolved.normalizedTarget ?? parseLinkTarget(target).path;
            const hasExt = /\.[^./]+$/.test(destination);
            const newPath = await newFilePath(hasExt ? destination : `${destination}.md`, origin);
            await get().createNote(newPath, `# ${target.replace(/\.md$/, '')}\n`);
          }
        } catch (error) {
          get().notify('打开链接失败：' + String(error));
        }
      },

      closeTab: async (path) => {
        const { activePath, splitPath, parkedSplit } = get();
        // Closing a member of a set-aside group dissolves the group; the other page stays a tab.
        if (parkedSplit && (path === parkedSplit.main || path === parkedSplit.side)) set({ parkedSplit: null });
        if (splitPath !== null && splitPath !== activePath && (path === splitPath || path === activePath))
          return get().closePane(path === splitPath ? 'split' : 'main');
        if (splitPath !== null && path === splitPath) {
          await get().closeSplit();
          if (get().splitPath !== null) return;
        }
        const tab = get().tabs.find(tab => tab.path === path);
        try { await documents.saveLeaving(path); }
        catch (error) { get().notify(String(error)); return; }
        if (get().tabs.find(item => item.path === path) !== tab) return;
        set((s) => {
          const tabs = s.tabs.filter((t) => t.path !== path);
          const wasActive = s.activePath === path;
          const activePath = wasActive ? (tabs.at(-1)?.path ?? null) : s.activePath;
          return { tabs, activePath, ...(wasActive ? { content: '', dirty: false } : {}) };
        });
        const next = get();
        if (next.activePath && next.parkedSplit && [next.parkedSplit.main, next.parkedSplit.side].includes(next.activePath)) await get().showTab(next.activePath);
      },

      renamePath: async (from, requested, expectedRevision) => {
        const to = requested.replace(/\\/g, '/');
        if (from === to) return;
        if (!to || to.split('/').some(part => !part || part === '.' || part === '..')) throw new Error('请输入有效的仓库相对路径');
        if (to.startsWith(from + '/')) throw new Error('不能将文件夹移入自身');
        openGeneration++; splitGeneration++;
        const validate = expectedRevision === undefined ? undefined : () => {
          const snapshot = documents.get(from)?.snapshot;
          if (snapshot && (snapshot.dirty || snapshot.saving || snapshot.conflict || snapshot.revision !== expectedRevision))
            throw new Error('源笔记已改变，请重新提交重命名候选');
        };
        await documents.changePath(from, to, () => api.rename(from, to, expectedRevision), () => {
          window.dispatchEvent(new CustomEvent('file-path-changed', { detail: { from, to } }));
          set(state => remapWorkspacePaths(state, from, to));
        }, validate);
        await get().loadTree();
      },
      removePath: async (path) => {
        openGeneration++; splitGeneration++;
        const result = await documents.changePath(path, undefined, () => api.remove(path), () => {
          set(state => remapWorkspacePaths(state, path));
        });
        await get().loadTree();
        return result;
      },

      setContent: (content) => {
        const path = get().activePath;
        const doc = path ? documents.get(path) : undefined;
        if (!doc) return;
        doc.setRawText(content);
      },

      save: async (cause = 'manual') => {
        const editor = cause === 'manual' ? getActiveEditor() : null;
        const path = editor ? contextOf(editor).sourcePath : get().currentPath();
        if (path && TEXT_EXT_RE.test(path)) {
          if(cause==='manual')await manualSave(path);else await documents.get(path)?.save();
        }
      },

      createNote: async (path, body, applyTemplate = true) => {
        const viewId = get().currentViewId();
        const { sharedApp } = await import('./plugins');
        await sharedApp.vault.create(path, body ?? '', applyTemplate);
        await get().openFile(path, true, viewId);
      },

      newNote: async (dir) => {
        // Pick the first free "Untitled" name in the target folder, like Obsidian.
        const active = get().currentPath() ?? '';
        const source = findNode(get().tree, active)?.type === 'folder' ? `${active}/_` : active;
        const base = (dir ?? await newFileFolder(source)).replace(/\/+$/, '');
        const folder = base ? findNode(get().tree, base) : get().tree;
        const taken = new Set((folder?.children ?? []).map((c) => c.name.toLowerCase()));
        let name = 'Untitled.md';
        for (let i = 1; taken.has(name.toLowerCase()); i++) name = `Untitled ${i}.md`;
        const path = base ? `${base}/${name}` : name;
        await get().createNote(path, '');
        if (base) get().revealInTree(path);
      },

      renamingPath: null,
      setRenamingPath: (path) => set({ renamingPath: path }),

      newFolder: async (dir) => {
        // Create an "Untitled" folder (unique name) and drop straight into inline
        // rename — same as Obsidian, no prompt.
        const base = (dir ?? '').replace(/\/+$/, '');
        const parent = base ? findNode(get().tree, base) : get().tree;
        const taken = new Set((parent?.children ?? []).map((c) => c.name.toLowerCase()));
        let name = 'Untitled';
        for (let i = 1; taken.has(name.toLowerCase()); i++) name = `Untitled ${i}`;
        const path = base ? `${base}/${name}` : name;
        await api.createFolder(path);
        await get().loadTree();
        // Make sure the new row is rendered (expand ancestors + open the Files panel)…
        if (base) {
          const segs = base.split('/');
          const ancestors: string[] = [];
          let acc = '';
          for (const s of segs) { acc = acc ? `${acc}/${s}` : s; ancestors.push(acc); }
          set((st) => ({ expanded: Array.from(new Set([...st.expanded, ...ancestors])) }));
        }
        set({ leftPanel: 'files', leftActiveId: null, leftOpen: true, renamingPath: path });
      },

      hydrate: async () => {
        // Active tab + split pane content aren't persisted (only the paths) —
        // re-read them from the vault after a reload. Drop tabs whose file is gone.
        const { activePath, splitPath, tabs } = get();
        if (activePath && TEXT_EXT_RE.test(activePath)) {
          try {
            const doc = await documents.refresh(activePath);
            if (get().activePath === activePath) set({ content: doc.snapshot.raw, dirty: doc.snapshot.dirty });
          } catch {
            if (get().activePath !== activePath) return;
            set({
              tabs: tabs.filter((t) => t.path !== activePath),
              activePath: tabs.filter((t) => t.path !== activePath).at(-1)?.path ?? null,
              content: '',
            });
          }
        }
        if (splitPath && TEXT_EXT_RE.test(splitPath)) {
          try {
            const doc = await documents.refresh(splitPath);
            if (get().splitPath === splitPath) set({ splitContent: doc.snapshot.raw });
          } catch {
            if (get().splitPath === splitPath) set({ splitPath: null, splitContent: '' });
          }
        }
      },

      loadUiState: async () => {
        const generation = ++workspaceLoadGeneration;
        canSave = false;
        try {
          const s = await api.getUiState();
          if (generation !== workspaceLoadGeneration) return;
          suppressSave = true;
          applyPersisted(s, set);
          lastSaved = JSON.stringify(pickPersisted(get()));
          desiredWorkspace = lastSaved;
          workspaceDirty = false;
          workspaceRetries = 0;
          canSave = true;
        } catch (error) {
          if (generation !== workspaceLoadGeneration) return;
          get().notify(`工作区读取失败，已暂停布局保存：${String(error)}`, 0);
          throw error;
        } finally {
          suppressSave = false;
        }
        await get().hydrate();
      },

      applyRemoteState: async (state, originId) => {
        if (originId === CLIENT_ID) return; // ignore echo of our own change
        const generation = ++remoteWorkspaceGeneration;
        if (!canSave || workspaceHasUnsavedChanges()) return;
        const prevActive = get().activePath;
        const prevSplit = get().splitPath;
        await documents.saveLeaving(get().activePath);
        await documents.saveLeaving(prevSplit);
        const incoming = restoreSidebarTabs(state.rightTabs);
        for (const tab of get().rightTabs) {
          const next = incoming.find(next => next.id === tab.id);
          if (tab.type !== 'markdown' || next?.type === 'markdown' && next.state.file === tab.state.file) continue;
          await saveLeavingSidebarTab(tab);
        }
        if (generation !== remoteWorkspaceGeneration || workspaceHasUnsavedChanges()) return;
        suppressSave = true;
        try {
          applyPersisted(state, set);
          lastSaved = JSON.stringify(pickPersisted(get()));
          desiredWorkspace = lastSaved;
        } finally { suppressSave = false; }
        if (get().activePath !== prevActive || get().splitPath !== prevSplit) {
          await get().hydrate();
        }
      },
    }),
);

// Save durable workspace state to the server (debounced) whenever it changes.
useStore.subscribe((state, prev) => {
  if (state.activePath !== prev.activePath && state.activePath) {
    const doc = documents.get(state.activePath);
    if (doc) useStore.setState({ content: doc.snapshot.raw, dirty: doc.snapshot.dirty });
  }
  if (suppressSave) return;
  if (PERSIST_KEYS.some(key => state[key] !== prev[key])) {
    workspaceDirty = true;
    if (canSave) scheduleSave();
  }
});

// Compatibility mirrors for panels; document ownership lives in sessions.
documents.onError = error => useStore.getState().notify(String(error));
documents.isOpen = path => {
  const state = useStore.getState();
  return state.tabs.some(tab => tab.path === path) || state.splitPath === path || state.rightTabs.some(tab => tab.type === 'markdown' && tab.state.file === path)
    || [...document.querySelectorAll<HTMLElement>('[data-document-id]')].some(element => element.dataset.documentId === path);
};
documents.canRefresh = () => !useStore.getState().vaultSessionStale;
documents.subscribe((snapshot) => {
  const state = useStore.getState();
  const patch: Partial<AppState> = {};
  if (state.activePath === snapshot.id) { patch.content = snapshot.raw; patch.dirty = snapshot.dirty; }
  if (state.splitPath === snapshot.id) patch.splitContent = snapshot.raw;
  if (Object.keys(patch).length) useStore.setState(patch);
});
