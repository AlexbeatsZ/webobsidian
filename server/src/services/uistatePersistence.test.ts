import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';

const fixture = vi.hoisted(() => ({ directory: '' }));
vi.mock('../config.js', () => ({ config: { get dataDir() { return fixture.directory; } } }));
vi.mock('./vaultFile.js', () => ({ vaultPathKey: (root: string) => root }));

let state: typeof import('./uistate');
let file: string;

beforeEach(async () => {
  vi.resetModules();
  const temporary = path.join(os.tmpdir(), '.agents');
  await fs.mkdir(temporary, { recursive: true });
  fixture.directory = await fs.mkdtemp(path.join(temporary, 'architecture-persistence-'));
  file = path.join(fixture.directory, 'uistate.json');
  state = await import('./uistate');
});

afterEach(async () => {
  vi.restoreAllMocks();
  const intended = path.join(os.tmpdir(), '.agents', 'architecture-persistence-');
  if (!path.resolve(fixture.directory).startsWith(intended)) throw new Error('Unexpected test directory');
  await fs.rm(fixture.directory, { recursive: true, force: true });
});

describe('durable workspace snapshots', () => {
  it('initializes only a missing workspace and commits a complete snapshot', async () => {
    expect(await state.readUiState()).toEqual({});
    await state.writeUiState({ tabs: ['first.md'] });
    expect(JSON.parse(await fs.readFile(file, 'utf8'))).toEqual({ tabs: ['first.md'] });
  });

  it.each(['{ broken', '[]', 'null', 'false'])('preserves invalid existing bytes %s on both read and write', async source => {
    await fs.writeFile(file, source);
    await expect(state.readUiState()).rejects.toThrow();
    await expect(state.writeUiState({ tabs: [] })).rejects.toThrow();
    expect(await fs.readFile(file, 'utf8')).toBe(source);
  });

  it('preserves permission failures instead of persisting defaults', async () => {
    await fs.writeFile(file, '{"tabs":["protected.md"]}');
    const denied = Object.assign(new Error('Permission denied'), { code: 'EACCES' });
    const read = vi.spyOn(fs, 'readFile').mockRejectedValue(denied);
    await expect(state.readUiState()).rejects.toMatchObject({ code: 'EACCES' });
    await expect(state.writeUiState({ tabs: [] })).rejects.toMatchObject({ code: 'EACCES' });
    read.mockRestore();
    expect(await fs.readFile(file, 'utf8')).toBe('{"tabs":["protected.md"]}');
  });

  it('orders accepted writes and reads even when the first rename is slow', async () => {
    let release!: () => void;
    let entered!: () => void;
    const blocked = new Promise<void>(resolve => { release = resolve; });
    const started = new Promise<void>(resolve => { entered = resolve; });
    const rename = fs.rename.bind(fs);
    let first = true;
    vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
      if (first) { first = false; entered(); await blocked; }
      return rename(from, to);
    });
    const earlier = state.writeUiState({ client: 'earlier' });
    await started;
    const later = state.writeUiState({ client: 'later' });
    let readFinished = false;
    const read = state.readUiState().then(value => { readFinished = true; return value; });
    await Promise.resolve();
    expect(readFinished).toBe(false);
    release();
    await Promise.all([earlier, later]);
    expect(await read).toEqual({ client: 'later' });
  });

  it('retains the old snapshot after failed rename and accepts a later retry', async () => {
    await state.writeUiState({ tabs: ['old.md'] });
    const rename = vi.spyOn(fs, 'rename').mockRejectedValueOnce(new Error('disk busy'));
    await expect(state.writeUiState({ tabs: ['new.md'] })).rejects.toThrow('disk busy');
    expect(await state.readUiState()).toEqual({ tabs: ['old.md'] });
    expect((await fs.readdir(fixture.directory)).filter(name => name.includes('.tmp-'))).toEqual([]);
    rename.mockRestore();
    await state.writeUiState({ tabs: ['new.md'] });
    expect(await state.readUiState()).toEqual({ tabs: ['new.md'] });
  });

  it('captures caller snapshots before another accepted request mutates the object', async () => {
    const snapshot = { tabs: ['first.md'] };
    const saving = state.writeUiState(snapshot);
    snapshot.tabs.push('later.md');
    await saving;
    expect(await state.readUiState()).toEqual({ tabs: ['first.md'] });
  });

  it('archives after earlier writes and orders writes into the newly selected workspace', async () => {
    const earlier = state.writeUiState({ tabs: ['old-vault.md'] });
    const selection = state.selectVaultWorkspace('old', 'new');
    const later = state.writeUiState({ tabs: ['new-vault.md'] });
    await Promise.all([earlier, selection, later]);
    const archive = path.join(fixture.directory, 'workspaces', createHash('sha256').update('old').digest('hex') + '.json');
    expect(JSON.parse(await fs.readFile(archive, 'utf8'))).toEqual({ tabs: ['old-vault.md'] });
    expect(await state.readUiState()).toEqual({ tabs: ['new-vault.md'] });
  });

  it('does not replace the active snapshot when the selected archive is corrupt', async () => {
    await state.writeUiState({ tabs: ['safe.md'] });
    const directory = path.join(fixture.directory, 'workspaces');
    await fs.mkdir(directory);
    const corrupt = path.join(directory, createHash('sha256').update('bad').digest('hex') + '.json');
    await fs.writeFile(corrupt, 'broken');
    await expect(state.selectVaultWorkspace('old', 'bad')).rejects.toThrow();
    expect(await state.readUiState()).toEqual({ tabs: ['safe.md'] });
    expect(await fs.readFile(corrupt, 'utf8')).toBe('broken');
  });
});
