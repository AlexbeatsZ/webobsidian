import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID, createHash } from 'node:crypto';
import { Script } from 'node:vm';
import type { ScriptBundle, ScriptRecord } from '../../../web/src/lib/userscripts/types';
import { identity, pageWorld, parseMetadata } from './metadata';
import { scriptFetch, verifyIntegrity } from './network';

interface StoreData {
  version: 1; vault: string; migration: string; scripts: ScriptRecord[];
  values: Record<string, Record<string, unknown>>; retained?: Record<string, string>; autoUpdate: boolean; intervalHours: number;
}
const empty = (vault: string): StoreData => ({ version: 1, vault, migration: '', scripts: [], values: {}, autoUpdate: false, intervalHours: 24 });
const clone = <T>(value: T): T => structuredClone(value);
export const approval = (b: ScriptBundle): ScriptRecord['approved'] => ({ grants: [...b.metadata.grants], connects: [...b.metadata.connects], pageWorld: pageWorld(b.metadata),
  rules: { matches: [...b.metadata.matches], includes: [...b.metadata.includes], excludes: [...b.metadata.excludes], excludeMatches: [...b.metadata.excludeMatches] } });
export function validateSyntax(source: string, label: string) {
  // Parse only. Never run downloaded or migrated code in Node.
  new Script('(function(){\n' + source + '\n})', { filename: label });
}
export async function prepareBundle(source: string, signal?: AbortSignal): Promise<ScriptBundle> {
  const metadata = parseMetadata(source);
  validateSyntax(source, metadata.name);
  const requires: ScriptBundle['requires'] = [], resources: ScriptBundle['resources'] = Object.create(null);
  for (const url of metadata.requires) {
    const r = await scriptFetch(url, { signal });
    if (r.status !== 200) throw new Error('@require HTTP ' + r.status);
    verifyIntegrity(url, r.bytes);
    const text = r.bytes.toString('utf8'); validateSyntax(text, url);
    requires.push({ url, source: text });
  }
  for (const resource of metadata.resources) {
    const r = await scriptFetch(resource.url, { signal });
    if (r.status !== 200) throw new Error('@resource HTTP ' + r.status);
    verifyIntegrity(resource.url, r.bytes);
    resources[resource.name] = { url: resource.url, source: r.bytes.toString('utf8'),
      dataUrl: 'data:' + (r.headers['content-type']?.split(';')[0] || 'application/octet-stream') + ';base64,' + r.bytes.toString('base64') };
  }
  if (source.length + requires.reduce((n, a) => n + a.source.length, 0) + Object.values(resources).reduce((n, a) => n + a.source.length + (a.dataUrl?.length ?? 0), 0) > 24 * 1024 * 1024)
    throw new Error('Script and assets exceed 24 MiB');
  return { source, metadata, requires, resources, warnings: warnings(metadata) };
}
function warnings(m: ScriptBundle['metadata']) {
  return [
    ...(!m.matches.length && !m.includes.length ? ['No positive URL rule: script will never run'] : []),
    ...(!m.noframes ? ['Top-level documents only; iframe execution is not implemented'] : []),
    ...(pageWorld(m) ? ['Page world: the website can access this script\'s GM values and granted capabilities. Use only on trusted sites.'] : []),
    ...(m.runAt === 'document-start' ? ['Runs from sandboxed guest preload; early page timing needs user acceptance'] : []),
  ];
}
/** Sole owner of installed scripts, approvals, update state and per-script values. */
export class UserscriptStore {
  private data: StoreData;
  private tail: Promise<unknown> = Promise.resolve();
  private sourceDirectory?: Promise<string>;
  readonly file: string;
  constructor(readonly vault: string, dataDir: string, private changed: () => void) {
    this.data = empty(vault);
    this.file = path.join(dataDir, 'userscripts', createHash('sha256').update(path.resolve(vault)).digest('hex').slice(0, 24) + '.json');
  }
  async load() {
    try {
      const d = JSON.parse(await fs.readFile(this.file, 'utf8'));
      if (d.version !== 1 || d.vault !== this.vault || !Array.isArray(d.scripts) || !d.values || typeof d.values !== 'object' || Array.isArray(d.values)) throw new Error('Invalid native userscript store');
      for (const s of d.scripts) {
        if (!s.id || !s.approved || !s.update || !Number.isInteger(s.revision)) throw new Error('Invalid script record');
        if (!s.warnings?.some((w: string) => w.startsWith('Migration blocked:'))) { s.metadata = parseMetadata(s.source); validateSyntax(s.source, s.id); }
      }
      this.data = d;
      return;
    } catch (e: any) { if (e.code !== 'ENOENT') throw e; }
    let legacy: any;
    try { legacy = JSON.parse(await fs.readFile(path.join(this.vault, '.obsidian/plugins/webviewer-userscripts/data.json'), 'utf8')); }
    catch (e: any) { if (e.code !== 'ENOENT') throw new Error('Legacy userscript migration failed: ' + e.message); }
    if (legacy) {
      if (legacy.schemaVersion !== 1 || !Array.isArray(legacy.scripts) || !legacy.values || Array.isArray(legacy.values)) throw new Error('Unsupported legacy userscript data; original was preserved');
      for (const old of legacy.scripts) {
        if (typeof old.source !== 'string' || typeof old.id !== 'string' || this.data.scripts.some(s => s.id === old.id)) throw new Error('Invalid/duplicate legacy script');
        // Migration is entirely offline. Missing cached assets stay disabled until edited/imported.
        let bundle: ScriptBundle;
        try {
          const metadata = parseMetadata(old.source); validateSyntax(old.source, old.id);
          const requires = metadata.requires.map(url => {
            const asset = old.requiredSources?.find((a: any) => a.url === url);
            if (!asset || typeof asset.source !== 'string') throw new Error('Missing cached @require');
            validateSyntax(asset.source, url); verifyIntegrity(url, Buffer.from(asset.source));
            return { url, source: asset.source };
          });
          if (metadata.resources.length) throw new Error('Resources need a fresh import');
          bundle = { source: old.source, metadata, requires, resources: {}, warnings: warnings(metadata) };
        } catch (e) {
          // Keep unsupported source and its values visible for repair, without executing it.
          const fallback = parseMetadata('// ==UserScript==\n// @name ' + String(old.metadata?.name ?? old.id).replace(/[\r\n]/g, '') + '\n// ==/UserScript==');
          bundle = { source: old.source, metadata: fallback, requires: [], resources: {}, warnings: ['Migration blocked: ' + String(e)] };
        }
        const blocked = bundle.warnings.some(w => w.startsWith('Migration blocked:'));
        this.data.scripts.push({ ...bundle, id: old.id, revision: 1, enabled: !!old.enabled && !blocked,
          importedAt: old.importedAt || Date.now(), updatedAt: old.updatedAt || Date.now(), autoUpdate: false,
          approved: approval(bundle), update: { state: blocked ? 'migration-error' : 'migrated' } });
        this.data.values[old.id] = clone(legacy.values[old.id] ?? {});
      }
      this.data.migration = 'Read-only import of webviewer-userscripts schema 1; original sources/configuration preserved';
    } else this.data.migration = 'No legacy userscript configuration';
    await this.persist(this.data);
  }
  snapshot() { const { values: _values, ...rest } = this.data; return clone(rest); }
  get(id: string) { const r = this.data.scripts.find(s => s.id === id); if (!r) throw new Error('Script no longer exists'); return clone(r); }
  async exportSource(id: string, revision: unknown, pending: boolean, candidateId: unknown): Promise<string> {
    const script = this.get(id);
    if (script.revision !== revision) throw new Error('源码版本已变化，请刷新后重新查看');
    if (pending && (!script.update.pending || !script.update.candidateId || script.update.candidateId !== candidateId)) throw new Error('待更新源码已变化，请刷新后重新查看');
    const source = pending ? script.update.pending!.source : script.source;
    this.sourceDirectory ??= (async () => {
      const root = path.join(os.tmpdir(), '.agents');
      await fs.mkdir(root, { recursive: true });
      return fs.mkdtemp(path.join(root, 'webobsidian-userscripts-'));
    })().catch(error => { this.sourceDirectory = undefined; throw error; });
    // A text suffix opens an editor instead of an OS JavaScript execution host.
    // This is a disposable view, never an input to installed state or execution.
    const file = path.join(await this.sourceDirectory, randomUUID() + '.user.js.txt');
    await fs.writeFile(file, source, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    return file;
  }
  values(id: string) { this.get(id); return clone(this.data.values[id] ?? {}); }
  async mutate<T>(fn: (draft: StoreData) => T, announce = true): Promise<T> {
    const operation = this.tail.catch(() => {}).then(async () => {
      const draft = clone(this.data), result = fn(draft);
      await this.persist(draft); this.data = draft; if (announce) this.changed(); return result;
    });
    this.tail = operation; return operation;
  }
  private async persist(draft: StoreData) {
    const json = JSON.stringify(draft);
    if (Buffer.byteLength(json) > 96 * 1024 * 1024) throw new Error('Userscript store exceeds 96 MiB');
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    const temp = this.file + '.' + randomUUID() + '.tmp';
    try { await fs.writeFile(temp, json, 'utf8'); await fs.rename(temp, this.file); }
    finally { await fs.rm(temp, { force: true }); }
  }
  async install(bundle: ScriptBundle, options: { id?: string; revision?: number; sourceUrl?: string; approve?: boolean }) {
    return this.mutate(d => {
      const old = options.id ? d.scripts.find(s => s.id === options.id) : d.scripts.find(s => identity(s.metadata) === identity(bundle.metadata));
      if (options.id && (!old || old.revision !== options.revision)) throw new Error('Script changed while being edited; reload before saving');
      if (old && !options.id) {
        old.revision++;
        old.update = { state: 'import-review', pending: bundle, availableVersion: bundle.metadata.version, pendingSourceUrl: options.sourceUrl, candidateId: randomUUID() };
        return old.id;
      }
      if (d.scripts.some(s => s !== old && identity(s.metadata) === identity(bundle.metadata))) throw new Error('Another installed script already has this @namespace/@name');
      const now = Date.now();
      const retainedId = d.retained?.[identity(bundle.metadata)];
      const record: ScriptRecord = { ...bundle, id: old?.id ?? retainedId ?? randomUUID(), revision: (old?.revision ?? 0) + 1,
        enabled: old?.enabled ?? false, importedAt: old?.importedAt ?? now, updatedAt: now,
        sourceUrl: options.sourceUrl ?? old?.sourceUrl, autoUpdate: old?.autoUpdate ?? false,
        approved: options.approve ? approval(bundle) : old?.approved ?? { grants: [], connects: [], pageWorld: false, rules: { matches: [], includes: [], excludes: [], excludeMatches: [] } }, update: { state: 'saved' } };
      if (d.retained) delete d.retained[identity(bundle.metadata)];
      if (old) d.scripts[d.scripts.indexOf(old)] = record; else d.scripts.push(record);
      return record.id;
    });
  }
  async setValues(id: string, patch: Record<string, unknown>, deleted: string[] = []) {
    if (Object.keys(patch).length + deleted.length > 1000) throw new Error('Too many value mutations');
    if (Buffer.byteLength(JSON.stringify(patch)) > 8 * 1024 * 1024) throw new Error('Value update exceeds 8 MiB');
    return this.mutate(d => {
      if (!d.scripts.some(s => s.id === id)) throw new Error('Script was removed');
      const values = d.values[id] ??= {};
      for (const key of deleted) delete values[key];
      for (const [key, value] of Object.entries(patch)) Object.defineProperty(values, key, { value, enumerable: true, configurable: true, writable: true });
    }, false);
  }
  async flush() { await this.tail; }
  async dispose() {
    try { await this.flush(); }
    finally {
      const sourceDirectory = this.sourceDirectory;
      this.sourceDirectory = undefined;
      // A text editor may still hold a view open; cleanup must not block quitting.
      if (sourceDirectory) await sourceDirectory.then(directory => fs.rm(directory, { recursive: true, force: true }))
        .catch(error => console.warn('Userscript source view cleanup:', error));
    }
  }
}
