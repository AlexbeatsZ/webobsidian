import { describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn, type ChildProcess } from 'node:child_process';
import type { AddressInfo } from 'node:net';
import { WebSocket } from 'ws';
import { createSyncServer } from '../../../sync-server/server.mjs';
import { FileSyncEngine } from './fileSyncEngine.js';
import { prefix } from '../../../sync-server/protocol.mjs';
import type { FileSyncStatus } from '../contracts/fileSync.js';

describe('real application integration', () => {
  it('uses the existing watcher and workspace lease, masks credentials and never overwrites a dirty editor', async () => {
    const parent = path.join(os.tmpdir(), '.agents'); await fs.mkdir(parent, { recursive: true });
    const directory = await fs.mkdtemp(path.join(parent, 'webobsidian-sync-runtime-'));
    const vault = path.join(directory, 'vault'); const data = path.join(directory, 'data'); const peerRoot = path.join(directory, 'peer');
    await fs.mkdir(vault); await fs.mkdir(peerRoot); await fs.mkdir(data);
    const token = 'fixture-only-runtime-token-0123456789-abcdef';
    const hub = await createSyncServer({ root: path.join(directory, 'hub'), token });
    let child: ChildProcess | undefined; let socket: WebSocket | undefined; let logs = '';
    try {
      await new Promise<void>(resolve => hub.server.listen(0, '127.0.0.1', resolve));
      const endpoint = `http://127.0.0.1:${(hub.server.address() as AddressInfo).port}${prefix}/`;
      const preferences = { enabled: true, endpoints: ['http://127.0.0.1:1', endpoint], token, intervalSec: 3600 };
      const peer = new FileSyncEngine(peerRoot, path.join(directory, 'peer-state'), preferences, { publish: async work => work(), changed: async () => {} });
      const image = Buffer.from([137, 80, 78, 71, 0, 255]);
      await fs.writeFile(path.join(peerRoot, 'remote.png'), image); expect((await peer.run()).phase).toBe('idle');
      await fs.writeFile(path.join(vault, 'local.md'), 'local source\r\n');
      const entry = process.env.WEBOBSIDIAN_SYNC_TEST_ENTRY;
      child = spawn(process.execPath, entry ? [path.resolve(entry)] : ['--import', 'tsx', 'server/src/index.ts'], { cwd: process.cwd(), windowsHide: true,
        env: { ...process.env, PORT: '0', HOST: '127.0.0.1', DATA_DIR: data, VAULT_PATH: vault, ALLOWED_ROOTS: directory,
          WEBOBSIDIAN_INITIAL_VAULT: '', NODE_ENV: 'development' }, stdio: ['ignore', 'pipe', 'pipe'] });
      child.stdout!.on('data', chunk => { logs = (logs + chunk).slice(-65536); }); child.stderr!.on('data', chunk => { logs = (logs + chunk).slice(-65536); });
      let base = '';
      await expect.poll(async () => {
        if (child!.exitCode !== null) throw new Error(logs);
        base = await fs.readFile(path.join(data, 'operations-endpoint.json'), 'utf8').then(text => JSON.parse(text).url, () => '');
        return base;
      }, { timeout: 20000, interval: 50 }).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
      const identity = (await (await fetch(base + '/api/vault-identity')).json() as { vault: string }).vault;
      const request = async (resource: string, method = 'GET', body?: unknown) => fetch(base + '/api/' + resource, {
        method, headers: { 'Content-Type': 'application/json', 'X-Vault-Identity': identity }, ...(body ? { body: JSON.stringify(body) } : {}),
      });
      expect(await (await request('file-sync')).json()).toMatchObject({ status: { enabled: false } });
      expect((await request('file-sync', 'PUT', preferences)).status).toBe(200);
      const settings = await (await request('settings')).json(); expect(settings).not.toHaveProperty('fileSync'); expect(JSON.stringify(settings)).not.toContain(token);
      expect(await (await request('file-sync')).json()).toMatchObject({ preferences: { token: '••••••••' } });
      let blocked = true; const maintenance: string[] = [];
      socket = new WebSocket(base.replace('http:', 'ws:') + '/ws');
      socket.on('message', raw => {
        const message = JSON.parse(String(raw));
        if (message.type === 'maintenance') {
          maintenance.push(message.phase);
          if (message.phase === 'inspect' || message.phase === 'prepare') socket!.send(JSON.stringify({ type: 'maintenance-ack', token: message.token, check: message.check,
            blockers: blocked ? ['fixture editor has unsaved text'] : [] }));
        }
      });
      await new Promise<void>((resolve, reject) => { socket!.once('open', resolve); socket!.once('error', reject); });
      const refused = await (await request('file-sync/run', 'POST', {})).json() as FileSyncStatus; expect(refused.phase, logs).toBe('recovery'); expect(refused.message).toContain('unsaved');
      await expect(fs.access(path.join(vault, 'remote.png'))).rejects.toThrow();
      blocked = false;
      const completed = await (await request('file-sync/run', 'POST', {})).json() as FileSyncStatus; expect(completed.phase, logs).toBe('idle'); expect(completed.activeEndpoint).toBe(endpoint);
      expect(await fs.readFile(path.join(vault, 'remote.png'))).toEqual(image); expect(maintenance).toContain('release');
      await peer.run(); expect(await fs.readFile(path.join(peerRoot, 'local.md'), 'utf8')).toBe('local source\r\n');
      await fs.writeFile(path.join(vault, 'external.png'), Buffer.from([0, 254, 253]));
      await expect.poll(async () => {
        await peer.run(); return fs.readFile(path.join(peerRoot, 'external.png')).then(value => [...value], () => []);
      }, { timeout: 15000, interval: 250 }).toEqual([0, 254, 253]);
      expect((await request('file-sync', 'PUT', { ...preferences, token: '••••••••' })).status).toBe(200);
      expect((await request('file-sync', 'PUT', { ...preferences, endpoints: ['http://8.8.8.8'] })).status).toBe(400);
      await expect(fs.access(path.join(vault, '.git'))).rejects.toThrow();
    } finally {
      if (socket && socket.readyState !== WebSocket.CLOSED) { const closed = new Promise(resolve => socket!.once('close', resolve)); socket.close(); await closed; }
      if (child && child.exitCode === null) { const closed = new Promise(resolve => child!.once('close', resolve)); child.kill(); await closed; }
      await hub.close();
      if (!path.resolve(directory).startsWith(path.join(parent, 'webobsidian-sync-runtime-'))) throw new Error('Unsafe runtime fixture');
      await fs.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  }, 45000);
});
