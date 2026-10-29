import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileSyncPreferences } from './fileSyncPreferences.js';

const fixture = vi.hoisted(() => ({ root: '' }));
vi.mock('./vaultFile.js', async importOriginal => ({ ...await importOriginal<typeof import('./vaultFile.js')>(), getVaultRoot: async () => fixture.root }));

let directory: string;
let configuration: string;
const preferences = { enabled: true, endpoints: ['127.0.0.1:18744', 'https://example.com/webobsidian-sync/v1/'], token: 'fixture-only-preferences-token-0123456789', intervalSec: 15 };
beforeEach(async () => {
  const base = path.join(os.tmpdir(), '.agents'); await fs.mkdir(base, { recursive: true });
  directory = await fs.mkdtemp(path.join(base, 'webobsidian-sync-preferences-'));
  fixture.root = path.join(directory, 'vault');
  await fs.mkdir(path.join(fixture.root, '.obsidian/webobsidian'), { recursive: true });
  configuration = path.join(fixture.root, '.obsidian/webobsidian/sync.jsonc');
});
afterEach(async () => {
  if (!path.resolve(directory).startsWith(path.join(os.tmpdir(), '.agents', 'webobsidian-sync-preferences-'))) throw new Error('Unsafe fixture');
  await fs.rm(directory, { recursive: true, force: true });
});

describe('Vault-owned sync configuration', () => {
  it('defaults to disabled without creating a configuration or importing machine settings', async () => {
    expect(await fileSyncPreferences()).toEqual({ enabled: false, endpoints: [], token: '', intervalSec: 15 });
    await expect(fs.access(configuration)).rejects.toThrow();
  });

  it('reads JSONC and preserves the explicit endpoint order on every read', async () => {
    await fs.writeFile(configuration, '// shared Vault configuration\n' + JSON.stringify(preferences).replace(/}$/, ',}'));
    expect(await fileSyncPreferences()).toEqual({ ...preferences, endpoints: ['http://127.0.0.1:18744/webobsidian-sync/v1/', preferences.endpoints[1]] });
    await fs.writeFile(configuration, JSON.stringify({ ...preferences, endpoints: [...preferences.endpoints].reverse() }));
    expect((await fileSyncPreferences()).endpoints[0]).toBe(preferences.endpoints[1]);
  });

  it.each(['{ broken', JSON.stringify({ ...preferences, token: '••••••••' }), JSON.stringify({ ...preferences, endpoints: ['http://8.8.8.8'] }), JSON.stringify({ ...preferences, unexpected: true })])('fails closed on invalid configuration: %s', async content => {
    await fs.writeFile(configuration, content);
    await expect(fileSyncPreferences()).rejects.toThrow();
  });

  it('does not reuse another Vault connection after switching roots', async () => {
    await fs.writeFile(configuration, JSON.stringify(preferences));
    expect((await fileSyncPreferences()).enabled).toBe(true);
    fixture.root = path.join(directory, 'other'); await fs.mkdir(fixture.root);
    expect((await fileSyncPreferences()).enabled).toBe(false);
  });
});
