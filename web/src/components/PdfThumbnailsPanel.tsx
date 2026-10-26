import { useEffect, useRef, useState } from 'react';
import type { PdfSession } from '../lib/pdf/session';
import { usePdfSnapshot } from '../lib/pdf/react';
import PdfPage, { usePdfVisible } from './PdfPage';
import '../styles/pdf.css';

function Thumbnail({ session, page, root }: { session: PdfSession; page: number; root: React.RefObject<HTMLDivElement> }) {
  const state = usePdfSnapshot(session);
  const host = useRef<HTMLButtonElement>(null);
  const [ratio, setRatio] = useState(792 / 612);
  const visible = usePdfVisible(root, host, 160);
  const count = state.matchesByPage[page]?.length ?? 0;
  return <button ref={host} className={`pdf-thumbnail${state.currentPage === page ? ' is-current' : ''}${count ? ' has-matches' : ''}`}
    data-thumbnail-page={page} aria-label={`第 ${page} 页${count ? `，${count} 个匹配` : ''}`}
    aria-current={state.currentPage === page ? 'page' : undefined} onClick={() => session.goToPage(page)}>
    <div className="pdf-thumbnail-image">{visible && <PdfPage session={session} page={page} width={Math.min(132, 171 / ratio)} onSize={setRatio} thumbnail />}</div>
    <span className="pdf-thumbnail-label"><span>{page}</span>{count > 0 && <span className="pdf-match-count">{count} 个匹配</span>}</span>
  </button>;
}

export default function PdfThumbnailsPanel({ session }: { session: PdfSession }) {
  const state = usePdfSnapshot(session);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const current = root.current?.querySelector<HTMLElement>(`[data-thumbnail-page="${state.currentPage}"]`);
    if (!current || !root.current) return;
    const parent = root.current.getBoundingClientRect(), box = current.getBoundingClientRect();
    if (box.top < parent.top || box.bottom > parent.bottom) root.current.scrollTop = current.offsetTop - 12;
  }, [state.currentPage]);
  if (state.status === 'loading') return <p className="pdf-panel-message">正在加载缩略图…</p>;
  if (state.status !== 'ready') return <p className="pdf-panel-message" role="alert">{state.error || 'PDF 已关闭'}</p>;
  return <div className="pdf-thumbnails" ref={root} aria-label="PDF 页面缩略图">
    {Array.from({ length: state.pageCount }, (_, index) => <Thumbnail key={index} session={session} page={index + 1} root={root} />)}
  </div>;
}
