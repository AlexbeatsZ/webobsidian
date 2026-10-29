import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { z } from 'zod';
import { validPath, validateManifest, hashPattern, idPattern } from '../../../sync-server/protocol.mjs';
import type { FileSyncPreferences, FileSyncStatus, SyncEntry, SyncOperation } from '../contracts/fileSync.js';
import { resolveVaultPath, vaultPathKey } from './vaultFile.js';
import { hashFile, writeFileFromSource } from './textFile.js';
import { atomicSyncJson, fileSignature, stageLocalFile, stageSyncBlob, withSyncLock } from './syncStorage.js';
import { OrderedSyncTransport, SyncHttpError } from './syncTransport.js';

const hash = z.string().regex(hashPattern);
const identifier = z.string().regex(idPattern);
const entry = z.object({ hash: hash.nullable(), version: z.number().int().positive().safe() });
const change = z.object({ path: z.string().refine(validPath), hash: hash.nullable(), expectedVersion: z.number().int().nonnegative().safe() });
const incoming = z.object({ path: z.string().refine(validPath), expected: hash.nullable(), entry });
const checkpoint = z.object({
  version: z.literal(1), root: z.string(), deviceId: identifier, workspaceId: identifier.nullable(), revision: z.number().int().nonnegative().safe(),
  base: z.record(entry), cache: z.record(z.object({ signature: z.string(), hash })), lastSuccess: z.string().nullable(),
  outbox: z.object({ workspaceId: identifier, deviceId: identifier, operationId: identifier, changes: z.array(change).min(1).max(20000) }).optional(),
  incoming: z.array(incoming).optional(),
  conflict: z.object({ id: identifier, changes: z.array(incoming), local: z.record(hash.nullable()), branches: z.array(z.string()) }).optional(),
});
type Checkpoint = z.infer<typeof checkpoint>;
type Incoming = z.infer<typeof incoming>;
class IncomingConflict extends Error {
  constructor(readonly changes: Incoming[]) { super('待同步文件已有新修改'); }
}
export type ConflictSnapshot = { id: string; files: { path: string; local: string | null; remote: string | null }[] };
type Hooks = {
  publish<T>(work: () => Promise<T>): Promise<T>;
  changed(relative: string, deleted: boolean): Promise<void>;
  conflict?(snapshot: ConflictSnapshot): Promise<string[]>;
};

export class FileSyncEngine {
  private state!: Checkpoint;
  private loaded = false;
  private scanned = false;
  private files = new Map<string, string>();
  private dirty = new Set<string>();
  private running: Promise<FileSyncStatus> | null = null;
  private snapshot: FileSyncStatus;
  private readonly blobs: string;
  private readonly filename: string;

  constructor(readonly root: string, readonly directory: string, readonly preferences: FileSyncPreferences, private readonly hooks: Hooks) {
    this.root = path.resolve(root);
    this.blobs = path.join(directory, 'blobs'); this.filename = path.join(directory, 'checkpoint.json');
    this.snapshot = { enabled: preferences.enabled, endpoints: [...preferences.endpoints], hasToken: !!preferences.token,
      activeEndpoint: null, phase: preferences.enabled ? 'idle' : 'disabled', message: '', lastSuccess: null, conflictDirectory: null, conflictBranches: [] };
  }

  status(): FileSyncStatus { return { ...this.snapshot, endpoints: [...this.snapshot.endpoints], conflictBranches: [...this.snapshot.conflictBranches] }; }
  get busy(): boolean { return this.running !== null; }
  noteChanged(relative: string): void { this.dirty.add(relative); }

  async load(): Promise<void> {
    if (this.loaded) return;
    await fs.mkdir(this.directory, { recursive: true });
    try { this.state = checkpoint.parse(JSON.parse(await fs.readFile(this.filename, 'utf8'))); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('同步检查点损坏，已停止；请保留恢复目录');
      this.state = { version: 1, root: vaultPathKey(this.root), deviceId: randomUUID(), workspaceId: null, revision: 0, base: {}, cache: {}, lastSuccess: null };
    }
    if (this.state.root !== vaultPathKey(this.root)) throw new Error('同步检查点属于另一个 Vault');
    if (this.state.workspaceId) validateManifest({ workspaceId: this.state.workspaceId, revision: this.state.revision, files: this.state.base });
    if (Object.keys(this.state.cache).some(name => !validPath(name)) || Object.keys(this.state.conflict?.local ?? {}).some(name => !validPath(name)))
      throw new Error('同步检查点包含无效路径');
    this.state.base = Object.assign(Object.create(null), this.state.base);
    this.state.cache = Object.assign(Object.create(null), this.state.cache);
    this.loaded = true;
    this.snapshot.lastSuccess = this.state.lastSuccess;
    if (this.state.conflict) this.setConflictStatus();
  }

  async recover(): Promise<void> {
    if (!this.preferences.enabled) return;
    await withSyncLock(this.directory, async () => {
      await this.load();
      if (this.state.incoming?.length) { await this.validateRoot(); await this.applyIncoming(); }
    });
  }

  run(): Promise<FileSyncStatus> {
    if (this.running) return this.running;
    this.running = withSyncLock(this.directory, () => this.pass()).catch(error => {
      this.snapshot.phase = this.state?.incoming?.length ? 'recovery' : 'error';
      this.snapshot.message = error instanceof Error ? error.message : '同步失败，本机文件已保留';
      return this.status();
    }).finally(() => { this.running = null; });
    return this.running;
  }

  private async pass(): Promise<FileSyncStatus> {
    if (!this.preferences.enabled) return this.status();
    await this.load();
    await this.validateRoot();
    if (this.state.conflict) { this.setConflictStatus(); return this.status(); }
    this.snapshot.phase = 'syncing'; this.snapshot.message = ''; this.snapshot.activeEndpoint = null;
    await this.applyIncoming();
    if (this.state.conflict) return this.status();
    await this.scan();
    const transport = new OrderedSyncTransport(this.preferences.endpoints, this.preferences.token);
    let manifest = await transport.select(this.state.workspaceId ? { workspaceId: this.state.workspaceId, revision: this.state.revision } : undefined);
    this.snapshot.activeEndpoint = transport.selected;
    if (!this.state.workspaceId) { this.state.workspaceId = manifest.workspaceId; this.state.revision = manifest.revision; await this.persist(); }
    if (this.state.outbox) {
      const completed = await this.submit(transport);
      if (!completed) throw new Error('远端已有新修改，本机内容已保留，下次同步重新比较');
      manifest = await transport.select({ workspaceId: this.state.workspaceId!, revision: this.state.revision });
      this.snapshot.activeEndpoint = transport.selected;
    }
    const changes: SyncOperation['changes'] = [];
    const downloads: Incoming[] = []; const conflicts: Incoming[] = [];
    const acknowledgements: Record<string, SyncEntry> = {};
    for (const name of new Set([...this.files.keys(), ...Object.keys(this.state.base), ...Object.keys(manifest.files)])) {
      const local = this.files.get(name) ?? null;
      const base = this.state.base[name]?.hash ?? null;
      const remote = Object.hasOwn(manifest.files, name) ? manifest.files[name] : { hash: null, version: 0 };
      if (remote.version < (this.state.base[name]?.version ?? 0)) throw new Error('远端文件版本回退，已停止同步');
      if (this.state.base[name]?.version === remote.version && this.state.base[name].hash !== remote.hash)
        throw new Error('远端文件内容与已确认版本不一致，已停止同步');
      if (local === remote.hash) { if (remote.version) acknowledgements[name] = remote; continue; }
      if (local === base) downloads.push({ path: name, expected: local, entry: remote });
      else if (remote.hash === base) changes.push({ path: name, expectedVersion: remote.version, hash: local });
      else conflicts.push({ path: name, expected: local, entry: remote });
    }
    if (conflicts.length) {
      await this.retainConflicts(transport, conflicts);
      return this.status();
    }
    for (const item of downloads) if (item.entry.hash) await this.download(transport, item.entry.hash);
    Object.assign(this.state.base, acknowledgements);
    this.state.revision = Math.max(this.state.revision, manifest.revision);
    if (downloads.length) this.state.incoming = downloads;
    if (changes.length) {
      if (changes.length > 20000) throw new Error('单批同步超过 20000 个文件，请分批导入');
      this.state.outbox = { workspaceId: manifest.workspaceId, deviceId: this.state.deviceId, operationId: randomUUID(), changes };
    }
    await this.persist();
    await this.applyIncoming();
    if (this.state.conflict) return this.status();
    if (this.state.outbox && !await this.submit(transport)) throw new Error('远端已有新修改，本机内容已保留，下次同步重新比较');
    this.state.lastSuccess = new Date().toISOString(); await this.persist();
    this.snapshot.lastSuccess = this.state.lastSuccess; this.snapshot.phase = 'idle'; this.snapshot.message = '同步完成';
    return this.status();
  }

  private async submit(transport: OrderedSyncTransport): Promise<boolean> {
    const operation = this.state.outbox!;
    try {
      for (const value of new Set(operation.changes.map(item => item.hash).filter((value): value is string => !!value)))
        await transport.upload(value, path.join(this.blobs, value));
      const receipt = await transport.commit(operation);
      Object.assign(this.state.base, receipt.files);
      this.state.revision = Math.max(this.state.revision, receipt.revision);
      delete this.state.outbox; await this.persist();
      return true;
    } catch (error) {
      if (error instanceof SyncHttpError && error.status === 409 && (error.details as { error?: string })?.error === 'version_conflict') {
        delete this.state.outbox; await this.persist(); return false;
      }
      throw error;
    }
  }

  async validateRoot(): Promise<void> {
    if ((await fs.lstat(this.root)).isSymbolicLink()) throw new Error('不能同步符号链接或联接目录');
    for (let current = this.root;; current = path.dirname(current)) {
      for (const marker of ['.stfolder', '.stignore']) {
        try { await fs.access(path.join(current, marker)); }
        catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error; }
        throw new Error('此目录由 Syncthing 管理，请选择独立副本后启用内置同步');
      }
      if (path.dirname(current) === current) break;
    }
  }

  private async scan(): Promise<void> {
    const requested = this.scanned ? [...this.dirty] : ['']; this.dirty.clear();
    const inspect = async (relative: string): Promise<void> => {
      if (relative && relative !== '.obsidian' && !validPath(relative)) return;
      const absolute = relative ? await resolveVaultPath(this.root, relative, true) : this.root;
      let info;
      try { info = await fs.lstat(absolute); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        for (const name of this.files.keys()) if (name === relative || name.startsWith(`${relative}/`)) { this.files.delete(name); delete this.state.cache[name]; }
        return;
      }
      if (info.isSymbolicLink()) throw new Error('同步目录包含符号链接或联接，请移出后重试');
      if (info.isDirectory()) {
        const names = await fs.readdir(absolute);
        if (names.includes('.stfolder')) throw new Error('同步目录包含 Syncthing 管理的文件夹');
        for (const name of names) await inspect(relative ? `${relative}/${name}` : name);
        return;
      }
      if (!info.isFile()) throw new Error('同步仅支持普通文件');
      const signature = fileSignature(info);
      const previous = this.state.cache[relative];
      const cached = !this.scanned && previous?.signature === signature && await fs.access(path.join(this.blobs, previous.hash)).then(() => true, () => false);
      const digest = cached ? previous.hash : await stageLocalFile(absolute, this.blobs, signature);
      this.state.cache[relative] = { signature, hash: digest }; this.files.set(relative, digest);
    };
    try { for (const relative of requested) await inspect(relative); this.scanned = true; }
    catch (error) { for (const relative of requested) this.dirty.add(relative); throw error; }
  }

  private async download(transport: OrderedSyncTransport, digest: string): Promise<void> {
    const filename = path.join(this.blobs, digest);
    if (await hashFile(filename) === digest) return;
    const response = await transport.request(`blobs/${digest}`);
    if (!response.body) throw new Error('附件下载没有返回数据');
    await stageSyncBlob(Readable.fromWeb(response.body as never), this.blobs, digest);
  }

  private async applyIncoming(): Promise<void> {
    if (!this.state.incoming?.length) return;
    try { await this.hooks.publish(async () => {
      const current: Incoming[] = [];
      let conflicted = false;
      for (const item of this.state.incoming!) {
        const absolute = await resolveVaultPath(this.root, item.path, true);
        const actual = await hashFile(absolute);
        current.push({ ...item, expected: actual });
        if (actual !== item.expected && actual !== item.entry.hash) conflicted = true;
      }
      if (conflicted) {
        for (const item of current) if (item.expected) {
          const absolute = await resolveVaultPath(this.root, item.path, true);
          const digest = await stageLocalFile(absolute, this.blobs, fileSignature(await fs.stat(absolute)));
          if (digest !== item.expected) throw new Error('本机文件仍在修改，已暂停恢复');
        }
        throw new IncomingConflict(current);
      }
      for (const item of this.state.incoming!) {
        const absolute = await resolveVaultPath(this.root, item.path, true);
        const actual = await hashFile(absolute);
        if (actual !== item.entry.hash) {
          if (actual !== item.expected) throw new Error('待同步文件已有新修改，未覆盖；请保留恢复目录');
          const source = item.entry.hash ? path.join(this.blobs, item.entry.hash) : null;
          if (source && await hashFile(source) !== item.entry.hash) throw new Error('待恢复附件不完整，未修改笔记');
          await writeFileFromSource(absolute, source, item.expected);
        }
        this.state.base[item.path] = item.entry;
        if (item.entry.hash) {
          this.files.set(item.path, item.entry.hash);
          this.state.cache[item.path] = { signature: fileSignature(await fs.stat(absolute)), hash: item.entry.hash };
        } else { this.files.delete(item.path); delete this.state.cache[item.path]; }
        await this.hooks.changed(item.path, !item.entry.hash);
      }
      delete this.state.incoming; await this.persist();
    }); } catch (error) {
      if (!(error instanceof IncomingConflict)) throw error;
      await this.retainConflicts(null, error.changes);
      delete this.state.incoming; await this.persist();
    }
  }

  private async retainConflicts(transport: OrderedSyncTransport | null, changes: Incoming[]): Promise<void> {
    const id = randomUUID(); const directory = path.join(this.directory, 'conflicts', id);
    const local: Record<string, string | null> = {};
    const snapshot: ConflictSnapshot = { id, files: [] };
    for (const item of changes) {
      local[item.path] = item.expected;
      if (item.entry.hash && transport) await this.download(transport, item.entry.hash);
      for (const [side, digest] of [['local', item.expected], ['remote', item.entry.hash]] as const) {
        if (!digest) continue;
        const target = path.join(directory, side, item.path);
        await fs.mkdir(path.dirname(target), { recursive: true }); await fs.copyFile(path.join(this.blobs, digest), target);
      }
      snapshot.files.push({ path: item.path, local: item.expected ? path.join(this.blobs, item.expected) : null,
        remote: item.entry.hash ? path.join(this.blobs, item.entry.hash) : null });
    }
    await atomicSyncJson(path.join(directory, 'conflict.json'), { changes, local });
    if (!transport) delete this.state.incoming;
    this.state.conflict = { id, changes, local, branches: [] }; await this.persist();
    let branchError = '';
    if (this.hooks.conflict) {
      try { this.state.conflict.branches = await this.hooks.conflict(snapshot); await this.persist(); }
      catch (error) { branchError = `；Git 分支保存失败：${(error as Error).message}`; }
    }
    this.setConflictStatus();
    this.snapshot.message += branchError;
  }

  resolveConflict(choice: 'local' | 'remote' | 'recheck'): Promise<FileSyncStatus> {
    if (this.running) return Promise.reject(new Error('同步正在进行，请稍后重试'));
    this.running = withSyncLock(this.directory, () => this.resolveImpl(choice)).finally(() => { this.running = null; });
    return this.running;
  }

  private async resolveImpl(choice: 'local' | 'remote' | 'recheck'): Promise<FileSyncStatus> {
    await this.load();
    const conflict = this.state.conflict;
    if (!conflict) return this.status();
    if (choice === 'recheck') {
      delete this.state.conflict; await this.persist(); this.scanned = false;
      this.snapshot.conflictDirectory = null; this.snapshot.conflictBranches = [];
      return this.pass();
    }
    const transport = new OrderedSyncTransport(this.preferences.endpoints, this.preferences.token);
    const manifest = await transport.select({ workspaceId: this.state.workspaceId!, revision: this.state.revision });
    for (const item of conflict.changes) {
      const actual = await hashFile(await resolveVaultPath(this.root, item.path, true));
      if (actual !== conflict.local[item.path] || manifest.files[item.path]?.version !== item.entry.version || manifest.files[item.path]?.hash !== item.entry.hash)
        throw new Error('冲突产生后文件已变化，保留的两版不再是当前版本，请先检查恢复目录');
    }
    for (const item of conflict.changes) this.state.base[item.path] = item.entry;
    if (choice === 'remote') this.state.incoming = conflict.changes;
    else delete this.state.incoming;
    delete this.state.conflict; await this.persist();
    await this.applyIncoming();
    this.scanned = false; this.snapshot.conflictDirectory = null; this.snapshot.conflictBranches = [];
    return this.pass();
  }

  private setConflictStatus(): void {
    const conflict = this.state.conflict!;
    this.snapshot.phase = 'conflict'; this.snapshot.message = `发现 ${conflict.changes.length} 个冲突，已保留本机与远端两版`;
    this.snapshot.conflictDirectory = path.join(this.directory, 'conflicts', conflict.id);
    this.snapshot.conflictBranches = [...conflict.branches];
  }
  private persist(): Promise<void> { return atomicSyncJson(this.filename, this.state); }
}
