import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { simpleGit } from 'simple-git';

const fixture = vi.hoisted(() => ({ root: '', settings: { git: { enabled: true, autoCommitOnSave: true, authorName: 'Fixture', authorEmail: 'fixture@localhost', lfsPatterns: [] as string[], remote: '', branch: 'main', token: '' }, fileSync: {} as Record<string, { enabled: boolean }> } }));
vi.mock('./settings.js', () => ({ getSettings: async () => fixture.settings }));
vi.mock('./vaultFile.js', async importOriginal => ({ ...await importOriginal<typeof import('./vaultFile.js')>(), getVaultRoot: async () => fixture.root }));
vi.mock('./vaultMaintenance.js', () => ({ beginBackgroundVaultWrite: () => () => {} }));

let directory: string;
beforeEach(async () => {
  vi.resetModules();
  const base = path.join(os.tmpdir(), '.agents'); await fs.mkdir(base, { recursive: true });
  directory = await fs.mkdtemp(path.join(base, 'webobsidian-sync-git-test-'));
  fixture.root = path.join(directory, 'vault'); await fs.mkdir(fixture.root);
  fixture.settings.git.remote = '';
  fixture.settings.fileSync = { [process.platform === 'win32' ? fixture.root.toLowerCase() : fixture.root]: { enabled: true } };
  const client = simpleGit(fixture.root); await client.init();
  await client.addConfig('user.name', 'Fixture'); await client.addConfig('user.email', 'fixture@localhost');
});
afterEach(async () => {
  vi.useRealTimers();
  if (!path.resolve(directory).startsWith(path.join(os.tmpdir(), '.agents', 'webobsidian-sync-git-test-'))) throw new Error('Unsafe fixture');
  await fs.rm(directory, { recursive: true, force: true });
});

describe('Git as backup, not file transport', () => {
  it('preserves both exact versions in branches without switching HEAD or changing the real index', async () => {
    const client = simpleGit(fixture.root);
    await fs.writeFile(path.join(fixture.root, 'note.md'), 'original'); await client.add('.'); await client.commit('fixture initial');
    const head = await client.revparse('HEAD');
    await fs.writeFile(path.join(fixture.root, 'staged.md'), 'unrelated staging'); await client.add('staged.md');
    await fs.writeFile(path.join(fixture.root, 'note.md'), 'dirty worktree');
    const index = await fs.readFile(path.join(fixture.root, '.git/index'));
    const local = path.join(directory, 'local'); const remote = path.join(directory, 'remote');
    await fs.writeFile(local, Buffer.from([0, 255, 128, 1])); await fs.writeFile(remote, Buffer.from([2, 0, 254]));
    const { recordSyncConflict } = await import('./git.js');
    const branches = await recordSyncConflict(fixture.root, { id: randomUUID(), files: [{ path: 'note.md', local, remote }] });
    expect(branches).toHaveLength(2); expect(await client.revparse('HEAD')).toBe(head);
    expect(await fs.readFile(path.join(fixture.root, '.git/index'))).toEqual(index);
    expect(await fs.readFile(path.join(fixture.root, 'note.md'), 'utf8')).toBe('dirty worktree');
    const objects = await Promise.all(branches.map(branch => client.raw(['rev-parse', `${branch}:note.md`])));
    expect(objects[0].trim()).toBe((await client.raw(['hash-object', '--no-filters', local])).trim());
    expect(objects[1].trim()).toBe((await client.raw(['hash-object', '--no-filters', remote])).trim());
  });

  it('supports first-use conflict branches without a HEAD commit', async () => {
    const local = path.join(directory, 'local'); await fs.writeFile(local, 'first local');
    const { recordSyncConflict } = await import('./git.js');
    const branches = await recordSyncConflict(fixture.root, { id: randomUUID(), files: [{ path: 'new.md', local, remote: null }] });
    expect(branches).toHaveLength(2); const client = simpleGit(fixture.root);
    expect(await client.show([`${branches[0]}:new.md`])).toBe('first local');
    expect((await client.raw(['ls-tree', '-r', branches[1]])).trim()).toBe('');
    await expect(client.revparse(['--verify', 'HEAD'])).rejects.toThrow();
  });

  it('never commits on save when native file sync is enabled', async () => {
    vi.useFakeTimers();
    await fs.writeFile(path.join(fixture.root, 'note.md'), 'do not commit each save');
    const { scheduleAutoCommitOnSave } = await import('./git.js'); scheduleAutoCommitOnSave();
    await vi.advanceTimersByTimeAsync(6000);
    vi.useRealTimers();
    await expect(simpleGit(fixture.root).revparse(['--verify', 'HEAD'])).rejects.toThrow();
  });

  it('backs up periodically to a per-device branch without pulling remote work into the Vault', async () => {
    const remote = path.join(directory, 'remote.git'); await fs.mkdir(remote); await simpleGit(remote).init(true);
    fixture.settings.git.remote = remote;
    await simpleGit(fixture.root).addRemote('origin', remote);
    await fs.writeFile(path.join(fixture.root, 'note.md'), 'local backup');
    const git = await import('./git.js');
    expect((await git.sync()).ok).toBe(true);
    const branches = (await simpleGit(remote).raw(['for-each-ref', '--format=%(refname:short)', 'refs/heads'])).trim().split('\n');
    expect(branches).toHaveLength(1); expect(branches[0]).toMatch(/^webobsidian-backups\//);
    await expect(git.pull()).rejects.toThrow('仅用于备份'); await expect(git.clone()).rejects.toThrow('仅用于备份');
    await fs.writeFile(path.join(fixture.root, 'note.md'), 'later backup'); expect((await git.sync()).ok).toBe(true);
    expect(await simpleGit(remote).show([`${branches[0]}:note.md`])).toBe('later backup');
  });
});
