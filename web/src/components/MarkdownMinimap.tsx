import { useEffect, useRef } from 'react';
import { getSearchQuery, searchPanelOpen, type SearchQuery } from '@codemirror/search';
import type { EditorView } from '@codemirror/view';
import { useDocumentSession } from '../lib/useDocumentSession';
import { navigationView, navigationViewport, navigateTo, subscribeNavigationViews } from '../lib/fragmentNavigation';
import { MINIMAP_MAX_HEIGHT, minimapViewport, minimapSearchRows, workspaceMatchRanges } from '../lib/markdownMinimap';
import { paintMarkdownMinimap } from '../lib/markdownMinimapCanvas';
import { observeMinimapLayout } from '../lib/markdownMinimapLayout';
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
    let frame = 0, paint = true, mode: string | null = null;
    let query: SearchQuery | undefined, searchOpen = false;
    let drag: { pointer: number; offset: number } | undefined;
    let jumpFrame = 0, jumpLine = 0;
    let layout: ReturnType<typeof observeMinimapLayout> | undefined;
    const schedule = (redraw = false) => {
      paint ||= redraw;
      if (!frame) frame = requestAnimationFrame(update);
    };
    const scroll = () => schedule();
    const bind = () => {
      const next = navigationView(path, 'main');
      if (view === next) return;
      layout?.dispose();
      view = next;
      query = undefined;
      paint = true;
      mode = view?.dom.closest('[data-mode]')?.getAttribute('data-mode') ?? null;
      layout = view ? observeMinimapLayout(view, scroll) : undefined;
    };
    const draw = () => {
      if (!view || !layout) return;
      const model = latest.current.session?.analysis;
      if (!model || model.text.length !== view.state.doc.length) return;
      const height = Math.max(1, Math.min(MINIMAP_MAX_HEIGHT, Math.round(element.clientHeight)));
      const workspace = getSearchResultHighlights();
      const ranges = workspace.query ? workspaceMatchRanges(view.state.doc, workspace.matches.get(path)) : [];
      const currentQuery = getSearchQuery(view.state);
      query = currentQuery; searchOpen = searchPanelOpen(view.state);
      const searchRows = searchOpen && currentQuery.valid && currentQuery.search ? minimapSearchRows(view.state, currentQuery, height) : [];
      paintMarkdownMinimap(image, element, view, model, layout.width, ranges, searchRows);
    };
    const update = () => {
      frame = 0;
      bind();
      element.dataset.ready = String(!!view);
      if (!view) return;
      if (layout?.measure()) paint = true;
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
      const nextMode = changed.dom.closest('[data-mode]')?.getAttribute('data-mode') ?? null;
      const redraw = !query?.eq(nextQuery) || searchOpen !== nextOpen || nextMode !== mode;
      query = nextQuery; searchOpen = nextOpen; mode = nextMode;
      schedule(redraw);
    });
    const stopSearch = subscribeSearchResultHighlights(() => schedule(true));
    const resize = new ResizeObserver(() => schedule(true));
    resize.observe(element);
    const theme = new MutationObserver(() => schedule(true));
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style', 'data-theme'] });
    theme.observe(document.body, { attributes: true, attributeFilter: ['class', 'style', 'data-theme'] });
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
      stopViews(); stopSearch(); resize.disconnect(); layout?.dispose();
      theme.disconnect(); events.abort();
      cancelAnimationFrame(frame); cancelAnimationFrame(jumpFrame);
      if (drag && element.hasPointerCapture(drag.pointer)) element.releasePointerCapture(drag.pointer);
    };
  }, [path, session]);
  useEffect(() => { invalidate.current?.(); }, [snapshot.version]);

  return <section className="markdown-minimap-panel" aria-label="Markdown 缩略图" aria-busy={!session && !error}>
    <div className="nav-header"><span className="nav-title">缩略图</span></div>
    {error && <div role="alert">{error.message}</div>}
    <div ref={host} className="markdown-minimap" role="slider" tabIndex={0} aria-label="文档缩略图位置"
      aria-orientation="vertical" aria-valuemin={1} aria-valuenow={1} aria-valuemax={1}>
      <canvas ref={canvas} aria-hidden="true" />
      <div ref={viewport} className="markdown-minimap-viewport" aria-hidden="true" />
    </div>
  </section>;
}
