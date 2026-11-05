import type { CatalogEntry } from '@webobsidian/search-core';
import type { TreeNode } from './api';
export type { VirtualDocument, VirtualSource } from '../../../server/src/contracts/virtualDocument';
import type { VirtualDocument } from '../../../server/src/contracts/virtualDocument';

let documents: readonly VirtualDocument[] = [], generation = 0;
const memberTargets = new Map<string, string | null>();
export const virtualMemberFor = (document: string, label: string) => memberTargets.get(document + '\0' + label) ?? undefined;
const listeners = new Set<() => void>();
export const subscribeVirtualDocuments = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export function virtualDocumentsIn(tree: TreeNode): VirtualDocument[] {
  const result: VirtualDocument[] = [];
  const visit = (node: TreeNode) => {
    if (node.virtualDocument) { result.push(node.virtualDocument); return; }
    node.children?.forEach(visit);
  };
  visit(tree); return result;
}
export function publishVirtualDocuments(tree: TreeNode) {
  documents = virtualDocumentsIn(tree); generation++; projected = undefined;
  memberTargets.clear();
  for (const listener of listeners) listener();
}
export function isVirtualDocument(path: string) { return documents.some(document => document.path === path); }
let projected: { source: readonly CatalogEntry[]; generation: number; result: readonly CatalogEntry[] } | undefined;
/** Presentation only: catalog records used for links and full text remain physical. */
export function projectVirtualCatalog(source: readonly CatalogEntry[], collections = documents): readonly CatalogEntry[] {
  if (collections === documents && projected?.source === source && projected.generation === generation) return projected.result;
  const records = new Map(source.map(entry => [entry.path, entry]));
  const virtual = collections.map(document => {
    const members = [...new Set(document.streams.flatMap(stream => stream.files.map(file => file.path)))].map(path => records.get(path)).filter((entry): entry is CatalogEntry => !!entry);
    if (collections === documents) for (const member of members) for (const label of [member.title, ...member.aliases]) {
      const key = document.path + '\0' + label;
      memberTargets.set(key, memberTargets.has(key) && memberTargets.get(key) !== member.path ? null : member.path);
    }
    return { path: document.path, kind: 'file' as const, title: document.title,
      aliases: [...new Set(members.flatMap(entry => [entry.title, ...entry.aliases]))],
      tags: [...new Set(members.flatMap(entry => entry.tags))], headings: members.flatMap(entry => entry.headings) };
  });
  const result = [...source.filter(entry => !collections.some(document => document.path === entry.path || entry.path.startsWith(document.path + '/'))), ...virtual];
  if (collections === documents) projected = { source, generation, result };
  return result;
}

/** Bounded contiguous window for the scroll viewport, with a neighbour for prefetch. */
export function readingWindow(heights: readonly number[], top: number, viewport: number, limit = 6) {
  let first = 0, offset = 0;
  while (first < heights.length - 1 && offset + heights[first] < top) offset += heights[first++];
  let last = first, end = offset + (heights[first] ?? 0);
  while (last < heights.length - 1 && end < top + viewport && last - first < limit - 2) end += heights[++last];
  const from = Math.max(0, first - 1);
  return { first: from, last: Math.min(heights.length - 1, Math.max(last + 1, first + 1), from + limit - 1) };
}
