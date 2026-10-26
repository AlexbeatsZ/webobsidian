import { beforeEach, expect, it, vi } from 'vitest';
import express from 'express';

vi.mock('./search.js', () => ({ qmd: {} }));

import { VaultCatalog, catalog, replaceCatalog } from './catalog.js';
import { parseNote } from './markdown.js';
import { backlinksFor, graphData, rebuildGraphFromCatalog, updateLinkGraphFromNote } from './links.js';
import { searchRouter } from '../routes/search.js';

beforeEach(() => {
  replaceCatalog(new VaultCatalog());
  rebuildGraphFromCatalog();
});

function put(path: string, text: string, searchFirst = false) {
  const note = parseNote(path, text);
  if (searchFirst) catalog.putNote(path, note);
  updateLinkGraphFromNote(path, note);
}

function linkSource(target: string) {
  const note = parseNote('source.md', '');
  note.links = [target];
  updateLinkGraphFromNote('source.md', note);
}

it('resolves typed global targets independently of source and preserves explicit local fragments', () => {
  put('folder/target.md', '# Title ^heading-title\n\ntext');
  put('source.md', 'legacy ^old\n');
  expect(catalog.resolve('^heading-title', 'source.md')).toMatchObject({ status: 'resolved', path: 'folder/target.md', fragment: '^heading-title', candidates: ['folder/target.md'], targetOccurrences: [{ path: 'folder/target.md', valid: true }] });
  expect(catalog.resolve('#^heading-title', 'source.md')).toMatchObject({ status: 'resolved', path: 'source.md', fragment: '^heading-title' });
  expect(catalog.resolve('#^old', 'source.md')).toMatchObject({ status: 'resolved', path: 'source.md', fragment: '^old' });
  expect(catalog.resolve('^heading-missing', 'folder/target.md')).toMatchObject({ status: 'missing', path: '', candidates: [], targetOccurrences: [] });
  expect(catalog.resolve('^heading-title|alias')).toMatchObject({ alias: 'alias', path: 'folder/target.md' });
});

it('never chooses a duplicate, including same-file definitions and invalid typed anchors', () => {
  put('one.md', '# One ^heading-id\n');
  put('two.md', '# Two ^heading-id\n');
  expect(catalog.resolve('^heading-id', 'one.md')).toMatchObject({ status: 'ambiguous', path: '', candidates: ['one.md', 'two.md'], targetOccurrences: [{ path: 'one.md', valid: true }, { path: 'two.md', valid: true }] });
  expect(catalog.suggestContentTargets('heading-id')).toEqual([]);
  put('two.md', '# Two ^heading-other\n');
  put('one.md', '# One ^heading-id\n\n# Again ^heading-id\n');
  expect(catalog.resolve('^heading-id')).toMatchObject({ status: 'ambiguous', path: '', candidates: ['one.md'], targetOccurrences: expect.arrayContaining([{ path: 'one.md', valid: false }]) });
  put('one.md', 'plain ^heading-id\n');
  expect(catalog.resolve('^heading-id')).toMatchObject({ status: 'ambiguous', path: '', targetOccurrences: [{ path: 'one.md', valid: false }] });
});

it('refreshes backlinks after target moves, duplicate introduction, recovery and removal even after catalog changes first', () => {
  linkSource('^heading-id');
  put('old.md', '# Old ^heading-id\n', true);
  expect(backlinksFor('old.md')).toEqual(['source.md']);
  put('old.md', '# Old\n', true);
  expect(backlinksFor('old.md')).toEqual([]);
  put('new.md', '# New ^heading-id\n', true);
  expect(backlinksFor('new.md')).toEqual(['source.md']);
  put('duplicate.md', '# Duplicate ^heading-id\n', true);
  expect(backlinksFor('new.md')).toEqual([]);
  catalog.remove('duplicate.md');
  updateLinkGraphFromNote('duplicate.md', undefined, true);
  expect(backlinksFor('new.md')).toEqual(['source.md']);
  catalog.remove('new.md');
  updateLinkGraphFromNote('new.md', undefined, true);
  expect(backlinksFor('new.md')).toEqual([]);
  expect(catalog.resolve('^heading-id')).toMatchObject({ status: 'missing' });
});

it('restores cached metadata and dependencies and bounds unique suggestions', () => {
  for (let index = 0; index < 105; index++) put(`${index}.md`, `# Title ${index} ^heading-${index}\n`);
  const restored = VaultCatalog.restore(JSON.parse(JSON.stringify(catalog.serialize())));
  replaceCatalog(restored);
  rebuildGraphFromCatalog();
  expect(catalog.resolve('^heading-10')).toMatchObject({ status: 'resolved', path: '10.md' });
  expect(catalog.suggestContentTargets('', 1000)).toHaveLength(100);
  expect(catalog.suggestContentTargets('Title 10', 2)).toHaveLength(2);
  expect(catalog.suggestContentTargets('^heading-10', 1)).toEqual([{ id: 'heading-10', kind: 'heading', label: 'Title 10', path: '10.md' }]);
  linkSource('^heading-10');
  expect(backlinksFor('10.md')).toEqual(['source.md']);
  put('10.md', '# Removed\n', true);
  expect(backlinksFor('10.md')).toEqual([]);
});

it('preserves bare global destinations when parsing real wikilinks and explicit local links', () => {
  expect(parseNote('source.md', '[[^heading-id]] [[#^heading-id]]').links).toEqual(['^heading-id', '#^heading-id']);
});

it('keeps unresolved global graph identities separate without filename fallback', () => {
  const note = parseNote('source.md', '');
  note.links = ['^heading-first', '^heading-second'];
  updateLinkGraphFromNote('source.md', note);
  catalog.putPath('^heading-first.md');
  expect(catalog.resolve('^heading-first')).toMatchObject({ status: 'missing', path: '' });
  expect(graphData().nodes.filter(node => node.kind === 'unresolved').map(node => node.id)).toEqual(['unresolved:^heading-first', 'unresolved:^heading-second']);
});

it.each(['heading', 'eq', 'code', 'callout', 'range'] as const)('indexes the %s namespace through the core metadata contract', namespace => {
  const id = `${namespace}-stable`;
  const note = parseNote('target.md', '');
  const kind = namespace === 'eq' ? 'equation' : namespace;
  note.contentTargets = { targets: [{ id, kind, from: 0, to: 0, focus: { from: 0, to: 0 }, label: namespace, protectedSpans: [] }], issues: [] };
  catalog.putNote('target.md', note);
  expect(catalog.resolve(`^${id}`)).toMatchObject({ status: 'resolved', path: 'target.md', fragment: `^${id}` });
  expect(catalog.suggestContentTargets(id)).toEqual([{ id, kind, label: namespace, path: 'target.md' }]);
  note.contentTargets.targets.push({ ...note.contentTargets.targets[0] });
  catalog.putNote('target.md', note);
  expect(catalog.resolve(`^${id}`)).toMatchObject({ status: 'ambiguous', path: '', targetOccurrences: [{ path: 'target.md', valid: true }, { path: 'target.md', valid: true }] });
  expect(catalog.suggestContentTargets(id)).toEqual([]);
});

it('serves global occurrences and bounded unique suggestions using existing resolve and search routes', async () => {
  put('one.md', '# One ^heading-id\n\n# Unique ^heading-unique\n');
  put('two.md', '# Two ^heading-id\n');
  const app = express();
  app.use('/api', searchRouter);
  const server = app.listen(0, '127.0.0.1');
  try {
    await new Promise<void>(resolve => server.once('listening', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing test address');
    const base = `http://127.0.0.1:${address.port}/api`;
    const resolved = await fetch(`${base}/resolve?target=%5Eheading-id&sourcePath=one.md`).then(response => response.json());
    expect(resolved).toMatchObject({ path: null, fragment: '^heading-id', status: 'ambiguous', candidates: ['one.md', 'two.md'], targetOccurrences: [{ path: 'one.md', valid: true }, { path: 'two.md', valid: true }] });
    const suggested = await fetch(`${base}/content-targets?query=heading&limit=1000`).then(response => response.json());
    expect(suggested).toEqual({ targets: [{ id: 'heading-unique', kind: 'heading', label: 'Unique', path: 'one.md' }] });
    const local = await fetch(`${base}/resolve?target=%23%5Eheading-id&sourcePath=one.md`).then(response => response.json()) as { path: string };
    expect(local.path).toBe('one.md');
    expect(local).not.toHaveProperty('targetOccurrences');
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
