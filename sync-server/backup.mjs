import path from 'node:path';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, stat, link, copyFile, rm, open, rename, readdir } from 'node:fs/promises';

// Connection files carry access tokens; they never enter Git history.
const CREDENTIAL_PATHS = new Set(['.obsidian/webobsidian/sync.jsonc', '.obsidian/webobsidian/git.jsonc']);
const RULE_FILE = /(?:^|\/)\.git(?:ignore|attributes)$/;
const LIST_LIMIT = 50;

const invalid = message => Object.assign(new Error(message), { code: 'invalid_backup_config' });

export function parseBackupOptions(value, dataRoot) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid('Invalid backup configuration');
  const { repository, remote, branch = 'main', intervalSec = 600, authorName = 'WebObsidian Sync', authorEmail = 'sync@localhost' } = value;
  if (typeof repository !== 'string' || !path.isAbsolute(repository)) throw invalid('backup.repository must be an absolute path');
  const repo = path.resolve(repository), data = path.resolve(dataRoot);
  if (repo === data || repo.startsWith(data + path.sep) || data.startsWith(repo + path.sep)) throw invalid('backup.repository must be outside dataDir');
  if (typeof remote !== 'string' || !remote.trim() || /[\r\n]/.test(remote) || /^https?:\/\/[^/]*@/i.test(remote)) throw invalid('backup.remote must be a URL without credentials');
  if (typeof branch !== 'string' || !/^[A-Za-z0-9._/-]{1,200}$/.test(branch) || branch.includes('..') || branch.startsWith('/') || branch.endsWith('/')) throw invalid('Invalid backup.branch');
  if (!Number.isInteger(intervalSec) || intervalSec < 60 || intervalSec > 86400) throw invalid('backup.intervalSec must be 60-86400');
  for (const field of [authorName, authorEmail]) if (typeof field !== 'string' || !field.trim() || /[\r\n<>]/.test(field)) throw invalid('Invalid backup author');
  return { repository: repo, remote: remote.trim(), branch, intervalSec, authorName, authorEmail };
}

function git(repository, args, { input, env, codes = [0] } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('git', ['-C', repository, ...args], {
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never', ...env }, windowsHide: true,
    });
    const out = [], err = [];
    child.stdout.on('data', chunk => out.push(chunk));
    child.stderr.on('data', chunk => err.push(chunk));
    child.on('error', reject);
    child.on('close', code => {
      if (codes.includes(code)) resolve(Buffer.concat(out).toString('utf8'));
      else reject(new Error(`git ${args[0]} failed (${code}): ${Buffer.concat(err).toString('utf8').trim().slice(0, 300)}`));
    });
    child.stdin.on('error', () => {});
    child.stdin.end(input ?? '');
  });
}

const blobOid = bytes => createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
const pointer = (hash, size) => `version https://git-lfs.github.com/spec/v1\noid sha256:${hash}\nsize ${size}\n`;
const nulFields = text => text.split('\0').filter((_, index, all) => index < all.length - 1);

async function exists(file) {
  try { await stat(file); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}

async function lock(gitDir) {
  const file = path.join(gitDir, 'webobsidian-backup.lock');
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const handle = await open(file, 'wx');
      await handle.writeFile(String(process.pid)); await handle.close();
      return () => rm(file, { force: true });
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const pid = Number(await readFile(file, 'utf8').catch(() => ''));
      let alive = true;
      try { process.kill(pid, 0); } catch (probe) { alive = probe.code === 'EPERM'; }
      if (Number.isInteger(pid) && pid > 0 && alive) throw new Error('Another backup run is active');
      await rm(file, { force: true });
    }
  }
  throw new Error('Could not acquire backup lock');
}

async function ensureRepository({ repository, remote }) {
  if (!await exists(path.join(repository, '.git'))) {
    await mkdir(repository, { recursive: true });
    await git(repository, ['init', '-q']);
  }
  // Match the Windows clients that produced the existing history.
  await git(repository, ['config', 'core.ignorecase', 'true']);
  // The existing history was committed with core.autocrlf=true (CRLF text stored as LF).
  await git(repository, ['config', 'core.autocrlf', 'true']);
  await git(repository, ['config', 'core.safecrlf', 'false']);
  // Only current snapshot objects are local; older history objects already live on the remote.
  await git(repository, ['config', 'lfs.allowincompletepush', 'true']);
  const current = (await git(repository, ['remote', 'get-url', 'origin'], { codes: [0, 2] })).trim();
  if (!current) await git(repository, ['remote', 'add', 'origin', remote]);
  else if (current !== remote) await git(repository, ['remote', 'set-url', 'origin', remote]);
}

async function readManifest(dataRoot) {
  for (const [name, pick] of [['state.json', value => value?.manifest], ['manifest.json', value => value]]) {
    try {
      const manifest = pick(JSON.parse(await readFile(path.join(dataRoot, name), 'utf8')));
      if (!manifest || !Number.isSafeInteger(manifest.revision) || !manifest.files || typeof manifest.files !== 'object') throw new Error('Invalid sync manifest');
      return manifest;
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  throw new Error('Sync data has no manifest');
}

/** Place only the snapshot's ignore/attribute files in the work tree so Git applies its own rules. */
async function syncRuleFiles(repository, dataRoot, rules) {
  const wanted = new Set(rules.map(([name]) => name));
  const walk = async (relative) => {
    for (const entry of await readdir(path.join(repository, relative), { withFileTypes: true })) {
      if (!relative && entry.name === '.git') continue;
      const child = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await walk(child);
      else if (!wanted.has(child)) await rm(path.join(repository, child), { force: true });
    }
  };
  await walk('');
  for (const [name, { hash }] of rules) {
    const target = path.join(repository, name);
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(path.join(dataRoot, 'blobs', hash), target);
  }
}

async function linkObject(source, target) {
  if (await exists(target)) return;
  await mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.tmp-${process.pid}`;
  // Sync blobs are immutable, so a hard link avoids duplicating gigabytes.
  try { await link(source, temporary); } catch { await copyFile(source, temporary); }
  await rename(temporary, target);
}

function describe(changes, revision) {
  const groups = { A: [], M: [], D: [] };
  for (const { status, file } of changes) groups[status]?.push(file);
  const total = changes.length;
  const only = changes[0];
  const verb = { A: 'Add', M: 'Update', D: 'Delete' };
  const subject = total === 1 && verb[only.status]
    ? `${verb[only.status]} ${path.posix.basename(only.file).replace(/\.(md|markdown)$/i, '')}`
    : `Backup ${total} files`;
  const section = (title, files) => files.length
    ? `${title}:\n${files.slice(0, LIST_LIMIT).map(file => `- ${file}`).join('\n')}${files.length > LIST_LIMIT ? `\n- … ${files.length - LIST_LIMIT} more` : ''}`
    : '';
  const body = [section('Added', groups.A), section('Modified', groups.M), section('Deleted', groups.D)].filter(Boolean).join('\n\n');
  return `${subject}\n\n${body ? body + '\n\n' : ''}Sync-Revision: ${revision}\n`;
}

/**
 * One backup pass: snapshot the authoritative manifest into a commit on the backup branch
 * and push it without force. Sync data is only read.
 */
export async function runBackup({ dataRoot, options, dryRun = false }) {
  const { repository, branch } = options;
  await ensureRepository(options);
  const gitDir = path.join(repository, '.git');
  const release = await lock(gitDir);
  const index = path.join(gitDir, `webobsidian-backup-${process.pid}.index`);
  const scratch = path.join(gitDir, `webobsidian-backup-${process.pid}`);
  try {
    const cacheFile = path.join(gitDir, 'webobsidian-backup.json');
    const cache = JSON.parse(await readFile(cacheFile, 'utf8').catch(() => '{}'));
    cache.blobs ??= {}; cache.sizes ??= {};
    const manifest = await readManifest(dataRoot);
    const localRef = `refs/heads/${branch}`, remoteRef = `refs/remotes/origin/${branch}`;
    const resolve = ref => git(repository, ['rev-parse', '--verify', '-q', ref], { codes: [0, 1] }).then(value => value.trim() || null);
    let parent = await resolve(localRef);
    if (!parent) {
      // First run continues the existing remote history. ls-remote fails loudly on
      // network/auth errors, so an unreachable remote never yields a new root commit.
      if ((await git(repository, ['ls-remote', '--heads', 'origin', `refs/heads/${branch}`])).trim())
        await git(repository, ['fetch', '-q', '--no-tags', 'origin', `+refs/heads/${branch}:${remoteRef}`]);
      parent = await resolve(remoteRef);
      if (parent && !dryRun) await git(repository, ['update-ref', localRef, parent]);
    }
    const pushed = await resolve(remoteRef);
    if (!dryRun && cache.revision === manifest.revision && parent === pushed) return { status: 'unchanged', revision: manifest.revision, commit: parent };

    const live = Object.entries(manifest.files).filter(([name, entry]) => entry?.hash && !CREDENTIAL_PATHS.has(name)).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
    const rules = live.filter(([name]) => RULE_FILE.test(name));
    await syncRuleFiles(repository, dataRoot, rules);
    const names = live.map(([name]) => name);
    const listed = names.join('\0') + '\0';
    const ignored = rules.some(([name]) => name.endsWith('.gitignore'))
      ? new Set(nulFields(await git(repository, ['check-ignore', '--no-index', '--stdin', '-z'], { input: listed, codes: [0, 1] })))
      : new Set();
    const lfs = new Set();
    if (rules.some(([name]) => name.endsWith('.gitattributes'))) {
      const fields = nulFields(await git(repository, ['check-attr', '--stdin', '-z', 'filter'], { input: listed }));
      for (let at = 0; at + 2 < fields.length; at += 3) if (fields[at + 2] === 'lfs') lfs.add(fields[at]);
    }

    const kept = live.filter(([name]) => !ignored.has(name));
    // Git applies the repository's line-ending normalization (core.autocrlf=true like the
    // clients), so regular-file object IDs come from hash-object rather than raw bytes.
    const uncached = [...new Set(kept.filter(([name, { hash }]) => !lfs.has(name) && !cache.blobs[hash]).map(([, { hash }]) => hash))];
    if (uncached.length) {
      const oids = (await git(repository, ['hash-object', ...(dryRun ? [] : ['-w']), '--stdin-paths'],
        { input: uncached.map(hash => path.join(dataRoot, 'blobs', hash)).join('\n') + '\n' })).trim().split('\n');
      if (oids.length !== uncached.length) throw new Error('Git object hash mismatch');
      uncached.forEach((hash, at) => { cache.blobs[hash] = oids[at]; });
    }
    const entries = [];
    for (const [name, { hash }] of kept) {
      const source = path.join(dataRoot, 'blobs', hash);
      if (lfs.has(name)) {
        cache.sizes[hash] ??= (await stat(source)).size;
        const text = pointer(hash, cache.sizes[hash]);
        entries.push({ name, hash, lfs: true, text, oid: blobOid(Buffer.from(text)) });
      } else entries.push({ name, hash, lfs: false, source, oid: cache.blobs[hash] });
    }

    if (!dryRun) {
      const unique = [...new Map(entries.map(entry => [entry.oid, entry])).values()];
      const checked = (await git(repository, ['cat-file', '--batch-check'], { input: unique.map(entry => entry.oid).join('\n') + '\n' })).split('\n');
      const missing = unique.filter((_, at) => checked[at]?.endsWith(' missing'));
      if (missing.length) {
        await mkdir(scratch, { recursive: true });
        const files = [];
        for (const entry of missing) {
          if (!entry.lfs) { files.push(entry.source); continue; }
          const file = path.join(scratch, entry.hash);
          await writeFile(file, entry.text); files.push(file);
        }
        const written = (await git(repository, ['hash-object', '-w', '--stdin-paths'], { input: files.join('\n') + '\n' })).trim().split('\n');
        if (written.join() !== missing.map(entry => entry.oid).join()) throw new Error('Git object hash mismatch');
      }
      for (const entry of entries) if (entry.lfs) {
        await linkObject(path.join(dataRoot, 'blobs', entry.hash), path.join(gitDir, 'lfs', 'objects', entry.hash.slice(0, 2), entry.hash.slice(2, 4), entry.hash));
      }
    }

    const indexEnv = { GIT_INDEX_FILE: index };
    await rm(index, { force: true });
    await git(repository, ['update-index', '--add', '--index-info'], { env: indexEnv, input: entries.map(entry => `100644 ${entry.oid}\t${entry.name}\n`).join('') });
    const tree = (await git(repository, ['write-tree', ...(dryRun ? ['--missing-ok'] : [])], { env: indexEnv })).trim();
    const parentTree = parent ? (await git(repository, ['rev-parse', `${parent}^{tree}`])).trim() : null;
    const changes = [];
    if (tree !== parentTree) {
      const fields = nulFields(await git(repository, parentTree
        ? ['diff-tree', '-r', '-z', '--name-status', parentTree, tree]
        : ['ls-tree', '-r', '-z', '--name-only', tree]));
      if (parentTree) for (let at = 0; at + 1 < fields.length; at += 2) changes.push({ status: fields[at], file: fields[at + 1] });
      else for (const file of fields) changes.push({ status: 'A', file });
    }
    const summary = { revision: manifest.revision, files: entries.length, lfs: entries.filter(entry => entry.lfs).length,
      excluded: live.length - entries.length, added: changes.filter(c => c.status === 'A').length,
      modified: changes.filter(c => c.status === 'M').length, deleted: changes.filter(c => c.status === 'D').length };
    if (dryRun) return { status: 'dry-run', parent, ...summary, sample: changes.slice(0, LIST_LIMIT) };

    let head = parent;
    if (changes.length) {
      const identity = { GIT_AUTHOR_NAME: options.authorName, GIT_AUTHOR_EMAIL: options.authorEmail,
        GIT_COMMITTER_NAME: options.authorName, GIT_COMMITTER_EMAIL: options.authorEmail };
      head = (await git(repository, ['commit-tree', tree, ...(parent ? ['-p', parent] : []), '-F', '-'], { env: identity, input: describe(changes, manifest.revision) })).trim();
      await git(repository, ['update-ref', localRef, head, parent ?? '0'.repeat(40)]);
    }
    cache.revision = manifest.revision;
    await writeFile(cacheFile, JSON.stringify(cache));
    if (head && head !== pushed) {
      if (entries.some(entry => entry.lfs)) await git(repository, ['lfs', 'push', 'origin', localRef]);
      // Never force: a diverged remote stops here and is resolved by the operator.
      await git(repository, ['push', '-q', '--no-verify', 'origin', `${localRef}:refs/heads/${branch}`]);
    }
    return { status: changes.length ? 'committed' : head !== pushed ? 'pushed' : 'unchanged', commit: head, ...summary };
  } finally {
    await rm(index, { force: true });
    await rm(scratch, { recursive: true, force: true });
    await release();
  }
}

/** Periodic in-process backups; runs never overlap and close() waits for the active one. */
export function startBackupSchedule({ dataRoot, options, log = console }) {
  let active = Promise.resolve(), closed = false;
  const tick = () => {
    active = active.then(async () => {
      if (closed) return;
      try {
        const result = await runBackup({ dataRoot, options });
        if (result.status !== 'unchanged') log.log(`WebObsidian sync backup ${result.status}: revision ${result.revision}`);
      } catch (error) { log.error('WebObsidian sync backup failed:', error.message); }
    });
  };
  const first = setTimeout(tick, 30_000), timer = setInterval(tick, options.intervalSec * 1000);
  first.unref(); timer.unref();
  return { async close() { closed = true; clearTimeout(first); clearInterval(timer); await active; } };
}
