import type { EditorState, Text } from '@codemirror/state';
import type { SearchQuery } from '@codemirror/search';
import { mathRegions, type MarkdownModel, type SourceSpan } from '@webobsidian/markdown-core';
import type { NoteMatches } from './api';

export const MINIMAP_MAX_HEIGHT = 2048;
export interface MinimapRow { line: number; text: string; kind: 'text' | 'heading' | 'code' | 'image' | 'math' | 'table'; endLine: number }
export function minimapRows(model: MarkdownModel, doc: Text, height: number): MinimapRow[] {
  const count = Math.min(doc.lines, Math.max(1, Math.floor(Math.min(MINIMAP_MAX_HEIGHT, height) / 3)));
  const structures = model.nodes.flatMap(node => {
    const kind = /^(?:ATXHeading|SetextHeading|BodyHeading)/.test(node.name) ? 'heading'
      : ['FencedCode', 'CodeBlock'].includes(node.name) ? 'code'
      : node.name === 'Image' ? 'image' : node.name === 'Table' ? 'table' : undefined;
    return kind ? [{ ...node, kind: kind as MinimapRow['kind'] }] : [];
  });
  const formulas = mathRegions(model).filter(region => region.display || region.block).map(region => ({ ...region, kind: 'math' as const }));
  const ranges = [...structures, ...formulas].sort((left, right) => left.from - right.from || right.to - left.to);
  const rows: MinimapRow[] = [];
  let rangeIndex = 0;
  const active: typeof ranges = [];
  for (let index = 0; index < count; index++) {
    const line = Math.min(doc.lines, Math.floor(index * doc.lines / count) + 1);
    const endLine = Math.min(doc.lines, Math.ceil((index + 1) * doc.lines / count));
    const source = doc.line(line), end = doc.line(endLine);
    while (rangeIndex < ranges.length && ranges[rangeIndex].from <= end.to) active.push(ranges[rangeIndex++]);
    for (let cursor = active.length - 1; cursor >= 0; cursor--) if (active[cursor].to < source.from) active.splice(cursor, 1);
    const structure = active.find(range => range.kind === 'math' || range.kind === 'image') ?? active[0];
    rows.push({ line, endLine, text: source.text.slice(0, 180), kind: structure?.kind ?? 'text' });
  }
  return rows;
}

export function workspaceMatchRanges(doc: Text, matches: NoteMatches | undefined): SourceSpan[] {
  return (matches?.sourceRanges ?? []).filter(range => range.from >= 0 && range.to <= doc.length &&
    range.to > range.from && doc.sliceString(range.from, range.to) === range.text);
}

export function minimapViewport(doc: Text, range: SourceSpan) {
  const clamp = (position: number) => Math.max(0, Math.min(doc.length, position));
  const from = doc.lineAt(clamp(range.from)).number - 1;
  const to = doc.lineAt(clamp(range.to)).number;
  return { top: from / doc.lines, height: Math.max(1, to - from) / doc.lines };
}

export function minimapSearchRows(state: EditorState, query: SearchQuery, height: number): number[] {
  const pixels = Math.max(1, Math.min(state.doc.lines, MINIMAP_MAX_HEIGHT, Math.floor(height)));
  const rows: number[] = [];
  let match = query.getCursor(state).next();
  while (!match.done && rows.length < pixels) {
    const line = state.doc.lineAt(match.value.from).number;
    rows.push(line);
    const pixel = Math.floor((line - 1) * pixels / state.doc.lines);
    const nextLine = Math.max(line + 1, Math.floor((pixel + 1) * state.doc.lines / pixels) + 1);
    if (nextLine > state.doc.lines) break;
    match = query.getCursor(state, state.doc.line(nextLine).from).next();
  }
  return rows;
}
