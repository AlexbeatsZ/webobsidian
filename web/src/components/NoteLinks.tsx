import { useEffect, useMemo, useState } from 'react';
import { extractMetadata } from '@webobsidian/markdown-core';
import { useStore } from '../lib/store';
import { api, type NoteMatches } from '../lib/api';
import { sharedApp } from '../lib/plugins';
import { useIndexVersion } from '../lib/indexEvents';
import { useDocumentSession } from '../lib/useDocumentSession';
import { useLinkPreview } from '../lib/useLinkPreview';
import Icon from './Icon';

const MD_RE = /\.(md|markdown)$/i;
const name = (path: string) => path.split('/').pop()?.replace(MD_RE, '') ?? path;

export function NoteLinkSection({
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

function LinkedMention({ path, target }: { path: string; target: string }) {
  const [expanded, setExpanded] = useState(false);
  const { session, snapshot, error } = useDocumentSession(expanded ? path : null);
  const preview = useLinkPreview(path);
  const occurrences = useMemo(() => {
    if (!session) return [];
    return extractMetadata(session.analysis).linkOccurrences.filter(link => sharedApp.metadataCache.getFirstLinkpathDest(link.target, path)?.path === target);
  }, [session, snapshot.version, path, target]);
  return <div className="mention-box">
    <div className="mention-src" {...preview(path)} onClick={() => void useStore.getState().openFile(path)}>{name(path)}</div>
    <button className="text-btn" onClick={() => setExpanded(!expanded)}>{expanded ? '收起引用' : '查看引用位置'}</button>
    {error && <div role="alert">{error.message}</div>}
    {expanded && occurrences.map(link => <div key={link.from} className="mention-context" role="button" tabIndex={0}
      {...preview(path)} onClick={() => void useStore.getState().navigate(path, { range: link, text: session!.analysis.text.slice(link.from, link.to) })}
      onKeyDown={event => { if (event.key === 'Enter') void useStore.getState().navigate(path, { range: link, text: session!.analysis.text.slice(link.from, link.to) }); }}>
      {session!.analysis.text.slice(Math.max(0, link.from - 32), link.to + 32).replace(/\n/g, ' ')}
    </div>)}
    {expanded && session && !occurrences.length && <div>当前正文没有可定位的引用</div>}
  </div>;
}

/** Linked mentions (backlinks index) + Unlinked mentions (plain-text title hits). */
export function BacklinksPanel({ path: activePath }: { path: string | null }) {
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
          {activePath && MD_RE.test(activePath) ? `${name(activePath)} 的反向链接` : "反向链接"}
        </span>
      </div>
      <div className="sidebar-body">
        <NoteLinkSection title="已链接提及" count={linked.length} open={openLinked} onToggle={() => setOpenLinked(!openLinked)}>
          {linked.length === 0 && <div className="panel-item">未发现反向链接。</div>}
          {linked.map(b => <LinkedMention key={b} path={b} target={activePath!} />)}
        </NoteLinkSection>
        <NoteLinkSection
          title="未链接提及"
          count={unlinked.length}
          open={openUnlinked}
          onToggle={() => setOpenUnlinked(!openUnlinked)}
        >
          {unlinked.length === 0 && <div className="panel-item">未发现未链接提及。</div>}
          {unlinked.map((m) => (
            <div key={m.path} className="mention-box">
              <div className="mention-src" onClick={() => openFile(m.path)}>
                {name(m.path)}
              </div>
              {m.contexts[0] && (
                <div style={{ color: 'var(--text-muted)' }} onClick={() => {
                  const source = m.contexts[0].source;
                  if (source) void useStore.getState().navigate(m.path, { range: source, text: source.text });
                  else void openFile(m.path);
                }}>
                  {m.contexts[0].pre && '…'}
                  {m.contexts[0].text}
                  {m.contexts[0].post && '…'}
                </div>
              )}
            </div>
          ))}
        </NoteLinkSection>
      </div>
    </>
  );
}

/** Every wikilink in the active note, resolved (exists) or not (click creates). */
export function OutgoingPanel({ path: activePath }: { path: string | null }) {
  const openWikilink = useStore((s) => s.openWikilink);
  const { session, snapshot } = useDocumentSession(activePath && MD_RE.test(activePath) ? activePath : null);
  const metadata = useMemo(() => extractMetadata(session?.analysis ?? ''), [session, snapshot.version]);
  const indexVersion = useIndexVersion();
  const preview = useLinkPreview(activePath);

  const targets = useMemo(() => {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const link of metadata.links) {
      const t = link;
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
          {activePath && MD_RE.test(activePath) ? `${name(activePath)} 的出链` : "出链"}
        </span>
      </div>
      <div className="sidebar-body">
        <div className="section-head" style={{ cursor: 'default' }}>
          <span>链接</span>
          <span className="count">{links.length}</span>
        </div>
        {links.length === 0 && <div className="panel-item">无出链。</div>}
        {links.map((t) => (
          <div key={t} className="outgoing-item" {...preview(t)} onClick={() => openWikilink(t, activePath ?? undefined)} title={resolved[t] ?? t}>
            <Icon name="file-text" size={14} />
            <span>{t}</span>
          </div>
        ))}
        {unresolved.length > 0 && (
          <div className="section-head" style={{ cursor: 'default' }}>
            <span>未解析</span>
            <span className="count">{unresolved.length}</span>
          </div>
        )}
        {unresolved.map((t) => (
          <div key={t} className="outgoing-item unresolved" onClick={() => openWikilink(t)} title="尚未创建 — 点击以创建">
            <Icon name="file-plus" size={14} />
            <span>{t}</span>
          </div>
        ))}
      </div>
    </>
  );
}
