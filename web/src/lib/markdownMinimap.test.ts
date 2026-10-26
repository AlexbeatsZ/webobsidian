import { describe, expect, it } from 'vitest';
import { EditorState, Text } from '@codemirror/state';
import { SearchQuery } from '@codemirror/search';
import { analyzeMarkdown } from '@webobsidian/markdown-core';
import { minimapRows, minimapViewport, minimapSearchRows, workspaceMatchRanges, MINIMAP_MAX_HEIGHT } from './markdownMinimap';

describe('Markdown full-document minimap', () => {
  it('samples the full source with bounded rows, retaining far-away structure without parsing another model', () => {
    const source = ['# First', ...Array.from({ length: 30000 }, (_, index) => `line ${index}`),
      '![image](local.png)', '', '$$', 'x^2', '$$', '', '# Last'].join('\n');
    const model = analyzeMarkdown(source), doc = Text.of(source.split('\n'));
    const rows = minimapRows(model, doc, 1000000);
    expect(rows.length).toBeLessThanOrEqual(Math.floor(MINIMAP_MAX_HEIGHT / 3));
    expect(rows[0]).toMatchObject({ line: 1, kind: 'heading' });
    expect(rows.at(-1)?.endLine).toBe(doc.lines);
    expect(rows.at(-1)?.kind).toBe('image');
    expect(model.text).toBe(source);
  });

  it('represents formulas, images and code as structure while keeping headings and text', () => {
    const source = '# Heading\n\nBody\n\n![pic](image.png)\n\n$$\nx^2\n$$\n\n```js\nthrow Error("never executed")\n```';
    const rows = minimapRows(analyzeMarkdown(source), Text.of(source.split('\n')), 500);
    expect(new Set(rows.map(row => row.kind))).toEqual(new Set(['heading', 'text', 'image', 'math', 'code']));
  });

  it('uses complete shared source ranges beyond context limits and drops stale draft coordinates', () => {
    const doc = Text.of(Array.from({ length: 100 }, () => 'needle'));
    const sourceRanges = Array.from({ length: 100 }, (_, index) => ({ from: index * 7, to: index * 7 + 6, text: 'needle' }));
    const matches = { path: 'a.md', count: 100, contexts: [], sourceRanges };
    expect(workspaceMatchRanges(doc, matches)).toHaveLength(100);
    const edited = doc.replace(0, 6, Text.of(['changed']));
    expect(workspaceMatchRanges(edited, matches)).toHaveLength(0);
    expect(workspaceMatchRanges(doc, { ...matches, sourceRanges: [{ from: -1, to: 6, text: 'needle' }] })).toEqual([]);
  });

  it('maps viewport source lines including empty and terminal lines', () => {
    const doc = Text.of(['first', '', 'last']);
    expect(minimapViewport(doc, { from: 6, to: 7 })).toEqual({ top: 1 / 3, height: 2 / 3 });
    expect(minimapViewport(Text.of(['']), { from: 0, to: 0 })).toEqual({ top: 0, height: 1 });
  });

  it('merges dense CM query hits by pixel across the whole document including its tail', () => {
    const state = EditorState.create({ doc: Array.from({ length: 50000 }, () => 'needle 42').join('\n') });
    const query = new SearchQuery({ search: 'needle \\d+', regexp: true });
    const rows = minimapSearchRows(state, query, 400);
    expect(rows).toHaveLength(400);
    expect(rows[0]).toBe(1);
    expect(rows.at(-1)).toBeGreaterThan(49000);
    expect(minimapSearchRows(state, new SearchQuery({ search: 'NEEDLE', caseSensitive: true }), 400)).toEqual([]);
  });
});
