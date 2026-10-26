import { useEffect, useRef, useState, type RefObject, type CSSProperties } from 'react';
import type { PdfSession } from '../lib/pdf/session';
import { usePdfSnapshot } from '../lib/pdf/react';
import '../styles/pdf.css';

export function usePdfVisible(root: RefObject<HTMLElement>, element: RefObject<HTMLElement>, margin = 300) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!root.current || !element.current) return;
    const observer = new IntersectionObserver(entries => setVisible(entries.some(entry => entry.isIntersecting)), {
      root: root.current, rootMargin: `${margin}px 0px`,
    });
    observer.observe(element.current);
    return () => observer.disconnect();
  }, [root, element, margin]);
  return visible;
}

export default function PdfPage({ session, page, width, thumbnail = false, onSize }: {
  session: PdfSession; page: number; width: number; thumbnail?: boolean; onSize?: (ratio: number) => void;
}) {
  const snapshot = usePdfSnapshot(session);
  const host = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width, height: width * 792 / 612 });
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);
  const size = useRef(onSize); size.current = onSize;
  useEffect(() => {
    const resource = session.resource;
    if (!resource || !host.current || snapshot.status !== 'ready') return;
    const signal = new AbortController();
    const root = host.current;
    const canvas = document.createElement('canvas');
    canvas.setAttribute('aria-label', `第 ${page} 页${thumbnail ? '缩略图' : ''}`);
    const text = document.createElement('div'); text.className = 'pdf-text-layer textLayer';
    let layer: import('pdfjs-dist').TextLayer | undefined;
    root.replaceChildren(canvas);
    setReady(false); setError('');
    const rendering = resource.render(page, canvas, width, signal.signal).then(async viewport => {
      if (signal.signal.aborted) return;
      setDimensions({ width: viewport.width, height: viewport.height });
      size.current?.(viewport.height / viewport.width);
      if (!thumbnail) {
        const [{ TextLayer }, model] = await Promise.all([import('../lib/pdf/runtime'), resource.text(page)]);
        if (signal.signal.aborted) return;
        text.style.setProperty('--total-scale-factor', String(viewport.scale));
        layer = new TextLayer({ textContentSource: model.content, container: text, viewport });
        root.append(text);
        await layer.render();
      }
      if (!signal.signal.aborted) setReady(true);
    }).catch(cause => {
      if (!signal.signal.aborted) setError(String(cause));
    });
    return () => {
      signal.abort(); layer?.cancel();
      root.replaceChildren();
      void rendering.finally(() => { canvas.width = 0; canvas.height = 0; });
    };
  }, [session, page, width, thumbnail, snapshot.status]);
  const matches = snapshot.matchesByPage[page] ?? [];
  const selected = snapshot.matches[snapshot.activeMatch]?.id;
  return <div className={`pdf-page-surface${ready ? ' is-ready' : ''}`} data-pdf-page={page}
    style={{ width: dimensions.width, height: dimensions.height }}>
    <div className="pdf-page-paint" ref={host} />
    <div className="pdf-match-layer" aria-hidden="true">
      {matches.flatMap(match => match.boxes.map((box, index) => <span key={`${match.id}:${index}`}
        className={`pdf-match${match.id === selected ? ' is-selected' : ''}`} data-match-id={match.id}
        data-match-box={`${box.x},${box.y},${box.width},${box.height}`}
        style={{ left: `${box.x * 100}%`, top: `${box.y * 100}%`, width: `${box.width * 100}%`, height: `${box.height * 100}%` } as CSSProperties} />))}
    </div>
    {error && <div className="pdf-page-error" role="alert">第 {page} 页加载失败：{error}</div>}
  </div>;
}
