import { extractMetadata, mathRegions, type MarkdownModel, type SourceChange } from '@webobsidian/markdown-core';

export type HeadingDirection = 'promote' | 'demote';
export interface HeadingLevelPlan {
  changes: SourceChange[];
  count: number;
  status: 'ready' | 'no-heading' | 'at-limit';
}

/** Plan marker-only edits over the existing syntax snapshot, never a second parser. */
export function planHeadingLevels(model: MarkdownModel, selection: { from: number; to: number }, direction: HeadingDirection): HeadingLevelPlan {
  const start = Math.max(0, Math.min(model.text.length, selection.from));
  const end = Math.max(start, Math.min(model.text.length, selection.to));
  const from = start === end ? model.text.lastIndexOf('\n', start - 1) + 1 : start;
  const nextLine = model.text.indexOf('\n', start);
  const to = start === end ? (nextLine < 0 ? model.text.length : nextLine) : end;
  const metadata = extractMetadata(model);
  const visible = new Set(metadata.headings.map(heading => heading.from));
  const formulas = mathRegions(model);
  const headings: { from: number; level: number }[] = [];
  for (const node of model.nodes) {
    // Setext and BodyHeading intentionally do not participate. In particular,
    // H6 must never be demoted into the independent seven-hash body syntax.
    if (!/^ATXHeading[1-6]$/.test(node.name) || !visible.has(node.from)) continue;
    const marker = model.text.slice(node.from, node.to).match(/^([ \t]*)(#{1,6})(?=[ \t]|$)/);
    if (!marker) continue;
    const at = node.from + marker[1].length, level = marker[2].length;
    if (at < from || at + level > to || formulas.some(formula => at >= formula.from && at < formula.to)) continue;
    headings.push({ from: at, level });
  }
  if (!headings.length) return { changes: [], count: 0, status: 'no-heading' };
  if (headings.some(heading => heading.level === (direction === 'promote' ? 1 : 6)))
    return { changes: [], count: headings.length, status: 'at-limit' };
  return { status: 'ready', count: headings.length, changes: headings.map(heading => direction === 'promote'
    ? { from: heading.from + heading.level - 1, to: heading.from + heading.level, insert: '' }
    : { from: heading.from + heading.level, to: heading.from + heading.level, insert: '#' }) };
}
