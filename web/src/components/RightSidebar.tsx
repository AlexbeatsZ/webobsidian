import SidebarTabPanels from './SidebarTabPanels';
import SidebarTabRail from './SidebarTabRail';
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { Text } from '@codemirror/state';
import { documents } from '../lib/documents';
import { useStore } from '../lib/store';
import { api, type NoteMatches } from '../lib/api';
import { extractMetadata, parseLinkTarget } from '@webobsidian/markdown-core';
import TagsPanel from './TagsPanel';
import Icon from './Icon';
import { useIndexVersion } from '../lib/indexEvents';
import { useDocumentSession } from '../lib/useDocumentSession';
import { sharedApp } from '../lib/plugins';
import SidebarDock from './SidebarDock';
import { useLinkPreview } from '../lib/useLinkPreview';
import MarkdownMinimap from './MarkdownMinimap';
import { useMainPdfSession } from '../lib/pdf/react';
import PdfOutlinePanel from './PdfOutlinePanel';
import PdfThumbnailsPanel from './PdfThumbnailsPanel';
import {
  addCurrentMcpContext,
  mcpContextSnapshot,
  pinMcpContext,
  removeMcpContext,
  reviewSnapshot,
  selectReview,
  subscribeMcpContext,
  subscribeReview,
  type McpContextItem,
  type McpSelection,
} from '../lib/review/client';

const MD_RE = /\.(md|markdown)$/i;
const name = (p: string) => p.split('/').pop()?.replace(MD_RE, '') ?? p;

const TABS = [
  { id: 'backlinks', icon: 'link', title: '反向链接' },
  { id: 'outgoing', icon: 'arrow-up-right', title: '出链' },
  { id: 'tags', icon: 'hash', title: '标签' },
  { id: 'outline', icon: 'list', title: '大纲' },
  { id: 'minimap', icon: 'image', title: '缩略图' },
  { id: 'mcp', icon: 'cpu', title: 'MCP' },
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
          {activePath && MD_RE.test(activePath) ? `${name(activePath)} 的反向链接` : "反向链接"}
        </span>
      </div>
      <div className="sidebar-body">
        <Section title="已链接提及" count={linked.length} open={openLinked} onToggle={() => setOpenLinked(!openLinked)}>
          {linked.length === 0 && <div className="panel-item">未发现反向链接。</div>}
          {linked.map(b => <LinkedMention key={b} path={b} target={activePath!} />)}
        </Section>
        <Section
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

function OutlinePanel() {
  const heads = useActiveMetadata().headings;
  return (
    <>
      <div className="nav-header">
        <span className="nav-title">大纲</span>
      </div>
      <div className="sidebar-body">
        {heads.length === 0 && <div className="panel-item">无标题</div>}
        {heads.map((h, i) => (
          <div key={i} className="outline-item" style={{ paddingLeft: 10 + (h.level - 1) * 12 }} onClick={() => {
            const path = useStore.getState().activePath;
            if (path) void useStore.getState().navigate(path, { range: { from: h.from, to: h.to } });
          }}>
            {h.text}
          </div>
        ))}
      </div>
    </>
  );
}

function formatSelectionRange(sel: McpSelection): string {
  if (!sel.from || !sel.to) return '阅读选区';
  return sel.from.line === sel.to.line
    ? `L${sel.from.line}:${sel.from.ch}-${sel.to.ch}`
    : `L${sel.from.line}:${sel.from.ch}-L${sel.to.line}:${sel.to.ch}`;
}

function openMcpItem(item: McpContextItem, selection = item.selections?.[0]): void {
  void (async () => {
    if (!selection?.from || !selection.to) { await useStore.getState().openFile(item.path); return; }
    const session = await documents.open(item.path), text = Text.of(session.snapshot.text.split('\n'));
    const offset = (point: { line: number; ch: number }) => {
      const line = text.line(Math.min(text.lines, point.line));
      return Math.min(line.to, line.from + point.ch);
    };
    await useStore.getState().navigate(item.path, { range: { from: offset(selection.from), to: offset(selection.to) }, text: selection.text });
  })().catch(error => useStore.getState().notify(String(error)));
}

function McpPanel() {
  const ctx = useSyncExternalStore(subscribeMcpContext, mcpContextSnapshot);
  const review = useSyncExternalStore(subscribeReview, reviewSnapshot);
  const [openContext, setOpenContext] = useState(true);
  const [openReview, setOpenReview] = useState(true);

  return (
    <>
      <div className="nav-header">
        <span className="nav-title">MCP</span>
        <button
          type="button"
          className="icon-btn"
          title="添加选中内容或当前页面"
          aria-label="添加选中内容或当前页面"
          disabled={ctx.busy}
          onClick={() => void addCurrentMcpContext()}
        >
          <Icon name="plus" size={14} />
        </button>
      </div>
      <div className="sidebar-body">
        {ctx.error && <div className="panel-item" role="alert">{ctx.error}</div>}
        <Section title="上下文" count={ctx.items.length} open={openContext} onToggle={() => setOpenContext(!openContext)}>
          {ctx.items.length === 0 && <div className="panel-item">暂无待发送上下文。</div>}
          {ctx.items.map((item) => (
            <div key={item.id} className="mention-box mcp-context-item" data-context-id={item.id} data-context-kind={item.kind}>
              <div className="mcp-context-head">
                <button type="button" className="mcp-context-link" onClick={() => openMcpItem(item)} title={item.path}>
                  <Icon name={item.kind === 'page' ? 'file-text' : 'quote'} size={14} />
                  <span className="mcp-context-title">{name(item.path)}</span>
                  <span className="mcp-context-meta">
                    {item.kind === 'page' ? '页面路径' : item.selections?.length === 1 ? formatSelectionRange(item.selections[0]) : `${item.selections?.length ?? 0} 处选区`}
                  </span>
                </button>
                <div className="mcp-context-actions">
                  <button
                    type="button"
                    className={'icon-btn mcp-pin-btn' + (item.pinned ? ' is-active' : '')}
                    title={item.pinned ? '取消固定' : '固定保留'}
                    aria-label={item.pinned ? '取消固定' : '固定保留'}
                    aria-pressed={item.pinned}
                    disabled={ctx.busy}
                    onClick={() => void pinMcpContext(item.id, !item.pinned)}
                  >
                    <Icon name="pin" size={14} />
                  </button>
                  <button
                    type="button"
                    className="icon-btn mcp-remove-btn"
                    title="移除"
                    aria-label="移除上下文"
                    disabled={ctx.busy}
                    onClick={() => void removeMcpContext(item.id)}
                  >
                    <Icon name="trash" size={14} />
                  </button>
                </div>
              </div>
              <div className="mcp-context-path">{item.path}</div>
              {item.kind === 'selection' && item.selections?.map((sel, index) => (
                <div
                  key={index}
                  className="mention-context mcp-context-snippet"
                  role="button"
                  tabIndex={0}
                  onClick={() => openMcpItem(item, sel)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openMcpItem(item, sel); }
                  }}
                >
                  {item.selections!.length > 1 && <span className="mcp-context-range">{formatSelectionRange(sel)}</span>}
                  <span>{sel.text.replace(/\s+/g, ' ').slice(0, 160)}</span>
                </div>
              ))}
            </div>
          ))}
        </Section>
        <Section title="候选修改" count={review.proposals.length} open={openReview} onToggle={() => setOpenReview(!openReview)}>
          {review.error && <div className="panel-item" role="alert">{review.error}</div>}
          {review.proposals.length === 0 && <div className="panel-item">暂无候选修改。</div>}
          {review.proposals.map((p) => (
            <div key={p.id} className="mention-box mcp-review-item" onClick={() => void selectReview(p.id)}>
              <div className="mention-src">{p.title}</div>
              <div className="mcp-context-path">{p.path} · {p.pending ? '待审阅' : '已处理'}</div>
            </div>
          ))}
        </Section>
      </div>
    </>
  );
}

export default function RightSidebar({ open }: { open: boolean; onTheme?: () => void }) {
  const path = useStore(s => s.activePath);
  const pdf = useMainPdfSession(path);
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
    {presented => <div className="right-sidebar">
      {presented && !activeId && rightPanel === 'backlinks' && <BacklinksPanel />}
      {presented && !activeId && rightPanel === 'outgoing' && <OutgoingPanel />}
      {presented && !activeId && rightPanel === 'tags' && (
        <>
          <div className="nav-header">
            <span className="nav-title">标签</span>
          </div>
          <div className="sidebar-body">
            <TagsPanel />
          </div>
        </>
      )}
      {presented && !activeId && rightPanel === 'outline' && (pdf ? <PdfOutlinePanel session={pdf} /> : <OutlinePanel />)}
      {presented && !activeId && rightPanel === 'minimap' && (pdf ? <PdfThumbnailsPanel session={pdf} />
        : path && MD_RE.test(path) ? <MarkdownMinimap key={path} path={path} />
        : <div className="panel-item">打开 Markdown 或 PDF 查看缩略图</div>)}
      {presented && !activeId && rightPanel === 'mcp' && <McpPanel />}
      <SidebarTabPanels side="right" open={presented} />
    </div>}
    </SidebarDock>
  );
}
