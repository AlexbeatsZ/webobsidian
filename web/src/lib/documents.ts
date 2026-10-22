import { DocumentSession, type DocumentSnapshot } from '@webobsidian/markdown-core';
import { api } from './api';
import { WorkspaceDocumentSession } from './tags/folderSession';

/** Workspace service, deliberately outside the renderer. */
export class DocumentRegistry {
  private sessions = new Map<string, DocumentSession>();
  private pending = new Map<string, Promise<DocumentSession>>();
  private listeners = new Set<(snapshot: DocumentSnapshot) => void>();

  get(path: string): DocumentSession | undefined { return this.sessions.get(path); }
  /** Current saved/unsaved state for explicit maintenance operations. */
  snapshots(): DocumentSnapshot[] { return [...this.sessions.values()].map(session => session.snapshot); }
  subscribe(listener: (snapshot: DocumentSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  async open(path: string): Promise<DocumentSession> {
    const existing = this.sessions.get(path);
    if (existing?.snapshot.dirty) return existing;
    const pending = this.pending.get(path);
    if (pending) return pending;
    const loading = api.read(path).then((file) => {
      if (existing) { existing.acceptExternal(file.content, file.revision); return existing; }
      const session = new WorkspaceDocumentSession(path, file.content, file.revision, (id, raw, revision) => api.write(id, raw, revision));
      this.sessions.set(path, session);
      session.subscribe(() => { for (const listener of this.listeners) listener(session.snapshot); });
      return session;
    }).finally(() => this.pending.delete(path));
    this.pending.set(path, loading);
    return loading;
  }

  /** Observe disk refreshes even when a session is dirty, without discarding it. */
  async refresh(path: string): Promise<DocumentSession> {
    const existing = this.sessions.get(path);
    if (!existing) return this.open(path);
    const pending = this.pending.get(path);
    if (pending) return pending;
    const loading = api.read(path).then(file => {
      existing.acceptExternal(file.content, file.revision);
      return existing;
    }).finally(() => this.pending.delete(path));
    this.pending.set(path, loading);
    return loading;
  }
}

export const documents = new DocumentRegistry();
