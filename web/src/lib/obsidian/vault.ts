import { api, type TreeNode } from '../api';
import { documents } from '../documents';
import { useStore } from '../store';
import {
  extractMetadata,
  analyzeMarkdown,
  blockContainers,
  type MarkdownModel,
} from '@webobsidian/markdown-core';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { Events } from './events';
import type { FileStat } from '../tree';

export function normalizePath(path: string) {
  return path
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/')
    .replace(/^\.\//, '')
    .replace(/^\/+|\/+$/g, '')
    .normalize('NFC');
}
export class TAbstractFile {
  parent: TFolder | null = null;
  vault!: Vault;
  constructor(
    public path: string,
    public name: string = path.split('/').pop() ?? ''
  ) {}
}
export class TFile extends TAbstractFile {
  stat = { ctime: 0, mtime: 0, size: 0 };
  get basename() {
    const at = this.name.lastIndexOf('.');
    return at > 0 ? this.name.slice(0, at) : this.name;
  }
  get extension() {
    const at = this.name.lastIndexOf('.');
    return at > 0 ? this.name.slice(at + 1) : '';
  }
}
export class TFolder extends TAbstractFile {
  children: TAbstractFile[] = [];
  isRoot() {
    return this.path === '';
  }
}
export class FileSystemAdapter {
  basePath = '';
  constructor(private vault: Vault) {}
  getName() {
    return this.vault.getName();
  }
  getBasePath(): string {
    if (!this.basePath) throw new Error('Vault base path is not initialized');
    return this.basePath;
  }
  async read(path: string) {
    return (await api.pluginAdapter('read', path)).content as string;
  }
  async write(path: string, content: string) {
    const file = this.vault.getFileByPath(path);
    if (file) await this.vault.modify(file, content);
    else if (!path.startsWith('.')) await this.vault.create(path, content);
    else await api.pluginAdapter('write', path, { content });
  }
  async append(path: string, content: string) {
    await this.write(path, (await this.read(path)) + content);
  }
  async readBinary(path: string): Promise<ArrayBuffer> {
    const { base64 } = await api.pluginAdapter('readBinary', path);
    return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)).buffer;
  }
  async writeBinary(path: string, data: ArrayBuffer) {
    let str = '';
    for (const byte of new Uint8Array(data)) str += String.fromCharCode(byte);
    await api.pluginAdapter('writeBinary', path, { base64: btoa(str) });
  }
  async exists(path: string) {
    return (await api.pluginAdapter('exists', path)).exists as boolean;
  }
  async stat(path: string) {
    return (await api.pluginAdapter('stat', path)).stat;
  }
  async list(path: string) {
    return api.pluginAdapter('list', path);
  }
  async mkdir(path: string) {
    await api.pluginAdapter('mkdir', path);
  }
  async remove(path: string) {
    const file = this.vault.getAbstractFileByPath(path);
    if (file) await this.vault.delete(file);
    else await api.remove(path);
  }
  async rename(from: string, to: string) {
    const file = this.vault.getAbstractFileByPath(from);
    if (file) await this.vault.rename(file, to);
    else await api.rename(from, to);
  }
  async copy(from: string, to: string) {
    await api.copy(from, to);
  }
  getResourcePath(path: string) {
    return api.rawUrl(path) + '&raw=1';
  }
}
export class Vault extends Events {
  configDir = '.obsidian';
  adapter = new FileSystemAdapter(this);
  fileMap: Record<string, TAbstractFile> = {};
  private root = new TFolder('', '');
  private settings: Record<string, any> = {};
  private fallbackLinks: Map<string, TFile> | undefined;
  constructor(private prepareNewNote?: (path: string, content: string) => Promise<string>) {
    super();
    this.root.vault = this;
    this.fileMap[''] = this.root;
  }
  getName() {
    return useStore.getState().tree?.name ?? 'WebObsidian';
  }
  getRoot() {
    return this.root;
  }
  sync(tree: TreeNode | null, emit = false) {
    if (!tree) return;
    const prior = this.fileMap,
      next: typeof prior = { '': this.root };
    this.root.name = tree.name;
    const events: { name: string; file: TAbstractFile }[] = [];
    const walk = (node: TreeNode, parent: TFolder): TAbstractFile => {
      const Type = node.type === 'folder' ? TFolder : TFile;
      const old = prior[node.path];
      const file = old instanceof Type ? old : new Type(node.path, node.name);
      file.vault = this;
      file.name = node.name;
      file.parent = parent;
      next[node.path] = file;
      const mtime = file instanceof TFile ? file.stat.mtime : 0;
      if (file instanceof TFile)
        file.stat = {
          mtime: node.mtime ?? 0,
          ctime: node.ctime ?? 0,
          size: node.size ?? file.stat.size,
        };
      if (file instanceof TFolder)
        file.children = (node.children ?? []).map((n) => walk(n, file));
      if (emit) {
        if (!old) events.push({ name: 'create', file });
        else if (file instanceof TFile && mtime !== file.stat.mtime)
          events.push({ name: 'modify', file });
      }
      return file;
    };
    this.root.children = (tree.children ?? []).map((n) => walk(n, this.root));
    this.fileMap = next;
    this.fallbackLinks = undefined;
    for (const event of events) this.trigger(event.name, event.file);
    if (emit)
      for (const [path, file] of Object.entries(prior))
        if (!next[path]) this.trigger('delete', file);
  }
  getAllLoadedFiles() {
    return Object.values(this.fileMap);
  }
  applyFileStat(path: string, stat: FileStat) {
    const file = this.getFileByPath(path);
    if (!file) return;
    file.stat = { mtime: stat.mtime ?? file.stat.mtime, ctime: stat.ctime ?? file.stat.ctime, size: stat.size ?? file.stat.size };
    this.trigger('modify', file);
  }
  getFiles(): TFile[] {
    return this.getAllLoadedFiles().filter(
      (f): f is TFile => f instanceof TFile
    );
  }
  getMarkdownFiles() {
    return this.getFiles().filter((f) => /^(md|markdown)$/i.test(f.extension));
  }
  /** Preserve getFiles().find precedence while avoiding a vault scan per link. */
  findLinkCandidate(target: string): TFile | null {
    if (!this.fallbackLinks) {
      this.fallbackLinks = new Map();
      for (const file of this.getFiles()) {
        const parts = file.path.split('/');
        const keys = new Set([file.basename]);
        for (let i = 1; i < parts.length; i++) {
          const suffix = parts.slice(i).join('/');
          keys.add(suffix); keys.add(suffix.replace(/\.md$/, ''));
        }
        for (const key of keys) if (!this.fallbackLinks.has(key)) this.fallbackLinks.set(key, file);
      }
    }
    return this.fallbackLinks.get(target) ?? null;
  }
  getAbstractFileByPath(path: string) {
    return this.fileMap[normalizePath(path)] ?? null;
  }
  getFileByPath(path: string) {
    const file = this.getAbstractFileByPath(path);
    return file instanceof TFile ? file : null;
  }
  getFolderByPath(path: string) {
    const file = this.getAbstractFileByPath(path);
    return file instanceof TFolder ? file : null;
  }
  async read(file: TFile) {
    return (await api.read(file.path)).content;
  }
  async cachedRead(file: TFile) {
    return documents.get(file.path)?.snapshot.raw ?? this.read(file);
  }
  async modify(file: TFile, content: string) {
    const session = await documents.open(file.path);
    session.setRawText(content, 'plugin');
    await session.save();
    this.trigger('modify', file);
  }
  async process(file: TFile, fn: (data: string) => string) {
    const session = await documents.open(file.path);
    const result = fn(session.snapshot.raw);
    session.setRawText(result, 'plugin.process');
    await session.save();
    this.trigger('modify', file);
    return result;
  }
  async create(path: string, content: string, applyTemplate = true) {
    if (await this.adapter.exists(path))
      throw new Error(`File already exists: ${path}`);
    if (applyTemplate && this.prepareNewNote) content = await this.prepareNewNote(path, content);
    await api.createText(path, content);
    await useStore.getState().loadTree();
    const file = this.getFileByPath(path)!;
    this.trigger('create', file);
    return file;
  }
  async createFolder(path: string) {
    await api.createFolder(path);
    await useStore.getState().loadTree();
    return this.getFolderByPath(path)!;
  }
  async delete(file: TAbstractFile) {
    await api.remove(file.path);
    await useStore.getState().loadTree();
  }
  async trash(file: TAbstractFile, _system = false) {
    await this.delete(file);
  }
  async rename(file: TAbstractFile, path: string) {
    const old = file.path;
    await api.rename(old, path);
    delete this.fileMap[old];
    file.path = path;
    file.name = path.split('/').pop()!;
    this.fileMap[path] = file;
    this.fallbackLinks = undefined;
    await useStore.getState().loadTree();
    this.trigger('rename', file, old);
  }
  async copy(file: TFile, path: string) {
    await api.copy(file.path, path);
    await useStore.getState().loadTree();
    return this.getFileByPath(path)!;
  }
  async append(file: TFile, text: string) {
    await this.process(file, (data) => data + text);
  }
  getResourcePath(file: TFile) {
    return this.adapter.getResourcePath(file.path);
  }
  async readBinary(file: TFile) {
    return this.adapter.readBinary(file.path);
  }
  async modifyBinary(file: TFile, data: ArrayBuffer) {
    await this.adapter.writeBinary(file.path, data);
    this.trigger('modify', file);
  }
  async createBinary(path: string, data: ArrayBuffer) {
    if (await this.adapter.exists(path))
      throw new Error(`File already exists: ${path}`);
    await this.adapter.writeBinary(path, data);
    await useStore.getState().loadTree();
    return this.getFileByPath(path)!;
  }
  getConfig(key: string) {
    return this.settings[key];
  }
  setConfig(key: string, value: any) {
    this.settings[key] = value;
  }
  get config() {
    return this.settings;
  }
}
export function parseLinktext(text: string) {
  const [path, ...sub] = text.split('#');
  return { path, subpath: sub.length ? '#' + sub.join('#') : '' };
}
function pointIndex(source: string) {
  const starts = [0];
  for (let i = source.indexOf('\n'); i !== -1; i = source.indexOf('\n', i + 1)) starts.push(i + 1);
  return (offset: number) => {
    let lo = 0, hi = starts.length;
    while (lo < hi) { const mid = (lo + hi) >>> 1; if (starts[mid] <= offset) lo = mid + 1; else hi = mid; }
    const line = lo - 1;
    return { line, col: offset - starts[line], offset };
  };
}
export function cachedMetadata(source: string, model: MarkdownModel = analyzeMarkdown(source)) {
  const point = pointIndex(source);
  const meta = extractMetadata(model),
    position = (from: number, to: number) => ({
      start: point(from),
      end: point(to),
    });
  let frontmatter: any;
  if (model.frontmatter) {
    try {
      frontmatter =
        parseYaml(
          source
            .slice(model.frontmatter.from, model.frontmatter.to)
            .replace(/^---\n/, '')
            .replace(/\n---\s*$/, '')
        ) ?? {};
    } catch {
      /* invalid YAML remains editable */
    }
  }
  const links: any[] = [],
    embeds: any[] = [];
  for (const m of source.matchAll(/(!?)\[\[([^\]\n]+)\]\]/g)) {
    if (model.literal.some((r) => m.index! >= r.from && m.index! < r.to))
      continue;
    const [link, ...display] = m[2].split('|');
    (m[1] ? embeds : links).push({
      link,
      displayText: display.join('|'),
      original: m[0],
      position: position(m.index!, m.index! + m[0].length),
    });
  }
  return {
    frontmatter,
    frontmatterPosition: model.frontmatter
      ? position(model.frontmatter.from, model.frontmatter.to)
      : undefined,
    headings: meta.headings.map((h) => ({
      heading: h.text,
      level: h.level,
      position: position(h.from, h.to),
    })),
    tags: [...source.matchAll(/(^|\s)(#[\p{L}\p{N}_/-]+)/gu)]
      .filter((m) => meta.tags.includes(m[2].slice(1)))
      .map((m) => ({
        tag: m[2],
        position: position(m.index! + m[1].length, m.index! + m[0].length),
      })),
    links,
    embeds,
    blocks: Object.fromEntries(
      meta.blockIds.map((b) => [
        b.id,
        { id: b.id, position: position(b.from, b.to) },
      ])
    ),
    sections: blockContainers(model).map((b) => ({
      type: b.kind,
      position: position(b.from, b.to),
    })),
    listItems: [],
  };
}
export class MetadataCache extends Events {
  private cache = new Map<string, any>();
  private sessionCache = new WeakMap<object, { version: number; metadata: any }>();
  private revisions = new Map<string, string>();
  private references = new Map<string, Set<string>>();
  private sourceKeys = new Map<string, Set<string>>();
  resolvedLinks: Record<string, Record<string, number>> = {};
  unresolvedLinks: Record<string, Record<string, number>> = {};
  constructor(public vault: Vault) {
    super();
  }
  getFileCache(file: TFile | null) {
    return file ? this.getCache(file.path) : null;
  }
  getCache(path: string) {
    const session = documents.get(path);
    if (!session) return this.cache.get(path) ?? null;
    let entry = this.sessionCache.get(session);
    if (!entry || entry.version !== session.snapshot.version) {
      entry = { version: session.snapshot.version, metadata: cachedMetadata(session.snapshot.text, session.analysis) };
      this.sessionCache.set(session, entry);
    }
    return entry.metadata;
  }
  async refresh(file: TFile) {
    const session = documents.get(file.path);
    const loaded = session ? undefined : await api.read(file.path);
    const source = session?.snapshot.raw ?? loaded!.content;
    const revision = loaded?.revision;
    const cache = session ? this.getCache(file.path)
      : revision !== undefined && this.revisions.get(file.path) === revision ? this.cache.get(file.path)
      : cachedMetadata(source.replace(/\r\n?/g, '\n'));
    if (revision !== undefined) this.revisions.set(file.path, revision); else this.revisions.delete(file.path);
    this.cache.set(file.path, cache);
    this.trigger('changed', file, source, cache);
    this.trigger('resolve', file);
    return cache;
  }
  async initialize() {
    const files = this.vault.getMarkdownFiles();
    let at = 0;
    await Promise.all(
      Array.from({ length: Math.min(8, files.length) }, async () => {
        while (at < files.length) {
          const file = files[at++];
          await this.refresh(file).catch(console.error);
        }
      })
    );
    this.rebuildLinks();
    this.trigger('resolved');
  }
  rebuildLinks() {
    this.resolvedLinks = {};
    this.unresolvedLinks = {};
    this.references.clear();
    this.sourceKeys.clear();
    for (const file of this.vault.getMarkdownFiles()) this.updateFileLinks(file);
  }
  private removeFileLinks(path: string) {
    for (const key of this.sourceKeys.get(path) ?? []) {
      const sources = this.references.get(key);
      sources?.delete(path);
      if (!sources?.size) this.references.delete(key);
    }
    this.sourceKeys.delete(path);
    delete this.resolvedLinks[path];
    delete this.unresolvedLinks[path];
  }
  private updateFileLinks(file: TFile) {
      this.removeFileLinks(file.path);
      const resolved: Record<string, number> = {},
        unresolved: Record<string, number> = {};
      const cache = this.getFileCache(file);
      const keys = new Set<string>();
      for (const link of [
        ...(cache?.links ?? []),
        ...(cache?.embeds ?? []),
      ]) {
        keys.add(normalizePath(parseLinktext(link.link).path));
        const target = this.getFirstLinkpathDest(link.link, file.path);
        const map = target ? resolved : unresolved;
        const key = target?.path ?? link.link;
        map[key] = (map[key] ?? 0) + 1;
      }
      this.resolvedLinks[file.path] = resolved;
      this.unresolvedLinks[file.path] = unresolved;
      this.sourceKeys.set(file.path, keys);
      for (const key of keys) {
        if (!this.references.has(key)) this.references.set(key, new Set());
        this.references.get(key)!.add(file.path);
      }
  }
  /** Content changes touch one source; path changes also revisit its dependents. */
  async updateFiles(paths: readonly string[], structuralPaths: readonly string[]) {
    const affected = new Set(paths);
    for (const path of structuralPaths) {
      const parts = normalizePath(path).split('/');
      const keys = new Set<string>();
      for (let i = 0; i < parts.length; i++) {
        const suffix = parts.slice(i).join('/');
        keys.add(suffix); keys.add(suffix.replace(/\.md$/, ''));
      }
      keys.add(parts.at(-1)!.replace(/\.[^.]+$/, ''));
      for (const key of keys) for (const source of this.references.get(key) ?? []) affected.add(source);
    }
    for (const path of paths) {
      const file = this.vault.getFileByPath(path);
      if (file && /^(md|markdown)$/i.test(file.extension)) await this.refresh(file).catch(console.error);
      else { this.cache.delete(path); this.revisions.delete(path); this.removeFileLinks(path); }
    }
    for (const path of affected) {
      const file = this.vault.getFileByPath(path);
      if (file && /^(md|markdown)$/i.test(file.extension)) this.updateFileLinks(file);
    }
    this.trigger('resolved');
  }
  getFirstLinkpathDest(link: string, source = '') {
    const target = normalizePath(parseLinktext(link).path);
    if (!target) return this.vault.getFileByPath(source);
    const base = source.includes('/')
      ? source.slice(0, source.lastIndexOf('/') + 1)
      : '';
    for (const name of [
      base + target,
      target,
      base + target + '.md',
      target + '.md',
    ]) {
      const file = this.vault.getFileByPath(name);
      if (file) return file;
    }
    return this.vault.findLinkCandidate(target);
  }
  fileToLinktext(file: TFile, _source: string, omitMd = false) {
    return omitMd ? file.path.replace(/\.md$/i, '') : file.path;
  }
  getTags() {
    const tags: Record<string, number> = {};
    for (const file of this.vault.getMarkdownFiles())
      for (const tag of getAllTags(this.getFileCache(file)) ?? [])
        tags[tag] = (tags[tag] ?? 0) + 1;
    return tags;
  }
}
export function getAllTags(cache: any): string[] | null {
  if (!cache) return null;
  const tags = (cache.tags ?? []).map((t: any) => t.tag);
  const front = cache.frontmatter?.tags;
  for (const tag of Array.isArray(front)
    ? front
    : typeof front === 'string'
      ? front.split(/[,\s]+/)
      : [])
    if (tag) tags.push('#' + String(tag).replace(/^#/, ''));
  return [...new Set<string>(tags)];
}
export function getFrontMatterInfo(content: string) {
  const match = content.match(/^\ufeff?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  return {
    exists: !!match,
    frontmatter: match?.[1] ?? '',
    from: match ? match[0].indexOf(match[1]) : 0,
    to: match ? match[0].indexOf(match[1]) + match[1].length : 0,
    contentStart: match?.[0].length ?? 0,
  };
}
export { parseYaml, stringifyYaml };
