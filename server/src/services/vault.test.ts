import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const state = vi.hoisted(() => ({ root: '', native: {} as Record<string, unknown>, index: undefined as Promise<void> | undefined }));
vi.mock('./settings.js', () => ({ getSettings: async () => ({ vault: { path: state.root, trash: '.trash' }, nativeFeatures: state.native }) }));
vi.mock('./git.js', () => ({ scheduleAutoCommitOnSave: vi.fn() }));
vi.mock('./fileupdates.js', () => ({ queueFileUpdate: vi.fn(() => state.index ?? Promise.resolve()) }));
import { writeFileText, writeFileBuffer, createFolder, rename, copy, remove, trash, restoreFromTrash } from './vault.js';
import { clearVaultStats, vaultPathKey, readFileSnapshot, resolveInVault, listTree, invalidateStat } from './vaultFile.js';
import { scheduleAutoCommitOnSave } from './git.js';
import { queueFileUpdate } from './fileupdates.js';
import { catalog, replaceCatalog, VaultCatalog } from './catalog.js';
import { NativeTagService, configureTagPreferences } from './tags/service.js';

const base = path.join(os.tmpdir(), '.agents');
let fixture = '', releaseIndex: (() => void) | undefined;
beforeEach(async () => {
  await fs.mkdir(base, { recursive: true });
  fixture = await fs.mkdtemp(path.join(base, 'vault-architecture-'));
  state.root = path.join(fixture, 'vault');
  await fs.mkdir(state.root);
  state.native = {}; state.index = undefined; releaseIndex = undefined;
  clearVaultStats(); replaceCatalog(new VaultCatalog()); vi.clearAllMocks();
  configureTagPreferences(async () => ({ batchEnabled: true, wranglerEnabled: true }));
});
afterEach(async () => {
  releaseIndex?.();
  if (path.dirname(fixture) !== base) throw new Error('Refusing to clean outside fixture parent');
  await fs.rm(fixture, { recursive: true, force: true });
});

it('normal saves return before indexing, preserve raw bytes and reject stale revisions without effects', async () => {
  state.index = new Promise<void>(resolve => { releaseIndex = resolve; });
  const raw = '\ufeff# Note\r\n\r\nunchanged\n';
  const written = await writeFileText('note.md', raw);
  expect(await fs.readFile(path.join(state.root, 'note.md'), 'utf8')).toBe(raw);
  expect(await readFileSnapshot('note.md')).toEqual({ content: raw, revision: written.revision });
  expect(scheduleAutoCommitOnSave).toHaveBeenCalledTimes(1);
  await fs.writeFile(path.join(state.root, 'note.md'), 'external');
  await expect(writeFileText('note.md', 'stale local', written.revision)).rejects.toMatchObject({ status: 409 });
  expect(await fs.readFile(path.join(state.root, 'note.md'), 'utf8')).toBe('external');
  expect(queueFileUpdate).toHaveBeenCalledTimes(1);
  expect(scheduleAutoCommitOnSave).toHaveBeenCalledTimes(1);
});

it('Tag Page creation preserves preview source, awaits indexing and never overwrites a path', async () => {
  state.native = { [vaultPathKey(state.root)]: { tags: { folderTags: {
    enabled: true, pruneAncestors: true, rules: [{ folder: '', tags: ['automatic'], recursive: true }],
  } } } };
  state.index = new Promise<void>(resolve => { releaseIndex = resolve; });
  const service = new NativeTagService(), page = await service.page('science');
  let done = false;
  const creating = service.createPage('science', 'tag.md').then(result => { done = true; return result; });
  await vi.waitFor(() => expect(queueFileUpdate).toHaveBeenCalledWith('tag.md', 'add'));
  expect(await fs.readFile(path.join(state.root, 'tag.md'), 'utf8')).toBe(page.content);
  expect(done).toBe(false);
  expect(scheduleAutoCommitOnSave).not.toHaveBeenCalled();
  releaseIndex!();
  await expect(creating).resolves.toEqual({ path: 'tag.md' });
  expect(scheduleAutoCommitOnSave).toHaveBeenCalledTimes(1);
  await expect(service.createPage('science', 'tag.md')).rejects.toMatchObject({ status: 409 });
  await expect(writeFileText('tag.md', 'replacement', undefined, { createOnly: true, prepared: true })).rejects.toMatchObject({ status: 409 });
  expect(await fs.readFile(path.join(state.root, 'tag.md'), 'utf8')).toBe(page.content);
  expect(scheduleAutoCommitOnSave).toHaveBeenCalledTimes(1);
});

it('initial note creation still applies folder rules through the existing planner', async () => {
  state.native = { [vaultPathKey(state.root)]: { tags: { folderTags: {
    enabled: true, pruneAncestors: true, rules: [{ folder: '', tags: ['automatic'], recursive: true }],
  } } } };
  await writeFileText('created.md', '# Title\n', undefined, { createOnly: true });
  expect((await readFileSnapshot('created.md')).content).toBe('---\ntags: ["automatic"]\n---\n# Title\n');
});

it('direct file operations own their update events and schedule one commit after each successful mutation', async () => {
  await fs.mkdir(path.join(state.root, 'tree'));
  await fs.writeFile(path.join(state.root, 'tree/a.md'), 'original');
  catalog.putPath('tree/a.md');
  await rename('tree', 'moved');
  expect(queueFileUpdate).toHaveBeenCalledWith('tree/a.md', 'unlink');
  expect(queueFileUpdate).toHaveBeenCalledWith('moved/a.md', 'add');
  expect(scheduleAutoCommitOnSave).toHaveBeenCalledTimes(1);
  await expect(copy('moved', 'copy')).resolves.toEqual(['copy/a.md']);
  expect(scheduleAutoCommitOnSave).toHaveBeenCalledTimes(2);
  const trashed = await trash('copy/a.md');
  expect(trashed).toBe('.trash/copy/a.md');
  expect(scheduleAutoCommitOnSave).toHaveBeenCalledTimes(3);
  await expect(restoreFromTrash(trashed)).resolves.toBe('copy/a.md');
  expect(await fs.readFile(path.join(state.root, 'copy/a.md'), 'utf8')).toBe('original');
  expect(scheduleAutoCommitOnSave).toHaveBeenCalledTimes(4);
  await remove('moved');
  expect(scheduleAutoCommitOnSave).toHaveBeenCalledTimes(5);
  await fs.writeFile(path.join(state.root, 'taken.md'), 'keep');
  const updates = vi.mocked(queueFileUpdate).mock.calls.length;
  await expect(rename('copy/a.md', 'taken.md')).rejects.toMatchObject({ status: 409 });
  expect(await fs.readFile(path.join(state.root, 'taken.md'), 'utf8')).toBe('keep');
  expect(queueFileUpdate).toHaveBeenCalledTimes(updates);
  expect(scheduleAutoCommitOnSave).toHaveBeenCalledTimes(5);
});

it('folder and binary writes retain their existing non-Git behavior', async () => {
  await createFolder('attachments');
  await writeFileBuffer('attachments/image.bin', Buffer.from([0, 255, 1]));
  expect(await fs.readFile(path.join(state.root, 'attachments/image.bin'))).toEqual(Buffer.from([0, 255, 1]));
  expect(queueFileUpdate).toHaveBeenCalledWith('attachments', 'addDir');
  expect(scheduleAutoCommitOnSave).not.toHaveBeenCalled();
});

it('the lower file module retains traversal, Git metadata and symlink escape checks', async () => {
  await expect(resolveInVault('../escape.md')).rejects.toMatchObject({ status: 400 });
  await expect(resolveInVault('.git/config')).rejects.toMatchObject({ status: 400 });
  const outside = path.join(fixture, 'outside');
  await fs.mkdir(outside);
  await fs.symlink(outside, path.join(state.root, 'external'), 'junction');
  await expect(resolveInVault('external/new.md')).rejects.toMatchObject({ status: 400 });
});

it('tree stat invalidation reaches the same cache used by readonly callers', async () => {
  await fs.writeFile(path.join(state.root, 'cached.md'), 'a');
  expect((await listTree()).children?.find(file => file.path === 'cached.md')?.size).toBe(1);
  await fs.writeFile(path.join(state.root, 'cached.md'), 'longer');
  invalidateStat('cached.md');
  expect((await listTree()).children?.find(file => file.path === 'cached.md')?.size).toBe(6);
});
