import { diffLines, diffChars, type BaseOptions, type Change } from 'diff';
/** Positions are UTF-16 offsets in the LF editor text, never DOM offsets. */
export interface SourceChange {
  from: number;
  to: number;
  insert: string;
  /** Used by inverse edits to restore the exact removed line endings. */
  rawInsert?: string;
}

/** Range patches for text transforms. Unchanged lines and character runs stay raw. */
export function changesBetween(before: string, after: string): SourceChange[] {
  if(before===after)return [];
  const output:SourceChange[]=[];let offset=0;
  const lines=diffLines(before,after);
  for(let i=0;i<lines.length;){
    if(!lines[i].added&&!lines[i].removed){offset+=lines[i++].value.length;continue;}
    let removed='',inserted='';const from=offset;
    while(i<lines.length&&(lines[i].added||lines[i].removed)){
      const part=lines[i++];if(part.removed){removed+=part.value;offset+=part.value.length;}else inserted+=part.value;
    }
    const chars = (diffChars as (a:string,b:string,o:BaseOptions & {timeout:number})=>Change[]|undefined)(removed,inserted,{timeout:20});
    if(!chars){output.push({from,to:offset,insert:inserted});continue;}
    let p=from,start=from,insert='';let active=false;
    const flush=()=>{if(active)output.push({from:start,to:p,insert});active=false;insert='';};
    for(const part of chars){if(part.added){if(!active){active=true;start=p;}insert+=part.value;}
      else if(part.removed){if(!active){active=true;start=p;}p+=part.value.length;}
      else {flush();p+=part.value.length;}}
    flush();
  }
  return output;
}

export class SourceDocument {
  private value: string;
  private normalized = '';
  /** LF offsets immediately after CRLF; each contributes one extra raw code unit. */
  private crlfEnds: number[] = [];
  private bom = 0;
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
    let lo = 0, hi = this.crlfEnds.length;
    while (lo < hi) { const mid = (lo + hi) >>> 1; if (this.crlfEnds[mid] <= position) lo = mid + 1; else hi = mid; }
    return position + this.bom + lo;
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
    if (!replacements.length) return inverse;
    const chunks: string[] = [];
    let cursor = 0;
    for (const replacement of replacements) {
      chunks.push(this.value.slice(cursor, replacement.from), replacement.insert);
      cursor = replacement.to;
    }
    chunks.push(this.value.slice(cursor));
    this.value = chunks.join('');
    this.index();
    return inverse;
  }

  private index(): void {
    const chunks: string[] = [];
    this.bom = this.value.startsWith('\ufeff') ? 1 : 0;
    this.crlfEnds = [];
    let cursor = this.bom, extra = 0;
    for (const match of this.value.matchAll(/\r\n?/g)) {
      chunks.push(this.value.slice(cursor, match.index), '\n');
      cursor = match.index! + match[0].length;
      if (match[0].length === 2) {
        this.crlfEnds.push(match.index! - this.bom - extra + 1);
        extra++;
      }
    }
    chunks.push(this.value.slice(cursor));
    this.normalized = chunks.join('');
  }
}
