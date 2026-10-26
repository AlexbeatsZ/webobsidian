import { contentTargets, extractMetadata, updateMarkdown, type DocumentSnapshot, type SourceChange } from '@webobsidian/markdown-core';
import type { FragmentEditBinding } from './renderContext';

export class EmbedProjection {
  private cachedSource?: DocumentSnapshot;
  private cached?: DocumentSnapshot;
  private cachedWritable?: boolean;
  private stopped = false;
  private prepared?: { version: number; changes: readonly SourceChange[]; result: { mapped: SourceChange[]; candidate: ReturnType<typeof updateMarkdown> } };
  constructor(readonly binding: FragmentEditBinding) {}

  stop() { this.stopped = true; this.cachedSource = undefined; }
  get range() { return this.binding.resolveRange(this.binding.session.analysis); }
  get writable() {
    const source = this.binding.session.snapshot;
    return !this.stopped && !source.locked && !source.conflict && !!this.range;
  }
  get snapshot(): DocumentSnapshot {
    const source = this.binding.session.snapshot;
    const writable = this.writable;
    if (this.cachedSource !== source || this.cachedWritable !== writable || !this.cached) {
      const range = this.range;
      const text = range ? source.text.slice(range.from, range.to) : '';
      this.cached = { ...source, text, raw: text, historyState: undefined, locked: !writable };
      this.cachedSource = source;
      this.cachedWritable = writable;
    }
    return this.cached;
  }

  prepare(version: number, changes: readonly SourceChange[]) {
    const session = this.binding.session, range = this.range;
    if (!this.writable || !range || session.snapshot.version !== version) throw new Error('嵌入源文档已改变，请重新进入编辑');
    const prepared = this.prepared;
    if (prepared?.version === version && prepared.changes.length === changes.length && changes.every((change, index) => {
      const previous = prepared.changes[index];
      return change.from === previous.from && change.to === previous.to && change.insert === previous.insert;
    })) return prepared.result;
    const mapped = changes.map(change => {
      if (!Number.isInteger(change.from) || !Number.isInteger(change.to) || change.from < 0 || change.to < change.from || change.to > range.to - range.from)
        throw new Error('编辑超出嵌入范围');
      return { from: range.from + change.from, to: range.from + change.to, insert: change.insert.replace(/\r\n|\r/g, '\n') };
    }).sort((left, right) => left.from - right.from || left.to - right.to);
    const model = session.analysis;
    const anchors = [...extractMetadata(model).blockIds, ...contentTargets(model).targets.flatMap(target => target.protectedSpans)];
    let end = range.from, delta = 0, text = '', cursor = 0;
    const edits = mapped.map(change => {
      if (change.from < end || anchors.some(anchor => change.from < anchor.to && change.to > anchor.from ||
        change.from === change.to && change.from > anchor.from && change.from < anchor.to)) throw new Error('不能修改嵌入标识或边界');
      text += model.text.slice(cursor, change.from) + change.insert;
      cursor = change.to; end = change.to;
      const edit = { fromA: change.from, toA: change.to, fromB: change.from + delta, toB: change.from + delta + change.insert.length };
      delta += change.insert.length - (change.to - change.from);
      return edit;
    });
    text += model.text.slice(cursor);
    const candidate = updateMarkdown(model, text, edits, version + 1);
    const next = this.binding.resolveRange(candidate);
    if (!next || next.kind !== range.kind || next.from !== range.from || next.to !== range.to + delta)
      throw new Error('编辑会改变嵌入标识、类型或边界');
    const result = { mapped, candidate };
    this.prepared = { version, changes: changes.map(change => ({ ...change })), result };
    return result;
  }

  edit(version: number, changes: readonly SourceChange[], origin: string) {
    const { mapped, candidate } = this.prepare(version, changes);
    this.binding.session.edit(version, mapped, origin);
    this.binding.session.acceptAnalysis(candidate);
    return this.snapshot;
  }
  history(redo: boolean) {
    if (this.writable) {
      if (redo) this.binding.session.redo(); else this.binding.session.undo();
    }
    return this.snapshot;
  }
}
