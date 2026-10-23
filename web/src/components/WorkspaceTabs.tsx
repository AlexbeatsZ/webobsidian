import { useEffect, useRef } from 'react';
import { useStore, GRAPH_PATH, isHomepagePath, type ContextMenuItem } from '../lib/store';
import { api } from '../lib/api';
import { documents } from '../lib/documents';
import { printDocument } from '../lib/printDocument';
import { createVaultRenderContext } from '../lib/vaultRenderContext';
import { editorFind, getActiveEditor } from '../lib/activeEditor';
import { triggerAddProperty } from '../lib/livePreview';
import { pathToUrl } from '../lib/urlsync';
import { extendFileMenu } from '../lib/obsidian/menus';
import { nativeBatchTagMenuItems } from '../lib/tags/actions';
import { menuModifiers } from '../lib/configuredMenus/transform';
import { useIsMobile } from '../lib/useIsMobile';
import Icon from './Icon';

export default function WorkspaceTabs() {
  const tabs = useStore((s) => s.tabs);
  const activePath = useStore((s) => s.activePath);
  const openFile = useStore((s) => s.openFile);
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
  const openHomepage = useStore((s) => s.openHomepage);
  const openContextMenu = useStore((s) => s.openContextMenu);
  const setMovePath = useStore((s) => s.setMovePath);
  const setRightPanel = useStore((s) => s.setRightPanel);
  const setVersionHistory = useStore((s) => s.setVersionHistory);
  const revealInTree = useStore((s) => s.revealInTree);
  const loadTree = useStore((s) => s.loadTree);
  const isMobile = useIsMobile();
  const scroll = useRef<HTMLDivElement>(null);

  const inTab = async (path: string, action: () => void) => {
    if (useStore.getState().activePath !== path) await openFile(path);
    // Let the requested editor/graph mount before invoking its view command.
    window.requestAnimationFrame(() => {
      if (useStore.getState().activePath === path) action();
    });
  };

  useEffect(() => {
    scroll.current?.querySelector('.tab.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [activePath, tabs.length]);

  // Obsidian's "Add file property": focus a new property-key field in the
  // Properties widget with the key suggester open (NOT a text prompt). The
  // widget only renders in Live Preview, so switch out of source/reading first.
  const addFileProperty = async (path: string) => {
    await openFile(path);
    if (useStore.getState().viewMode !== 'live') setViewMode('live');
    // Let the editor swap modes / mount the Properties widget, then start the add.
    window.setTimeout(() => {
      const v = getActiveEditor();
      if (v) triggerAddProperty(v);
      else notify("打开笔记以添加属性");
    }, 80);
  };

  const exportToPdf = async (path: string) => {
    await openFile(path);
    const snapshot = documents.get(path)?.snapshot; if (!snapshot) return;
    const context = createVaultRenderContext(path, { openLink: () => {}, openMenu: () => {}, files: () => [], reportError: notify });
    void printDocument(snapshot, context).catch(error => notify(error.message));
  };

  // File actions now live on the tab context menu instead of a second header.
  const openTabMenu = (e: React.MouseEvent, path: string) => {
    e.preventDefault();
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const isMd = /\.(md|markdown)$/i.test(path);
    const canSplit = /\.(md|markdown|txt|json|csv|canvas|css|js|ya?ml)$/i.test(path);
    const baseName = path.split('/').pop() ?? path;
    const closeOthers = () => tabs.filter((t) => t.path !== path).forEach((t) => closeTab(t.path));
    const tabItems: ContextMenuItem[] = [
      { id: 'tab:close', label: "关闭标签页", icon: 'x', onClick: () => closeTab(path) },
      { id: 'tab:close-others', label: "关闭其他标签页", onClick: closeOthers },
    ];
    let items: ContextMenuItem[];
    if (isHomepagePath(path)) {
      items = tabItems;
    } else if (path === GRAPH_PATH) {
      items = [
        // GraphView owns the Pixi renderer — it listens for this event and
        // extracts the stage to a PNG (a plain canvas read would be blank).
        { id: 'tab:copy-screenshot', label: "复制截图", icon: 'camera', onClick: () => void inTab(path, () => window.dispatchEvent(new CustomEvent('wo-graph-screenshot'))) },
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
            await api.rename(path, to);
            closeTab(path);
            await loadTree();
            await openFile(to);
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
        ...(isMd ? [{ id: 'file:backlinks', label: "文档中的反向链接", icon: 'link', onClick: () => void inTab(path, () => setRightPanel('backlinks')) }, sep] : []),
        ...(canSplit
          ? [
              { id: 'file:split-right', label: "向右分屏", icon: 'columns', onClick: () => openToSide(path, 'right') },
              { id: 'file:split-down', label: "向下分屏", icon: 'rows', onClick: () => openToSide(path, 'down') },
            ]
          : []),
        { id: 'file:new-window', label: "在新窗口中打开", icon: 'arrow-up-right', onClick: () => window.open(pathToUrl(path), '_blank', 'noopener') },
        sep,
        renameItem,
        moveItem,
        copyItem,
        { label: bookmarks.includes(path) ? "移除书签" : "添加书签", icon: 'bookmark', onClick: () => toggleBookmark(path) },
        ...(isMd ? [{ id: 'file:add-property', label: "添加文件属性", icon: 'plus', onClick: () => void addFileProperty(path) }] : []),
        ...(isMd ? [{ id: 'file:export-pdf', label: "导出为 PDF…", icon: 'file-pdf', onClick: () => void exportToPdf(path) }] : []),
        ...(canSplit
          ? [
              sep,
              {
                id: 'editor:find', label: "查找…",
                icon: 'search',
                onClick: () => void inTab(path, () => {
                  if (!editorFind()) notify("打开笔记以在其中搜索");
                }),
              },
            ]
          : []),
        sep,
        {
          id: 'file:copy-url', label: "复制 URL 路径",
          onClick: () => {
            navigator.clipboard?.writeText(`${location.origin}${pathToUrl(path)}`).catch(() => {});
            notify("URL 已复制");
          },
        },
        { id: 'file:history', label: "打开版本历史", icon: 'clock', onClick: () => setVersionHistory(path) },
        ...(isMd
          ? [
              {
                id: 'file:linked-view', label: "打开关联视图",
                icon: 'arrow-up-right',
                submenu: [
                  { label: "反向链接", icon: 'link', onClick: () => void inTab(path, () => setRightPanel('backlinks')) },
                  { label: "出链", icon: 'arrow-up-right', onClick: () => void inTab(path, () => setRightPanel('outgoing')) },
                  { id: 'file:outline', label: "大纲", icon: 'list', onClick: () => void inTab(path, () => setRightPanel('outline')) },
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
              const r = await api.remove(path);
              closeTab(path);
              await loadTree();
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

  return (
    <header className="tab-bar">
      <button type="button" className="tab-new tab-ctl"
        title={isMobile ? "打开菜单" : "切换左侧边栏 (Ctrl/⌘\\)"}
        aria-label="折叠/展开左侧边栏" aria-expanded={isMobile ? mobileDrawer === 'left' : leftOpen}
        onClick={() => (isMobile ? setMobileDrawer(mobileDrawer === 'left' ? null : 'left') : toggleLeft())}>
        <Icon name={isMobile ? 'menu' : 'panel-left'} size={16} />
      </button>
      <div className="tab-scroll" role="tablist" aria-label="已打开的文件" ref={scroll}>
        {tabs.map((tab) => (
          <div key={tab.path} className={`tab ${activePath === tab.path ? 'active' : ''}`}
            role="tab" aria-selected={activePath === tab.path} tabIndex={activePath === tab.path ? 0 : -1}
            onClick={() => void openFile(tab.path)}
            onAuxClick={(event) => { if (event.button === 1) { event.preventDefault(); closeTab(tab.path); } }}
            onContextMenu={(event) => openTabMenu(event, tab.path)}
            onKeyDown={(event) => {
              if (event.target !== event.currentTarget) return;
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault(); void openFile(tab.path);
              } else if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
                event.preventDefault();
                const index = tabs.indexOf(tab);
                const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1
                  : (index + (event.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length;
                (scroll.current?.children[next] as HTMLElement | undefined)?.focus();
                void openFile(tabs[next].path);
              }
            }}
            title={tab.path}>
            {(tab.path === GRAPH_PATH || isHomepagePath(tab.path)) && <Icon name={tab.path === GRAPH_PATH ? 'graph' : 'home'} size={13} />}
            <span className="title">{tab.title.replace(/\.(md|markdown)$/, '')}</span>
            {dirty && activePath === tab.path && <span className="dot" aria-label="未保存的更改">●</span>}
            <button type="button" className="close" title="关闭标签页" aria-label={`关闭 ${tab.title}`}
              onClick={(event) => { event.stopPropagation(); closeTab(tab.path); }}>
              <Icon name="x" size={13} />
            </button>
          </div>
        ))}
      </div>
      <button type="button" className="tab-new tab-ctl" title="主页" aria-label="新建中央标签页"
        onClick={() => void openHomepage().catch(error => notify(String(error)))}>
        <Icon name="plus" size={16} />
      </button>
      <div className="titlebar-drag-space" />
      <button type="button" className="tab-new tab-ctl" title="折叠/展开右侧边栏"
        aria-label="折叠/展开右侧边栏" aria-expanded={isMobile ? mobileDrawer === 'right' : rightOpen}
        onClick={() => (isMobile ? setMobileDrawer(mobileDrawer === 'right' ? null : 'right') : toggleRight())}>
        <Icon name="panel-right" size={16} />
      </button>
    </header>
  );
}
