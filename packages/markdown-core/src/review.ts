import { diffLines } from 'diff';

/** Review units are whole lines; editor transactions still use changesBetween. */
export interface ReviewHunk {
  id: string;
  from: number;
  to: number;
  insert: string;
  decision: 'pending' | 'accepted' | 'rejected';
}

export function reviewHunks(before: string, after: string): ReviewHunk[] {
  const result: ReviewHunk[] = [];
  let offset = 0, current: ReviewHunk | undefined;
  for (const part of diffLines(before, after)) {
    if (!part.added && !part.removed) { current = undefined; offset += part.value.length; continue; }
    if (!current) {
      current = { id: `h${result.length + 1}`, from: offset, to: offset, insert: '', decision: 'pending' };
      result.push(current);
    }
    if (part.removed) { offset += part.value.length; current.to = offset; }
    else current.insert += part.value;
  }
  return result;
}

export function materializeReview(before: string, hunks: readonly ReviewHunk[]): string {
  let result = before;
  for (const h of [...hunks].reverse()) if (h.decision === 'accepted')
    result = result.slice(0, h.from) + h.insert + result.slice(h.to);
  return result;
}

function touches(a: ReviewHunk, from: number, to: number): boolean {
  if (a.from === a.to) return a.from >= from && a.from <= to;
  if (from === to) return from >= a.from && from <= a.to;
  return a.from < to && from < a.to;
}

/** Exact line rebase only. A competing insertion on the same edge conflicts. */
export function rebaseReview(before: string, hunks: readonly ReviewHunk[], current: string): ReviewHunk[] | null {
  const expected = materializeReview(before, hunks);
  const changes = reviewHunks(expected, current);
  const shiftAt = (at: number) => changes.reduce((n, c) => n + (c.to <= at ? c.insert.length - (c.to - c.from) : 0), 0);
  let delta = 0;
  const result: ReviewHunk[] = [];
  for (const h of hunks) {
    const from = h.from + delta;
    const to = h.decision === 'accepted' ? from + h.insert.length : h.to + delta;
    if (h.decision === 'accepted') delta += h.insert.length - (h.to - h.from);
    if (h.decision === 'pending') {
      if (changes.some(c => touches(c, from, to))) return null;
      result.push({ ...h, from: from + shiftAt(from), to: to + shiftAt(from) });
    } else {
      const at = Math.min(current.length, from + shiftAt(from));
      result.push({ ...h, from: at, to: at, insert: '' });
    }
  }
  return result;
}

/** Restore only reviewed lines; retain later unrelated user edits. */
export function mergeReview(base: string, current: string, restored: string): string | null {
  const ours = reviewHunks(base, current), theirs = reviewHunks(base, restored);
  if (ours.some(a => theirs.some(b => touches(a, b.from, b.to)))) return null;
  return materializeReview(base, [...ours, ...theirs].map(h => ({ ...h, decision: 'accepted' as const }))
    .sort((a, b) => a.from - b.from || a.to - b.to));
}

export interface OperationPoint { line: number; ch: number }
export interface OperationEdit { from: OperationPoint; to: OperationPoint; expected_text: string; replacement: string }
/** Shared JSON contract; transports do not own validation or implementation. */
export interface TextProposalInput {
  request_id: string;
  title?: string;
  operations: { kind: 'edit'; path: string; base_revision: string; edits: OperationEdit[] }[];
}
export interface ReviewProposal {
  id: string;
  request_id: string;
  title: string;
  root: string;
  path: string;
  createdAt: string;
  baseline: string;
  hunks: ReviewHunk[];
  applied: { before: string; after: string }[];
  restored?: boolean;
  error?: string;
  uncertain?: { before: string; diskBefore: string; after: string; kind: 'accept' | 'recover'; hunks: ReviewHunk[] };
}
export const operationNames = ['obsidian_get_context', 'obsidian_list_files', 'obsidian_search', 'obsidian_read_file',
  'obsidian_propose_changes', 'obsidian_get_change_status'] as const;
export type OperationName = typeof operationNames[number];
