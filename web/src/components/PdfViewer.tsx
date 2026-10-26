import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { PdfSession } from '../lib/pdf/session';
import { activatePdfSession, registerPdfSession, usePdfSnapshot } from '../lib/pdf/react';
import PdfPage, { usePdfVisible } from './PdfPage';
import Icon from './Icon';
import { useStore } from '../lib/store';
import '../styles/pdf.css';

function PageSlot({ session, page, width, root }: {
  session: PdfSession; page: number; width: number; root: React.RefObject<HTMLDivElement>;
}) {
  const host = useRef<HTMLDivElement>(null);
  const visible = usePdfVisible(root, host);
  const [ratio, setRatio] = useState(792 / 612);
  const previousHeight = useRef(width * ratio);
  useLayoutEffect(() => {
    const height = width * ratio, delta = height - previousHeight.current;
    previousHeight.current = height;
    if (delta && page < session.getSnapshot().currentPage && root.current) root.current.scrollTop += delta;
  }, [width, ratio, page, root, session]);
  return <div ref={host} className="pdf-page-slot" data-page-number={page} style={{ width, height: width * ratio }}>
    {visible && <PdfPage session={session} page={page} width={width} onSize={setRatio} />}
  </div>;
}

function Reader({ session, main }: { session: PdfSession; main: boolean }) {
  const state = usePdfSnapshot(session);
  const viewport = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const focusSearch = useRef(false);
  const navigationTop = useRef<number>();
  const toolbarOpen = useStore(s => s.pdfToolbarOpen);
  const setToolbarOpen = useStore(s => s.setPdfToolbarOpen);
  const toolbarVisible = !main || toolbarOpen;
  const [available, setAvailable] = useState(780);
  const [zoom, setZoom] = useState(1);
  const [pageInput, setPageInput] = useState('1');
  const width = Math.max(180, Math.min(available - 40, 900) * zoom);
  useEffect(() => {
    if (!toolbarVisible || !focusSearch.current) return;
    focusSearch.current = false;
    search.current?.focus();
    search.current?.select();
  }, [toolbarVisible]);
  useEffect(() => {
    if (!viewport.current) return;
    const observer = new ResizeObserver(entries => setAvailable(entries[0].contentRect.width));
    observer.observe(viewport.current); return () => observer.disconnect();
  }, []);
  useEffect(() => { setPageInput(String(state.currentPage)); }, [state.currentPage]);
  useEffect(() => {
    if (!state.navigation || !viewport.current) return;
    const target = viewport.current.querySelector<HTMLElement>(`[data-page-number="${state.currentPage}"]`);
    if (!target) { navigationTop.current = undefined; return; }
    viewport.current.scrollTop = target.offsetTop - 16;
    navigationTop.current = viewport.current.scrollTop;
    session.observePage(state.currentPage);
  }, [state.navigation]);
  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    let frame = 0;
    const scroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (navigationTop.current !== undefined) {
          if (Math.abs(element.scrollTop - navigationTop.current) < 1) return;
          navigationTop.current = undefined;
        }
        const top = element.scrollTop + 32;
        const slots = element.querySelectorAll<HTMLElement>('[data-page-number]');
        let low = 0, high = slots.length - 1;
        while (low < high) {
          const middle = Math.ceil((low + high) / 2);
          if (slots[middle].offsetTop <= top) low = middle; else high = middle - 1;
        }
        if (slots[low]) session.observePage(Number(slots[low].dataset.pageNumber));
      });
    };
    element.addEventListener('scroll', scroll, { passive: true });
    return () => { cancelAnimationFrame(frame); element.removeEventListener('scroll', scroll); };
  }, [session, state.pageCount]);
  const selected = state.activeMatch >= 0 ? state.activeMatch + 1 : 0;
  return <section className="pdf-viewer" data-pdf-path={session.path} onPointerDown={() => activatePdfSession(session)}
    onFocusCapture={() => activatePdfSession(session)} onKeyDown={event => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
        event.preventDefault(); event.stopPropagation();
        if (main && !toolbarOpen) { focusSearch.current = true; setToolbarOpen(true); }
        else { search.current?.focus(); search.current?.select(); }
      }
    }}>
    {toolbarVisible && <div id={main ? 'pdf-toolbar' : undefined} className={`pdf-toolbar${main ? ' is-overlay' : ''}`} role="toolbar" aria-label="PDF 阅读工具">
      <span className="pdf-filename" title={session.path}>{session.path.split('/').pop()}</span>
      <button className="tool-btn" aria-label="上一页" disabled={state.currentPage <= 1} onClick={() => session.goToPage(state.currentPage - 1)}><Icon name="chevron-up" /></button>
      <label className="pdf-page-control"><input aria-label="PDF 页码" inputMode="numeric" value={pageInput} onChange={event => setPageInput(event.target.value)}
        onBlur={() => session.goToPage(Number(pageInput))} onKeyDown={event => { if (event.key === 'Enter') session.goToPage(Number(pageInput)); }} /><span>/ {state.pageCount}</span></label>
      <button className="tool-btn" aria-label="下一页" disabled={state.currentPage >= state.pageCount} onClick={() => session.goToPage(state.currentPage + 1)}><Icon name="chevron-down" /></button>
      <button className="tool-btn" aria-label="缩小 PDF" disabled={zoom <= 0.5} onClick={() => setZoom(value => Math.max(0.5, value - 0.25))}><Icon name="minus" /></button>
      <button className="pdf-zoom" onClick={() => setZoom(1)} title="适合宽度">{Math.round(zoom * 100)}%</button>
      <button className="tool-btn" aria-label="放大 PDF" disabled={zoom >= 3} onClick={() => setZoom(value => Math.min(3, value + 0.25))}><Icon name="plus" /></button>
      <div className="pdf-search">
        <Icon name="search" /><input ref={search} type="search" aria-label="搜索 PDF" placeholder="搜索 PDF" value={state.query} onChange={event => session.setQuery(event.target.value)}
          onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); session.nextMatch(event.shiftKey ? -1 : 1); } }} />
        <span role="status">{state.query ? `${selected}/${state.matches.length}${state.truncated ? '+' : ''}` : ''}</span>
        <button className="tool-btn" aria-label="上一个 PDF 匹配" disabled={!state.matches.length} onClick={() => session.nextMatch(-1)}><Icon name="chevron-up" /></button>
        <button className="tool-btn" aria-label="下一个 PDF 匹配" disabled={!state.matches.length} onClick={() => session.nextMatch(1)}><Icon name="chevron-down" /></button>
      </div>
    </div>}
    {state.searchPending && <div className="pdf-message" role="status">正在搜索 {state.searchedPages}/{state.pageCount} 页…</div>}
    {!state.searchPending && state.query && !state.matches.length && <div className="pdf-message" role="status">未找到匹配文字。扫描图像 PDF 需要先有文字层。</div>}
    {state.error && <div className="pdf-message" role="alert">{state.error}</div>}
    <div className="pdf-pages" ref={viewport} role="region" tabIndex={0} aria-label="PDF 页面">
      {state.status === 'loading' && <p className="pdf-message" role="status">正在打开 PDF…</p>}
      {state.status === 'ready' && Array.from({ length: state.pageCount }, (_, index) =>
        <PageSlot key={index} session={session} page={index + 1} width={width} root={viewport} />)}
    </div>
  </section>;
}

export default function PdfViewer({ path, viewId = 'main' }: { path: string; viewId?: string }) {
  const stale = useStore(state => state.vaultSessionStale);
  const [session, setSession] = useState<PdfSession>();
  useEffect(() => {
    if (stale) return;
    const current = new PdfSession(path, viewId);
    setSession(current);
    const unregister = registerPdfSession(current);
    const invalidate = () => { unregister(); current.destroy(); };
    window.addEventListener('vault-identity-invalidated', invalidate);
    return () => { window.removeEventListener('vault-identity-invalidated', invalidate); unregister(); current.destroy(); };
  }, [path, viewId, stale]);
  if (stale) return <div className="pdf-message" role="alert">Vault 已切换，请重新加载应用；旧文档会话保留</div>;
  if (!session || session.path !== path) return <p className="pdf-message">正在打开 PDF…</p>;
  return <Reader key={path + viewId} session={session} main={viewId === 'main'} />;
}
