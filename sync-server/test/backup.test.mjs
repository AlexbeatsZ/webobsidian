import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, writeFile, readFile, access } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { fixture, operation, commit, digest, token } from './fixtures.mjs';
import { parseBackupOptions, runBackup } from '../backup.mjs';

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } }).trim();
const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 1, 2, 3]);
const attributes = '*.png filter=lfs diff=lfs merge=lfs -text\n';
const ignore = 'Thumbs.db\n.obsidian/*\n!.obsidian/webobsidian/\n';

/** Apply {path: bytes|null} to the hub through the real blob/commit protocol. */
async function apply(hub, files) {
  const manifest = await (await hub.request('manifest')).json();
  const changes = [];
  for (const [name, value] of Object.entries(files)) {
    const hash = value === null ? null : digest(value);
    if (value !== null) assert.equal((await hub.request('blobs/' + hash, { method: 'PUT', body: value })).status, 200);
    changes.push({ path: name, hash, expectedVersion: manifest.files[name]?.version ?? 0 });
  }
  assert.equal((await commit(hub, operation(manifest.workspaceId, changes))).status, 200);
}

async function setup(t) {
  const data = await fixture(t);
  const hub = await data.start();
  const remote = path.join(data.directory, 'remote.git');
  git(data.directory, 'init', '-q', '--bare', remote);
  const options = parseBackupOptions({ repository: path.join(data.directory, 'backup'), remote: pathToFileURL(remote).href,
    authorName: 'Fixture Backup', authorEmail: 'backup@localhost', intervalSec: 60 }, hub.root);
  return { data, hub, remote, options };
}

/** A Windows client repository produced with real git-lfs, like the existing Vault history. */
function clientHistory(directory, remote, files) {
  const client = path.join(directory, 'client');
  git(directory, 'init', '-q', client);
  for (const [key, value] of [['user.name', 'Client'], ['user.email', 'client@localhost'], ['core.autocrlf', 'true']]) git(client, 'config', key, value);
  git(client, 'lfs', 'install', '--local');
  for (const [name, value] of Object.entries(files)) {
    execFileSync(process.platform === 'win32' ? 'cmd' : 'mkdir', process.platform === 'win32' ? ['/c', 'if', 'not', 'exist', path.dirname(path.join(client, name)), 'mkdir', path.dirname(path.join(client, name))] : ['-p', path.dirname(path.join(client, name))]);
    execFileSync(process.execPath, ['-e', 'require("fs").writeFileSync(process.argv[1], Buffer.from(process.argv[2], "base64"))', path.join(client, name), value.toString('base64')]);
  }
  git(client, 'add', '.'); git(client, 'commit', '-q', '-m', 'client backup');
  git(client, 'push', '-q', pathToFileURL(remote).href, 'HEAD:refs/heads/main');
  return git(client, 'rev-parse', 'HEAD');
}

test('continues client history byte-for-byte, then commits and pushes later revisions with LFS', async t => {
  const { data, hub, remote, options } = await setup(t);
  const notes = { '.gitattributes': Buffer.from(attributes), '.gitignore': Buffer.from(ignore),
    '笔记/化学 动力学.md': Buffer.from('# 动力学\n'), 'img/p.png': png, '.obsidian/webobsidian/math.jsonc': Buffer.from('{}\n'),
    // Windows clients commit CRLF text as LF (core.autocrlf=true); the server stores raw CRLF bytes.
    'img/c.svg': Buffer.from('<svg>\r\n</svg>\r\n') };
  const head = clientHistory(data.directory, remote, notes);
  await apply(hub, { ...notes, 'Thumbs.db': Buffer.from('device'),
    '.obsidian/webobsidian/sync.jsonc': Buffer.from('{"token":"fixture-secret-token-should-never-be-committed"}') });

  // Identical content to the git-lfs produced tree: no new commit, nothing pushed.
  const first = await runBackup({ dataRoot: hub.root, options });
  assert.deepEqual([first.status, first.commit, first.files, first.lfs, first.excluded], ['unchanged', head, 6, 1, 1]);
  assert.equal(git(remote, 'rev-parse', 'main'), head);
  assert.equal((await runBackup({ dataRoot: hub.root, options })).status, 'unchanged');

  const larger = Buffer.concat([png, Buffer.from('second image')]);
  await apply(hub, { '笔记/化学 动力学.md': Buffer.from('# 动力学\n\n速率方程\n'), 'img/q.png': larger, 'img/p.png': null });
  const second = await runBackup({ dataRoot: hub.root, options });
  assert.equal(second.status, 'committed');
  assert.deepEqual([second.added, second.modified, second.deleted], [1, 1, 1]);
  assert.equal(git(remote, 'rev-parse', 'main'), second.commit);
  assert.equal(git(remote, 'rev-parse', 'main^'), head);
  assert.match(git(remote, 'log', '-1', '--format=%B', 'main'), /Sync-Revision: \d+/);
  assert.equal(git(remote, 'log', '-1', '--format=%an <%ae>', 'main'), 'Fixture Backup <backup@localhost>');

  const clone = path.join(data.directory, 'restore');
  git(data.directory, '-c', 'core.autocrlf=false', 'clone', '-q', '-b', 'main', pathToFileURL(remote).href, clone);
  assert.deepEqual(await readFile(path.join(clone, 'img/q.png')), larger);
  assert.equal(await readFile(path.join(clone, '笔记/化学 动力学.md'), 'utf8'), '# 动力学\n\n速率方程\n');
  for (const excluded of ['Thumbs.db', '.obsidian/webobsidian/sync.jsonc', 'img/p.png']) await assert.rejects(access(path.join(clone, excluded)));
  assert.equal(git(clone, 'log', '--all', '-S', 'fixture-secret-token', '--format=%H'), '');

  assert.equal((await runBackup({ dataRoot: hub.root, options })).status, 'unchanged');
});

test('never forces over a remote that another writer advanced', async t => {
  const { data, hub, remote, options } = await setup(t);
  await apply(hub, { 'a.md': Buffer.from('a') });
  assert.equal((await runBackup({ dataRoot: hub.root, options })).status, 'committed');
  const other = path.join(data.directory, 'other');
  git(data.directory, 'clone', '-q', '-b', 'main', pathToFileURL(remote).href, other);
  git(other, 'config', 'user.name', 'Other'); git(other, 'config', 'user.email', 'other@localhost');
  await writeFile(path.join(other, 'b.md'), 'other device'); git(other, 'add', '.'); git(other, 'commit', '-q', '-m', 'other');
  git(other, 'push', '-q', 'origin', 'HEAD:main');
  const advanced = git(remote, 'rev-parse', 'main');
  await apply(hub, { 'a.md': Buffer.from('changed') });
  await assert.rejects(runBackup({ dataRoot: hub.root, options }), /git push failed/);
  assert.equal(git(remote, 'rev-parse', 'main'), advanced);
  // The lock was released, so a later run can retry.
  await assert.rejects(runBackup({ dataRoot: hub.root, options }), /git push failed/);
});

test('dry run reports the first backup without creating a branch', async t => {
  const { hub, remote, options } = await setup(t);
  await apply(hub, { 'a.md': Buffer.from('a'), 'b.md': Buffer.from('b') });
  const result = await runBackup({ dataRoot: hub.root, options, dryRun: true });
  assert.deepEqual([result.status, result.parent, result.added, result.files], ['dry-run', null, 2, 2]);
  assert.equal(git(options.repository, 'for-each-ref', 'refs/heads'), '');
  assert.equal(git(remote, 'for-each-ref'), '');
});

test('backup configuration rejects embedded credentials and data-root repositories', async t => {
  const data = await fixture(t); const root = path.join(data.directory, 'data');
  const base = { repository: path.join(data.directory, 'repo'), remote: 'https://github.com/o/r.git' };
  assert.equal(parseBackupOptions(base, root).branch, 'main');
  assert.equal(parseBackupOptions({ ...base, remote: 'git@github.com:o/r.git' }, root).remote, 'git@github.com:o/r.git');
  for (const bad of [{ ...base, remote: 'https://user:token@github.com/o/r.git' }, { ...base, repository: path.join(root, 'repo') },
    { ...base, repository: 'relative' }, { ...base, branch: '../main' }, { ...base, intervalSec: 5 }, { ...base, remote: 'HTTPS://t@github.com/o/r.git' }])
    assert.throws(() => parseBackupOptions(bad, root), { code: 'invalid_backup_config' });
  await mkdir(root, { recursive: true });
});

test('CLI runs a dry-run backup and the server stops its backup schedule on close', async t => {
  const { data, hub, options } = await setup(t);
  await apply(hub, { 'a.md': Buffer.from('a') });
  await hub.close();
  const config = path.join(data.directory, 'server.json');
  await writeFile(config, JSON.stringify({ dataDir: hub.root, token, host: '127.0.0.1', port: 0,
    backup: { repository: options.repository, remote: options.remote, intervalSec: 60 } }));
  const { runCli } = await import('../cli.mjs'); const { createSyncServer } = await import('../server.mjs');
  const result = await runCli(createSyncServer, ['--backup-dry-run', config]);
  assert.deepEqual([result.status, result.added], ['dry-run', 1]);
  const service = await runCli(createSyncServer, [config]);
  await service.close();
  await assert.rejects(access(path.join(hub.root, 'server.lock')));
});
