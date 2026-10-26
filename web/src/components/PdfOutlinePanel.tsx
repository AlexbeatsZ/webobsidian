import type { PdfSession } from '../lib/pdf/session';
import type { PdfOutlineEntry } from '../lib/pdf/types';
import { usePdfSnapshot } from '../lib/pdf/react';
import '../styles/pdf.css';

function Entries({ entries, session, current }: { entries: readonly PdfOutlineEntry[]; session: PdfSession; current: number }) {
  return <ul className="pdf-outline-list">{entries.map((entry, index) => <li key={index}>
    <button className="pdf-outline-item" disabled={entry.page === null} aria-current={entry.page === current ? 'location' : undefined}
      onClick={() => { if (entry.page !== null) session.goToPage(entry.page); }} title={entry.page === null ? '此目录项没有可用的本地页面目标' : `第 ${entry.page} 页`}>
      <span>{entry.title || '无标题'}</span>{entry.page !== null && <small>{entry.page}</small>}
    </button>
    {!!entry.children.length && <Entries entries={entry.children} session={session} current={current} />}
  </li>)}</ul>;
}

export default function PdfOutlinePanel({ session }: { session: PdfSession }) {
  const state = usePdfSnapshot(session);
  if (state.status === 'loading') return <p className="pdf-panel-message" role="status">正在读取 PDF 目录…</p>;
  if (state.status !== 'ready') return <p className="pdf-panel-message" role="alert">{state.error || 'PDF 已关闭'}</p>;
  if (state.outlineError) return <p className="pdf-panel-message" role="alert">PDF 目录读取失败：{state.outlineError}</p>;
  if (!state.outline.length) return <p className="pdf-panel-message">此 PDF 没有内置目录。</p>;
  return <nav className="pdf-outline" aria-label="PDF 内置目录"><Entries entries={state.outline} session={session} current={state.currentPage} /></nav>;
}
