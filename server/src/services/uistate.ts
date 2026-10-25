import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomBytes, createHash } from 'node:crypto';
import { config } from '../config.js';
import { vaultPathKey } from './vaultFile.js';

/**
 * Persisted UI/workspace state (open tabs, active note, expanded folders, panel
 * layout, bookmarks, recents). Stored server-side as a plain JSON file so the
 * workspace is shared across browsers/devices — not tied to one browser's
 * localStorage. Single-user app → one shared state file.
 */

const FILE = path.join(config.dataDir, 'uistate.json');
let workspaceQueue: Promise<unknown> = Promise.resolve();

function ordered<T>(operation: () => Promise<T>): Promise<T> {
  const result = workspaceQueue.catch(() => {}).then(operation);
  workspaceQueue = result;
  return result;
}

async function readState(file: string): Promise<Record<string, unknown>> {
  try {
    const state: unknown = JSON.parse(await fs.readFile(file, 'utf8'));
    if (!state || typeof state !== 'object' || Array.isArray(state)) throw new Error('工作区状态格式无效');
    return state as Record<string, unknown>;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    return {};
  }
}

async function persistState(file: string, json: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp-${randomBytes(8).toString('hex')}`;
  try {
    await fs.writeFile(temporary, json, 'utf8');
    await fs.rename(temporary, file);
  } finally {
    await fs.rm(temporary, { force: true });
  }
}

export function readUiState(): Promise<Record<string, unknown>> {
  return ordered(() => readState(FILE));
}

export function writeUiState(state: Record<string, unknown>): Promise<void> {
  const json = JSON.stringify(state, null, 2);
  return ordered(async () => {
    await readState(FILE);
    await persistState(FILE, json);
  });
}

/** Save the old layout before selecting the next Vault's own workspace. The
 * existing endpoint still owns the active layout; old note paths never migrate
 * into a different Vault after its client reloads. Called under maintenance. */
export function selectVaultWorkspace(previous: string, next: string): Promise<void> {
  const directory = path.join(config.dataDir, 'workspaces');
  const fileFor = (root: string) => {
    return path.join(directory, createHash('sha256').update(vaultPathKey(root)).digest('hex') + '.json');
  };
  return ordered(async () => {
    const current = await readState(FILE);
    const target = await readState(fileFor(next));
    await persistState(fileFor(previous), JSON.stringify(current, null, 2));
    await persistState(FILE, JSON.stringify(target, null, 2));
  });
}
