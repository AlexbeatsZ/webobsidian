import type { SourceSpan } from '@webobsidian/markdown-core';

/** Overlap lookup also handles nested ranges by keeping prefix maximum ends. */
export function overlapIndex(ranges: readonly SourceSpan[]) {
  const sorted = [...ranges].sort((a, b) => a.from - b.from);
  const ends: number[] = [];
  for (const range of sorted) ends.push(Math.max(ends.at(-1) ?? -1, range.to));
  return (span: SourceSpan) => {
    let lo = 0, hi = sorted.length;
    while (lo < hi) { const mid = (lo + hi) >>> 1; if (sorted[mid].from < span.to) lo = mid + 1; else hi = mid; }
    return lo > 0 && ends[lo - 1] > span.from;
  };
}
