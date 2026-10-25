import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const state = vi.hoisted(() => ({ root: '', failRead: false }));
vi.mock('./settings.js', () => ({ getSettings: async () => ({ vault: { path: state.root }, nativeFeatures: {} }) }));
vi.mock('./vaultFile.js', async original => {
  const actual = await original<typeof import('./vaultFile.js')>();
  return { ...actual, readFileSnapshot: async (relative: string) => {
    if (state.failRead) throw new Error('fault: note read');
    return actual.readFileSnapshot(relative);
  } };
});
vi.mock('./search.js', () => ({ qmd: { upsertNote: vi.fn(), remove: vi.fn() } }));
vi.mock('./links.js', () => ({ updateLinkGraphFromNote: vi.fn() }));
vi.mock('./git.js', () => ({ scheduleAutoCommitOnSave: vi.fn() }));
vi.mock('./realtime.js', () => ({ broadcast: vi.fn(), notifyIndexChanged: vi.fn() }));
import { queueFileUpdate, enableFileUpdates, drainFileUpdates, rebuildFileIndexes } from './fileupdates.js';
import { qmd } from './search.js';
import { updateLinkGraphFromNote } from './links.js';
import { replaceCatalog, VaultCatalog } from './catalog.js';
import { broadcast } from './realtime.js';
import { NativeTagService, configureTagPreferences } from './tags/service.js';

const base = path.join(os.tmpdir(), '.agents');
beforeEach(async () => {
  await fs.mkdir(base, { recursive: true });
  state.root = await fs.mkdtemp(path.join(base, 'vault-index-outcome-')); state.failRead = false;
  await rebuildFileIndexes(async () => {});
  replaceCatalog(new VaultCatalog()); enableFileUpdates(); vi.clearAllMocks();
  configureTagPreferences(async () => ({ batchEnabled: true, wranglerEnabled: true }));
});
afterEach(async () => {
  await drainFileUpdates();
  if (path.dirname(state.root) !== base) throw new Error('Refusing fixture cleanup outside .agents');
  await fs.rm(state.root, { recursive: true, force: true });
});

it.each(['read', 'search', 'links'] as const)('reports a %s failure separately from draining and retries the unchanged revision', async stage => {
  await fs.writeFile(path.join(state.root, 'note.md'), 'saved source');
  if (stage === 'read') state.failRead = true;
  if (stage === 'search') vi.mocked(qmd.upsertNote).mockImplementationOnce(() => { throw new Error('fault: search upsert'); });
  if (stage === 'links') vi.mocked(updateLinkGraphFromNote).mockImplementationOnce(() => { throw new Error('fault: link upsert'); });
  const result = await queueFileUpdate('note.md', 'add');
  expect(result).toMatchObject({ status: 'failed', path: 'note.md', error: expect.stringContaining('fault:') });
  await expect(drainFileUpdates()).resolves.toBeUndefined();
  expect(broadcast).toHaveBeenCalledWith(expect.objectContaining({ type: 'index-error', indexed: false, path: 'note.md' }));
  state.failRead = false;
  await expect(queueFileUpdate('note.md')).resolves.toEqual({ status: 'indexed', path: 'note.md' });
  expect(vi.mocked(qmd.upsertNote).mock.calls.at(-1)?.[1].body).toBe('saved source');
  expect(vi.mocked(updateLinkGraphFromNote).mock.calls.at(-1)?.[0]).toBe('note.md');
});

it('returns a saved Tag Page plus failure, preserves exact bytes and does not duplicate creation', async () => {
  state.failRead = true;
  const service = new NativeTagService();
  const page = await service.page('science');
  const result = await service.createPage('science', 'science.md');
  expect(result).toMatchObject({ path: 'science.md', indexing: { status: 'failed', path: 'science.md', error: 'fault: note read' } });
  expect(await fs.readFile(path.join(state.root, 'science.md'), 'utf8')).toBe(page.content);
  await expect(service.createPage('science', 'science.md')).rejects.toMatchObject({ status: 409 });
  state.failRead = false;
  await expect(queueFileUpdate('science.md')).resolves.toEqual({ status: 'indexed', path: 'science.md' });
  expect(await fs.readdir(state.root)).toEqual(['science.md']);
});

it('reports ignored hidden paths as skipped without claiming indexing happened', async () => {
  expect(await queueFileUpdate('.obsidian/plugins/test/data.json')).toMatchObject({ status: 'skipped', reason: 'ignored' });
  expect(qmd.upsertNote).not.toHaveBeenCalled();
});
