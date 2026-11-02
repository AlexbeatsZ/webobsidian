import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import express from 'express';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { Server } from 'node:http';

const state = vi.hoisted(() => ({ root: '' }));
vi.mock('../services/settings.js', () => ({ getSettings: async () => ({ vault: { path: state.root, trash: '.trash' }, nativeFeatures: {} }) }));
vi.mock('../services/git.js', () => ({ scheduleAutoCommitOnSave: vi.fn() }));
vi.mock('../services/fileupdates.js', () => ({ queueFileUpdate: vi.fn(() => Promise.resolve()) }));
import { filesRouter } from './files.js';
import { errorHandler } from '../middleware/error.js';
import { vaultConfigurationIdentity } from '../services/vaultConfiguration.js';

const base = path.join(os.tmpdir(), '.agents');
let fixture = '', listener: Server | undefined;
beforeEach(async () => {
  await fs.mkdir(base, { recursive: true });
  fixture = await fs.mkdtemp(path.join(base, 'files-route-'));
  state.root = path.join(fixture, 'vault');
  await fs.mkdir(state.root);
});
afterEach(async () => {
  if (listener) await new Promise<void>((resolve, reject) => listener!.close(error => error ? reject(error) : resolve()));
  listener = undefined;
  if (path.dirname(fixture) !== base) throw new Error('Refusing to clean outside fixture parent');
  await fs.rm(fixture, { recursive: true, force: true });
});

it('uploads keep UTF-8 names and never replace an existing attachment', async () => {
  const server = express(); server.use('/api/files', filesRouter); server.use(errorHandler);
  listener = server.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => listener!.once('listening', resolve));
  const url = `http://127.0.0.1:${(listener.address() as { port: number }).port}/api/files/upload`;
  const upload = async (body: string) => {
    const form = new FormData();
    form.append('dir', 'Attachments');
    form.append('file', new File([body], '实验数据.png', { type: 'image/png' }));
    const headers = { 'X-Vault-Identity': (await vaultConfigurationIdentity()).vault };
    const res = await fetch(url, { method: 'POST', body: form, headers });
    if (res.status !== 200) throw new Error(await res.text());
    return ((await res.json()) as { path: string }).path;
  };
  expect([await upload('first'), await upload('second')]).toEqual(['Attachments/实验数据.png', 'Attachments/实验数据 1.png']);
  expect(await fs.readFile(path.join(state.root, 'Attachments', '实验数据.png'), 'utf8')).toBe('first');
  expect(await fs.readFile(path.join(state.root, 'Attachments', '实验数据 1.png'), 'utf8')).toBe('second');
});
