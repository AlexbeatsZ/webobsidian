import { useEffect, useState, useSyncExternalStore } from 'react';
import { extractMetadata } from '@webobsidian/markdown-core';
import { documents } from '../lib/documents';
import type { VirtualReadingSession } from '../lib/virtualReading';
import type { PdfOutlineEntry } from '../lib/pdf/types';

function PdfEntries({ entries, path, reader }: { entries: readonly PdfOutlineEntry[]; path: string; reader: VirtualReadingSession }) {
  return <ul>{entries.map((entry, index) => <li key={index}><button disabled={entry.page === null}
    onClick={() => { if (entry.page !== null) reader.go({ path, page: entry.page }); }}>{entry.title || '无标题'}</button>
    {!!entry.children.length && <PdfEntries entries={entry.children} path={path} reader={reader} />}</li>)}</ul>;
}
export default function VirtualOutlinePanel({ reader }: { reader: VirtualReadingSession }) {
  const state = useSyncExternalStore(reader.subscribe, reader.getSnapshot);
  const stream = reader.document.streams.find(stream => stream.id === state.stream)!;
  const [, refresh] = useState(0);
  useEffect(() => documents.subscribe(snapshot => {
    if (stream.files.some(file => file.path === snapshot.id)) refresh(value => value + 1);
  }), [stream]);
  if (state.configuration) return null;
  return <nav className="virtual-outline sidebar-body" aria-label="连续文档大纲">
    {stream.files.map(source => <section key={source.path}>
      <button className="virtual-outline-file" onClick={() => reader.go({ path: source.path })}>{source.title}</button>
      {(documents.get(source.path) ? extractMetadata(documents.get(source.path)!.analysis).headings : source.headings).map((heading, index) => <button key={index} className="outline-item" style={{ paddingLeft: 16 + (heading.level - 1) * 12 }}
        onClick={() => reader.go({ path: source.path, fragment: heading.text })}>{heading.text}</button>)}
      {state.pdfOutlines[source.path] && <PdfEntries entries={state.pdfOutlines[source.path]} path={source.path} reader={reader} />}
    </section>)}
  </nav>;
}
