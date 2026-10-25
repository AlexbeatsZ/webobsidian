import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const state = vi.hoisted(() => ({ root: '' }));
vi.mock('./settings.js', () => ({ getSettings: async () => ({ vault: { path: state.root }, nativeFeatures: {} }) }));
vi.mock('./git.js', () => ({ scheduleAutoCommitOnSave: vi.fn() }));
vi.mock('./fileupdates.js', () => ({ queueFileUpdate: vi.fn(async () => ({ status: 'indexed' })) }));
import { writePluginData, adapterOperation } from './plugins.js';
import { writeFileBuffer, writeFileText } from './vault.js';
import { readTextFile, writeTextFile } from './textFile.js';
import { scheduleAutoCommitOnSave } from './git.js';

const base = path.join(os.tmpdir(), '.agents');
let finishWrite: (() => void) | undefined;
beforeEach(async () => {
  await fs.mkdir(base, { recursive: true });
  state.root = await fs.mkdtemp(path.join(base, 'physical-vault-writes-'));
});
afterEach(async () => {
  finishWrite?.(); finishWrite = undefined;
  if (path.dirname(state.root) !== base) throw new Error('Refusing fixture cleanup outside .agents');
  await fs.rm(state.root, { recursive: true, force: true });
});

it('serializes plugin data, adapter binary and Vault binary through one atomic path queue', async () => {
  const relative = '.obsidian/plugins/test/data.json', target = path.join(state.root, relative);
  await fs.mkdir(path.dirname(target), { recursive: true }); await fs.writeFile(target, 'original');
  const commits: Buffer[] = [];
  const rename = fs.rename.bind(fs);
  let started!: () => void;
  const pending = new Promise<void>(resolve => { started = resolve; });
  const gate = new Promise<void>(resolve => { finishWrite = resolve; });
  vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
    if (String(to) === target && !commits.length) { started(); await gate; }
    await rename(from, to);
    if (String(to) === target) commits.push(await fs.readFile(target));
  });
  const first = writePluginData('test', { count: 1 });
  await pending;
  const second = adapterOperation('writeBinary', relative, { base64: Buffer.from('adapter complete').toString('base64') });
  const third = writeFileBuffer(relative, Buffer.from('vault complete'));
  await new Promise(resolve => setTimeout(resolve, 25));
  expect(commits).toEqual([]); expect(await fs.readFile(target, 'utf8')).toBe('original');
  finishWrite!(); await Promise.all([first, second, third]);
  expect(commits.map(bytes => bytes.toString())).toEqual([JSON.stringify({ count: 1 }, null, 2), 'adapter complete', 'vault complete']);
  expect(await fs.readdir(path.dirname(target))).toEqual(['data.json']);
  expect(scheduleAutoCommitOnSave).not.toHaveBeenCalled();
});

it('preserves committed bytes on failure, cleans temporary files and does not poison queued writers', async () => {
  const target = path.join(state.root, 'note.md');
  await fs.writeFile(target, 'original');
  const snapshot = await readTextFile(target);
  const rename = fs.rename.bind(fs);
  let failed = false;
  vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
    if (String(to) === target && !failed) { failed = true; throw Object.assign(new Error('fault: rename denied'), { code: 'EACCES' }); }
    return rename(from, to);
  });
  await expect(writeFileBuffer('note.md', Buffer.from('invisible failed bytes'))).rejects.toThrow('fault: rename denied');
  expect(await fs.readFile(target, 'utf8')).toBe('original');
  expect(await fs.readdir(state.root)).toEqual(['note.md']);
  await adapterOperation('write', 'note.md', { content: 'adapter complete' });
  await expect(writeFileText('note.md', 'stale', snapshot.revision)).rejects.toMatchObject({ status: 409 });
  expect(await fs.readFile(target, 'utf8')).toBe('adapter complete');
});

it('exclusive creation exposes only complete bytes and never clobbers an existing file', async () => {
  const target = path.join(state.root, 'exclusive.md');
  const write = fs.writeFile.bind(fs);
  vi.spyOn(fs, 'writeFile').mockImplementation(async (file, bytes, options) => {
    if (String(file).includes('exclusive.md.tmp-')) {
      await write(file, 'partial');
      throw new Error('fault: interrupted temporary write');
    }
    return write(file, bytes, options);
  });
  await expect(writeTextFile(target, 'complete', undefined, true)).rejects.toThrow('interrupted');
  expect(await fs.readdir(state.root)).toEqual([]);
  vi.restoreAllMocks();
  await writeTextFile(target, 'complete', undefined, true);
  await expect(writeTextFile(target, 'replacement', undefined, true)).rejects.toMatchObject({ status: 409 });
  expect(await fs.readFile(target, 'utf8')).toBe('complete');
  expect(await fs.readdir(state.root)).toEqual(['exclusive.md']);
});
