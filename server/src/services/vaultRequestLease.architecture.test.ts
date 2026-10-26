import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { PassThrough } from 'node:stream';
import type { WebSocket } from 'ws';

const state = vi.hoisted(() => ({ root: '', native: {} as Record<string, unknown>, beforeSettings: undefined as (() => Promise<void>) | undefined,
  stream: undefined as import('node:stream').PassThrough | undefined }));
vi.mock('node:fs', async original => {
  const actual = await original<typeof import('node:fs')>();
  return { ...actual, createReadStream: (...args: Parameters<typeof actual.createReadStream>) => state.stream ?? actual.createReadStream(...args) };
});
vi.mock('./settings.js', () => ({
  getSettings: async () => ({ vault: { path: state.root, trash: '.trash', deleteMode: 'permanent' }, nativeFeatures: state.native }),
  updateSettings: async (change: (draft: any) => void) => {
    await state.beforeSettings?.();
    const draft = { vault: { path: state.root }, nativeFeatures: state.native };
    change(draft);
    return draft;
  },
}));
vi.mock('./tags/migration.js', () => ({ readLegacyTagPreferences: async () => ({ batchEnabled: true, wranglerEnabled: true }) }));
vi.mock('./git.js', () => ({ scheduleAutoCommitOnSave: vi.fn() }));
vi.mock('./fileupdates.js', () => ({ queueFileUpdate: async () => ({ status: 'indexed' }) }));
import { guardVaultMutations, withVaultMaintenance, bindMaintenanceClients, maintenanceClientMessage, beginBackgroundVaultWrite, vaultGeneration } from './vaultMaintenance.js';
import { vaultConfigurationIdentity } from './vaultConfiguration.js';
import { filesRouter } from '../routes/files.js';
import { asyncHandler, errorHandler } from '../middleware/error.js';
import { nativeFeatureSettings } from './nativeFeatureSettings.js';

const base = path.join(os.tmpdir(), '.agents');
let fixture = '', url = '', server: Server;
let finishWork: (() => void) | undefined;
beforeEach(async () => {
  await fs.mkdir(base, { recursive: true });
  fixture = await fs.mkdtemp(path.join(base, 'vault-request-lease-'));
  state.root = path.join(fixture, 'a'); state.native = {}; state.beforeSettings = undefined;
  await fs.mkdir(state.root); await fs.mkdir(path.join(fixture, 'b'));
  for (const root of ['a', 'b']) await fs.writeFile(path.join(fixture, root, 'same.md'), 'same bytes');
  const client = { readyState: 1, send(data: string) {
    const message = JSON.parse(data);
    if (message.phase === 'prepare') maintenanceClientMessage(client as unknown as WebSocket, {
      type: 'maintenance-ack', token: message.token, check: message.check, blockers: [],
    });
  } };
  bindMaintenanceClients(() => [client as unknown as WebSocket]);
  const app = express(); app.use(express.json()); app.use(guardVaultMutations);
  app.use('/api/files', filesRouter);
  app.get('/api/native-features', asyncHandler(async (_req, res) => { res.json(await nativeFeatureSettings()); }));
  app.post('/api/detached', asyncHandler(async (_req, res) => {
    const release = beginBackgroundVaultWrite();
    const pending = new Promise<void>(resolve => { finishWork = resolve; });
    void pending.finally(release);
    res.json({ ok: true });
  }));
  app.use(errorHandler);
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Fixture port unavailable');
  url = `http://127.0.0.1:${address.port}`;
});
afterEach(async () => {
  finishWork?.(); finishWork = undefined;
  state.stream?.destroy(); state.stream = undefined;
  state.beforeSettings = undefined;
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  bindMaintenanceClients(() => []);
  if (path.dirname(fixture) !== base) throw new Error('Refusing fixture cleanup outside .agents');
  await fs.rm(fixture, { recursive: true, force: true });
});

it('rejects stale same-path same-revision writes and structural requests without any socket notification', async () => {
  const vault = (await vaultConfigurationIdentity()).vault;
  const initial = await fetch(url + '/api/files/content?path=same.md', { headers: { 'X-Vault-Identity': vault } });
  const file = await initial.json() as { vault: string; revision: string };
  expect(file.vault).toBe(vault);
  await withVaultMaintenance(async () => {}, async () => { state.root = path.join(fixture, 'b'); });
  for (const [route, method, body] of [
    ['/content', 'PUT', { path: 'same.md', content: 'wrong', baseRevision: file.revision }],
    ['/content', 'PUT', { path: 'new.md', content: 'wrong', createOnly: true }],
    ['/rename', 'PATCH', { from: 'same.md', to: 'renamed.md' }],
    ['/copy', 'POST', { from: 'same.md', to: 'copied.md' }],
    ['/folder', 'POST', { path: 'wrong' }],
    ['/?path=same.md', 'DELETE', undefined],
  ] as const) {
    const response = await fetch(url + '/api/files' + route, { method, headers: { 'Content-Type': 'application/json', 'X-Vault-Identity': vault }, body: body ? JSON.stringify(body) : undefined });
    expect(response.status).toBe(409); expect(await response.json()).toMatchObject({ code: 'VAULT_CHANGED' });
  }
  expect((await fetch(url + `/api/files/content?path=same.md&vault=${vault}`)).status).toBe(409);
  expect((await fetch(url + '/api/files/content?path=same.md')).status).toBe(409);
  for (const root of ['a', 'b']) {
    expect(await fs.readFile(path.join(fixture, root, 'same.md'), 'utf8')).toBe('same bytes');
    expect(await fs.readdir(path.join(fixture, root))).toEqual(['same.md']);
  }
});

it('keeps a disconnected HTTP write leased until its physical rename finishes', async () => {
  const vault = (await vaultConfigurationIdentity()).vault;
  let started!: () => void;
  const writing = new Promise<void>(resolve => { started = resolve; });
  const gate = new Promise<void>(resolve => { finishWork = resolve; });
  const original = fs.rename.bind(fs);
  vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
    if (String(to) === path.join(fixture, 'a', 'same.md')) { started(); await gate; }
    return original(from, to);
  });
  const controller = new AbortController();
  const request = fetch(url + '/api/files/content', { method: 'PUT', signal: controller.signal,
    headers: { 'Content-Type': 'application/json', 'X-Vault-Identity': vault }, body: JSON.stringify({ path: 'same.md', content: 'completed in A' }) }).catch(() => undefined);
  await writing; controller.abort(); await request;
  let switched = false;
  const switching = withVaultMaintenance(async () => {}, async () => { state.root = path.join(fixture, 'b'); switched = true; });
  await new Promise(resolve => setTimeout(resolve, 45));
  expect(switched).toBe(false);
  finishWork!(); await switching;
  expect(await fs.readFile(path.join(fixture, 'a', 'same.md'), 'utf8')).toBe('completed in A');
  expect(await fs.readFile(path.join(fixture, 'b', 'same.md'), 'utf8')).toBe('same bytes');
});

it('holds a delayed text read on its original Vault until its snapshot settles', async () => {
  const vault = (await vaultConfigurationIdentity()).vault;
  const read = fs.readFile.bind(fs);
  let started!: () => void;
  const reading = new Promise<void>(resolve => { started = resolve; });
  const gate = new Promise<void>(resolve => { finishWork = resolve; });
  vi.spyOn(fs, 'readFile').mockImplementation(async (...args: Parameters<typeof fs.readFile>) => {
    const result = await read(...args);
    if (String(args[0]) === path.join(fixture, 'a', 'same.md')) { started(); await gate; }
    return result;
  });
  const request = fetch(url + '/api/files/content?path=same.md', { headers: { 'X-Vault-Identity': vault } });
  await reading;
  let switched = false;
  const switching = withVaultMaintenance(async () => {}, async () => { switched = true; state.root = path.join(fixture, 'b'); });
  await new Promise(resolve => setTimeout(resolve, 35));
  expect(switched).toBe(false);
  finishWork!();
  const response = await request;
  expect(await response.json()).toMatchObject({ content: 'same bytes', vault });
  await switching;
  expect(switched).toBe(true);
});

it('waits for actual GET migration writes and releases failed route/background operations exactly once', async () => {
  let started!: () => void;
  const migrating = new Promise<void>(resolve => { started = resolve; });
  const gate = new Promise<void>(resolve => { finishWork = resolve; });
  state.beforeSettings = async () => { started(); await gate; };
  const controller = new AbortController();
  const request = fetch(url + '/api/native-features', { signal: controller.signal }).catch(() => undefined);
  await migrating; controller.abort(); await request;
  let switched = false;
  const switching = withVaultMaintenance(async () => {}, async () => { state.root = path.join(fixture, 'b'); switched = true; });
  expect((await fetch(url + '/api/native-features')).status).toBe(409);
  expect(switched).toBe(false);
  finishWork!(); await switching;
  expect(Object.keys(state.native)).toHaveLength(1);
  const release = beginBackgroundVaultWrite(); release(); release();
  const generation = vaultGeneration();
  expect((await fetch(url + '/api/files/content?path=missing.md', { headers: { 'X-Vault-Identity': (await vaultConfigurationIdentity()).vault } })).status).toBe(500);
  expect(vaultGeneration()).toBe(generation);
  await withVaultMaintenance(async () => {}, async () => {});
});

it('keeps detached background work leased after the originating handler returns', async () => {
  expect((await fetch(url + '/api/detached', { method: 'POST' })).status).toBe(200);
  let maintained = false;
  const maintenance = withVaultMaintenance(async () => {}, async () => { maintained = true; });
  await new Promise(resolve => setTimeout(resolve, 45));
  expect(maintained).toBe(false);
  finishWork!(); await maintenance;
  expect(maintained).toBe(true);
});

it('holds the read operation through the last media-stream byte', async () => {
  await fs.writeFile(path.join(state.root, 'media.bin'), 'firstlast');
  state.stream = new PassThrough();
  const request = fetch(url + `/api/files/content?path=media.bin&vault=${(await vaultConfigurationIdentity()).vault}`);
  state.stream.write('first');
  const response = await request;
  let maintained = false;
  const maintenance = withVaultMaintenance(async () => {}, async () => { maintained = true; });
  await new Promise(resolve => setTimeout(resolve, 45));
  expect(maintained).toBe(false);
  state.stream.end('last');
  expect(await response.text()).toBe('firstlast');
  await maintenance;
  expect(maintained).toBe(true);
});

it('serves scoped PDF bytes and ranges while rejecting missing and stale identities', async () => {
  const bytes = '%PDF-1.7\nfixture PDF bytes\n%%EOF';
  await fs.writeFile(path.join(state.root, 'paper.pdf'), bytes);
  const vault = (await vaultConfigurationIdentity()).vault;
  const scoped = url + `/api/files/content?path=paper.pdf&vault=${vault}`;
  const response = await fetch(scoped);
  expect(response.status).toBe(200);
  expect(response.headers.get('content-type')).toBe('application/pdf');
  expect(await response.text()).toBe(bytes);
  const partial = await fetch(scoped, { headers: { Range: 'bytes=0-7' } });
  expect(partial.status).toBe(206);
  expect(partial.headers.get('content-range')).toBe(`bytes 0-7/${bytes.length}`);
  expect(await partial.text()).toBe('%PDF-1.7');
  for (const request of [
    fetch(url + '/api/files/content?path=paper.pdf'),
    fetch(scoped, { headers: { 'X-Vault-Identity': 'old-vault' } }),
    fetch(url + '/api/files/content?path=paper.pdf&vault=old-vault'),
  ]) {
    const rejected = await request;
    expect(rejected.status).toBe(409);
    expect(await rejected.json()).toMatchObject({ code: 'VAULT_CHANGED' });
  }
  expect((await vaultConfigurationIdentity()).vault).toBe(vault);
});
