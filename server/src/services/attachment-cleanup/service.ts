import { promises as fs, createReadStream } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { getSettings } from '../settings.js';
import { getVaultRoot, readFileSnapshot, resolveInVault, trash } from '../vault.js';
import { collectReferences } from './references.js';
import { readKnownPluginReferences } from './pluginReaders.js';
import type { Candidate, CleanupHost, CleanupIssue, CleanupOptions, CleanupPreview, CleanupResult, CleanupState } from './types.js';

const SOURCE_EXTENSIONS = new Set(['md', 'markdown', 'canvas', 'json', 'yaml', 'yml', 'base', 'css', 'html', 'htm', 'txt', 'svg', 'tex', 'sty', 'cls', 'bib']);
/** Opaque leaf formats only. Unknown/plugin formats are protected, never inferred unused. */
export const ATTACHMENT_EXTENSIONS = new Set([
  'avif', 'bmp', 'gif', 'jpeg', 'jpg', 'png', 'svg', 'webp', 'ico', 'tif', 'tiff', 'heic',
  'pdf', 'mp3', 'wav', 'm4a', '3gp', 'flac', 'ogg', 'oga', 'opus', 'aac',
  'mp4', 'webm', 'ogv', 'mov', 'mkv', 'avi', 'wmv',
  'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'odt', 'ods', 'odp',
  'zip', '7z', 'rar', 'gz', 'tar', 'woff', 'woff2', 'ttf', 'otf',
]);
const extOf = (p: string) => path.posix.extname(p).slice(1).toLowerCase();
const comparable = (p: string) => p.normalize('NFC').toLocaleLowerCase('en-US');
const under = (p: string, dir: string) => comparable(p) === comparable(dir) || comparable(p).startsWith(comparable(dir) + '/');
const errorMessage = (error: unknown) => error instanceof Error ? error.message : String(error);
function reject(message: string, status = 409): never { throw Object.assign(new Error(message), { status }); }
const stampOf = (stat: Awaited<ReturnType<typeof fs.stat>>) =>
  `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`;
const TTL = 10 * 60_000;
interface Scan {
  preview: CleanupPreview;
  state: CleanupState;
  catalog: ReturnType<CleanupHost['getCatalog']>;
  /** Content and directory stamps only; no Vault-wide body mirror. */
  stamps: Map<string, string>;
  directories: Map<string, Set<string>>;
  trashDirectory: string;
}
interface Ticket { scan: Scan; owner: string }

export function normalizeCleanupOptions(options: CleanupOptions): CleanupOptions {
  const directories = options.excludeDirectories.map((dir) => {
    const normalized = dir.trim().replace(/\\/g, '/').replace(/\/+$/, '');
    if (!normalized || normalized.startsWith('/') || normalized.split('/').some((part) => !part || part === '.' || part === '..') || /[:\0]/.test(normalized))
      reject('排除目录必须是 Vault 内的相对目录', 400);
    return normalized;
  });
  const extensions = options.excludeExtensions.map((ext) => {
    const normalized = ext.trim().replace(/^\./, '').toLowerCase();
    if (!/^[a-z\d][a-z\d-]{0,31}$/.test(normalized)) reject('排除类型必须是扩展名', 400);
    return normalized;
  });
  return { excludeDirectories: [...new Set(directories)], excludeExtensions: [...new Set(extensions)] };
}

/** On-demand maintenance service. No watcher, body cache, index or boot-time disk work. */
export class AttachmentCleanupService {
  private tickets = new Map<string, Ticket>();
  private busy = false;
  constructor(private host: CleanupHost) {}
  dispose() { this.tickets.clear(); }

  private async task<T>(work: () => Promise<T>): Promise<T> {
    if (this.busy) reject('附件清理任务正在进行，请稍后重试');
    this.busy = true;
    try { return await work(); } finally { this.busy = false; }
  }
  async preview(options: CleanupOptions, owner: string): Promise<CleanupPreview> {
    return this.task(async () => {
      for (const [token, ticket] of this.tickets) if (ticket.scan.preview.expiresAt <= Date.now()) this.tickets.delete(token);
      // Bound retained previews, and supersede this authenticated session's old preview.
      for (const [token, ticket] of this.tickets) if (ticket.owner === owner) this.tickets.delete(token);
      while (this.tickets.size >= 8) this.tickets.delete(this.tickets.keys().next().value!);
      const scan = await this.scan(normalizeCleanupOptions(options));
      if (scan.preview.canExecute) this.tickets.set(scan.preview.token, { scan, owner });
      return scan.preview;
    });
  }
  async execute(token: string, selected: string[], owner: string): Promise<CleanupResult> {
    return this.task(async () => {
      const ticket = this.tickets.get(token);
      if (!ticket || ticket.owner !== owner || ticket.scan.preview.expiresAt <= Date.now()) reject('扫描已过期或不属于此会话，请重新扫描');
      this.tickets.delete(token); // One attempt, including failure; never replay a partial result.
      const prior = ticket.scan;
      if (!selected.length || new Set(selected).size !== selected.length) reject('请选择附件，且不要重复选择', 400);
      const originals = new Map(prior.preview.candidates.map((item) => [item.path, item]));
      if (selected.some((p) => !originals.has(p))) reject('所选路径不属于本次扫描', 400);
      return this.host.withExclusiveMutation(async () => {
        await this.host.assertWorkspaceSafe();
        this.assertState(prior, await this.host.captureState());
        // Scan all current sources again. No graph-only or cached-body deletion decisions.
        const current = await this.scan(prior.preview.options);
        if (!current.preview.canExecute) reject('执行前引用检查失败，未移动任何文件：' + current.preview.issues.filter((i) => i.blocking).map((i) => i.message).join('；'));
        const fresh = new Map(current.preview.candidates.map((item) => [item.path, item]));
        for (const p of selected) if (!fresh.has(p) || fresh.get(p)!.revision !== originals.get(p)!.revision)
          reject('附件已被引用或内容已变化，请重新扫描：' + p);
        // Stable full-source/directory snapshot is required before the first mutation.
        await this.verifyStamps(current);
        const result: CleanupResult = { moved: [], failed: [], stopped: null };
        for (const p of selected) {
          try {
            await this.host.assertWorkspaceSafe();
            if ((await getVaultRoot()) !== current.state.root || this.host.getCatalog() !== current.catalog)
              reject('Vault 或索引已切换');
            if ((await getSettings()).vault.trash !== current.trashDirectory) reject('回收站配置已变化');
            // vault.trash owns the move; validate its destination through the same
            // realpath/traversal guard before handing control to it.
            await resolveInVault(path.posix.join(current.trashDirectory, p));
            // Detect external edits even if watcher delivery is delayed. Moves alter parent
            // directory stamps, so rebase just those after our own successful trash operation.
            await this.verifyStamps(current);
            if ((await this.candidate(p)).revision !== originals.get(p)!.revision) reject('附件内容已变化');
            const trashPath = await trash(p); // Always trash, regardless of deleteMode.
            result.moved.push({ path: p, trashPath });
            current.stamps.delete(p);
            const parent = path.posix.dirname(p), key = parent === '.' ? '' : parent;
            current.directories.get(key)?.delete(path.posix.basename(p));
            const touched = new Set(['', key]);
            // A configured nested trash path may create previously absent ancestors.
            // Expect only that known chain, never adopt arbitrary new disk members.
            const parts = current.trashDirectory.split('/');
            for (let i = 0; i < parts.length; i++) {
              const ancestor = parts.slice(0, i).join('/'), child = parts.slice(0, i + 1).join('/');
              if (!current.directories.has(ancestor)) current.directories.set(ancestor, new Set());
              if (!under(child, current.trashDirectory)) current.directories.get(ancestor)!.add(parts[i]);
              touched.add(ancestor);
            }
            // Check membership BEFORE rebasing our directory mtime. A concurrently
            // created source must not disappear behind our own expected rename event.
            await this.verifyDirectories(current);
            for (const dir of touched) current.stamps.set(dir, stampOf(await fs.lstat(await resolveInVault(dir))));
          } catch (error) {
            result.failed.push({ path: p, message: errorMessage(error) });
            result.stopped = '任务已停止；其余附件未移动。已移动的附件可从回收站恢复。';
            break;
          }
        }
        return result;
      });
    });
  }
  private assertState(scan: Scan, state: CleanupState) {
    if (state.root !== scan.state.root || state.generation !== scan.state.generation || this.host.getCatalog() !== scan.catalog)
      reject('Vault 在预览后发生变化，请重新扫描');
    if (state.blockers.length) reject('存在未保存文档、冲突或未完成写入：' + state.blockers.join('；'));
  }
  private async fileStat(p: string) {
    const stat = await fs.lstat(await resolveInVault(p));
    if (!stat.isFile() || stat.isSymbolicLink()) reject('不是普通附件文件：' + p);
    return stat;
  }
  private async candidate(p: string): Promise<Candidate> {
    const before = await this.fileStat(p);
    // Binary files have no textFile revision; stream a concurrency token, never retain bytes.
    const digest = createHash('sha256');
    for await (const chunk of createReadStream(await resolveInVault(p))) digest.update(chunk);
    const after = await this.fileStat(p);
    if (stampOf(before) !== stampOf(after)) reject('读取期间附件发生变化：' + p);
    return { path: p, size: after.size, mtime: after.mtimeMs, revision: stampOf(after) + ':' + digest.digest('base64url') };
  }
  private async verifyStamps(scan: Scan) {
    await this.verifyDirectories(scan);
    for (const [p, stamp] of scan.stamps) {
      const stat = await fs.lstat(await resolveInVault(p));
      if (stat.isSymbolicLink() || stampOf(stat) !== stamp) reject('扫描期间文件或目录发生变化：' + (p || '/'));
    }
  }
  private async verifyDirectories(scan: Scan) {
    for (const [p, expected] of scan.directories) {
      const actual = (await fs.readdir(await resolveInVault(p))).filter((name) => {
        const rel = p ? p + '/' + name : name;
        return !under(rel, scan.trashDirectory) && name !== '.git' && name !== 'node_modules';
      });
      if (actual.length !== expected.size || actual.some((name) => !expected.has(name)))
        reject('目录成员在扫描后发生变化：' + (p || '/'));
    }
  }
  private async scan(options: CleanupOptions): Promise<Scan> {
    const state = await this.host.captureState(), catalog = this.host.getCatalog();
    if (state.root !== await getVaultRoot()) reject('Vault 状态尚未就绪');
    const trashDirectory = (await getSettings()).vault.trash;
    if (!trashDirectory || trashDirectory.startsWith('/') || /[:\\\0]/.test(trashDirectory) ||
      trashDirectory.split('/').some((part) => !part || part === '.' || part === '..' || comparable(part) === '.git')) reject('回收站必须位于 Vault 内且不能使用 Git 元数据目录', 400);
    await resolveInVault(trashDirectory);
    const issues: CleanupIssue[] = [], protectedItems: CleanupPreview['protected'] = [];
    const stamps = new Map<string, string>(), directories = new Map<string, Set<string>>(), referenced = new Set<string>();
    const protectedExtensions = new Set<string>();
    const pluginData = new Map<string, string>();
    const sources = new Set<string>(), possible: string[] = [];
    const issue = (p: string, code: string, message: string, blocking = true) => issues.push({ path: p, code, message, blocking });
    for (const blocker of state.blockers) issue('', 'workspace', blocker);
    const ignored = (p: string) => under(p, trashDirectory) || p.split('/').some((part) => part === '.git' || part === 'node_modules');
    const exclude = (p: string) => options.excludeDirectories.some((dir) => under(p.toLocaleLowerCase('en-US'), dir.toLocaleLowerCase('en-US'))) || options.excludeExtensions.includes(extOf(p));
    for (const [p, entry] of catalog.entries) {
      if (entry.kind !== 'file' || ignored(p)) continue;
      const ext = extOf(p);
      if (SOURCE_EXTENSIONS.has(ext)) sources.add(p);
      if (ATTACHMENT_EXTENSIONS.has(ext)) {
        if (exclude(p)) protectedItems.push({ path: p, reason: '用户排除' }); else possible.push(p);
      } else {
        protectedItems.push({ path: p, reason: SOURCE_EXTENSIONS.has(ext) ? '文档或配置' : '未知格式或插件数据' });
        if (!SOURCE_EXTENSIONS.has(ext)) issue(p, 'unknown-format', '未知格式已保护，不作为清理候选；未解析其私有内部依赖', false);
      }
    }
    // Reconcile existing catalog directories with current disk membership. This is a
    // consistency check, not a second membership index or persistent watcher.
    for (const dir of ['', ...[...catalog.entries].filter(([, e]) => e.kind === 'folder').map(([p]) => p)]) {
      if (ignored(dir)) continue;
      try {
        const abs = await resolveInVault(dir), stat = await fs.lstat(abs);
        if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('目录类型变化或符号链接');
        stamps.set(dir, stampOf(stat));
        const contents = await fs.readdir(abs, { withFileTypes: true });
        directories.set(dir, new Set(contents.filter((e) => !ignored(dir ? dir + '/' + e.name : e.name)).map((e) => e.name)));
        for (const entry of contents) {
          const p = dir ? dir + '/' + entry.name : entry.name;
          if (ignored(p) || p === '.obsidian') continue;
          if (entry.name.startsWith('.') && !entry.isSymbolicLink() && !SOURCE_EXTENSIONS.has(extOf(p))) {
            protectedItems.push({ path: p, reason: '私有隐藏数据，非候选' });
            issue(p, 'hidden-data', '私有隐藏数据已保护，不推断其未声明依赖', false); continue;
          }
          if (entry.isSymbolicLink() || !catalog.entries.has(p)) issue(p, 'membership', '文件尚未进入目录索引或为未知隐藏数据，请重建索引/检查后重试');
        }
      } catch (error) { issue(dir, 'directory-read', errorMessage(error)); }
    }
    // Catalog intentionally excludes dotfiles. Read config explicitly, never index it.
    const scanConfig = async (dir: string) => {
      try {
        const abs = await resolveInVault(dir), stat = await fs.lstat(abs);
        if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('配置目录不是普通目录');
        stamps.set(dir, stampOf(stat));
        const contents = await fs.readdir(abs, { withFileTypes: true });
        directories.set(dir, new Set(contents.filter((e) => !ignored(dir + '/' + e.name)).map((e) => e.name)));
        for (const entry of contents) {
          const p = dir + '/' + entry.name;
          if (ignored(p)) continue;
          if (entry.isSymbolicLink()) { issue(p, 'config-link', '配置包含符号链接'); continue; }
          if (entry.isDirectory()) { await scanConfig(p); continue; }
          if (!entry.isFile()) { issue(p, 'config-type', '未知配置文件类型'); continue; }
          if (under(p, '.obsidian/plugins')) {
            const parts = p.split('/'), pluginId = parts[2], local = parts.slice(3).join('/');
            protectedItems.push({ path: p, reason: '插件资源或数据，永不作为候选' });
            // Presence/implementation assets are not evidence of data dependencies.
            if (local === 'main.js' || local === 'manifest.json') continue;
            if (local === 'styles.css') { sources.add(p); continue; }
            if (SOURCE_EXTENSIONS.has(extOf(p))) { pluginData.set(p, pluginId); sources.add(p); }
            else issue(p, 'plugin-opaque', '私有插件文件已保护；未声明为受支持引用源', false);
          } else if (SOURCE_EXTENSIONS.has(extOf(p))) sources.add(p);
          else { protectedItems.push({ path: p, reason: '未知配置格式' }); issue(p, 'unknown-config', '未知配置已保护；未解析其私有内部依赖', false); }
        }
      } catch (error) {
        if (dir === '.obsidian' && (error as NodeJS.ErrnoException).code === 'ENOENT') return;
        issue(dir, 'config-read', errorMessage(error));
      }
    };
    await scanConfig('.obsidian');
    let scannedSources = 0;
    // Sequential bounded reads keep maintenance I/O outside input/menu hot paths.
    for (const p of sources) {
      try {
        const before = await this.fileStat(p);
        if (before.size > 16 * 1024 * 1024) throw new Error('引用源超过 16 MiB，无法保证完整扫描');
        const snapshot = await readFileSnapshot(p), after = await this.fileStat(p);
        if (stampOf(before) !== stampOf(after)) throw new Error('读取期间引用源发生变化');
        stamps.set(p, stampOf(after));
        let collection;
        if (pluginData.has(p)) {
          collection = await this.host.readPluginReferences?.(pluginData.get(p)!, p, snapshot.content)
            ?? readKnownPluginReferences(pluginData.get(p)!, p, snapshot.content);
          if (!collection) issue(p, 'plugin-data', '插件数据已保护并收集显式引用；不推断未声明的私有依赖', false);
        }
        collection ??= collectReferences(p, snapshot.content);
        issues.push(...collection.issues); scannedSources++;
        for (const ext of collection.protectedExtensions ?? []) protectedExtensions.add(ext.toLowerCase());
        for (const ref of collection.references) {
          // Standard URL links are relative to the source; wiki links keep catalog
          // semantics. Protect the union when the spelling supports both interpretations.
          const variants = [ref.target];
          if (ref.relative && !/^(?:\/|\.\.?\/)/.test(ref.target)) variants.push('./' + ref.target);
          for (const target of variants) {
            const resolved = catalog.resolve(target, p, 'allFiles');
            if (resolved.status === 'resolved') referenced.add(resolved.path);
            else if (resolved.status === 'ambiguous') {
              for (const item of resolved.candidates) referenced.add(item);
              issue(p, 'ambiguous', '同名引用的所有候选均受保护：' + target, false);
            } else if (resolved.status === 'denied') issue(p, 'unresolved-local', '本地引用无法安全解析：' + target);
            else if (resolved.status === 'missing') issue(p, 'missing', '未找到引用目标：' + target, false);
          }
        }
      } catch (error) { issue(p, 'source-read', '引用扫描失败：' + errorMessage(error)); }
    }
    const candidates: Candidate[] = [];
    for (const p of possible) {
      if (protectedExtensions.has(extOf(p))) { protectedItems.push({ path: p, reason: '动态引用的扩展名保护范围' }); continue; }
      if (referenced.has(p)) { protectedItems.push({ path: p, reason: '已有引用或同名歧义' }); continue; }
      try {
        const item = await this.candidate(p);
        stamps.set(p, item.revision.split(':').slice(0, 5).join(':'));
        candidates.push(item);
      } catch (error) { issue(p, 'candidate-read', errorMessage(error)); }
    }
    const scan: Scan = {
      state, catalog, stamps, directories, trashDirectory,
      preview: { token: randomUUID(), expiresAt: Date.now() + TTL, candidates, totalBytes: candidates.reduce((n, c) => n + c.size, 0), protected: protectedItems, issues, canExecute: false, scannedSources, options },
    };
    try { this.assertState(scan, await this.host.captureState()); await this.verifyStamps(scan); }
    catch (error) { issue('', 'changed', errorMessage(error)); }
    if (issues.some((i) => i.blocking)) {
      for (const item of candidates) protectedItems.push({ path: item.path, reason: '引用扫描不完整，整轮禁止执行' });
    } else scan.preview.canExecute = true;
    return scan;
  }
}
