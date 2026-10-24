import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomBytes, createHash } from 'node:crypto';
import { config } from '../config.js';
import { vaultPathKey } from './vault.js';

/**
 * Persisted UI/workspace state (open tabs, active note, expanded folders, panel
 * layout, bookmarks, recents). Stored server-side as a plain JSON file so the
 * workspace is shared across browsers/devices — not tied to one browser's
 * localStorage. Single-user app → one shared state file.
 */

const FILE = path.join(config.dataDir, 'uistate.json');

export async function readUiState(): Promise<Record<string, unknown>> {
  try {
    return JSON.parse(await fs.readFile(FILE, 'utf8'));
  } catch {
    return {};
  }
}

export async function writeUiState(state: Record<string, unknown>): Promise<void> {
  await fs.mkdir(config.dataDir, { recursive: true });
  const tmp = `${FILE}.tmp-${randomBytes(4).toString('hex')}`;
  await fs.writeFile(tmp, JSON.stringify(state, null, 2));
  await fs.rename(tmp, FILE);
}

/** Save the old layout before selecting the next Vault's own workspace. The
 * existing endpoint still owns the active layout; old note paths never migrate
 * into a different Vault after its client reloads. Called under maintenance. */
export async function selectVaultWorkspace(previous: string, next: string): Promise<void> {
  const directory = path.join(config.dataDir, 'workspaces');
  const fileFor = (root: string) => {
    return path.join(directory, createHash('sha256').update(vaultPathKey(root)).digest('hex') + '.json');
  };
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(fileFor(previous), JSON.stringify(await readUiState(), null, 2));
  let target: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(await fs.readFile(fileFor(next), 'utf8'));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) target = parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  await writeUiState(target);
}
