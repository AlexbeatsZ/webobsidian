import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { gitPreferences, redactGitPreferences, saveGitPreferences } from './gitPreferences.js';

const fixture = vi.hoisted(() => ({ root: '' }));
vi.mock('./vaultFile.js', async importOriginal => ({
  ...await importOriginal<typeof import('./vaultFile.js')>(), getVaultRoot: async () => fixture.root,
}));
let directory: string;
let filename: string;
beforeEach(async () => {
  const base = path.join(os.tmpdir(), '.agents'); await fs.mkdir(base, { recursive: true });
  directory = await fs.mkdtemp(path.join(base, 'webobsidian-git-preferences-'));
  fixture.root = path.join(directory, 'vault'); await fs.mkdir(fixture.root);
  filename = path.join(fixture.root, '.obsidian/webobsidian/git.jsonc');
});
afterEach(async () => {
  vi.restoreAllMocks();
  if (!path.resolve(directory).startsWith(path.join(os.tmpdir(), '.agents', 'webobsidian-git-preferences-'))) throw new Error('Unsafe fixture');
  await fs.rm(directory, { recursive: true, force: true });
});

describe('Vault-owned Git configuration', () => {
  it('defaults without creating files or inheriting another Vault or application settings', async () => {
    expect(await gitPreferences()).toMatchObject({ enabled: false, remote: '', autoSync: false });
    await expect(fs.access(filename)).rejects.toThrow();
    await saveGitPreferences({ enabled: true, remote: 'https://github.com/example/private.git', autoSync: true });
    expect((await gitPreferences()).enabled).toBe(true);
    fixture.root = path.join(directory, 'other'); await fs.mkdir(fixture.root);
    expect(await gitPreferences()).toMatchObject({ enabled: false, remote: '' });
  });

  it('reads JSONC again after external edits and preserves partial edits and masked credentials', async () => {
    await saveGitPreferences({ enabled: true, remote: 'https://github.com/example/private.git', token: 'fixture-git-secret' });
    await fs.writeFile(filename, '// Vault settings\n' + (await fs.readFile(filename, 'utf8')).replace('"intervalSec": 300', '"intervalSec": 900'));
    expect((await gitPreferences()).intervalSec).toBe(900);
    await saveGitPreferences({ authorName: 'Updated', token: '••••••••' });
    const value = await gitPreferences();
    expect(value).toMatchObject({ enabled: true, intervalSec: 900, authorName: 'Updated', token: 'fixture-git-secret' });
    expect(redactGitPreferences(value).token).toBe('••••••••');
    await saveGitPreferences({ token: '' });
    expect(redactGitPreferences(await gitPreferences()).token).toBe('');
  });

  it.each(['{broken', '{"enabled":true,"unexpected":1}', '{"intervalSec":0}'])('fails closed and preserves invalid bytes: %s', async content => {
    await fs.mkdir(path.dirname(filename), { recursive: true }); await fs.writeFile(filename, content);
    await expect(gitPreferences()).rejects.toThrow();
    expect(await fs.readFile(filename, 'utf8')).toBe(content);
  });

  it('rejects a Vault switch between configuration read and save', async () => {
    await saveGitPreferences({ remote: 'https://github.com/example/first.git' });
    const read = fs.readFile.bind(fs); const first = fixture.root;
    vi.spyOn(fs, 'readFile').mockImplementation(((...args: any[]) => {
      const result = (read as any)(...args);
      if (String(args[0]) === filename) fixture.root = path.join(directory, 'other');
      return result;
    }) as typeof fs.readFile);
    await expect(saveGitPreferences({ enabled: true })).rejects.toThrow('Vault changed');
    fixture.root = first;
    expect(JSON.parse(await read(filename, 'utf8')).enabled).toBe(false);
  });
});
