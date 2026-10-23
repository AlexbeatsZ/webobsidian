import SidebarTabPanels from './SidebarTabPanels';
import SidebarTabRail from './SidebarTabRail';
import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../lib/store';
import { api, type NoteMatches } from '../lib/api';
import { extractMetadata, parseLinkTarget } from '@webobsidian/markdown-core';
import TagsPanel from './TagsPanel';
import Icon from './Icon';
import { useIndexVersion } from '../lib/indexEvents';
import { useDocumentSession } from '../lib/useDocumentSession';
import { sharedApp } from '../lib/plugins';
import SidebarDock from './SidebarDock';

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

export default function RightSidebar({ open }: { open: boolean; onTheme?: () => void }) {
  const rightPanel = useStore((s) => s.rightPanel);
  const setRightPanel = useStore((s) => s.setRightPanel);
  const activeId = useStore(s => s.rightActiveId);
  const allTabs = useStore(s => s.rightTabs);
  useEffect(() => {
    for (const leaf of sharedApp.workspace.custom) if (leaf.slot === 'right' && !allTabs.some(tab => tab.id === leaf.id)) void leaf.closeView();
  }, [allTabs]);
  const rail = <nav className="ribbon ribbon-right" aria-label="右侧功能与标签页">
    <div className="ribbon-fixed">{TABS.map(item => <button key={item.id} title={item.title} aria-label={item.title}
      className={!activeId && rightPanel === item.id ? 'active' : ''} onClick={() => setRightPanel(item.id)}><Icon name={item.icon} size={18} /></button>)}</div>
    <SidebarTabRail side="right" />
  </nav>;

  return (
    <SidebarDock side="right" open={open} rail={rail}>
    <div className="right-sidebar">
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
      <SidebarTabPanels side="right" open={open} />
    </div>
    </SidebarDock>
  );
}
