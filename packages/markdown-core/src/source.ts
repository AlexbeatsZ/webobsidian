/** Positions are UTF-16 offsets in the LF editor text, never DOM offsets. */
export interface SourceChange {
  from: number;
  to: number;
  insert: string;
  /** Used by inverse edits to restore the exact removed line endings. */
  rawInsert?: string;
}

export class SourceDocument {
  private value: string;
  private normalized = '';
  private offsets: number[] = [];
  readonly lineEnding: string;

  constructor(raw: string) {
    this.value = raw;
    const counts = new Map<string, number>();
    for (const match of raw.matchAll(/\r\n|\r|\n/g)) counts.set(match[0], (counts.get(match[0]) ?? 0) + 1);
    this.lineEnding = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '\n';
    this.index();
  }

  get raw(): string { return this.value; }
  get text(): string { return this.normalized; }

  rawOffset(position: number): number {
    if (!Number.isInteger(position) || position < 0 || position > this.normalized.length) {
      throw new RangeError('Source position outside document');
    }
    return this.offsets[position];
  }

  /** Apply simultaneous ranges. Returns an inverse suitable for exact undo. */
  apply(changes: readonly SourceChange[]): SourceChange[] {
    const sorted = [...changes].sort((a, b) => a.from - b.from || a.to - b.to);
    let end = 0;
    let delta = 0;
    const inverse: SourceChange[] = [];
    const replacements: { from: number; to: number; insert: string }[] = [];
    for (const change of sorted) {
      if (change.from < end || change.to < change.from) throw new RangeError('Overlapping source edits');
      const from = this.rawOffset(change.from);
      const to = this.rawOffset(change.to);
      const insert = change.insert.replace(/\r\n|\r/g, '\n');
      if (change.rawInsert !== undefined && change.rawInsert.replace(/\r\n|\r/g, '\n') !== insert) {
        throw new Error('Inverse source does not match editor text');
      }
      replacements.push({ from, to, insert: change.rawInsert ?? insert.replace(/\n/g, this.lineEnding) });
      inverse.push({
        from: change.from + delta,
        to: change.from + delta + insert.length,
        insert: this.normalized.slice(change.from, change.to),
        rawInsert: this.value.slice(from, to),
      });
      delta += insert.length - (change.to - change.from);
      end = change.to;
    }
    for (const replacement of replacements.reverse()) {
      this.value = this.value.slice(0, replacement.from) + replacement.insert + this.value.slice(replacement.to);
    }
    this.index();
    return inverse;
  }

  private index(): void {
    const chunks: string[] = [];
    let offset = this.value.startsWith('\ufeff') ? 1 : 0;
    this.offsets = [offset];
    while (offset < this.value.length) {
      const char = this.value[offset++];
      if (char === '\r') {
        if (this.value[offset] === '\n') offset++;
        chunks.push('\n');
      } else chunks.push(char);
      this.offsets.push(offset);
    }
    this.normalized = chunks.join('');
  }
}
