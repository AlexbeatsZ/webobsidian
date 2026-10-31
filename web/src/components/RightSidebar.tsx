import { BacklinksPanel, OutgoingPanel, NoteLinkSection as Section } from './NoteLinks';
import NoteProperties from './NoteProperties';
import SidebarTabPanels from './SidebarTabPanels';
import SidebarTabRail from './SidebarTabRail';
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { Text } from '@codemirror/state';
import { documents } from '../lib/documents';
import { useStore } from '../lib/store';
import { extractMetadata } from '@webobsidian/markdown-core';
import TagsPanel from './TagsPanel';
import Icon from './Icon';
import { useIndexVersion } from '../lib/indexEvents';
import { useDocumentSession } from '../lib/useDocumentSession';
import { sharedApp } from '../lib/plugins';
import SidebarDock from './SidebarDock';
import MarkdownMinimap from './MarkdownMinimap';
import { useMainPdfSession } from '../lib/pdf/react';
import PdfOutlinePanel from './PdfOutlinePanel';
import PdfThumbnailsPanel from './PdfThumbnailsPanel';
import McpLauncher from './McpLauncher';
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
  { id: 'properties', icon: 'sliders', title: '属性' },
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
        <McpLauncher />
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
      {presented && !activeId && rightPanel === 'properties' && <NoteProperties path={path} />}
      {presented && !activeId && rightPanel === 'backlinks' && <BacklinksPanel path={path} />}
      {presented && !activeId && rightPanel === 'outgoing' && <OutgoingPanel path={path} />}
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
