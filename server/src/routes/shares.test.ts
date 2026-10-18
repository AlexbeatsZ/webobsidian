import { afterAll, expect, it, vi } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'node:net';

const fixture = vi.hoisted(() => ({
  locked: false,
  files: { 'root.md': '![[nested#Allowed]]\n![[pic.png]]\n[[secret]]',
    'nested.md': '# Hidden\nprivate text\n# Allowed\npublic text', 'secret.md': 'secret' } as Record<string, string>,
}));
vi.mock('../services/vault.js', () => ({ exists: async () => true,
  readFileText: async (path: string) => fixture.files[path], resolveInVault: async (path: string) => path,
}));
vi.mock('../services/fileindex.js', () => ({ resolveFile: (target: string) => target.endsWith('.png') ? target : target + '.md' }));
vi.mock('../services/shares.js', () => ({ getActiveShare: async () => ({ id: 'test', path: 'root.md', passwordHash: fixture.locked ? 'locked' : undefined }) }));
vi.mock('../services/httpfile.js', () => ({ sendFileWithRange: async (_req: unknown, res: express.Response, path: string) => res.send(path) }));

const { publicSharesRouter } = await import('./shares.js');
const app = express(); app.use('/public/shares', publicSharesRouter);
const server = app.listen(0, '127.0.0.1');
await new Promise<void>(resolve => server.once('listening', resolve));
const base = 'http://127.0.0.1:' + (server.address() as AddressInfo).port + '/public/shares/test';
afterAll(() => new Promise<void>(resolve => server.close(() => resolve())));

it('enforces scoped content and media authorization over HTTP', async () => {
  const response = await fetch(base + '/render'); expect(response.status).toBe(200);
  const payload = await response.json() as { documents: { token: string; source: string }[] };
  expect(payload.documents).toHaveLength(2);
  const nested = payload.documents.find((doc: { token: string }) => doc.token !== 'root');
  expect(nested?.source).toBe('# Allowed\npublic text');
  expect(nested).not.toHaveProperty('path');
  expect((await fetch(base + '/file?path=pic.png')).status).toBe(200);
  expect((await fetch(base + '/file?path=private.png')).status).toBe(404);
  expect((await fetch(base + '/file?path=secret.md')).status).toBe(404);
  expect((await fetch(base + '/file?path=pic.png&from=unknown')).status).toBe(404);
  fixture.locked = true;
  expect((await fetch(base + '/render')).status).toBe(401);
  expect((await fetch(base + '/file?path=pic.png')).status).toBe(401);
  fixture.locked = false;
});
