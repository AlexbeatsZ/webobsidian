import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const state = vi.hoisted(() => ({ root: '', afterRead: undefined as undefined | (() => Promise<void>) }));
vi.mock('./settings.js', () => ({ getSettings: async () => ({ vault: { path: state.root } }) }));
vi.mock('./vaultFile.js', async original => {
  const actual = await original<typeof import('./vaultFile.js')>();
  return { ...actual, readFileSnapshot: vi.fn(async (relative: string) => {
    const result = await actual.readFileSnapshot(relative);
    await state.afterRead?.();
    return result;
  }) };
});
vi.mock('./search.js', () => ({ qmd: { upsertNote: vi.fn(), remove: vi.fn() } }));
vi.mock('./links.js', () => ({ updateLinkGraphFromNote: vi.fn() }));
vi.mock('./realtime.js', () => ({ broadcast: vi.fn(), notifyIndexChanged: vi.fn() }));
import { queueFileUpdate, enableFileUpdates, drainFileUpdates, rebuildFileIndexes } from './fileupdates.js';
import { qmd } from './search.js';
import { replaceCatalog, VaultCatalog } from './catalog.js';
import { broadcast } from './realtime.js';

const base = path.join(os.tmpdir(), '.agents');
let releaseReads: (() => void) | undefined;
beforeEach(async () => {
  await fs.mkdir(base, { recursive: true });
  state.root = await fs.mkdtemp(path.join(base, 'fileupdates-architecture-'));
  state.afterRead = undefined; releaseReads = undefined;
  await rebuildFileIndexes(async () => {});
  replaceCatalog(new VaultCatalog()); enableFileUpdates(); vi.clearAllMocks();
});
afterEach(async () => {
  releaseReads?.();
  await drainFileUpdates();
  if (path.dirname(state.root) !== base) throw new Error('Refusing to clean outside fixture parent');
  await fs.rm(state.root, { recursive: true, force: true });
});

it('reruns the latest disk state after an in-flight event and deduplicates unchanged revisions', async () => {
  const gate = new Promise<void>(resolve => { releaseReads = resolve; });
  let captured!: () => void;
  const snapshotReady = new Promise<void>(resolve => { captured = resolve; });
  state.afterRead = async () => { captured(); await gate; };
  await fs.writeFile(path.join(state.root, 'note.md'), 'first');
  const first = queueFileUpdate('note.md', 'add');
  await snapshotReady;
  await fs.writeFile(path.join(state.root, 'note.md'), 'latest');
  const second = queueFileUpdate('./note.md', 'change');
  releaseReads!();
  await Promise.all([first, second]);
  expect(vi.mocked(qmd.upsertNote).mock.calls.at(-1)?.[1].body).toBe('latest');
  expect(qmd.upsertNote).toHaveBeenCalledTimes(2);
  await queueFileUpdate('note.md');
  expect(qmd.upsertNote).toHaveBeenCalledTimes(2);
  expect(vi.mocked(broadcast).mock.calls.at(-1)?.[0]).toMatchObject({ type: 'fs', path: 'note.md', indexed: true });
  await fs.unlink(path.join(state.root, 'note.md'));
  await queueFileUpdate('note.md', 'unlink');
  expect(qmd.remove).toHaveBeenCalledWith('note.md');
});

it('keeps at most four paths active and reserves all workers for a full rebuild', async () => {
  const gate = new Promise<void>(resolve => { releaseReads = resolve; });
  let active = 0, maximum = 0;
  state.afterRead = async () => { maximum = Math.max(maximum, ++active); await gate; active--; };
  await Promise.all(Array.from({ length: 6 }, (_, n) => fs.writeFile(path.join(state.root, `${n}.md`), 'body')));
  const updates = Array.from({ length: 6 }, (_, n) => queueFileUpdate(`${n}.md`, 'add'));
  await vi.waitFor(() => expect(active).toBe(4));
  let rebuilt = false;
  const rebuilding = rebuildFileIndexes(async () => { expect(active).toBe(0); rebuilt = true; });
  expect(rebuilt).toBe(false);
  releaseReads!();
  await Promise.all([...updates, rebuilding]);
  expect(maximum).toBe(4);
  expect(rebuilt).toBe(true);
  expect(qmd.upsertNote).toHaveBeenCalledTimes(6);
});
