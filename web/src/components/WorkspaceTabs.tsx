import { useEffect, useRef, useSyncExternalStore } from 'react';
import { useStore, GRAPH_PATH, isHomepagePath, type ContextMenuItem } from '../lib/store';
import { api } from '../lib/api';
import { documents } from '../lib/documents';
import { printDocument } from '../lib/printDocument';
import { createVaultRenderContext } from '../lib/vaultRenderContext';
import { activateNavigation, editorFind, getActiveEditor, getActiveNavigationId, setActiveEditorMode, subscribeActiveNavigation } from '../lib/activeEditor';
import { TAB_DRAG_TYPE, tabDrag } from '../lib/tabDrag';
import { isFolderPath } from '../lib/tree';
import { triggerAddProperty } from '../lib/livePreview';
import { extendFileMenu } from '../lib/obsidian/menus';
import { nativeBatchTagMenuItems } from '../lib/tags/actions';
import { menuModifiers } from '../lib/configuredMenus/transform';
import { useIsMobile } from '../lib/useIsMobile';
import { useMainPdfSession } from '../lib/pdf/react';
import Icon from './Icon';

type Pane = 'main' | 'split';
type Tab = { path: string; title: string };

export default function WorkspaceTabs() {
  const tabs = useStore((s) => s.tabs);
  const activePath = useStore((s) => s.activePath);
  const openFile = (path: string) => useStore.getState().openFile(path, true, 'main');
  const closeTab = useStore((s) => s.closeTab);
  const dirty = useStore((s) => s.dirty);
  const setViewMode = useStore((s) => s.setViewMode);
  const bookmarks = useStore((s) => s.bookmarks);
  const toggleBookmark = useStore((s) => s.toggleBookmark);
  const openToSide = useStore((s) => s.openToSide);
  const notify = useStore((s) => s.notify);
  const toggleLeft = useStore((s) => s.toggleLeft);
  const toggleRight = useStore((s) => s.toggleRight);
  const leftOpen = useStore((s) => s.leftOpen);
  const rightOpen = useStore((s) => s.rightOpen);
  const mobileDrawer = useStore((s) => s.mobileDrawer);
  const setMobileDrawer = useStore((s) => s.setMobileDrawer);
  const openHomepage = () => useStore.getState().openHomepage('main');
  const openContextMenu = useStore((s) => s.openContextMenu);
  const setMovePath = useStore((s) => s.setMovePath);
  const setRightPanel = useStore((s) => s.setRightPanel);
  const setVersionHistory = useStore((s) => s.setVersionHistory);
  const revealInTree = useStore((s) => s.revealInTree);
  const loadTree = useStore((s) => s.loadTree);
  const pdfToolbarOpen = useStore((s) => s.pdfToolbarOpen);
  const togglePdfToolbar = useStore((s) => s.togglePdfToolbar);
  const mainPdf = useMainPdfSession(activePath);
  const splitPath = useStore((s) => s.splitPath);
  const splitDirection = useStore((s) => s.splitDirection);
  const closeSplit = useStore((s) => s.closeSplit);
  const closePane = useStore((s) => s.closePane);
  const splitWithHomepage = useStore((s) => s.splitWithHomepage);
  const focusedView = useSyncExternalStore(subscribeActiveNavigation, getActiveNavigationId);
  const isMobile = useIsMobile();
  const scroll = useRef<HTMLDivElement>(null);

  // A tab in the split group already shows its page: focus that pane instead of reopening it in main.
  const inTab = async (path: string, action: () => void, view?: Pane) => {
    if (view) focusPane(view);
    else if (useStore.getState().activePath !== path) await openFile(path);
    // Let the requested editor/graph mount before invoking its view command.
    window.requestAnimationFrame(() => {
      if (view || useStore.getState().activePath === path) action();
    });
  };

  useEffect(() => {
    scroll.current?.querySelector('.tab-split-group, .tab.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [activePath, tabs.length, splitPath]);

  // Both split panes are equal: a grouped tab focuses its pane, and any other
  // tab opens in whichever pane is focused.
  const focusedPane: Pane = splitPath && focusedView === 'split' ? 'split' : 'main';
  const focusPane = (viewId: Pane) => {
    activateNavigation(viewId);
    getActiveEditor()?.focus();
  };
  const selectTab = (path: string) => {
    const s = useStore.getState();
    if (s.splitPath && (path === s.activePath || path === s.splitPath)) return focusPane(path === s.activePath ? 'main' : 'split');
    const sideable = isHomepagePath(path) || (path !== GRAPH_PATH && !isFolderPath(s.tree, path));
    void s.openFile(path, true, s.splitPath && sideable ? focusedPane : 'main');
  };

  // Obsidian's "Add file property": focus a new property-key field in the
  // Properties widget with the key suggester open (NOT a text prompt). The
  // widget only renders in Live Preview, so switch out of source/reading first.
  const addFileProperty = async (path: string, view?: Pane) => {
    if (view) focusPane(view); else await openFile(path);
    if (view === 'split') setActiveEditorMode('live');
    else if (useStore.getState().viewMode !== 'live') setViewMode('live');
    // Let the editor swap modes / mount the Properties widget, then start the add.
    window.setTimeout(() => {
      const v = getActiveEditor();
      if (v) triggerAddProperty(v);
      else notify("打开笔记以添加属性");
    }, 80);
  };

  const exportToPdf = async (path: string, view?: Pane) => {
    if (!view) await openFile(path);
    const snapshot = documents.get(path)?.snapshot; if (!snapshot) return;
    const context = createVaultRenderContext(path, { openLink: () => {}, openMenu: () => {}, files: () => [], reportError: notify });
    void printDocument(snapshot, context).catch(error => notify(error.message));
  };

  // File actions now live on the tab context menu instead of a second header.
  const openTabMenu = (e: React.MouseEvent, path: string, view?: Pane) => {
    e.preventDefault();
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const isMd = /\.(md|markdown)$/i.test(path);
    const canSplit = /\.(md|markdown|txt|json|csv|canvas|css|js|ya?ml)$/i.test(path);
    const down = splitDirection === 'down';
    // Splitting keeps this tab and opens a Homepage on the new side; inside a
    // split group the same place offers the layout instead.
    const splitItems: ContextMenuItem[] = view
      ? [
          { id: 'split:direction', label: down ? "改为左右分屏" : "改为上下分屏", icon: down ? 'columns' : 'rows',
            onClick: () => void openToSide(useStore.getState().splitPath ?? path, down ? 'right' : 'down') },
          { id: 'split:exit', label: "取消分屏", icon: 'layout-dashboard', onClick: () => void closeSplit() },
        ]
      : [
          { id: 'file:split-right', label: "向右分屏", icon: 'columns', onClick: () => void splitWithHomepage(path, 'right') },
          { id: 'file:split-down', label: "向下分屏", icon: 'rows', onClick: () => void splitWithHomepage(path, 'down') },
        ];
    const baseName = path.split('/').pop() ?? path;
    const closeOthers = () => tabs.filter((t) => t.path !== path).forEach((t) => closeTab(t.path));
    const tabItems: ContextMenuItem[] = [
      { id: 'tab:close', label: "关闭标签页", icon: 'x', onClick: () => void (view ? closePane(view) : closeTab(path)) },
      { id: 'tab:close-others', label: "关闭其他标签页", onClick: closeOthers },
    ];
    let items: ContextMenuItem[];
    if (isHomepagePath(path)) {
      items = [...splitItems, { label: '', separator: true }, ...tabItems];
    } else if (path === GRAPH_PATH) {
      items = [
        // GraphView owns the Pixi renderer — it listens for this event and
        // extracts the stage to a PNG (a plain canvas read would be blank).
        { id: 'tab:copy-screenshot', label: "复制截图", icon: 'camera', onClick: () => void inTab(path, () => window.dispatchEvent(new CustomEvent('wo-graph-screenshot')), view) },
        { label: '', separator: true },
        ...splitItems,
        { label: '', separator: true },
        ...tabItems,
      ];
    } else {
      const sep: ContextMenuItem = { label: '', separator: true };
      const renameItem: ContextMenuItem = {
        id: 'file:rename', label: "重命名…",
        icon: 'pencil',
        onClick: async () => {
          const to = prompt("重命名 / 移动至（仓库相对路径）：", path);
          if (to && to !== path) {
            await useStore.getState().renamePath(path, to);
          }
        },
      };
      const moveItem: ContextMenuItem = {
        id: 'file:move', label: "移动文件至…",
        icon: 'folder',
        onClick: () => setMovePath(path),
      };
      const copyItem: ContextMenuItem = {
        id: 'file:duplicate', label: "创建副本",
        icon: 'file-plus',
        onClick: async () => {
          const r = await api.read(path).catch(() => null);
          if (!r) return;
          const body = typeof r === 'string' ? r : r.content;
          const dot = path.lastIndexOf('.');
          const copyPath = dot > 0 ? `${path.slice(0, dot)} copy${path.slice(dot)}` : `${path} copy`;
          await api.write(copyPath, body);
          await loadTree();
          notify("已创建副本");
        },
      };
      items = [
        ...(isMd ? [{ id: 'file:backlinks', label: "文档中的反向链接", icon: 'link', onClick: () => void inTab(path, () => setRightPanel('backlinks'), view) }, sep] : []),
        ...splitItems,
        sep,
        renameItem,
        moveItem,
        copyItem,
        { label: bookmarks.includes(path) ? "移除书签" : "添加书签", icon: 'bookmark', onClick: () => toggleBookmark(path) },
        ...(isMd ? [{ id: 'file:add-property', label: "添加文件属性", icon: 'plus', onClick: () => void addFileProperty(path, view) }] : []),
        ...(isMd ? [{ id: 'file:export-pdf', label: "导出为 PDF…", icon: 'file-pdf', onClick: () => void exportToPdf(path, view) }] : []),
        ...(canSplit
          ? [
              sep,
              {
                id: 'editor:find', label: "查找…",
                icon: 'search',
                onClick: () => void inTab(path, () => {
                  if (!editorFind()) notify("打开笔记以在其中搜索");
                }, view),
              },
            ]
          : []),
        sep,
        { id: 'file:history', label: "打开版本历史", icon: 'clock', onClick: () => setVersionHistory(path) },
        ...(isMd
          ? [
              {
                id: 'file:linked-view', label: "打开关联视图",
                icon: 'arrow-up-right',
                submenu: [
                  { label: "反向链接", icon: 'link', onClick: () => void inTab(path, () => setRightPanel('backlinks'), view) },
                  { label: "出链", icon: 'arrow-up-right', onClick: () => void inTab(path, () => setRightPanel('outgoing'), view) },
                  { id: 'file:outline', label: "大纲", icon: 'list', onClick: () => void inTab(path, () => setRightPanel('outline'), view) },
                ],
              },
            ]
          : []),
        sep,
        {
          id: 'file:reveal', label: "在文件列表中显示",
          icon: 'folder',
          onClick: () => {
            revealInTree(path);
            if (isMobile) setMobileDrawer('left');
          },
        },
        sep,
        ...tabItems,
        sep,
        {
          id: 'file:delete', label: "删除",
          danger: true,
          icon: 'trash',
          onClick: async () => {
            if (confirm(`删除 "${baseName}"？`)) {
              const r = await useStore.getState().removePath(path);
              notify(r.deleted ? "已永久删除" : "已移至回收站");
            }
          },
        },
      ];
    }
    if (isMd) items.push(...nativeBatchTagMenuItems({ kind: 'files', paths: [path] }));
    openContextMenu({ x: e.clientX || Math.round(rect.left), y: e.clientY || Math.round(rect.bottom),
      items: extendFileMenu(items, [path], { kind: 'tab', source: 'workspace-tabs', paths: [path],
        fileTypes: [path.split('.').at(-1) ?? ''], activePath: useStore.getState().activePath ?? undefined,
        modifiers: menuModifiers(e.nativeEvent) }) });
  };

  const tabNode = (tab: Tab, view?: Pane) => {
    const selected = view ? focusedPane === view : activePath === tab.path;
    const close = () => void (view ? closePane(view) : closeTab(tab.path));
    return (
      <div key={view ? `${view}:${tab.path}` : tab.path} data-tab-path={tab.path}
        className={`tab${view || activePath === tab.path ? ' active' : ''}${view && selected ? ' is-focused' : ''}`}
        role="tab" aria-selected={selected} tabIndex={selected ? 0 : -1} draggable
        onClick={() => selectTab(tab.path)}
        onAuxClick={(event) => { if (event.button === 1) { event.preventDefault(); close(); } }}
        onContextMenu={(event) => openTabMenu(event, tab.path, view)}
        onDragStart={(event) => {
          tabDrag.path = tab.path;
          event.dataTransfer.setData(TAB_DRAG_TYPE, tab.path);
          event.dataTransfer.effectAllowed = 'move';
        }}
        onDragEnd={() => { tabDrag.path = null; }}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget) return;
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault(); selectTab(tab.path);
          } else if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
            event.preventDefault();
            const index = Math.max(0, tabs.findIndex((item) => item.path === tab.path));
            const next = tabs[event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1
              : (index + (event.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
            if (!next) return;
            scroll.current?.querySelector<HTMLElement>(`[data-tab-path="${CSS.escape(next.path)}"]`)?.focus();
            selectTab(next.path);
          }
        }}
        title={tab.path}>
        {(tab.path === GRAPH_PATH || isHomepagePath(tab.path)) && <Icon name={tab.path === GRAPH_PATH ? 'graph' : 'home'} size={13} />}
        <span className="title">{tab.title.replace(/\.(md|markdown)$/, '')}</span>
        {dirty && view !== 'split' && activePath === tab.path && <span className="dot" aria-label="未保存的更改">●</span>}
        <button type="button" className="close" title="关闭标签页" aria-label={`关闭 ${tab.title}`}
          onClick={(event) => { event.stopPropagation(); close(); }}>
          <Icon name="x" size={13} />
        </button>
      </div>
    );
  };

  // Browser-style split group: the two visible pages read as one unit of equal tabs.
  const splitTab: Tab | null = splitPath
    ? tabs.find((tab) => tab.path === splitPath) ?? { path: splitPath, title: isHomepagePath(splitPath) ? 'Homepage' : splitPath.split('/').pop() ?? splitPath }
    : null;
  const splitGroup = (main?: Tab) => splitTab && (
    <div key="split-group" className={`tab-split-group${splitDirection === 'down' ? ' is-down' : ''}`}
      role="group" aria-label={splitDirection === 'down' ? '上下分屏' : '左右分屏'}>
      <Icon name={splitDirection === 'down' ? 'rows' : 'columns'} size={13} className="split-icon" />
      {main && tabNode(main, 'main')}
      {tabNode(splitTab, 'split')}
    </div>
  );

  return (
    <header className="tab-bar">
      <button type="button" className="tab-new tab-ctl"
        title={isMobile ? "打开菜单" : "切换左侧边栏 (Ctrl/⌘\\)"}
        aria-label="折叠/展开左侧边栏" aria-expanded={isMobile ? mobileDrawer === 'left' : leftOpen}
        onClick={() => (isMobile ? setMobileDrawer(mobileDrawer === 'left' ? null : 'left') : toggleLeft())}>
        <Icon name={isMobile ? 'menu' : 'panel-left'} size={16} />
      </button>
      <div className="tab-scroll" role="tablist" aria-label="已打开的文件" ref={scroll}>
        {tabs.map((tab) => splitTab && tab.path === activePath ? splitGroup(tab)
          : splitTab && tab.path === splitPath ? null : tabNode(tab))}
        {splitTab && !tabs.some((tab) => tab.path === activePath) && splitGroup()}
      </div>
      <button type="button" className="tab-new tab-ctl" title="主页" aria-label="新建中央标签页"
        onClick={() => void openHomepage().catch(error => notify(String(error)))}>
        <Icon name="plus" size={16} />
      </button>
      <div className="titlebar-drag-space" />
      {mainPdf && <button type="button" className={`tab-new tab-ctl pdf-toolbar-toggle${pdfToolbarOpen ? ' is-active' : ''}`}
        title="显示/隐藏 PDF 工具栏" aria-label="显示/隐藏 PDF 工具栏" aria-expanded={pdfToolbarOpen}
        onClick={togglePdfToolbar}>
        <Icon name="panel-top" size={16} />
      </button>}
      <button type="button" className="tab-new tab-ctl" title="折叠/展开右侧边栏"
        aria-label="折叠/展开右侧边栏" aria-expanded={isMobile ? mobileDrawer === 'right' : rightOpen}
        onClick={() => (isMobile ? setMobileDrawer(mobileDrawer === 'right' ? null : 'right') : toggleRight())}>
        <Icon name="panel-right" size={16} />
      </button>
    </header>
  );
}
