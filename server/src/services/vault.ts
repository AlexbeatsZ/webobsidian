import { promises as fs } from 'node:fs';
import path from 'node:path';
import { queueFileUpdate } from './fileupdates.js';
import { indexedFilesUnder } from './fileindex.js';
import { getSettings } from './settings.js';
import { writeTextFile } from './textFile.js';
import { getVaultRoot, resolveInVault, vaultPathKey, toRel, exists, ignoredVaultNames } from './vaultFile.js';
import { planFolderTags } from '@webobsidian/markdown-core';
import { fileTitleError } from '@webobsidian/search-core';
import { scheduleAutoCommitOnSave } from './git.js';

function assertFileTitle(rel: string): void {
  const error = fileTitleError(rel);
  if (error) throw Object.assign(new Error(error), { status: 400 });
}

export async function ensureVault(): Promise<void> {
  const root = await getVaultRoot();
  await fs.mkdir(root, { recursive: true });
}

/** Same planner for initial writes and reviewed candidates; never writes itself. */
export async function prepareNoteSave(rel: string, content: string): Promise<string> {
  if (!/\.(md|markdown)$/i.test(rel)) return content;
  const settings = await getSettings();
  const root = path.resolve(settings.vault.path), key = process.platform === 'win32' ? root.toLowerCase() : root;
  const rules = settings.nativeFeatures[key]?.tags.folderTags;
  if (rules?.enabled) {
    try { return planFolderTags(content, rel, rules).raw; }
    catch (error) { console.warn('[folder tags] source preserved:', rel, error); }
  }
  return content;
}

export async function writeFileText(rel: string, content: string, baseRevision?: string,
  options: { createOnly?: boolean; prepared?: boolean; waitForIndex?: boolean } = {}): Promise<{ revision: string }> {
  const { createOnly = false, prepared = false, waitForIndex = false } = options;
  const abs = await resolveInVault(rel);
  const creating = createOnly || (baseRevision === undefined && !await exists(rel));
  if (creating) assertFileTitle(rel);
  // New notes have no existing document session. Apply the same native rules
  // before their initial bytes are written; established sessions prepare saves.
  if (!prepared && /\.(md|markdown)$/i.test(rel) && baseRevision === undefined && creating) {
    content = await prepareNoteSave(rel, content);
  }
  const result = await writeTextFile(abs, content, baseRevision, createOnly);
  const indexed = queueFileUpdate(rel, createOnly ? 'add' : 'change');
  if (waitForIndex) await indexed;
  scheduleAutoCommitOnSave();
  return result;
}

export async function writeFileBuffer(rel: string, buf: Buffer): Promise<void> {
  const abs = await resolveInVault(rel);
  if (!await exists(rel)) assertFileTitle(rel);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, buf);
  void queueFileUpdate(rel);
}

export async function createFolder(rel: string): Promise<void> {
  const abs = await resolveInVault(rel);
  await fs.mkdir(abs, { recursive: true });
  void queueFileUpdate(rel, 'addDir');
}

export async function rename(from: string, to: string): Promise<void> {
  const absFrom = await resolveInVault(from);
  const absTo = await resolveInVault(to);
  if (vaultPathKey(absFrom) !== vaultPathKey(absTo) && await pathExists(absTo))
    throw Object.assign(new Error('目标路径已存在，请选择其他名称'), { status: 409 });
  if ((await fs.stat(absFrom)).isFile() && path.basename(from) !== path.basename(to)) assertFileTitle(to);
  await fs.mkdir(path.dirname(absTo), { recursive: true });
  const children = indexedFilesUnder(from);
  await fs.rename(absFrom, absTo);
  for (const child of new Set([from, ...children])) {
    void queueFileUpdate(child, 'unlink');
    void queueFileUpdate(to + child.slice(from.length), 'add');
  }
  scheduleAutoCommitOnSave();
}

/**
 * Recursively copy a file or folder to a new location. Returns the vault-relative
 * paths of every file created (so callers can reindex them). Throws if `to` exists.
 */
export async function copy(from: string, to: string): Promise<string[]> {
  const absFrom = await resolveInVault(from);
  const absTo = await resolveInVault(to);
  if ((await fs.stat(absFrom)).isFile()) assertFileTitle(to);
  await fs.mkdir(path.dirname(absTo), { recursive: true });
  await fs.cp(absFrom, absTo, { recursive: true, errorOnExist: true, force: false });
  const root = await getVaultRoot();
  const out: string[] = [];
  const st = await fs.stat(absTo);
  if (st.isDirectory()) {
    async function walk(dir: string) {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const e of entries) {
        if (ignoredVaultNames.has(e.name)) continue;
        const abs = path.join(dir, e.name);
        if (e.isDirectory()) await walk(abs);
        else if (e.isFile()) out.push(toRel(root, abs));
      }
    }
    await walk(absTo);
  } else {
    out.push(toRel(root, absTo));
  }
  for (const file of out) void queueFileUpdate(file, 'add');
  void queueFileUpdate(to, 'add');
  scheduleAutoCommitOnSave();
  return out;
}

/** Permanently delete a file or folder (no trash). */
export async function remove(rel: string): Promise<void> {
  const abs = await resolveInVault(rel);
  const children = indexedFilesUnder(rel);
  await fs.rm(abs, { recursive: true, force: true });
  for (const child of new Set([rel, ...children])) void queueFileUpdate(child, 'unlink');
  scheduleAutoCommitOnSave();
}

/** Move a path into the vault trash folder, preserving relative layout. */
export async function trash(rel: string): Promise<string> {
  const s = await getSettings();
  const root = await getVaultRoot();
  const absFrom = await resolveInVault(rel);
  const trashRoot = path.join(root, s.vault.trash);
  const dest = path.join(trashRoot, rel);
  await fs.mkdir(path.dirname(dest), { recursive: true });
  // avoid collision
  let finalDest = dest;
  if (await pathExists(finalDest)) {
    const ext = path.extname(dest);
    finalDest = `${dest.slice(0, dest.length - ext.length)}.${Date.now()}${ext}`;
  }
  const children = indexedFilesUnder(rel);
  await fs.rename(absFrom, finalDest);
  for (const child of new Set([rel, ...children])) void queueFileUpdate(child, 'unlink');
  scheduleAutoCommitOnSave();
  return toRel(root, finalDest);
}

async function pathExists(abs: string): Promise<boolean> {
  try {
    await fs.access(abs);
    return true;
  } catch {
    return false;
  }
}

/** ---- Trash (FR-1) -------------------------------------------------------- */

export interface TrashItem {
  name: string; // basename
  path: string; // vault-relative, including the trash prefix, e.g. ".trash/folder/note.md"
  original: string; // where it restores to, e.g. "folder/note.md"
  ext: string;
  size: number;
  mtime: number; // deletion time (file mtime when it landed in trash)
}

async function getTrashRoot(): Promise<string> {
  const s = await getSettings();
  const root = await getVaultRoot();
  return path.join(root, s.vault.trash);
}

/** Confirm `abs` lives inside the trash folder; return its trash-relative path. */
function assertInTrash(abs: string, trashRoot: string): string {
  const rel = path.relative(trashRoot, abs);
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) {
    throw Object.assign(new Error('Not a trash item'), { status: 400 });
  }
  return rel;
}

/** Remove now-empty directories upward from `dir`, stopping at (and keeping) `stopAt`. */
async function pruneEmptyDirs(dir: string, stopAt: string): Promise<void> {
  let cur = path.resolve(dir);
  const root = path.resolve(stopAt);
  while (cur !== root && cur.startsWith(root + path.sep)) {
    try {
      const remaining = await fs.readdir(cur);
      if (remaining.length > 0) break;
      await fs.rmdir(cur);
    } catch {
      break;
    }
    cur = path.dirname(cur);
  }
}

/** List every file currently in the trash, newest deletion first. */
export async function listTrash(): Promise<TrashItem[]> {
  const root = await getVaultRoot();
  const trashRoot = await getTrashRoot();
  const out: TrashItem[] = [];
  async function walk(dir: string) {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return; // trash folder doesn't exist yet
    }
    for (const e of entries) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) {
        await walk(abs);
      } else if (e.isFile()) {
        const st = await fs.stat(abs).catch(() => null);
        out.push({
          name: e.name,
          path: toRel(root, abs),
          original: path.relative(trashRoot, abs).split(path.sep).join('/'),
          ext: path.extname(e.name).toLowerCase(),
          size: st?.size ?? 0,
          mtime: st ? st.mtimeMs : 0,
        });
      }
    }
  }
  await walk(trashRoot);
  out.sort((a, b) => b.mtime - a.mtime);
  return out;
}

/** Move a trashed item back to its original location. Returns the restored rel path. */
export async function restoreFromTrash(trashRel: string): Promise<string> {
  const trashRoot = await getTrashRoot();
  const absFrom = await resolveInVault(trashRel);
  const relInTrash = assertInTrash(absFrom, trashRoot);
  let destRel = relInTrash.split(path.sep).join('/');
  let absTo = await resolveInVault(destRel);
  // Don't clobber a file that was recreated at the same path after deletion.
  if (await pathExists(absTo)) {
    const ext = path.extname(destRel);
    destRel = `${destRel.slice(0, destRel.length - ext.length)}.restored-${Date.now()}${ext}`;
    absTo = await resolveInVault(destRel);
  }
  await fs.mkdir(path.dirname(absTo), { recursive: true });
  await fs.rename(absFrom, absTo);
  void queueFileUpdate(destRel, 'add');
  await pruneEmptyDirs(path.dirname(absFrom), trashRoot);
  scheduleAutoCommitOnSave();
  return destRel;
}

/** Permanently delete a single trashed item. */
export async function deleteFromTrash(trashRel: string): Promise<void> {
  const trashRoot = await getTrashRoot();
  const abs = await resolveInVault(trashRel);
  assertInTrash(abs, trashRoot);
  await fs.rm(abs, { recursive: true, force: true });
  await pruneEmptyDirs(path.dirname(abs), trashRoot);
}

/** Permanently delete everything in the trash. */
export async function emptyTrash(): Promise<void> {
  const trashRoot = await getTrashRoot();
  let entries;
  try {
    entries = await fs.readdir(trashRoot);
  } catch {
    return; // nothing to empty
  }
  for (const name of entries) {
    await fs.rm(path.join(trashRoot, name), { recursive: true, force: true });
  }
}
