import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const state = vi.hoisted(() => ({ root: '', parsed: [] as string[] }));
vi.mock('./settings.js', () => ({ getSettings: async () => ({ vault: { path: state.root }, nativeFeatures: {} }) }));
vi.mock('../config.js', async original => ({
  ...(await original<typeof import('../config.js')>()),
  get INDEX_FILE() { return path.join(state.root, '.cache', 'qmd-index.json'); },
}));
vi.mock('./markdown.js', async original => {
  const actual = await original<typeof import('./markdown.js')>();
  return { ...actual, parseNote: (rel: string, content: string) => { state.parsed.push(rel); return actual.parseNote(rel, content); } };
});
import { rebuildVaultIndex, loadSearchCache } from './vaultindex.js';
import { QmdEngine, qmd } from './search.js';
import { VaultCatalog, catalog } from './catalog.js';
import { parseNote } from './markdown.js';

const base = path.join(os.tmpdir(), '.agents');
const write = (rel: string, text: string) => fs.writeFile(path.join(state.root, rel), text);
const hits = (term: string) => qmd['mini'].search(term, { prefix: false, fuzzy: false }).map(hit => hit.id).sort();
const snapshot = () => ({
  entries: [...catalog.entries.keys()].sort(),
  notes: [...catalog.notes.keys()].sort(),
  stamps: [...catalog.stamps].sort(),
});

beforeEach(async () => {
  await fs.mkdir(base, { recursive: true });
  state.root = await fs.mkdtemp(path.join(base, 'vault-index-cache-'));
  await fs.mkdir(path.join(state.root, '.cache'));
  state.parsed = [];
});
afterEach(async () => {
  vi.unstubAllEnvs();
  if (path.dirname(state.root) !== base) throw new Error('Refusing fixture cleanup outside .agents');
  await fs.rm(state.root, { recursive: true, force: true });
});

it('rebuilds searchable Android notes without loading or overwriting the desktop index cache', async () => {
  await write('a.md', 'alpha body');
  await rebuildVaultIndex(false);
  await qmd.save(state.root);
  const cacheFile = path.join(state.root, '.cache', 'qmd-index.json');
  const previous = await fs.readFile(cacheFile, 'utf8');

  vi.stubEnv('WEBOBSIDIAN_PLATFORM', 'android');
  await write('a.md', 'delta body');
  state.parsed = [];
  expect(await loadSearchCache()).toBeUndefined();
  await rebuildVaultIndex(true);
  const serialize = vi.spyOn(qmd['mini'], 'toJSON');
  await qmd.save(state.root);
  expect(serialize).not.toHaveBeenCalled();
  expect(await fs.readFile(cacheFile, 'utf8')).toBe(previous);
  expect(state.parsed).toEqual(['a.md']);
  expect(hits('delta')).toEqual(['a.md']);
  expect(hits('alpha')).toEqual([]);
});

it('restores a stale cache by re-reading only changed notes', async () => {
  await fs.mkdir(path.join(state.root, 'sub'));
  await write('a.md', 'alpha body [[b]]');
  await write('b.md', 'beta body');
  await write('sub/c.md', 'gamma body');
  await write('keep.md', 'stable body');
  await rebuildVaultIndex(false);
  await qmd.save(state.root);

  await write('a.md', 'delta body changed');
  await fs.rm(path.join(state.root, 'b.md'));
  await fs.rm(path.join(state.root, 'sub'), { recursive: true });
  await write('d.md', 'epsilon body');
  state.parsed = [];
  await rebuildVaultIndex(true);
  await qmd.loaded();

  expect(state.parsed.sort()).toEqual(['a.md', 'd.md']);
  expect(hits('delta')).toEqual(['a.md']);
  expect(hits('epsilon')).toEqual(['d.md']);
  expect(hits('stable')).toEqual(['keep.md']);
  for (const gone of ['alpha', 'beta', 'gamma']) expect(hits(gone)).toEqual([]);
  const restored = snapshot();
  await rebuildVaultIndex(false);
  expect(restored).toEqual(snapshot());
});

it('keeps the catalog current while the saved index loads and replays edits made meanwhile', async () => {
  const source = new QmdEngine(new VaultCatalog());
  source.upsertNote('a.md', parseNote('a.md', 'alpha body'));
  source.upsertNote('b.md', parseNote('b.md', 'beta body'));
  const engine = new QmdEngine(new VaultCatalog());
  engine.loadMini(source['mini'].toJSON());
  engine.upsertNote('a.md', parseNote('a.md', 'first body'));
  engine.upsertNote('a.md', parseNote('a.md', 'delta body'));
  engine.remove('b.md');
  engine.upsertNote('c.md', parseNote('c.md', 'gamma body'));
  expect([...engine.catalog.notes.keys()].sort()).toEqual(['a.md', 'c.md']);
  await engine.loaded();
  const found = (term: string) => engine['mini'].search(term, { prefix: false, fuzzy: false }).map(hit => hit.id).sort();
  expect(found('delta')).toEqual(['a.md']);
  expect(found('gamma')).toEqual(['c.md']);
  for (const gone of ['alpha', 'first', 'beta']) expect(found(gone)).toEqual([]);
});

it('leaves a failed index load unready so search takes the rebuild path', async () => {
  const engine = new QmdEngine(new VaultCatalog());
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  engine.loadMini({} as never);
  engine.finish();
  await engine.loaded();
  engine.finish();
  expect(engine['ready']).toBe(false);
});

it('ignores a cache built for another Vault', async () => {
  await write('a.md', 'alpha body');
  await rebuildVaultIndex(false);
  await qmd.save(path.join(state.root, 'elsewhere'));
  expect(await loadSearchCache()).toBeUndefined();
  state.parsed = [];
  await rebuildVaultIndex(true);
  expect(state.parsed).toEqual(['a.md']);
  expect(hits('alpha')).toEqual(['a.md']);
});
