import { describe, it, expect } from 'vitest';
import { analyzeMarkdown, updateMarkdown } from './syntax.js';
import { mathRegions, formulaAt } from './math.js';
import { SourceDocument, changesBetween } from './source.js';
import { DocumentSession } from './session.js';

describe('shared formula source and history', () => {
  it('recognizes explicit inline HTML math without treating other classes as math', () => {
    const regions = mathRegions(
      analyzeMarkdown('<span class="math-inline">\\alpha</span> <span class="my-math">x</span>'),
    );
    expect(regions).toHaveLength(1);
    expect(regions[0].tex).toBe('\\alpha');
  });
  it('distinguishes code, inline, display and valid mhchem internal dollars', () => {
    const source = '`$code$`\n\n$x$ and $$\\ce{A <=>[$k_+$][$k_-$] B}$$';
    const regions = mathRegions(analyzeMarkdown(source));
    expect(regions).toHaveLength(2);
    expect(regions[1].tex).toBe('\\ce{A <=>[$k_+$][$k_-$] B}');
    expect(formulaAt(regions, regions[0].bodyFrom)?.tex).toBe('x');
  });
  it('retains quote source positions while presenting logical TeX', () => {
    const source = '> $$\n> \\frac{a}{b}\n> $$';
    const [region] = mathRegions(analyzeMarkdown(source));
    expect(region.block).toBe(true);
    expect(region.tex.trim()).toBe('\\frac{a}{b}');
    expect(source.slice(region.segments[1].from, region.segments[1].to)).toBe('\\frac{a}{b}');
  });
  it('does not pair malformed display math across a new heading', () => {
    const regions = mathRegions(analyzeMarkdown('$$x\n# Next\n$y$'));
    expect(regions[0].closed).toBe(false);
    expect(regions[1].tex).toBe('y');
    const multiline = mathRegions(analyzeMarkdown('$$\nunclosed\n# Next\n$$y$$'));
    expect(multiline[0].closed).toBe(false);
    expect(multiline[1].tex).toBe('y');
  });
  it('maps unchanged formulas through unrelated text edits', () => {
    const original = analyzeMarkdown('body $x$');
    const initial = mathRegions(original);
    const next = updateMarkdown(original, 'new body $x$', [{ fromA: 0, toA: 0, fromB: 0, toB: 4 }]);
    const mapped = mathRegions(next);
    expect(mapped[0].from).toBe(initial[0].from + 4);
    expect(mapped[0].tex).toBe('x');
  });
  it('keeps an empty display snippet bounded and updates its body on each keystroke', () => {
    const source = '$$$$\n\nFollowing text $y$';
    const original = analyzeMarkdown(source);
    const empty = mathRegions(original);
    expect(empty).toHaveLength(2);
    expect(empty[0]).toMatchObject({ from: 0, to: 4, bodyFrom: 2, bodyTo: 2, tex: '', display: true, closed: true });
    expect(formulaAt(empty, 2)).toBe(empty[0]);
    const next = updateMarkdown(original, '$$x$$\n\nFollowing text $y$', [{ fromA: 2, toA: 2, fromB: 2, toB: 3 }]);
    expect(mathRegions(next)[0]).toMatchObject({ from: 0, to: 5, tex: 'x', display: true, closed: true });
    expect(mathRegions(next)[1].tex).toBe('y');
    expect(mathRegions(analyzeMarkdown('> $$$$\n> following'))[0]).toMatchObject({ from: 2, to: 6, tex: '', closed: true });
    expect(mathRegions(analyzeMarkdown('$$$$$'))).toEqual([]);
  });
  it('keeps untouched raw line endings and restores exact inverse changes', () => {
    const raw = '\ufeffkeep\r\nalpha\nbeta\r\nend';
    const doc = new SourceDocument(raw);
    const inverse = doc.apply(
      changesBetween(doc.text, doc.text.replace('alpha', 'ALPHA').replace('end', 'END')),
    );
    expect(doc.raw).toBe('\ufeffkeep\r\nALPHA\nbeta\r\nEND');
    doc.apply(inverse);
    expect(doc.raw).toBe(raw);
  });
  it('attaches view state to the one shared history and keeps formatting separate from typing', () => {
    const doc = new DocumentSession('x.md', 'abc', undefined, async () => ({ revision: 'saved' }));
    doc.edit(0, [{ from: 0, to: 1, insert: 'A' }], 'format', {
      owner: 'view',
      before: { caret: 0 },
      after: { caret: 1 },
    });
    expect(doc.userEditVersion).toBe(0);
    doc.undo();
    expect(doc.snapshot.text).toBe('abc');
    expect(doc.snapshot.historyState).toEqual({ owner: 'view', value: { caret: 0 } });
    doc.redo();
    expect(doc.snapshot.text).toBe('Abc');
    expect(doc.snapshot.historyState?.value).toEqual({ caret: 1 });
  });
  it('undoes snippet expansion and subsequent bracket changes as one operation', () => {
    const doc = new DocumentSession('x.md', 'x', undefined, async () => ({}));
    doc.edit(0, [{ from: 0, to: 1, insert: '(x)' }], 'snippet:1');
    doc.edit(
      1,
      [
        { from: 0, to: 0, insert: '\\left' },
        { from: 2, to: 2, insert: '\\right' },
      ],
      'snippet:1',
    );
    doc.undo();
    expect(doc.snapshot.text).toBe('x');
    doc.redo();
    expect(doc.snapshot.text).toBe('\\left(x\\right)');
  });
});
