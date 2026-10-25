import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ vault: 'vault-A', raw: 'same bytes' }));
vi.mock('../../../web/src/lib/api', () => ({ api: {
  read: vi.fn(async (path: string, vault = state.vault) => {
    if (vault !== state.vault) throw Object.assign(new Error('Vault changed'), { status: 409 });
    return { path, content: state.raw, revision: 'same revision', vault };
  }),
  write: vi.fn(async (_path: string, _raw: string, _revision: string, vault: string) => {
    if (vault !== state.vault) throw Object.assign(new Error('Vault changed'), { status: 409 });
    return { revision: 'new revision' };
  }),
} }));
vi.mock('../../../web/src/lib/tags/folderSession', async () => ({
  WorkspaceDocumentSession: (await import('@webobsidian/markdown-core')).DocumentSession,
}));

const registryModule = '../../../web/src/lib/documents.ts';
const apiModule = '../../../web/src/lib/api.ts';
beforeEach(() => { state.vault = 'vault-A'; state.raw = 'same bytes'; vi.clearAllMocks(); vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

it('binds the session writer to the identity returned when it opened', async () => {
  const { DocumentRegistry } = await import(registryModule);
  const { api } = await import(apiModule);
  const registry = new DocumentRegistry();
  const session = await registry.open('same.md');
  state.vault = 'vault-B';
  session.edit(session.snapshot.version, [{ from: 0, to: 0, insert: 'local ' }], 'fixture');
  await expect(session.save()).rejects.toMatchObject({ status: 409 });
  expect(api.write).toHaveBeenCalledWith('same.md', 'local same bytes', 'same revision', 'vault-A');
  expect(session.snapshot.dirty).toBe(true);
  expect(session.snapshot.raw).toBe('local same bytes');
});

it('refreshes with the session identity and keeps that identity after a path relocation', async () => {
  const { DocumentRegistry } = await import(registryModule);
  const { api } = await import(apiModule);
  const registry = new DocumentRegistry();
  const session = await registry.open('same.md');
  await registry.changePath('same.md', 'renamed.md', async () => {}, () => {});
  state.vault = 'vault-B'; state.raw = 'wrong Vault bytes';
  await expect(registry.refresh('renamed.md')).rejects.toMatchObject({ status: 409 });
  expect(api.read).toHaveBeenLastCalledWith('renamed.md', 'vault-A');
  expect(session.snapshot.raw).toBe('same bytes');
  session.edit(session.snapshot.version, [{ from: 0, to: 0, insert: 'local ' }], 'fixture');
  await expect(session.save()).rejects.toMatchObject({ status: 409 });
  expect(api.write).toHaveBeenLastCalledWith('renamed.md', 'local same bytes', 'same revision', 'vault-A');
});
