import { promises as fs } from 'node:fs';
import path from 'node:path';
import { getVaultRoot, readFileSnapshot } from './vault.js';
import { INDEX_FILE } from '../config.js';
import { SEARCH_VERSION } from '@webobsidian/search-core';
import { VaultCatalog, replaceCatalog } from './catalog.js';
import { QmdEngine, replaceSearch } from './search.js';
import { parseNote } from './markdown.js';
import { rebuildGraphFromCatalog } from './links.js';

/** The only full Vault walk. Build off to the side and publish without an await between swaps. */
export async function rebuildVaultIndex(restore = false): Promise<void> {
  const root = await getVaultRoot();
  let next = new VaultCatalog();
  async function walk(dir: string, prefix = '') {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.isSymbolicLink()) continue;
      const rel = prefix + entry.name,
        absolute = path.join(dir, entry.name);
      const stat = await fs.stat(absolute);
      next.putPath(rel, entry.isDirectory(), `${stat.mtimeMs}:${stat.ctimeMs}:${stat.size}`);
      if (entry.isDirectory()) await walk(absolute, rel + '/');
    }
  }
  await walk(root);
  let engine = new QmdEngine(next),
    restored = false;
  if (restore)
    try {
      const saved = JSON.parse(await fs.readFile(INDEX_FILE, 'utf8'));
      if (saved.version === SEARCH_VERSION && saved.root === root) {
        const cached = VaultCatalog.restore(saved.catalog);
        if (
          cached.entries.size === next.entries.size &&
          [...next.stamps].every(([p, s]) => cached.stamps.get(p) === s)
        ) {
          const loaded = new QmdEngine(cached);
          loaded.restoreMini(saved.mini);
          engine = loaded;
          next = cached;
          restored = true;
        }
      }
    } catch {
      /* old, changed or corrupt cache: one complete build */
    }
  if (!restored)
    for (const [rel, entry] of next.entries) {
      if (entry.kind !== 'file' || !/\.(md|markdown)$/i.test(rel)) continue;
      try {
        const snapshot = await readFileSnapshot(rel);
        engine.upsertNote(rel, parseNote(rel, snapshot.content));
      } catch (error) {
        console.warn('[vault index] unreadable note', rel, error);
      }
    }
  engine.finish();
  replaceCatalog(next);
  replaceSearch(engine);
  rebuildGraphFromCatalog();
  await engine.save();
}
