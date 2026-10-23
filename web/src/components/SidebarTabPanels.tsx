import { memo, useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { parseLinkTarget } from '@webobsidian/markdown-core';
import { useStore } from '../lib/store';
import { sharedApp, subscribePlugins, pluginRevision } from '../lib/plugins';
import type { SidebarTab } from '../lib/sidebarTabs';
import { openFragment } from '../lib/fragmentNavigation';
import Editor from './Editor';
import Icon from './Icon';
import BookmarksPanel from './BookmarksPanel';
import WorkspaceLauncher from './WorkspaceLauncher';
const MD_RE = /\.(md|markdown)$/i;

const SidebarNote = memo(function SidebarNote({ tab, active }: { tab: SidebarTab; active: boolean }) {
  const opened = useRef(false);
  const editor = useRef<import('@codemirror/view').EditorView | null>(null);
  if (active) opened.current = true;
  const openLink = useCallback(async (target: string, source?: string) => {
    const fragment = parseLinkTarget(target).fragment;
    const file = sharedApp.metadataCache.getFirstLinkpathDest(target, source ?? tab.state.file);
    if (!file || !MD_RE.test(file.path)) { useStore.getState().notify('侧栏仅支持打开已有笔记'); return; }
    if (file.path === tab.state.file && fragment && editor.current) { openFragment(file.path, fragment, editor.current); return; }
    await useStore.getState().openRightTab('markdown', { file: file.path, ...(fragment ? { fragment } : {}) }, tab.id);
  }, [tab.id, tab.state.file]);
  return <div className="sidebar-note" hidden={!active} data-sidebar-tab={tab.id}>
    {opened.current && <Editor path={tab.state.file} sidebar onOpenLink={openLink} onReady={view => {
      editor.current = view;
      if (view && tab.state.fragment) openFragment(tab.state.file, tab.state.fragment, view);
    }} />}
  </div>;
});

/** DOM-owned plugin/guest views survive tab switches; close alone disposes them. */
const SidebarView = memo(function SidebarView({ tab, active }: { tab: SidebarTab; active: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const leaf = useRef<ReturnType<typeof sharedApp.workspace.rightLeaf>>();
  const opened = useRef(false);
  const [error, setError] = useState('');
  const revision = useSyncExternalStore(subscribePlugins, pluginRevision);
  const state = JSON.stringify(tab.state);
  useEffect(() => {
    if ((!active && !opened.current) || !host.current) return;
    opened.current = true;
    const current = leaf.current ??= sharedApp.workspace.rightLeaf(tab);
    let cancelled = false;
    void current.mountView(tab, host.current).then(() => { if (!cancelled) setError(''); })
      .catch(cause => { if (!cancelled) setError(String(cause)); });
    return () => { cancelled = true; };
  }, [active, state, tab.type, revision]);
  useEffect(() => () => { void leaf.current?.closeView(); }, []);
  return <section className="sidebar-view" hidden={!active} data-sidebar-tab={tab.id}>
    {error && <p className="editor-error" role="alert">{error}</p>}<div className="sidebar-view-host" ref={host} />
  </section>;
});


/** Both docks retain the same session/leaf hosts; side changes only placement. */
export default function SidebarTabPanels({ side, open }: { side: 'left' | 'right'; open: boolean }) {
  const allTabs = useStore(s => s.rightTabs);
  const activeId = useStore(s => side === 'left' ? s.leftActiveId : s.rightActiveId);
  const tabs = allTabs.filter(tab => (tab.side ?? 'right') === side);
  const tab = tabs.find(tab => tab.id === activeId);
  return <>
    {tab && <div className="sidebar-tab-header"><Icon name={tab.icon} size={16} /><span>{tab.title}</span>
      <button className="tool-btn" title="关闭标签页" aria-label={side === 'left' ? '关闭左侧标签页' : '关闭右侧标签页'} onClick={() => void useStore.getState().closeRightTab(tab.id)}><Icon name="x" size={16} /></button></div>}
    {open && tab?.type === 'empty' && <WorkspaceLauncher key={tab.id} sidebarId={tab.id} />}
    {tabs.filter(tab => tab.type === 'markdown').map(tab => <SidebarNote key={tab.id + tab.state.file} tab={tab} active={open && tab.id === activeId} />)}
    {open && tab?.type === 'bookmarks' && <div className="sidebar-body"><BookmarksPanel /></div>}
    {tabs.filter(tab => !['empty', 'markdown', 'bookmarks'].includes(tab.type)).map(tab => <SidebarView key={tab.id + tab.type} tab={tab} active={open && tab.id === activeId} />)}
  </>;
}
