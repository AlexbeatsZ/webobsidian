import { afterEach, beforeEach, expect, it, vi } from 'vitest';
vi.mock('./api', () => ({ api: { read: vi.fn(async (path: string) => ({ path, content: '# Original', revision: 'v1', vault: 'fixture' })),
  write: vi.fn(async () => ({ revision: 'v2' })) } }));
vi.mock('./tags/folderSession', async () => ({ WorkspaceDocumentSession: (await import('@webobsidian/markdown-core')).DocumentSession }));
import { DocumentRegistry } from './documents';
import { api } from './api';
beforeEach(() => vi.useFakeTimers());
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });
it('releases unedited virtual models only after their last mounted view leaves', async () => {
  const registry = new DocumentRegistry(), first = await registry.acquire('chapter.md'), second = await registry.acquire('chapter.md');
  expect(first.session).toBe(second.session);
  first.release(); await vi.advanceTimersByTimeAsync(0); expect(registry.get('chapter.md')).toBe(second.session);
  second.release(); await vi.advanceTimersByTimeAsync(0); expect(registry.get('chapter.md')).toBeUndefined();
});
it('keeps independent edit history and autosaves only the edited source after unmount', async () => {
  const registry = new DocumentRegistry(), first = await registry.acquire('one.md'), second = await registry.acquire('two.md');
  first.session.edit(0, [{ from: 10, to: 10, insert: ' changed' }]); first.release(); second.release();
  await vi.advanceTimersByTimeAsync(1000);
  expect(registry.get('one.md')).toBe(first.session); expect(registry.get('two.md')).toBeUndefined();
  expect(api.write).toHaveBeenLastCalledWith('one.md', '# Original changed', 'v1', 'fixture');
  expect(first.session.snapshot.dirty).toBe(false);
  first.session.undo(); expect(first.session.snapshot.raw).toBe('# Original');
});
it('keeps a session also owned by a normal tab or embed', async () => {
  const registry = new DocumentRegistry(), lease = await registry.acquire('chapter.md');
  expect(await registry.open('chapter.md')).toBe(lease.session);
  lease.release(); await vi.advanceTimersByTimeAsync(0); expect(registry.get('chapter.md')).toBe(lease.session);
});
