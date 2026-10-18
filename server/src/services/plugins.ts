import { promises as fs } from 'node:fs';
import path from 'node:path';
import { resolveInVault } from './vault.js';
import { getSettings, updateSettings } from './settings.js';
import { writeTextFile } from './textFile.js';

/**
 * Obsidian community plugin support (PRD FR-8).
 * Plugins live in `<vault>/.obsidian/plugins/<id>/` with manifest.json + main.js
 * (+ optional styles.css), exactly like the desktop app. The server lists,
 * installs (from GitHub releases) and toggles them; the browser loads main.js
 * against the Obsidian API shim (see web/src/lib/obsidian-shim).
 */

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  minAppVersion?: string;
  description?: string;
  author?: string;
  authorUrl?: string;
  isDesktopOnly?: boolean;
}

export interface InstalledPlugin extends PluginManifest {
  enabled: boolean;
  hasStyles: boolean;
  dir: string; // vault-relative
}

async function pluginsDir(): Promise<string> {
  return resolveInVault('.obsidian/plugins');
}

/**
 * A plugin id becomes a path segment under `.obsidian/plugins/`, both when
 * installing (taken from a *remote* manifest.json) and when serving assets
 * (taken from the URL). Reject anything that isn't a plain id so a crafted
 * `../../..` can't read or write outside the plugins directory.
 */
function assertSafeId(id: string): string {
  if (!/^[a-zA-Z0-9._-]+$/.test(id) || id === '.' || id === '..') {
    throw Object.assign(new Error('Invalid plugin id'), { status: 400 });
  }
  return id;
}

export async function listInstalled(): Promise<InstalledPlugin[]> {
  const dir = await pluginsDir();
  const s = await getSettings();
  // A fork reads the existing vault's enablement without rewriting it on startup.
  let enabled = s.plugins.enabled;
  try { enabled = JSON.parse(await fs.readFile(await resolveInVault('.obsidian/community-plugins.json'), 'utf8')); }
  catch (e: any) { if (e.code !== 'ENOENT') throw e; }
  if (!Array.isArray(enabled) || !enabled.every(id => typeof id === 'string')) throw new Error('Invalid community-plugins.json');
  let entries: string[] = [];
  try {
    entries = (await fs.readdir(dir, { withFileTypes: true }))
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch {
    return [];
  }
  const out: InstalledPlugin[] = [];
  for (const id of entries) {
    try {
      assertSafeId(id);
      const manifestRaw = await getPluginAsset(id, 'manifest.json');
      const manifest = JSON.parse(manifestRaw) as PluginManifest;
      const hasStyles = await fileExists(await resolveInVault(`.obsidian/plugins/${id}/styles.css`));
      out.push({
        ...manifest,
        id,
        enabled: enabled.includes(id),
        hasStyles,
        dir: `.obsidian/plugins/${id}`,
      });
    } catch {
      /* skip invalid plugin dir */
    }
  }
  return out;
}

export async function getPluginAsset(
  id: string,
  asset: 'main.js' | 'styles.css' | 'manifest.json',
): Promise<string> {
  assertSafeId(id);
  return fs.readFile(await resolveInVault(`.obsidian/plugins/${id}/${asset}`), 'utf8');
}

let enableQueue = Promise.resolve();
export function setEnabled(id: string, enabled: boolean): Promise<void> {
  const operation = enableQueue.catch(() => {}).then(() => updateEnabled(id, enabled));
  enableQueue = operation;
  return operation;
}
async function updateEnabled(id: string, enabled: boolean): Promise<void> {
  assertSafeId(id);
  const installed = await listInstalled();
  if (!installed.some(p => p.id === id)) throw Object.assign(new Error('Plugin not installed'), { status: 404 });
  const ids = new Set(installed.filter(p => p.enabled).map(p => p.id));
  // Preserve missing plugin IDs in the original enablement file as well.
  try { for (const entry of JSON.parse(await fs.readFile(await resolveInVault('.obsidian/community-plugins.json'), 'utf8'))) ids.add(entry); }
  catch (e: any) { if (e.code !== 'ENOENT') throw e; }
  if (enabled) ids.add(id); else ids.delete(id);
  const target = await resolveInVault('.obsidian/community-plugins.json');
  await fs.mkdir(path.dirname(target), { recursive: true });
  await writeTextFile(target, JSON.stringify([...ids], null, 2));
  await updateSettings((d) => {
    const set = new Set(d.plugins.enabled);
    if (enabled) set.add(id);
    else set.delete(id);
    d.plugins.enabled = [...set];
  });
}

export async function readPluginData(id: string): Promise<unknown> {
  assertSafeId(id);
  try { return JSON.parse(await fs.readFile(await resolveInVault(`.obsidian/plugins/${id}/data.json`), 'utf8')); }
  catch (e: any) { if (e.code === 'ENOENT') return null; throw e; }
}
const dataWrites = new Map<string, Promise<void>>();
export async function writePluginData(id: string, data: unknown): Promise<void> {
  assertSafeId(id);
  const target = await resolveInVault(`.obsidian/plugins/${id}/data.json`);
  const operation = (dataWrites.get(target) ?? Promise.resolve()).catch(() => {}).then(async () => {
    const tmp = target + '.webobsidian-tmp';
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(tmp, JSON.stringify(data, null, 2));
    await fs.rename(tmp, target);
  });
  dataWrites.set(target, operation);
  try { await operation; } finally { if (dataWrites.get(target) === operation) dataWrites.delete(target); }
}

/** Adapter operations remain vault-scoped, including hidden plugin/config files. */
export async function adapterOperation(op: string, rel: string, body: any = {}) {
  if (/^(?:[a-z]:|[/\\])|(?:^|[/\\])\.\.(?:[/\\]|$)/i.test(rel)) throw Object.assign(new Error('Invalid vault-relative path'), { status: 400 });
  const target = await resolveInVault(rel);
  switch (op) {
    case 'read': return { content: await fs.readFile(target, 'utf8') };
    case 'readBinary': return { base64: (await fs.readFile(target)).toString('base64') };
    case 'write': case 'writeBinary': {
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, op === 'writeBinary' ? Buffer.from(body.base64, 'base64') : String(body.content)); return { ok: true };
    }
    case 'exists': return { exists: await fs.access(target).then(() => true, () => false) };
    case 'stat': {
      const st = await fs.stat(target).catch((e: any) => { if(e.code === 'ENOENT') return null; throw e; });
      return { stat: st ? { type: st.isDirectory() ? 'folder' : 'file', ctime: st.birthtimeMs, mtime: st.mtimeMs, size: st.size } : null };
    }
    case 'list': {
      const entries = await fs.readdir(target, { withFileTypes: true });
      return { files: entries.filter(e => e.isFile()).map(e => path.posix.join(rel,e.name)), folders: entries.filter(e => e.isDirectory() && e.name !== '.git').map(e => path.posix.join(rel,e.name)) };
    }
    case 'mkdir': await fs.mkdir(target, { recursive: true }); return { ok: true };
    default: throw Object.assign(new Error('Unsupported adapter operation'), { status: 400 });
  }
}

/**
 * Install a community plugin from a GitHub repo (owner/repo). Pulls
 * manifest.json + main.js (+ styles.css) from the latest release assets.
 */
export async function installFromGithub(repo: string): Promise<InstalledPlugin> {
  const clean = repo.replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, '').trim();
  const relApi = `https://api.github.com/repos/${clean}/releases/latest`;
  const res = await fetch(relApi, { headers: { 'User-Agent': 'WebObsidian' } });
  if (!res.ok) throw new Error(`GitHub release lookup failed: ${res.status}`);
  const release = (await res.json()) as { assets: { name: string; browser_download_url: string }[] };
  const assets = Object.fromEntries(release.assets.map((a) => [a.name, a.browser_download_url]));
  if (!assets['manifest.json'] || !assets['main.js']) {
    throw new Error('Release missing manifest.json or main.js');
  }

  const manifest = JSON.parse(await fetchText(assets['manifest.json'])) as PluginManifest;
  // id comes from a REMOTE manifest — validate before it becomes a path segment
  // (a crafted `../../..` would otherwise write main.js outside the plugins dir).
  const id = assertSafeId(manifest.id || clean.split('/')[1]);
  const dir = await pluginsDir();
  const target = path.join(dir, id);
  await fs.mkdir(target, { recursive: true });
  await fs.writeFile(path.join(target, 'manifest.json'), JSON.stringify(manifest, null, 2));
  await fs.writeFile(path.join(target, 'main.js'), await fetchText(assets['main.js']));
  if (assets['styles.css']) {
    await fs.writeFile(path.join(target, 'styles.css'), await fetchText(assets['styles.css']));
  }
  await updateSettings((d) => {
    if (!d.plugins.installed.includes(id)) d.plugins.installed.push(id);
  });
  const installed = await listInstalled();
  const found = installed.find((p) => p.id === id);
  if (!found) throw new Error('Install verification failed');
  return found;
}

async function fetchText(url: string): Promise<string> {
  const r = await fetch(url, { headers: { 'User-Agent': 'WebObsidian' } });
  if (!r.ok) throw new Error(`Download failed: ${url} (${r.status})`);
  return r.text();
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}
