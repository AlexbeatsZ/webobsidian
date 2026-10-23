import { describe, expect, it } from 'vitest';
import { analyzeMarkdown } from './syntax.js';
import { equations, equationAnchor, equationAt, equationContext, equationTarget } from './equations.js';
import { fragmentRange } from './fragments.js';
import { DocumentSession } from './session.js';

describe('native equations (prepared; execution deferred by user)', () => {
  it('keeps the same block identity when a preceding formula changes the number', () => {
    const source = '# A\n$$x$$ ^eq-energy\n由 [[#^eq-energy]] 可得';
    const before = analyzeMarkdown(source), after = analyzeMarkdown(source.replace('# A\n', () => '# A\n$$y$$\n'));
    expect(equationTarget(equationContext(before), '^eq-energy')?.number).toBe('1-1');
    expect(equationTarget(equationContext(after), '^eq-energy')?.number).toBe('1-2');
    expect(after.text).toContain('[[#^eq-energy]]');
  });
  it('uses active H1 sections; excludes literal, comments, table and exempt math', () => {
    const source = '# Empty\n# A\n```md\n$$fake$$\n```\n%% $$hidden$$ %%\n$$a$$\n$$skip{{}}$$\n# B\n$$b$$\n';
    const list = equations(analyzeMarkdown(source));
    expect(list.map(e => e.number)).toEqual(['1-1', null, '2-1']);
    const table = analyzeMarkdown('| A |\n|---|\n| $$x$$ |\n');
    expect(equations(table)[0]?.number).toBeNull();
  });
  it('preserves explicit tags and mhchem internal dollars', () => {
    const list = equations(analyzeMarkdown('$$\\ce{A ->[$k_+$][$k_-$] B} \\tag{custom}$$'));
    expect(list).toHaveLength(1); expect(list[0].number).toBe('custom');
    expect(list[0].tex).toContain('[$k_+$]');
  });
  it('associates only an adjacent ID and selects the precise formula', () => {
    const model = analyzeMarkdown('before\n\n$$\nx\n$$\n^named-equation\n\nafter\n');
    const formula = equationTarget(equationContext(model), '^named-equation')!;
    const range = fragmentRange(model, '^named-equation')!;
    expect(model.text.slice(range.from, range.to)).toBe('$$\nx\n$$\n^named-equation');
    expect(equationAt(equationContext(model, formula.from), 0)).toBe(formula);
    expect(equations(analyzeMarkdown('$$x$$\n\n^distant'))[0].id).toBeUndefined();
  });
  it('never steals ordinary block IDs or accepts duplicate targets', () => {
    const model = analyzeMarkdown('$$x$$ ^same\n\nother ^same\n');
    expect(equationTarget(equationContext(model), '^same')).toBeUndefined();
    expect(fragmentRange(model, '^same')).toBeNull();
    expect(() => equationAnchor(model, equations(model)[0].from, 'random')).toThrow();
    const ordinary = analyzeMarkdown('paragraph ^eq-used\n\n$$x$$');
    expect(equationAnchor(ordinary, equations(ordinary)[0].from, 'used').id).toBe('eq-used-1');
  });
  it('retains quote source ranges and produces one source patch', () => {
    const model = analyzeMarkdown('> [!note]\n> $$\n> x\n> $$\n> ^named\n');
    const formula = equations(model)[0];
    expect(formula.tex).not.toContain('>'); expect(formula.id).toBe('named');
    expect(equationAnchor(model, formula.from, 'unused')).toEqual({ id: 'named' });
    const inline = analyzeMarkdown('> $$x\n> y$$ ^eq-a');
    const range = fragmentRange(inline, '^eq-a')!;
    const sliced = analyzeMarkdown(inline.text.slice(range.from, range.to));
    expect(equations(sliced)[0].tex).toBe(equations(inline)[0].tex);
  });
  it('adds a lazy anchor through source history without rewriting BOM/CRLF', () => {
    const source = '\ufeff# A\r\n$$x$$\r\nunchanged  \r\n';
    const session = new DocumentSession('note.md', source, undefined, async () => ({}));
    const formula = equations(session.analysis)[0];
    const { change } = equationAnchor(session.analysis, formula.from, 'test');
    session.edit(session.snapshot.version, [change!], 'equation-anchor');
    expect(session.snapshot.raw).toBe(source.replace('$$x$$', () => '$$x$$ ^eq-test'));
    session.undo(); expect(session.snapshot.raw).toBe(source);
  });
});
