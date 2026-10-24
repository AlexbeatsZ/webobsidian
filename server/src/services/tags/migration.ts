import { promises as fs } from 'node:fs';
import { resolveInVault } from '../vault.js';
import type { TagPreferences } from '@webobsidian/markdown-core';

/** Called once by the coordinator's per-vault settings migration, never at menus. */
export async function readLegacyTagPreferences(): Promise<TagPreferences> {
  const defaults: TagPreferences = { batchEnabled: true, wranglerEnabled: true, migration: 'Native tag defaults; original plugin data preserved' };
  let data: unknown;
  try {
    data = JSON.parse((await fs.readFile(await resolveInVault('.obsidian/plugins/obsidian-plus/data.json'), 'utf8')).replace(/^\ufeff/, ''));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return defaults;
    throw new Error('Cannot import Obsidian Plus tag settings; original data preserved: ' + String(error));
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Obsidian Plus data.json must be an object');
  const modules = (data as { modules?: unknown }).modules;
  if (modules != null && (typeof modules !== 'object' || Array.isArray(modules))) throw new Error('Invalid Obsidian Plus module flags');
  const flags = (modules ?? {}) as Record<string, unknown>;
  for (const key of ['multiTag', 'tagWrangler']) if (key in flags && typeof flags[key] !== 'boolean')
    throw new Error('Invalid Obsidian Plus flag: ' + key);
  return { batchEnabled: flags.multiTag as boolean | undefined ?? true,
    wranglerEnabled: flags.tagWrangler as boolean | undefined ?? true,
    migration: 'Imported Plus multiTag / tagWrangler flags; original data.json and all other modules preserved' };
}
