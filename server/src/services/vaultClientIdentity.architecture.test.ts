import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const modulePath = '../../../web/src/lib/api.ts';

beforeEach(() => { vi.resetModules(); });
afterEach(() => { vi.unstubAllGlobals(); });

it('bootstraps once and carries the captured identity on file, structural and raw requests', async () => {
  const fetcher = vi.fn(async (url: string, options?: RequestInit) => {
    if (url === '/api/vault-identity') return Response.json({ vault: 'vault-A' });
    expect(new Headers(options?.headers).get('X-Vault-Identity')).toBe('vault-A');
    if (url.startsWith('/api/files/content?')) return Response.json({ path: 'same.md', content: 'same bytes', revision: 'same revision', vault: 'vault-A' });
    return Response.json({ ok: true });
  });
  vi.stubGlobal('fetch', fetcher);
  const { api } = await import(modulePath);
  await Promise.all([api.tree(), api.read('same.md')]);
  await api.write('same.md', 'local', 'same revision', 'vault-A');
  await api.rename('same.md', 'renamed.md'); await api.remove('same.md'); await api.createText('new.md', 'new');
  expect(fetcher.mock.calls.filter(([url]) => url === '/api/vault-identity')).toHaveLength(1);
  expect(api.rawUrl('image.png')).toContain('vault=vault-A');
  expect(api.uploadUrl()).toContain('vault=vault-A');
});

it('does not silently rebind a rejected stale session to the server new Vault', async () => {
  const fetcher = vi.fn(async (url: string) => url === '/api/vault-identity' ? Response.json({ vault: 'vault-A' }) :
    Response.json({ error: 'Vault changed', code: 'VAULT_CHANGED' }, { status: 409 }));
  vi.stubGlobal('fetch', fetcher);
  const { api } = await import(modulePath);
  await expect(api.write('same.md', 'local', 'same revision', 'vault-A')).rejects.toMatchObject({ status: 409 });
  await expect(api.createText('new.md', 'new')).rejects.toMatchObject({ status: 409 });
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it('discards a delayed successful read after the page identity was invalidated', async () => {
  let finish!: (response: Response) => void;
  const response = new Promise<Response>(resolve => { finish = resolve; });
  let started!: () => void;
  const reading = new Promise<void>(resolve => { started = resolve; });
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url === '/api/vault-identity') return Response.json({ vault: 'vault-A' });
    started(); return response;
  }));
  const { api, invalidateVaultRequests } = await import(modulePath);
  const pending = api.read('same.md');
  await reading; invalidateVaultRequests();
  finish(Response.json({ content: 'late', vault: 'vault-A' }));
  await expect(pending).rejects.toMatchObject({ status: 409 });
});

it('rejects an identity-mismatched file response even when its content revision matches', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => url === '/api/vault-identity' ? Response.json({ vault: 'vault-A' }) :
    Response.json({ path: 'same.md', content: 'same bytes', revision: 'same revision', vault: 'vault-B' })));
  const { api } = await import(modulePath);
  await expect(api.read('same.md')).rejects.toMatchObject({ status: 409 });
  await expect(api.rename('same.md', 'other.md')).rejects.toMatchObject({ status: 409 });
});
