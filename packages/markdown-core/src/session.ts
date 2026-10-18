import { SourceDocument, type SourceChange } from './source.js';

export interface DocumentSnapshot {
  readonly id: string;
  readonly version: number;
  readonly text: string;
  readonly raw: string;
  readonly revision: string | undefined;
  readonly dirty: boolean;
  readonly saving: boolean;
  readonly conflict: boolean;
}
export type DocumentWriter = (id: string, raw: string, baseRevision?: string) => Promise<{ revision?: string }>;
type UndoGroup = { edits: SourceChange[][]; origin: string; at: number };

/** One session per document. Views own selections; only this object owns saves. */
export class DocumentSession {
  private source: SourceDocument;
  private savedRaw: string;
  private revision: string | undefined;
  private version = 0;
  private saving = false;
  private conflict = false;
  private pending: Promise<void> | undefined;
  private requested = false;
  private listeners = new Set<() => void>();
  private undoStack: UndoGroup[] = [];
  private redoStack: UndoGroup[] = [];
  private current: DocumentSnapshot;

  constructor(readonly id: string, raw: string, revision: string | undefined, private writer: DocumentWriter) {
    this.source = new SourceDocument(raw);
    this.savedRaw = raw;
    this.revision = revision;
    this.current = this.createSnapshot();
  }

  get snapshot(): DocumentSnapshot { return this.current; }
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  edit(baseVersion: number, changes: readonly SourceChange[], origin = 'edit'): void {
    if (baseVersion !== this.version) throw new Error('Document changed before edit could be applied');
    if (!changes.length) return;
    const before = this.source.raw;
    const inverse = this.source.apply(changes);
    if (this.source.raw === before) return;
    const now = Date.now();
    const previous = this.undoStack.at(-1);
    if (origin.startsWith('input.type:') && previous?.origin === origin && now - previous.at < 500) {
      previous.edits.push(inverse);
      previous.at = now;
    } else this.undoStack.push({ edits: [inverse], origin, at: now });
    this.redoStack = [];
    this.version++;
    this.emit();
  }

  /** Compatibility for callers supplying a complete editor string; patch only its difference. */
  setText(text: string, origin = 'replace'): void {
    this.replaceText(text, origin, false);
  }

  /** Compatibility adapters that already computed exact raw-source patches. */
  setRawText(text: string, origin = 'replace.raw'): void {
    this.replaceText(text, origin, true);
  }

  private replaceText(text: string, origin: string, preserveRaw: boolean): void {
    const normalized = text.replace(/^\ufeff/, '').replace(/\r\n|\r/g, '\n');
    const before = this.source.text;
    if (before === normalized) return;
    let from = 0;
    while (from < before.length && from < normalized.length && before[from] === normalized[from]) from++;
    let to = before.length;
    let insertTo = normalized.length;
    while (to > from && insertTo > from && before[to - 1] === normalized[insertTo - 1]) { to--; insertTo--; }
    const raw = preserveRaw ? new SourceDocument(text) : undefined;
    this.edit(this.version, [{ from, to, insert: normalized.slice(from, insertTo),
      ...(raw ? { rawInsert: raw.raw.slice(raw.rawOffset(from), raw.rawOffset(insertTo)) } : {}),
    }], origin);
  }

  undo(): boolean { return this.moveHistory(this.undoStack, this.redoStack); }
  redo(): boolean { return this.moveHistory(this.redoStack, this.undoStack); }

  /** External updates are accepted only when they cannot discard local work. */
  acceptExternal(raw: string, revision?: string): boolean {
    if (raw === this.savedRaw) return true;
    if (this.current.dirty || this.saving) { this.conflict = true; this.emit(); return false; }
    this.source = new SourceDocument(raw);
    this.savedRaw = raw;
    this.revision = revision;
    this.version++;
    this.undoStack = [];
    this.redoStack = [];
    this.conflict = false;
    this.emit();
    return true;
  }

  save(): Promise<void> {
    if (this.conflict) return Promise.reject(new Error('External changes conflict with local edits; save stopped'));
    this.requested = true;
    if (!this.pending) this.pending = this.persist().finally(() => { this.pending = undefined; });
    return this.pending;
  }

  private async persist(): Promise<void> {
    this.saving = true;
    this.emit();
    try {
      while (this.requested) {
        this.requested = false;
        if (this.source.raw === this.savedRaw) continue;
        const raw = this.source.raw;
        const result = await this.writer(this.id, raw, this.revision);
        this.savedRaw = raw;
        this.revision = result.revision;
      }
    } catch (error) {
      if ((error as { status?: number }).status === 409) this.conflict = true;
      throw error;
    } finally {
      this.saving = false;
      this.emit();
    }
  }

  private moveHistory(from: UndoGroup[], to: UndoGroup[]): boolean {
    const group = from.pop();
    if (!group) return false;
    const inverse: SourceChange[][] = [];
    for (const edit of [...group.edits].reverse()) inverse.push(this.source.apply(edit));
    to.push({ edits: inverse, origin: group.origin, at: 0 });
    this.version++;
    this.emit();
    return true;
  }

  private createSnapshot(): DocumentSnapshot {
    return Object.freeze({ id: this.id, version: this.version, text: this.source.text, raw: this.source.raw,
      revision: this.revision, dirty: this.source.raw !== this.savedRaw, saving: this.saving, conflict: this.conflict });
  }
  private emit(): void {
    this.current = this.createSnapshot();
    for (const listener of this.listeners) listener();
  }
}
