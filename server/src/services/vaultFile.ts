import { promises as fs } from 'node:fs';
import path from 'node:path';
import { getSettings } from './settings.js';
import { readTextFile } from './textFile.js';
import type { TreeNode } from '../contracts.js';
export type { TreeNode } from '../contracts.js';

/**
 * In-memory mtime/ctime cache so sort-by-time costs ONE stat per file total,
 * not 27k stats on every tree fetch (the tree is refetched on each fs event).
 * Filled lazily during listTree(); the file watcher invalidates changed paths
 * (see invalidateStat), so steady-state tree fetches do zero extra syscalls.
 */
const statCache = new Map<string, { m: number; c: number; size: number }>();

export function invalidateStat(rel: string): void {
  statCache.delete(rel);
}
export function clearVaultStats(): void { statCache.clear(); }

async function fileStat(abs: string, rel: string): Promise<{ m: number; c: number; size: number }> {
  const hit = statCache.get(rel);
  if (hit) return hit;
  let v = { m: 0, c: 0, size: 0 };
  try {
    const st = await fs.stat(abs);
    // birthtime can be 0 on some Linux filesystems → fall back to mtime.
    v = { m: st.mtimeMs, c: st.birthtimeMs || st.mtimeMs, size: st.size };
  } catch { /* file vanished mid-walk — leave zeros */ }
  statCache.set(rel, v);
  return v;
}

const TEXT_EXTS = new Set([
  '.md', '.markdown', '.txt', '.json', '.csv', '.canvas', '.css', '.js', '.yml', '.yaml',
]);

export const ignoredVaultNames: ReadonlySet<string> = new Set(['.git', 'node_modules']);

export async function getVaultRoot(): Promise<string> {
  const s = await getSettings();
  return path.resolve(s.vault.path);
}

/** One logical Vault identity; persisted encodings remain owned by their callers. */
export function vaultPathKey(root: string): string {
  const resolved = path.resolve(root);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

/** Resolve a vault-relative path to an absolute one, refusing traversal. */
export async function resolveInVault(relPath: string): Promise<string> {
  const root = await getVaultRoot();
  return resolveVaultPath(root, relPath);
}

export async function resolveVaultPath(root: string, relPath: string, rejectLinks = false): Promise<string> {
  const clean = relPath.replace(/^[/\\]+/, '');
  const abs = path.resolve(root, clean);
  const rootWithSep = root.endsWith(path.sep) ? root : root + path.sep;
  if (abs !== root && !abs.startsWith(rootWithSep)) {
    throw Object.assign(new Error('Path escapes vault'), { status: 400 });
  }
  // Never resolve into the vault's own git metadata: an authenticated write to
  // e.g. .git/hooks/post-merge would execute on the next git sync.
  if (path.relative(root, abs).split(path.sep).includes('.git')) {
    throw Object.assign(new Error('Path not allowed'), { status: 400 });
  }
  // Symlink guard: a symlink *inside* the vault could point outside it, which the
  // string-prefix check above can't catch. Resolve the real path of the deepest
  // existing ancestor and confirm it still lives under the vault root.
  await assertRealpathInVault(abs, root);
  if (rejectLinks) {
    let probe = root;
    for (const segment of path.relative(root, abs).split(path.sep).filter(Boolean)) {
      probe = path.join(probe, segment);
      const info = await fs.lstat(probe).catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return null; throw error; });
      if (!info) break;
      if (info.isSymbolicLink()) throw new Error('同步不支持符号链接或联接目录');
    }
  }
  return abs;
}

async function assertRealpathInVault(abs: string, root: string): Promise<void> {
  const realRoot = await fs.realpath(root).catch(() => root);
  const realRootSep = realRoot.endsWith(path.sep) ? realRoot : realRoot + path.sep;
  let probe = abs;
  for (;;) {
    try {
      const real = await fs.realpath(probe);
      if (real !== realRoot && !real.startsWith(realRootSep)) {
        throw Object.assign(new Error('Path escapes vault'), { status: 400 });
      }
      return; // deepest existing ancestor is inside the vault; the rest is new
    } catch (e: any) {
      if (e?.status === 400) throw e; // our own escape error — propagate
      const parent = path.dirname(probe);
      if (parent === probe) return; // reached fs root without resolving — nothing to verify
      probe = parent;
    }
  }
}

export function toRel(root: string, abs: string): string {
  return path.relative(root, abs).split(path.sep).join('/');
}

/** Build the full tree (folders + files), skipping ignored dirs. */
export async function listTree(): Promise<TreeNode> {
  const root = await getVaultRoot();
  await fs.mkdir(root, { recursive: true });

  async function walk(absDir: string): Promise<TreeNode[]> {
    const entries = await fs.readdir(absDir, { withFileTypes: true });
    // Stat files concurrently per directory (cached) so the one-time fill is fast;
    // steady state reads from statCache → no syscalls. mtime/ctime power sort-by-time.
    const nodes = await Promise.all(
      entries
        .filter((e) => !(ignoredVaultNames.has(e.name) || e.name.startsWith('.'))) // hide dotfiles like Obsidian
        .map(async (e): Promise<TreeNode | null> => {
          const abs = path.join(absDir, e.name);
          const rel = toRel(root, abs);
          if (e.isDirectory()) {
            return { name: e.name, path: rel, type: 'folder', children: await walk(abs) };
          }
          if (e.isFile()) {
            const { m, c, size } = await fileStat(abs, rel);
            return { name: e.name, path: rel, type: 'file', ext: path.extname(e.name).toLowerCase(), mtime: m, ctime: c, size };
          }
          return null;
        }),
    );
    const out = nodes.filter((n): n is TreeNode => n !== null);
    // folders first, then alphabetical (client re-sorts by the chosen order)
    out.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    return out;
  }

  return { name: path.basename(root), path: '', type: 'folder', children: await walk(root) };
}

export function isTextFile(rel: string): boolean {
  return TEXT_EXTS.has(path.extname(rel).toLowerCase());
}

export async function readFileText(rel: string): Promise<string> {
  const abs = await resolveInVault(rel);
  return (await readTextFile(abs)).content;
}

export async function readFileSnapshot(rel: string) {
  return readTextFile(await resolveInVault(rel));
}

export async function readFileBuffer(rel: string): Promise<Buffer> {
  const abs = await resolveInVault(rel);
  return fs.readFile(abs);
}

/**
 * Resolve a directory path against the folders that already exist, matching each
 * segment case-insensitively. Prevents creating a case-duplicate folder (e.g. a
 * new `attachments` next to an existing `Attachments`) on case-sensitive
 * filesystems. Segments with no existing match are kept verbatim.
 */
export async function resolveDirCaseInsensitive(rel: string): Promise<string> {
  const root = await getVaultRoot();
  const segs = rel.split('/').filter(Boolean);
  const out: string[] = [];
  let curAbs = root;
  for (const seg of segs) {
    let actual = seg;
    try {
      const entries = await fs.readdir(curAbs, { withFileTypes: true });
      const exact = entries.find((e) => e.isDirectory() && e.name === seg);
      const ci = exact ?? entries.find((e) => e.isDirectory() && e.name.toLowerCase() === seg.toLowerCase());
      if (ci) actual = ci.name;
    } catch {
      /* directory doesn't exist yet — keep the requested casing */
    }
    out.push(actual);
    curAbs = path.join(curAbs, actual);
  }
  return out.join('/');
}

export async function exists(rel: string): Promise<boolean> {
  try {
    await fs.access(await resolveInVault(rel));
    return true;
  } catch {
    return false;
  }
}

/** List all markdown files (vault-relative) for indexing. */
export async function listMarkdownFiles(): Promise<string[]> {
  const root = await getVaultRoot();
  const out: string[] = [];
  async function walk(dir: string) {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      // Skip dotfiles/dot-dirs (`.trash`, `.obsidian`, …) like the tree view and
      // file index do — a note moved to `.trash` must not stay a live link target
      // (and would otherwise shadow a real file with the same basename).
      if (ignoredVaultNames.has(e.name) || e.name.startsWith('.')) continue;
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) await walk(abs);
      else if (e.isFile() && /\.(md|markdown)$/i.test(e.name)) out.push(toRel(root, abs));
    }
  }
  await walk(root);
  return out;
}
