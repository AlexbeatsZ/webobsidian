import { promises as fs } from 'node:fs';
import path from 'node:path';
import { resolveInVault, readFileSnapshot, invalidateStat } from './vaultFile.js';
import { parseNote } from './markdown.js';
import { qmd } from './search.js';
import { updateLinkGraphFromNote } from './links.js';
import { hasIndexedFile, indexFile, unindexFile } from './fileindex.js';
import { catalog } from './catalog.js';
import { broadcast, notifyIndexChanged } from './realtime.js';
import { noteVaultMutation } from './vaultMaintenance.js';

type Event = 'add' | 'change' | 'unlink' | 'addDir' | 'unlinkDir';
type Seen = { revision?: string; stamp: string; directory: boolean };
import type { FileUpdateResult } from '../contracts.js';
export type { FileUpdateResult } from '../contracts.js';
const seen = new Map<string, Seen>();
const queues = new Map<
  string,
  { generation: number; drained: number; event: Event; promise: Promise<FileUpdateResult> }
>();
let enabled = false;
let active = 0;
const waiters: (() => void)[] = [];
let rebuilds: Promise<void> = Promise.resolve();
async function acquire() {
  if (active < 4) {
    active++;
    return;
  }
  await new Promise<void>((resolve) => waiters.push(resolve));
}
function release() {
  const next = waiters.shift();
  if (next) next();
  else active--;
}
/** Library imports/tests do not start background vault work. Enable after boot indexes. */
export function enableFileUpdates() {
  enabled = true;
}

/** Reserve every worker while explicit full rebuilds replace index structures. */
export function rebuildFileIndexes(work: () => Promise<void>): Promise<void> {
  noteVaultMutation();
  const job = rebuilds.then(async () => {
    for (let i = 0; i < 4; i++) await acquire();
    try {
      await work();
    } finally {
      seen.clear();
      for (let i = 0; i < 4; i++) release();
    }
  });
  rebuilds = job.catch(() => {});
  return job;
}

/** Maintenance waits for the existing drains without reserving their workers. */
export async function drainFileUpdates(): Promise<void> {
  await rebuilds;
  while (queues.size) await Promise.allSettled([...queues.values()].map(state => state.promise));
}

async function update(relative: string, event: Event) {
  const absolute = await resolveInVault(relative);
  const stat = await fs.stat(absolute).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return null;
    throw error;
  });
  const prior = seen.get(relative);
  const known = hasIndexedFile(relative);
  if (!stat) {
    if (prior?.stamp === 'missing' && !known) return;
    const directory = prior?.directory ?? event === 'unlinkDir';
    unindexFile(relative);
    if (/\.(md|markdown)$/i.test(relative)) {
      qmd.remove(relative);
      updateLinkGraphFromNote(relative, undefined, true);
    }
    invalidateStat(relative);
    seen.set(relative, { stamp: 'missing', directory });
    notifyIndexChanged();
    broadcast({ type: 'fs', event: directory ? 'unlinkDir' : 'unlink', path: relative, indexed: true });
    return;
  }
  const directory = stat.isDirectory();
  if (!directory && !stat.isFile()) return;
  if (directory && known) {
    unindexFile(relative);
    if (/\.(md|markdown)$/i.test(relative)) {
      qmd.remove(relative);
      updateLinkGraphFromNote(relative, undefined, true);
    }
  }
  const stamp = `${stat.mtimeMs}:${stat.ctimeMs}:${stat.size}`;
  let revision: string | undefined;
  const markdown = !directory && /\.(md|markdown)$/i.test(relative);
  if (markdown) {
    // Reuse the existing concurrency revision, not a second integrity hash/read.
    const snapshot = await readFileSnapshot(relative);
    revision = snapshot.revision;
    if (prior?.revision !== revision) {
      const note = parseNote(relative, snapshot.content);
      qmd.upsertNote(relative, note);
      updateLinkGraphFromNote(relative, note);
    }
  }
  const structural = directory ? !prior || prior.stamp === 'missing' || !prior.directory : !known;
  catalog.putPath(relative, directory, stamp);
  if (!structural && prior?.stamp === stamp && prior.revision === revision) return;
  invalidateStat(relative);
  seen.set(relative, { stamp, revision, directory });
  if (structural || (markdown && prior?.revision !== revision)) notifyIndexChanged();
  broadcast({
    type: 'fs',
    event: directory ? 'addDir' : structural ? 'add' : 'change',
    path: relative,
    indexed: true,
    ...(!directory
      ? { stat: { mtime: stat.mtimeMs, ctime: stat.birthtimeMs || stat.mtimeMs, size: stat.size } }
      : {}),
  });
}

/** Routes and watcher share one latest-state drain per canonical path. */
export function queueFileUpdate(relative: string, event: Event = 'change'): Promise<FileUpdateResult> {
  noteVaultMutation();
  relative = path.posix.normalize(relative.replace(/\\/g, '/')).replace(/^\/+/, '');
  if (
    !enabled ||
    relative === '.' ||
    relative.split('/').some((part) => part.startsWith('.') || part === 'node_modules')
  )
    return Promise.resolve({ status: 'skipped', path: relative, reason: enabled ? 'ignored' : 'disabled' });
  const current = queues.get(relative);
  if (current) {
    current.generation++;
    current.event = event;
    return current.promise;
  }
  const state = { generation: 0, drained: -1, event, promise: Promise.resolve<FileUpdateResult>({ status: 'indexed', path: relative }) };
  queues.set(relative, state);
  state.promise = Promise.resolve()
    .then(async () => {
      await acquire();
      let result: FileUpdateResult = { status: 'indexed', path: relative };
      try {
        let generation: number;
        do {
          generation = state.generation;
          try {
            await update(relative, state.event);
            result = { status: 'indexed', path: relative };
          } catch (error) {
            console.error('[file index]', relative, error);
            result = { status: 'failed', path: relative, error: error instanceof Error ? error.message : String(error) };
            try { broadcast({ type: 'index-error', path: relative, error: result.error, indexed: false }); }
            catch (notificationError) { console.error('[file index notification]', relative, notificationError); }
          }
          state.drained = generation;
        } while (generation !== state.generation);
        return result;
      } finally {
        release();
      }
    })
    .then(result => {
      if (queues.get(relative) === state) queues.delete(relative);
      // An event can arrive between the last drain check and this final microtask.
      if (state.drained !== state.generation) return queueFileUpdate(relative, state.event);
      return result;
    });
  return state.promise;
}
