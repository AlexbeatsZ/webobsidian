import { DocumentSession, type DocumentSnapshot } from '@webobsidian/markdown-core';
import { api } from './api';
import { WorkspaceDocumentSession } from './tags/folderSession';

/** Workspace service, deliberately outside the renderer. */
export class DocumentRegistry {
  private sessions = new Map<string, DocumentSession>();
  private pending = new Map<string, Promise<DocumentSession>>();
  private refreshAgain = new Set<string>();
  private deferredRefreshes = new Set<string>();
  private listeners = new Set<(snapshot: DocumentSnapshot) => void>();
  private timers = new Map<DocumentSession, ReturnType<typeof setTimeout>>();
  private stops = new Map<DocumentSession, () => void>();
  private pathQueue: Promise<unknown> = Promise.resolve();
  pathVersion = 0;
  private changing: { from: string; to?: string; done: Promise<unknown> } | undefined;
  onError: (error: unknown) => void = console.error;
  isOpen: (path: string) => boolean = () => false;
  canRefresh: (path: string) => boolean = () => true;

  get(path: string): DocumentSession | undefined { return this.sessions.get(path); }
  /** Current saved/unsaved state for explicit maintenance operations. */
  snapshots(): DocumentSnapshot[] { return [...this.sessions.values()].map(session => session.snapshot); }
  subscribe(listener: (snapshot: DocumentSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  async open(path: string): Promise<DocumentSession> {
    await this.waitForPath(path);
    const existing = this.sessions.get(path);
    if (existing?.snapshot.dirty) return existing;
    if (existing) return this.refresh(path);
    const pending = this.pending.get(path);
    if (pending) return pending;
    const loading = api.read(path).then((file) => {
      const session = new WorkspaceDocumentSession(path, file.content, file.revision, (id, raw, revision) => api.write(id, raw, revision));
      this.sessions.set(path, session);
      let version = session.snapshot.version, locked = !!session.snapshot.locked;
      this.stops.set(session, session.subscribe(() => {
        const snapshot = session.snapshot;
        if (!snapshot.dirty || snapshot.conflict || snapshot.locked) this.cancelSave(session);
        else if (snapshot.version !== version || locked) {
          this.cancelSave(session);
          this.timers.set(session, setTimeout(() => {
            this.timers.delete(session);
            void session.save().catch(error => this.onError(error));
          }, 900));
        }
        version = snapshot.version;
        locked = !!snapshot.locked;
        for (const listener of this.listeners) listener(snapshot);
      }));
      return session;
    }).finally(() => this.pending.delete(path));
    this.pending.set(path, loading);
    return loading;
  }

  /** Observe disk refreshes even when a session is dirty, without discarding it. */
  async refresh(path: string): Promise<DocumentSession> {
    const requested = this.sessions.get(path);
    await this.waitForPath(path);
    if (requested && this.sessions.get(path) !== requested) return requested;
    const existing = this.sessions.get(path);
    if (!existing) return this.open(path);
    if (!this.canRefresh(path)) { this.deferredRefreshes.add(path); return existing; }
    // A filesystem echo can precede the HTTP save response. Compare only after
    // the existing writer has settled, so its acknowledged bytes are savedRaw.
    await existing.whenSaved().catch(() => {});
    await this.waitForPath(path);
    if (this.sessions.get(path) !== existing) return existing;
    const pending = this.pending.get(path);
    if (pending) {
      this.refreshAgain.add(path);
      return pending.then(() => this.refreshAgain.delete(path) ? this.refresh(path) : existing);
    }
    const loading = (async () => {
      do {
        this.refreshAgain.delete(path);
        const revision = existing.snapshot.revision;
        const file = await api.read(path);
        await existing.whenSaved().catch(() => {});
        if (this.sessions.get(path) !== existing) return existing;
        // A save completed during the read: its response may acknowledge bytes
        // newer than this read. Read again rather than rolling them back.
        if (existing.snapshot.revision !== revision) { this.refreshAgain.add(path); continue; }
        if (!this.canRefresh(path)) { this.deferredRefreshes.add(path); break; }
        existing.acceptExternal(file.content, file.revision);
      } while (this.refreshAgain.has(path));
      return existing;
    })().finally(() => this.pending.delete(path));
    this.pending.set(path, loading);
    return loading;
  }

  async saveLeaving(path: string | null | undefined): Promise<void> {
    const session = path ? this.sessions.get(path) : undefined;
    if (!session) return;
    if (path && !this.canRefresh(path)) throw new Error('请先完成 Canvas 卡片或连线编辑');
    if (session.snapshot.locked || session.snapshot.conflict) throw new Error('笔记正在移动或存在冲突，请处理后重试');
    if (session.snapshot.dirty || session.snapshot.saving) await session.save();
    if (session.snapshot.dirty || session.snapshot.conflict || session.snapshot.locked) throw new Error('笔记保存期间又有修改，请保存后重试');
  }

  flushDeferredRefreshes() {
    for (const path of this.deferredRefreshes) if (this.canRefresh(path)) {
      this.deferredRefreshes.delete(path);
      void this.refresh(path).catch(error => this.onError(error));
    }
  }

  async pathsSettled() { await this.pathQueue.catch(() => {}); }

  /** Rename/delete callers share one save/freeze/identity transaction. */
  changePath<T>(from: string, to: string | undefined, work: () => Promise<T>, apply: () => void): Promise<T> {
    const job = this.pathQueue.catch(() => {}).then(async () => {
      this.pathVersion++;
      const loads = [...this.pending.values()];
      let done!: () => void;
      const gate = new Promise<void>(resolve => { done = resolve; });
      this.changing = { from, to, done: gate };
      const releases: (() => void)[] = [];
      try {
        await Promise.allSettled(loads);
        const affected = [...this.sessions].filter(([id]) => this.under(id, from));
        const targets = to ? [...this.sessions].filter(([id]) => this.under(id, to) && !this.under(id, from)) : [];
        if (targets.some(([id, session]) => this.isOpen(id) || session.snapshot.dirty || session.snapshot.conflict || session.snapshot.saving))
          throw new Error('目标路径仍有打开、未保存或冲突的文档，请先处理后重试');
        for (const [id] of affected) await this.saveLeaving(id);
        for (const [, session] of affected) releases.push(session.holdEdits());
        if (affected.some(([, session]) => session.snapshot.dirty || session.snapshot.saving || session.snapshot.conflict))
          throw new Error('笔记保存期间又有修改，请保存后重试');
        const result = await work();
        for (const [id, session] of targets) {
          this.cancelSave(session); this.stops.get(session)?.(); this.stops.delete(session); this.sessions.delete(id);
        }
        for (const [id, session] of affected) {
          this.sessions.delete(id);
          this.cancelSave(session);
          if (to) {
            const next = to + id.slice(from.length);
            this.sessions.set(next, session);
            session.relocate(next);
          } else { this.stops.get(session)?.(); this.stops.delete(session); }
        }
        apply();
        return result;
      } finally {
        for (const release of releases) release();
        this.changing = undefined;
        this.pathVersion++;
        done();
      }
    });
    this.pathQueue = job;
    return job;
  }

  private under(path: string, root: string) { return path === root || path.startsWith(root + '/'); }
  private async waitForPath(path: string) {
    const change = this.changing;
    if (change && (this.under(path, change.from) || change.to && this.under(path, change.to))) await change.done;
  }
  private cancelSave(session: DocumentSession) {
    clearTimeout(this.timers.get(session));
    this.timers.delete(session);
  }
}

export const documents = new DocumentRegistry();
