import { promises as fs } from 'node:fs';
import path from 'node:path';
import { getVaultRoot, readFileSnapshot } from './vaultFile.js';
import { INDEX_FILE, runtimeCapabilities } from '../config.js';
import { SEARCH_VERSION } from '@webobsidian/search-core';
import { VaultCatalog, replaceCatalog, CATALOG_SCHEMA_VERSION } from './catalog.js';
import { QmdEngine, qmd, replaceSearch, supportsSearchCache } from './search.js';
import { parseNote } from './markdown.js';
import { rebuildGraphFromCatalog } from './links.js';

const MARKDOWN = /\.(md|markdown)$/i;
/** Serializing the cache blocks the event loop for seconds; keep it off the boot path. */
const SAVE_DELAY_MS = 30_000;

export interface SearchCache {
  root: string;
  engine: QmdEngine;
  /** Starts the full-text index load; called once the restored engine is published. */
  startIndexLoad: () => void;
}

/**
 * Restore the saved catalog; its full-text index loads only after publication.
 * The catalog does not depend on live Vault state, so boot may overlap it with the
 * watcher scan; staleness is resolved per path afterwards. Starting the chunked
 * index load earlier starves the walk's per-entry awaits until the load ends.
 */
export async function loadSearchCache(): Promise<SearchCache | undefined> {
  if (!supportsSearchCache()) return undefined;
  try {
    const [root, raw] = await Promise.all([getVaultRoot(), fs.readFile(INDEX_FILE, 'utf8')]);
    const saved = JSON.parse(raw);
    if (saved.version !== SEARCH_VERSION || saved.catalogSchema !== CATALOG_SCHEMA_VERSION || saved.root !== root)
      return undefined;
    const engine = new QmdEngine(VaultCatalog.restore(saved.catalog));
    let startIndexLoad!: () => void;
    engine.loadMini(saved.mini, new Promise<void>(resolve => { startIndexLoad = resolve; }));
    return { root: saved.root, engine, startIndexLoad };
  } catch {
    return undefined; /* missing or corrupt cache: one complete build */
  }
}

/** Bring a restored engine up to the walked stamps; only changed paths are re-read. */
async function applyChanges(engine: QmdEngine, live: VaultCatalog): Promise<boolean> {
  const cached = engine.catalog;
  let changed = false;
  for (const [rel, entry] of [...cached.entries]) {
    if (live.entries.get(rel)?.kind === entry.kind) continue;
    engine.remove(rel);
    changed = true;
  }
  for (const [rel, stamp] of live.stamps) {
    if (cached.stamps.get(rel) === stamp) continue;
    changed = true;
    const folder = live.entries.get(rel)?.kind === 'folder';
    if (folder || !MARKDOWN.test(rel)) {
      cached.putPath(rel, folder, stamp);
      continue;
    }
    try {
      engine.upsertNote(rel, parseNote(rel, (await readFileSnapshot(rel)).content));
    } catch (error) {
      console.warn('[vault index] unreadable note', rel, error);
      engine.remove(rel);
    }
    cached.putPath(rel, false, stamp);
  }
  return changed;
}

let pendingSave: NodeJS.Timeout | undefined;
let pendingCache: { engine: QmdEngine; root: string } | undefined;
export async function flushSearchCache(): Promise<void> {
  clearTimeout(pendingSave);
  const pending = pendingCache;
  pendingCache = undefined;
  if (pending && qmd === pending.engine) await pending.engine.save(pending.root);
}
function scheduleSave(engine: QmdEngine, root: string) {
  clearTimeout(pendingSave);
  pendingCache = { engine, root };
  pendingSave = setTimeout(() => { void flushSearchCache(); }, SAVE_DELAY_MS);
  pendingSave.unref();
}

/** The only full Vault walk. Build off to the side and publish without an await between swaps. */
export async function rebuildVaultIndex(restore: boolean | Promise<SearchCache | undefined> = false): Promise<void> {
  const cache = restore === true ? loadSearchCache() : restore || undefined;
  const root = await getVaultRoot();
  const next = new VaultCatalog();
  async function walk(dir: string, prefix = '') {
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return [];
      throw error;
    });
    const visible = entries.filter(entry =>
      !entry.name.startsWith('.') && entry.name !== 'node_modules' && !entry.isSymbolicLink());
    // Stat siblings together; insert in directory order, depth-first, as before.
    const stats = await Promise.all(visible.map(entry =>
      fs.stat(path.join(dir, entry.name)).catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return null;
        throw error;
      })));
    for (const [index, entry] of visible.entries()) {
      const stat = stats[index];
      if (!stat) continue;
      const rel = prefix + entry.name;
      next.putPath(rel, entry.isDirectory(), `${stat.mtimeMs}:${stat.ctimeMs}:${stat.size}`);
      if (entry.isDirectory()) await walk(path.join(dir, entry.name), rel + '/');
    }
  }
  await walk(root);
  if (runtimeCapabilities.indexProgress) console.log(`[vault index] scanned ${next.entries.size} paths`);
  const saved = await cache;
  let engine: QmdEngine | undefined,
    changed = true;
  if (saved?.root === root)
    try {
      changed = await applyChanges(saved.engine, next);
      engine = saved.engine;
    } catch (error) {
      console.warn('[vault index] cache update failed; rebuilding', error);
    }
  if (!engine) {
    engine = new QmdEngine(next);
    let indexedNotes = 0;
    for (const [rel, entry] of next.entries) {
      if (entry.kind !== 'file' || !MARKDOWN.test(rel)) continue;
      try {
        const snapshot = await readFileSnapshot(rel);
        engine.upsertNote(rel, parseNote(rel, snapshot.content));
        if (++indexedNotes % 50 === 0 && runtimeCapabilities.indexProgress)
          console.log(`[vault index] parsed ${indexedNotes} notes`);
      } catch (error) {
        console.warn('[vault index] unreadable note', rel, error);
      }
    }
  }
  engine.finish();
  replaceCatalog(engine.catalog);
  replaceSearch(engine);
  rebuildGraphFromCatalog();
  if (engine === saved?.engine) saved.startIndexLoad();
  if (changed) scheduleSave(engine, root);
}
