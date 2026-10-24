import { beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({
  root: '/disposable-fixture',
  files: new Map<string, { content: string; revision: string }>(),
  notes: new Map<string, { path: string; tags: string[]; aliases: string[] }>(),
  writes: [] as string[],
  beforeWrite: undefined as undefined | (() => Promise<void>),
}));
vi.mock('../catalog.js', () => ({ catalog: { notes: state.notes } }));
vi.mock('../vaultFile.js', () => ({
  getVaultRoot: async () => state.root,
  resolveInVault: async (path: string) => '/disposable-fixture/' + path,
  readFileSnapshot: async (path: string) => {
    const file = state.files.get(path);
    if (!file) throw new Error('Missing fixture');
    return { ...file };
  },
}));
vi.mock('../vault.js', () => ({
  writeFileText: async (path: string, content: string, revision: string) => {
    await state.beforeWrite?.();
    if (state.files.get(path)?.revision !== revision) throw Object.assign(new Error('Conflict'), { status: 409 });
    state.writes.push(path);
    const next = { content, revision: revision + '.next' }; state.files.set(path, next);
    return { revision: next.revision };
  },
}));
import { NativeTagService, configureTagPreferences } from './service.js';

beforeEach(() => {
  state.files.clear(); state.notes.clear(); state.writes = []; state.beforeWrite = undefined;
  state.root = '/disposable-fixture';
  configureTagPreferences(async () => ({ batchEnabled: true, wranglerEnabled: true }));
  for (const path of ['a.md', 'b.md']) {
    state.files.set(path, { content: '#old', revision: 'revision-' + path });
    state.notes.set(path, { path, tags: ['old'], aliases: [] });
  }
});
const request = { operation: { kind: 'rename' as const, from: 'old', to: 'new' }, scope: { kind: 'vault' as const } };

it('requires merge confirmation before any file write', async () => {
  state.notes.set('tag-page.md', { path: 'tag-page.md', tags: [], aliases: ['#NEW'] });
  const service = new NativeTagService(), preview = await service.preview(request);
  expect(preview.collisions).toContainEqual({ from: 'old', to: 'new' });
  await expect(service.apply(preview.id, 'a.md', false)).rejects.toThrow(/confirmation/);
  expect(state.writes).toEqual([]);
  await service.apply(preview.id, 'a.md', true);
  expect(state.writes).toEqual(['a.md']);
});
it('rejects changed revisions and changed Vault roots before applying', async () => {
  const service = new NativeTagService(), preview = await service.preview(request);
  state.files.set('a.md', { content: '#old changed externally', revision: 'external' });
  await expect(service.apply(preview.id, 'a.md', true)).rejects.toThrow(/changed/);
  state.root = '/another-disposable-fixture';
  await expect(service.apply(preview.id, 'b.md', true)).rejects.toThrow(/Vault changed/);
  expect(state.writes).toEqual([]);
});
it('waits for the submitted write and cancellation prevents the next file', async () => {
  const service = new NativeTagService(), preview = await service.preview(request);
  let release!: () => void;
  const writing = new Promise<void>((resolve) => { release = resolve; });
  let started!: () => void;
  const start = new Promise<void>((resolve) => { started = resolve; });
  state.beforeWrite = async () => { started(); await writing; };
  const applying = service.apply(preview.id, 'a.md', false);
  await start;
  service.cancel(preview.id);
  expect(state.writes).toEqual([]);
  release();
  await applying;
  await expect(service.apply(preview.id, 'b.md', false)).rejects.toThrow(/cancelled/);
  expect(state.writes).toEqual(['a.md']);
});
it('local ownership grant performs no server write and still checks disk revision', async () => {
  const service = new NativeTagService();
  const preview = await service.preview({ ...request, overlays: [{ path: 'a.md', raw: '#old unsaved', version: 2, revision: 'revision-a.md' }] });
  expect((await service.apply(preview.id, 'a.md', false, true)).status).toBe('local');
  expect(state.writes).toEqual([]);
  const stale = await service.preview({ ...request, overlays: [{ path: 'a.md', raw: '#old unsaved', version: 2, revision: 'older' }] });
  await expect(service.apply(stale.id, 'a.md', false, true)).rejects.toThrow(/disk/);
});
