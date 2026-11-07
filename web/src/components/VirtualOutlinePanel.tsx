import { useEffect, useState, useSyncExternalStore } from 'react';
import { extractMetadata } from '@webobsidian/markdown-core';
import { documents } from '../lib/documents';
import type { VirtualReadingSession } from '../lib/virtualReading';
import type { PdfOutlineEntry } from '../lib/pdf/types';
import Icon from './Icon';
import '../styles/virtual-navigation.css';

interface Heading { text: string; level: number }
interface HeadingBranch { heading: Heading; index: number; children: HeadingBranch[] }
function headingTree(headings: readonly Heading[]) {
  const roots: HeadingBranch[] = [], stack: HeadingBranch[] = [];
  headings.forEach((heading, index) => {
    const branch = { heading, index, children: [] };
    while (stack.length && stack.at(-1)!.heading.level >= heading.level) stack.pop();
    (stack.at(-1)?.children ?? roots).push(branch);
    stack.push(branch);
  });
  return roots;
}
type Folding = { collapsed: ReadonlySet<string>; toggle: (key: string) => void };
const folds = new WeakMap<VirtualReadingSession, ReadonlySet<string>>();
function Toggle({ id, title, folding }: { id: string; title: string; folding: Folding }) {
  const open = !folding.collapsed.has(id);
  return <button type="button" className="virtual-outline-toggle" aria-label={`${open ? '收起' : '展开'} ${title}`}
    aria-expanded={open} onClick={() => folding.toggle(id)}><Icon name={open ? 'chevron-down' : 'chevron-right'} size={14} /></button>;
}
function HeadingEntries({ branches, path, reader, folding }: { branches: HeadingBranch[]; path: string; reader: VirtualReadingSession; folding: Folding }) {
  return <ul>{branches.map(({ heading, index, children }) => {
    const id = `heading:${path}:${index}:${heading.text}`;
    return <li key={id}><div className="virtual-outline-row">
      {children.length ? <Toggle id={id} title={heading.text} folding={folding} /> : <span className="virtual-outline-spacer" />}
      <button className="outline-item" onClick={() => reader.go({ path, fragment: heading.text })}>{heading.text}</button>
    </div>{children.length > 0 && !folding.collapsed.has(id) && <HeadingEntries branches={children} path={path} reader={reader} folding={folding} />}</li>;
  })}</ul>;
}
function PdfEntries({ entries, path, reader, folding, parent = 'pdf:' + path }: { entries: readonly PdfOutlineEntry[]; path: string; reader: VirtualReadingSession; folding: Folding; parent?: string }) {
  return <ul>{entries.map((entry, index) => {
    const id = parent + ':' + index, title = entry.title || '无标题';
    return <li key={id}><div className="virtual-outline-row">
      {entry.children.length ? <Toggle id={id} title={title} folding={folding} /> : <span className="virtual-outline-spacer" />}
      <button className="outline-item" disabled={entry.page === null}
        onClick={() => { if (entry.page !== null) reader.go({ path, page: entry.page }); }}>{title}</button>
    </div>{entry.children.length > 0 && !folding.collapsed.has(id) && <PdfEntries entries={entry.children} path={path} reader={reader} folding={folding} parent={id} />}</li>;
  })}</ul>;
}
export default function VirtualOutlinePanel({ reader }: { reader: VirtualReadingSession }) {
  const state = useSyncExternalStore(reader.subscribe, reader.getSnapshot);
  const stream = reader.document.streams.find(stream => stream.id === state.stream)!;
  const [, refresh] = useState(0);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => folds.get(reader) ?? new Set());
  const folding: Folding = { collapsed, toggle: key => setCollapsed(previous => {
    const next = new Set(previous);
    if (next.has(key)) next.delete(key); else next.add(key);
    folds.set(reader, next); return next;
  }) };
  useEffect(() => documents.subscribe(snapshot => {
    if (stream.files.some(file => file.path === snapshot.id)) refresh(value => value + 1);
  }), [stream]);
  if (state.configuration) return null;
  return <nav className="virtual-outline sidebar-body" aria-label="连续文档大纲">
    <button className="virtual-outline-cover virtual-outline-file" aria-current={!state.activeSource || state.activeSource === reader.document.path ? 'location' : undefined}
      onClick={() => reader.go({ path: reader.document.path })}><Icon name="list" size={14} /><span>目录</span></button>
    {stream.files.map(source => {
      const id = 'file:' + source.path;
      const headings = documents.get(source.path) ? extractMetadata(documents.get(source.path)!.analysis).headings : source.headings;
      const pdf = state.pdfOutlines[source.path];
      const children = headings.length > 0 || !!pdf?.length;
      return <section key={source.path} data-outline-source={source.path}><div className="virtual-outline-row">
        {children ? <Toggle id={id} title={source.title} folding={folding} /> : <span className="virtual-outline-spacer" />}
        <button className="virtual-outline-file" aria-current={state.activeSource === source.path ? 'location' : undefined}
          onClick={() => reader.go({ path: source.path })}>{source.title}</button>
      </div>{!collapsed.has(id) && <>
        {headings.length > 0 && <HeadingEntries branches={headingTree(headings)} path={source.path} reader={reader} folding={folding} />}
        {pdf && <PdfEntries entries={pdf} path={source.path} reader={reader} folding={folding} />}
      </>}</section>;
    })}
  </nav>;
}
