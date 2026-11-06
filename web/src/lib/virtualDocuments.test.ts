import { expect, it } from 'vitest';
import { projectVirtualCatalog, readingWindow, virtualDocumentsIn } from './virtualDocuments';
import { VirtualReadingSession } from './virtualReading';
import type { VirtualDocument } from './virtualDocuments';
import type { CatalogEntry } from '@webobsidian/search-core';

const document: VirtualDocument = { path: 'Book', title: '物理化学 第三版', revision: 'v1', streams: [
  { id: 'text', title: '正文', files: [{ path: 'Book/ch01.md', title: '量子', kind: 'markdown', size: 300, headings: [] }] },
  { id: 'pdf', title: '原版', files: [{ path: 'Book/original.pdf', title: '原版', kind: 'pdf', size: 200, headings: [] }] },
] };
it('projects one picker entry, keeping member names searchable without changing the physical catalog', () => {
  const original: CatalogEntry[] = ['Book/ch01.md','Book/old 索引.md','outside.md'].map(path => ({ path, kind: 'file', title: path, aliases: ['alias'], tags: ['chemistry'], headings: ['H'] }));
  const result = projectVirtualCatalog(original, [document]);
  expect(result.map(entry => entry.path)).toEqual(['outside.md','Book']);
  expect(result[1].aliases).toContain('Book/ch01.md');
  expect(original).toHaveLength(3);
});
it('keeps nested virtual folders behind their outer document presentation', () => {
  expect(virtualDocumentsIn({ name: 'root', path: '', type: 'folder', children: [{ name:'Book',path:'Book',type:'folder',virtualDocument:document,
    children:[{ name:'child',path:'Book/child',type:'folder',virtualDocument:{...document,path:'Book/child'} }] }] })).toEqual([document]);
});
it('bounds the loading window even when a document has thousands of tiny chapters', () => {
  const heights = Array(10000).fill(1);
  for (const top of [0, 100, 5000, 9999]) {
    const range = readingWindow(heights, top, 800);
    expect(range.last - range.first + 1).toBeLessThanOrEqual(6);
    expect(range.first).toBeGreaterThanOrEqual(0);
    expect(range.last).toBeLessThan(heights.length);
  }
});
it('prefetches neighbours and retains independent progress for each stream', () => {
  expect(readingWindow([1000,1000,1000,1000],1200,700)).toEqual({first:0,last:2});
  const session = new VirtualReadingSession(document, 'test');
  session.remember('text', 500, [1000]); session.selectStream('pdf'); session.remember('pdf', 300, [2000]);
  session.selectStream('text'); expect(session.progress()?.top).toBe(500);
  session.go({ path:'Book/original.pdf',page:4 });
  expect(session.getSnapshot()).toMatchObject({stream:'pdf',target:{path:'Book/original.pdf',page:4}});
  session.releaseTarget(); expect(session.getSnapshot().target).toBeUndefined();
});
it('keeps configuration editing and mode through a saved manifest refresh', () => {
  const session=new VirtualReadingSession(document,'configuration-test');session.selectConfiguration();session.setMode('source');
  session.replaceDocument({...document,revision:'v2',streams:document.streams.map(stream=>({...stream,title:stream.id==='text'?'MD':stream.title}))});
  expect(session.getSnapshot()).toMatchObject({configuration:true,mode:'source'});
  session.selectStream('text');expect(session.getSnapshot().configuration).toBe(false);
});
