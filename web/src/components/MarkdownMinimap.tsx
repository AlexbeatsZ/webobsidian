import { useEffect, useRef } from 'react';
import { getSearchQuery, searchPanelOpen, type SearchQuery } from '@codemirror/search';
import type { EditorView } from '@codemirror/view';
import { useDocumentSession } from '../lib/useDocumentSession';
import { navigationView, navigationViewport, navigateTo, subscribeNavigationViews } from '../lib/fragmentNavigation';
import { MINIMAP_MAX_HEIGHT, minimapRows, minimapViewport, minimapSearchRows, workspaceMatchRanges } from '../lib/markdownMinimap';
import { getSearchResultHighlights, subscribeSearchResultHighlights } from '../lib/search';
import '../styles/minimap.css';

export default function MarkdownMinimap({ path }: { path: string }) {
  const { session, snapshot, error } = useDocumentSession(path);
  const host = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const invalidate = useRef<() => void>();
  const latest = useRef({ session, snapshot });
  latest.current = { session, snapshot };

  useEffect(() => {
    const element = host.current, image = canvas.current, box = viewport.current;
    if (!element || !image || !box || !session) return;
    let view: EditorView | undefined;
    let frame = 0, paint = true, paints = 0;
    let query: SearchQuery | undefined, searchOpen = false;
    let drag: { pointer: number; offset: number } | undefined;
    let jumpFrame = 0, jumpLine = 0;
    const schedule = (redraw = false) => {
      paint ||= redraw;
      if (!frame) frame = requestAnimationFrame(update);
    };
    const scroll = () => schedule();
    const editorResize = new ResizeObserver(scroll);
    const bind = () => {
      const next = navigationView(path, 'main');
      if (view === next) return;
      if (view) { view.scrollDOM.removeEventListener('scroll', scroll); editorResize.unobserve(view.scrollDOM); }
      view = next;
      query = undefined;
      paint = true;
      if (view) { view.scrollDOM.addEventListener('scroll', scroll, { passive: true }); editorResize.observe(view.scrollDOM); }
    };
    const draw = () => {
      if (!view) return;
      const model = latest.current.session?.analysis;
      if (!model || model.text.length !== view.state.doc.length) return;
      const width = Math.max(1, Math.min(512, Math.round(element.clientWidth)));
      const height = Math.max(1, Math.min(MINIMAP_MAX_HEIGHT, Math.round(element.clientHeight)));
      image.width = width; image.height = height;
      const context = image.getContext('2d');
      if (!context) return;
      const style = getComputedStyle(element);
      const colors = { text: style.getPropertyValue('--text-muted').trim() || '#888',
        accent: style.getPropertyValue('--interactive-accent').trim() || '#7b6cd9',
        search: style.getPropertyValue('--minimap-match').trim() || '#ddaa33' };
      context.clearRect(0, 0, width, height);
      const rows = minimapRows(model, view.state.doc, height);
      context.font = '3px monospace';
      for (const row of rows) {
        const top = (row.line - 1) / view.state.doc.lines * height;
        const rowHeight = Math.max(1, (row.endLine - row.line + 1) / view.state.doc.lines * height - 1);
        context.fillStyle = row.kind === 'text' ? colors.text : colors.accent;
        context.globalAlpha = row.kind === 'text' ? 0.75 : 0.55;
        if (['image', 'math', 'table', 'code'].includes(row.kind)) {
          const inset = row.kind === 'math' ? width * 0.2 : 6;
          context.fillRect(inset, top, width - inset * 2, Math.min(5, rowHeight));
        } else context.fillText(row.text, 6, top + 3, width - 12);
      }
      context.globalAlpha = 1;
      const workspace = getSearchResultHighlights();
      const ranges = workspace.query ? workspaceMatchRanges(view.state.doc, workspace.matches.get(path)) : [];
      const bins = new Set<number>();
      context.fillStyle = colors.search;
      for (const range of ranges) {
        const top = Math.floor((view.state.doc.lineAt(range.from).number - 1) / view.state.doc.lines * height);
        if (!bins.has(top)) { context.fillRect(0, top, width, 2); bins.add(top); }
      }
      const currentQuery = getSearchQuery(view.state);
      query = currentQuery; searchOpen = searchPanelOpen(view.state);
      const searchRows = searchOpen && currentQuery.valid && currentQuery.search ? minimapSearchRows(view.state, currentQuery, height) : [];
      context.fillStyle = colors.accent;
      for (const line of searchRows) {
        context.fillRect(width - 8, (line - 1) / view.state.doc.lines * height, 8, 2);
      }
      image.dataset.paintCount = String(++paints);
      image.dataset.sourceLines = String(view.state.doc.lines);
      image.dataset.markerCount = String(searchRows.length);
      image.dataset.lastSearchLine = String(searchRows.at(-1) ?? 0);
      image.dataset.workspaceMarkerCount = String(ranges.length);
    };
    const update = () => {
      frame = 0;
      bind();
      element.dataset.ready = String(!!view);
      if (!view) return;
      if (paint) { paint = false; draw(); }
      const range = minimapViewport(view.state.doc, navigationViewport(view));
      const height = Math.max(8, range.height * element.clientHeight);
      const top = Math.min(element.clientHeight - height, range.top * element.clientHeight);
      box.style.height = `${height}px`;
      box.style.transform = `translateY(${Math.max(0, top)}px)`;
      element.setAttribute('aria-valuenow', String(Math.round(range.top * view.state.doc.lines) + 1));
      element.setAttribute('aria-valuemax', String(view.state.doc.lines));
    };
    const stopViews = subscribeNavigationViews(changed => {
      if (changed !== view && changed !== navigationView(path, 'main')) return;
      const nextQuery = getSearchQuery(changed.state), nextOpen = searchPanelOpen(changed.state);
      const redraw = !query?.eq(nextQuery) || searchOpen !== nextOpen;
      query = nextQuery; searchOpen = nextOpen;
      schedule(redraw);
    });
    const stopSearch = subscribeSearchResultHighlights(() => schedule(true));
    const resize = new ResizeObserver(() => schedule(true));
    resize.observe(element);
    const theme = new MutationObserver(() => schedule(true));
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style', 'data-theme'] });
    const app = element.closest('.app');
    if (app) theme.observe(app, { attributes: true, attributeFilter: ['class', 'style'] });
    const jump = (line: number) => {
      jumpLine = Math.max(0, Math.min((view?.state.doc.lines ?? 1) - 1, Math.round(line)));
      if (!jumpFrame) jumpFrame = requestAnimationFrame(() => {
        jumpFrame = 0;
        if (view) void navigateTo(path, { line: jumpLine, viewId: 'main', focus: false, history: false, scrollOnly: true }, view);
      });
    };
    const point = (event: PointerEvent) => {
      if (!view) return;
      const rect = element.getBoundingClientRect();
      const center = event.clientY - rect.top - (drag?.offset ?? 0);
      jump(center / Math.max(1, rect.height) * view.state.doc.lines);
    };
    const down = (event: PointerEvent) => {
      if (event.button !== 0 || !view) return;
      event.preventDefault();
      const onBox = box.contains(event.target as Node);
      const rect = element.getBoundingClientRect();
      const range = minimapViewport(view.state.doc, navigationViewport(view));
      drag = { pointer: event.pointerId, offset: onBox ? event.clientY - rect.top - (range.top + range.height / 2) * rect.height : 0 };
      element.setPointerCapture(event.pointerId);
      if (!onBox) point(event);
    };
    const move = (event: PointerEvent) => { if (drag?.pointer === event.pointerId) point(event); };
    const up = (event: PointerEvent) => {
      if (drag?.pointer !== event.pointerId) return;
      drag = undefined;
      if (element.hasPointerCapture(event.pointerId)) element.releasePointerCapture(event.pointerId);
    };
    const key = (event: KeyboardEvent) => {
      if (!view || !['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const range = minimapViewport(view.state.doc, navigationViewport(view));
      const center = (range.top + range.height / 2) * view.state.doc.lines;
      const delta = event.key.startsWith('Page') ? Math.max(1, range.height * view.state.doc.lines) : 1;
      jump(event.key === 'Home' ? 0 : event.key === 'End' ? view.state.doc.lines - 1
        : center + (event.key.endsWith('Down') ? delta : -delta));
    };
    const events = new AbortController();
    element.addEventListener('pointerdown', down, { signal: events.signal });
    element.addEventListener('pointermove', move, { signal: events.signal });
    element.addEventListener('pointerup', up, { signal: events.signal });
    element.addEventListener('pointercancel', up, { signal: events.signal });
    element.addEventListener('lostpointercapture', () => { drag = undefined; }, { signal: events.signal });
    element.addEventListener('keydown', key, { signal: events.signal });
    const redraw = () => schedule(true);
    invalidate.current = redraw;
    schedule(true);
    return () => {
      if (invalidate.current === redraw) invalidate.current = undefined;
      stopViews(); stopSearch(); resize.disconnect(); editorResize.disconnect(); theme.disconnect(); events.abort();
      if (view) view.scrollDOM.removeEventListener('scroll', scroll);
      cancelAnimationFrame(frame); cancelAnimationFrame(jumpFrame);
      if (drag && element.hasPointerCapture(drag.pointer)) element.releasePointerCapture(drag.pointer);
    };
  }, [path, session]);
  useEffect(() => { invalidate.current?.(); }, [snapshot.version]);

  return <section className="markdown-minimap-panel" aria-label="Markdown 缩略图">
    <div className="nav-header"><span className="nav-title">缩略图</span></div>
    <div className="markdown-minimap-description">全文结构概览 · 点击或拖动定位</div>
    {error && <div role="alert">{error.message}</div>}
    <div ref={host} className="markdown-minimap" role="slider" tabIndex={0} aria-label="文档缩略图位置"
      aria-orientation="vertical" aria-valuemin={1} aria-valuenow={1} aria-valuemax={1}>
      <canvas ref={canvas} aria-hidden="true" />
      <div ref={viewport} className="markdown-minimap-viewport" aria-hidden="true" />
    </div>
    <div className="markdown-minimap-description">公式、图片与代码以结构缩略显示<br />横条：仓库搜索 · 右侧标记：当前查找（按像素合并）</div>
  </section>;
}
