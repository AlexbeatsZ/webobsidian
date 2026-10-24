import { SourceDocument, changesBetween, type SourceChange } from './source.js';
import { analyzeMarkdown, updateMarkdown, type MarkdownModel } from './syntax.js';

export interface DocumentSnapshot {
  readonly historyState?: { owner: string; value: unknown };
  readonly id: string;
  readonly version: number;
  readonly text: string;
  readonly raw: string;
  readonly revision: string | undefined;
  readonly dirty: boolean;
  readonly saving: boolean;
  readonly conflict: boolean;
  readonly locked?: boolean;
}
export type DocumentWriter = (id: string, raw: string, baseRevision?: string) => Promise<{ revision?: string }>;
export interface EditHistoryState { owner: string; before: unknown; after: unknown }
type UndoGroup = { edits: SourceChange[][]; origin: string; at: number; state?: EditHistoryState };

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
  private model: MarkdownModel | undefined;
  private historyState: DocumentSnapshot['historyState'];
  private userEdits = 0;
  private editLocks = 0;
  get userEditVersion(): number { return this.userEdits; }

  constructor(private documentId: string, raw: string, revision: string | undefined, private writer: DocumentWriter) {
    this.source = new SourceDocument(raw);
    this.savedRaw = raw;
    this.revision = revision;
    this.current = this.createSnapshot();
  }

  get snapshot(): DocumentSnapshot { return this.current; }
  get id(): string { return this.documentId; }
  /** Explicit file operations freeze edits while saving and changing identity. */
  holdEdits(): () => void {
    this.editLocks++;
    this.emit();
    let released = false;
    return () => { if (!released) { released = true; this.editLocks--; this.emit(); } };
  }
  relocate(id: string): void {
    if (this.saving || this.current.dirty || this.conflict) throw new Error('Save the document before changing its path');
    this.documentId = id;
    this.model = undefined;
    this.version++;
    this.emit();
  }
  /** Lazy, shared by views/embeds/metadata, unaffected by save-state snapshots. */
  get analysis(): MarkdownModel {
    if (this.model?.version === this.version) return this.model;
    const text = this.source.text;
    if (this.model) {
      const before = this.model.text;
      let from = 0, to = before.length, insertTo = text.length;
      while (from < to && from < insertTo && before[from] === text[from]) from++;
      while (to > from && insertTo > from && before[to - 1] === text[insertTo - 1]) { to--; insertTo--; }
      this.model = updateMarkdown(this.model, text, [{ fromA: from, toA: to, fromB: from, toB: insertTo }], this.version);
    } else this.model = analyzeMarkdown(text, this.id, this.version);
    return this.model;
  }
  /** Adopt the model the originating editor already computed for this exact text. */
  acceptAnalysis(model: MarkdownModel): void {
    if (model.id === this.id && model.text === this.source.text) {
      this.model = model.version === this.version ? model : { ...model, version: this.version };
    }
  }
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  edit(baseVersion: number, changes: readonly SourceChange[], origin = 'edit', state?: EditHistoryState): void {
    if (this.editLocks) throw new Error('Document path is changing; editing is temporarily paused');
    if (baseVersion !== this.version) throw new Error('Document changed before edit could be applied');
    if (!changes.length) return;
    this.historyState = undefined;
    const before = this.source.raw;
    const inverse = this.source.apply(changes);
    if (this.source.raw === before) return;
    if (origin !== 'format') this.userEdits++;
    const now = Date.now();
    const previous = this.undoStack.at(-1);
    if (previous?.origin === origin && (origin.startsWith('input.type:') && now - previous.at < 500 || origin.startsWith('snippet:'))) {
      previous.edits.push(inverse);
      previous.at = now;
      if (previous.state && state?.owner === previous.state.owner) previous.state.after = state.after;
    } else this.undoStack.push({ edits: [inverse], origin, at: now, state });
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
    const raw = preserveRaw ? new SourceDocument(text) : undefined;
    let delta=0;
    const changes=changesBetween(before,normalized).map(change=>{
      const start=change.from+delta;delta+=change.insert.length-(change.to-change.from);
      return {...change,...(raw?{rawInsert:raw.raw.slice(raw.rawOffset(start),raw.rawOffset(start+change.insert.length))}:{})};
    });
    this.edit(this.version, changes, origin);
  }

  undo(): boolean { return this.moveHistory(this.undoStack, this.redoStack, false); }
  redo(): boolean { return this.moveHistory(this.redoStack, this.undoStack, true); }

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
    this.historyState = undefined;
    this.conflict = false;
    this.emit();
    return true;
  }

  save(expectedRaw?: string): Promise<void> {
    if (expectedRaw !== undefined && this.source.raw !== expectedRaw)
      return Promise.reject(new Error('Reviewed content changed before save; edits were preserved'));
    if (this.conflict) return Promise.reject(new Error('External changes conflict with local edits; save stopped'));
    this.requested = true;
    if (!this.pending) this.pending = this.persist().finally(() => { this.pending = undefined; });
    return this.pending;
  }

  /** Await an existing writer without requesting another save or formatting. */
  whenSaved(): Promise<void> { return this.pending ?? Promise.resolve(); }

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

  private moveHistory(from: UndoGroup[], to: UndoGroup[], redo: boolean): boolean {
    if (this.editLocks) return false;
    const group = from.pop();
    if (!group) return false;
    const inverse: SourceChange[][] = [];
    for (const edit of [...group.edits].reverse()) inverse.push(this.source.apply(edit));
    to.push({ edits: inverse, origin: group.origin, at: 0, state: group.state });
    this.historyState = group.state ? { owner: group.state.owner, value: redo ? group.state.after : group.state.before } : undefined;
    this.userEdits++;
    this.version++;
    this.emit();
    return true;
  }

  private createSnapshot(): DocumentSnapshot {
    return Object.freeze({ id: this.id, version: this.version, text: this.source.text, raw: this.source.raw,
      historyState: this.historyState,
      revision: this.revision, dirty: this.source.raw !== this.savedRaw, saving: this.saving, conflict: this.conflict, locked: this.editLocks > 0 });
  }
  private emit(): void {
    this.current = this.createSnapshot();
    for (const listener of this.listeners) listener();
  }
}
