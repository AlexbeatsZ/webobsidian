import { memo, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useStore } from '../lib/store';
import { api, type NoteMatches } from '../lib/api';
import { extractMetadata, parseLinkTarget } from '@webobsidian/markdown-core';
import TagsPanel from './TagsPanel';
import Icon from './Icon';
import { useIndexVersion } from '../lib/indexEvents';
import { useDocumentSession } from '../lib/useDocumentSession';
import { sharedApp, subscribePlugins, pluginRevision } from '../lib/plugins';
import type { SidebarTab } from '../lib/sidebarTabs';
import SidebarDock from './SidebarDock';
import { RibbonUtilities } from './Ribbon';
import Editor from './Editor';
import BookmarksPanel from './BookmarksPanel';
import WorkspaceLauncher from './WorkspaceLauncher';
import { openFragment } from '../lib/fragmentNavigation';

const MD_RE = /\.(md|markdown)$/i;
const name = (p: string) => p.split('/').pop()?.replace(MD_RE, '') ?? p;

const TABS = [
  { id: 'backlinks', icon: 'link', title: '反向链接' },
  { id: 'outgoing', icon: 'arrow-up-right', title: '出链' },
  { id: 'tags', icon: 'hash', title: '标签' },
  { id: 'outline', icon: 'list', title: '大纲' },
] as const;

function useActiveMetadata() {
  const path = useStore(s => s.activePath);
  const { session, snapshot } = useDocumentSession(path && MD_RE.test(path) ? path : null);
  return useMemo(() => extractMetadata(session?.analysis ?? ''), [session, snapshot.version]);
}

function Section({
  title,
  count,
  open,
  onToggle,
  children,
}: {
  title: string;
  count: number;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <>
      <div className="section-head" onClick={onToggle}>
        <Icon name={open ? 'chevron-down' : 'chevron-right'} size={14} />
        <span>{title}</span>
        <span className="count">{count}</span>
      </div>
      {open && children}
    </>
  );
}

/** Linked mentions (backlinks index) + Unlinked mentions (plain-text title hits). */
function BacklinksPanel() {
  const activePath = useStore((s) => s.activePath);
  const indexVersion = useIndexVersion();
  const key = JSON.stringify([activePath, indexVersion]);
  const openFile = useStore((s) => s.openFile);
  const [linkedResult, setLinked] = useState({ key: '', paths: [] as string[] });
  const [unlinkedResult, setUnlinked] = useState({ key: '', matches: [] as NoteMatches[] });
  const linked = linkedResult.key === key ? linkedResult.paths : [];
  const unlinked = unlinkedResult.key === key ? unlinkedResult.matches : [];
  const [openLinked, setOpenLinked] = useState(true);
  const [openUnlinked, setOpenUnlinked] = useState(true);

  useEffect(() => {
    if (!activePath || !MD_RE.test(activePath)) return;
    const controller = new AbortController();
    api.backlinks(activePath, controller.signal)
      .then((r) => { if (!controller.signal.aborted) setLinked({ key, paths: r.backlinks }); })
      .catch(() => { if (!controller.signal.aborted) setLinked({ key, paths: [] }); });
    return () => controller.abort();
  }, [activePath, key]);

  useEffect(() => {
    if (!activePath || !MD_RE.test(activePath) || !openUnlinked || linkedResult.key !== key || unlinkedResult.key === key) return;
    const controller = new AbortController();
    const title = name(activePath);
    (async () => {
      try {
        const { hits } = await api.search(title, 100, controller.signal);
        const linkedSet = new Set(linkedResult.paths);
        const candidates = hits
          .filter((h) => h.path !== activePath && !linkedSet.has(h.path) && MD_RE.test(h.path))
          .slice(0, 30)
          .map((h) => h.path);
        if (!candidates.length) {
          if (!controller.signal.aborted) setUnlinked({ key, matches: [] });
          return;
        }
        const { matches } = await api.searchMatches(title, candidates, false, true, controller.signal);
        if (!controller.signal.aborted) setUnlinked({ key, matches: matches.filter((m) => m.count > 0) });
      } catch {
        if (!controller.signal.aborted) setUnlinked({ key, matches: [] });
      }
    })();
    return () => {
      controller.abort();
    };
  }, [activePath, key, openUnlinked, linkedResult, unlinkedResult.key]);

  return (
    <>
      <div className="nav-header">
        <span className="nav-title">
          {activePath && MD_RE.test(activePath) ? `Backlinks for ${name(activePath)}` : 'Backlinks'}
        </span>
      </div>
      <div className="sidebar-body">
        <Section title="Linked mentions" count={linked.length} open={openLinked} onToggle={() => setOpenLinked(!openLinked)}>
          {linked.length === 0 && <div className="panel-item">No backlinks found.</div>}
          {linked.map((b) => (
            <div key={b} className="mention-box">
              <div className="mention-src" onClick={() => openFile(b)}>
                {name(b)}
              </div>
              <div style={{ color: 'var(--text-faint)' }}>links to {name(activePath ?? '')}</div>
            </div>
          ))}
        </Section>
        <Section
          title="Unlinked mentions"
          count={unlinked.length}
          open={openUnlinked}
          onToggle={() => setOpenUnlinked(!openUnlinked)}
        >
          {unlinked.length === 0 && <div className="panel-item">No unlinked mentions found.</div>}
          {unlinked.map((m) => (
            <div key={m.path} className="mention-box">
              <div className="mention-src" onClick={() => openFile(m.path)}>
                {name(m.path)}
              </div>
              {m.contexts[0] && (
                <div style={{ color: 'var(--text-muted)' }}>
                  {m.contexts[0].pre && '…'}
                  {m.contexts[0].text}
                  {m.contexts[0].post && '…'}
                </div>
              )}
            </div>
          ))}
        </Section>
      </div>
    </>
  );
}

/** Every wikilink in the active note, resolved (exists) or not (click creates). */
function OutgoingPanel() {
  const activePath = useStore((s) => s.activePath);
  const openWikilink = useStore((s) => s.openWikilink);
  const metadata = useActiveMetadata();
  const indexVersion = useIndexVersion();

  const targets = useMemo(() => {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const link of metadata.links) {
      const t = parseLinkTarget(link).path;
      if (t && !seen.has(t)) {
        seen.add(t);
        out.push(t);
      }
    }
    return out.slice(0, 200);
  }, [metadata]);
  const resolved = useMemo(() => Object.fromEntries(targets.map(target => [target,
    sharedApp.metadataCache.getFirstLinkpathDest(target, activePath ?? '')?.path ?? null])), [targets, activePath, indexVersion]);

  const links = targets.filter((t) => resolved[t] !== undefined && resolved[t] !== null);
  // /api/resolve only knows notes — an unresolved attachment embed (image/pdf/…)
  // is NOT a "create this note" candidate, so keep those out of the list.
  const unresolved = targets.filter(
    (t) => resolved[t] === null && !/\.(png|jpe?g|gif|svg|webp|bmp|ico|pdf|mp3|mp4|mov|zip)$/i.test(t),
  );

  return (
    <>
      <div className="nav-header">
        <span className="nav-title">
          {activePath && MD_RE.test(activePath) ? `Outgoing links from ${name(activePath)}` : 'Outgoing links'}
        </span>
      </div>
      <div className="sidebar-body">
        <div className="section-head" style={{ cursor: 'default' }}>
          <span>Links</span>
          <span className="count">{links.length}</span>
        </div>
        {links.length === 0 && <div className="panel-item">No outgoing links.</div>}
        {links.map((t) => (
          <div key={t} className="outgoing-item" onClick={() => openWikilink(t)} title={resolved[t] ?? t}>
            <Icon name="file-text" size={14} />
            <span>{t}</span>
          </div>
        ))}
        {unresolved.length > 0 && (
          <div className="section-head" style={{ cursor: 'default' }}>
            <span>Unresolved</span>
            <span className="count">{unresolved.length}</span>
          </div>
        )}
        {unresolved.map((t) => (
          <div key={t} className="outgoing-item unresolved" onClick={() => openWikilink(t)} title="Not created yet — click to create">
            <Icon name="file-plus" size={14} />
            <span>{t}</span>
          </div>
        ))}
      </div>
    </>
  );
}

function OutlinePanel() {
  const heads = useActiveMetadata().headings;
  return (
    <>
      <div className="nav-header">
        <span className="nav-title">Outline</span>
      </div>
      <div className="sidebar-body">
        {heads.length === 0 && <div className="panel-item">No headings</div>}
        {heads.map((h, i) => (
          <div key={i} className="outline-item" style={{ paddingLeft: 10 + (h.level - 1) * 12 }}>
            {h.text}
          </div>
        ))}
      </div>
    </>
  );
}

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

export default function RightSidebar({ open, onTheme }: { open: boolean; onTheme: () => void }) {
  const rightPanel = useStore((s) => s.rightPanel);
  const setRightPanel = useStore((s) => s.setRightPanel);
  const tabs = useStore(s => s.rightTabs);
  const activeId = useStore(s => s.rightActiveId);
  const select = useStore(s => s.selectRightTab);
  const close = useStore(s => s.closeRightTab);
  const tab = tabs.find(tab => tab.id === activeId);
  const openContextMenu = useStore(s => s.openContextMenu);
  useEffect(() => {
    for (const leaf of sharedApp.workspace.custom) if (leaf.slot === 'right' && !tabs.some(tab => tab.id === leaf.id)) void leaf.closeView();
  }, [tabs]);
  const rail = <nav className="ribbon ribbon-right" aria-label="右侧功能与标签页">
    <div className="ribbon-fixed">{TABS.map(item => <button key={item.id} title={item.title} aria-label={item.title}
      className={!activeId && rightPanel === item.id ? 'active' : ''} onClick={() => setRightPanel(item.id)}><Icon name={item.icon} size={18} /></button>)}</div>
    <div className="ribbon-divider" />
    <button title="新标签页" aria-label="新建右侧标签页" onClick={() => useStore.getState().openRightTab('empty')}><Icon name="plus" size={18} /></button>
    <div className="ribbon-tabs" role="tablist" aria-label="右侧标签页" aria-orientation="vertical">
      {tabs.map((tab, index) => <button key={tab.id} role="tab" aria-selected={activeId === tab.id} title={tab.title}
        aria-label={tab.title} className={activeId === tab.id ? 'active' : ''} onClick={() => select(tab.id)}
        onAuxClick={event => { if (event.button === 1) { event.preventDefault(); close(tab.id); } }}
        onKeyDown={event => {
          if (event.key === 'Delete') { event.preventDefault(); close(tab.id); }
          if (['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) {
            event.preventDefault(); const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : tabs.length - 1)) % tabs.length;
            select(tabs[next].id); (event.currentTarget.parentElement!.children[next] as HTMLElement).focus();
          }
        }}
        onContextMenu={event => { event.preventDefault(); openContextMenu({ x: event.clientX, y: event.clientY, items: [
          { label: '关闭标签页', icon: 'x', onClick: () => close(tab.id) },
          { label: '关闭其他标签页', onClick: () => tabs.filter(other => other.id !== tab.id).forEach(other => close(other.id)) },
        ] }); }}><Icon name={tab.icon} size={18} /><span className="ribbon-tab-number">{index + 1}</span></button>)}
    </div>
    <div className="ribbon-divider" /><RibbonUtilities onTheme={onTheme} />
  </nav>;

  return (
    <SidebarDock side="right" open={open} rail={rail}>
    <div className="right-sidebar">
      {tab && <div className="sidebar-tab-header"><Icon name={tab.icon} size={16} /><span>{tab.title}</span>
        <button className="tool-btn" title="关闭标签页" aria-label="关闭右侧标签页" onClick={() => close(tab.id)}><Icon name="x" size={16} /></button></div>}
      {open && !activeId && rightPanel === 'backlinks' && <BacklinksPanel />}
      {open && !activeId && rightPanel === 'outgoing' && <OutgoingPanel />}
      {open && !activeId && rightPanel === 'tags' && (
        <>
          <div className="nav-header">
            <span className="nav-title">Tags</span>
          </div>
          <div className="sidebar-body">
            <TagsPanel />
          </div>
        </>
      )}
      {open && !activeId && rightPanel === 'outline' && <OutlinePanel />}
      {open && tab?.type === 'empty' && <WorkspaceLauncher key={tab.id} sidebarId={tab.id} />}
      {tabs.filter(tab => tab.type === 'markdown').map(tab => <SidebarNote key={tab.id + tab.state.file} tab={tab} active={open && tab.id === activeId} />)}
      {open && tab?.type === 'bookmarks' && <div className="sidebar-body"><BookmarksPanel /></div>}
      {tabs.filter(tab => !['empty', 'markdown', 'bookmarks'].includes(tab.type)).map(tab => <SidebarView key={tab.id + tab.type} tab={tab} active={open && tab.id === activeId} />)}
    </div>
    </SidebarDock>
  );
}
