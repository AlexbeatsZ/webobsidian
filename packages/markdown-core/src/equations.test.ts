import { describe, expect, it } from 'vitest';
import { analyzeMarkdown } from './syntax.js';
import { equations, equationAnchor, equationAt, equationContext, equationTarget, equationReferenceName, equationReferenceLabel, equationOccurrenceBefore, equationReferenceText, equationInstanceNumber, embeddedFormulas, embedEquationContext } from './equations.js';
import { fragmentRange } from './fragments.js';
import { DocumentSession } from './session.js';

describe('native equations (prepared; execution deferred by user)', () => {
  it('keeps the same block identity when a preceding formula changes the number', () => {
    const source = '# A\n$$x$$ ^eq-energy\n由 [[#^eq-energy]] 可得';
    const before = analyzeMarkdown(source), after = analyzeMarkdown(source.replace('# A\n', () => '# A\n$$y$$\n'));
    expect(equationTarget(equationContext(before), '^eq-energy')?.number).toBe('1-1');
    expect(equationTarget(equationContext(after), '^eq-energy')?.number).toBe('1-2');
    expect(after.text).toContain('[[#^eq-energy]]');
    const formula = equationTarget(equationContext(after), '^eq-energy')!;
    expect(equationReferenceLabel(formula, null)).toBe('(1-2)');
    expect(equationReferenceLabel(formula, '')).toBe('energy');
    expect(equationReferenceLabel(formula, '能量')).toBe('能量');
    expect(equationReferenceName('^eq-migrated17')).toBe('migrated17');
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
    expect(equationTarget(equationContext(analyzeMarkdown('$$x \\tag{1-1}$$')), '=(1-1)')).toBeUndefined();
  });
  it('associates only an adjacent ID and selects the precise formula', () => {
    const model = analyzeMarkdown('before\n\n$$\nx\n$$\n^eq-named-equation\n\nafter\n');
    const formula = equationTarget(equationContext(model), '^eq-named-equation')!;
    const range = fragmentRange(model, '^eq-named-equation')!;
    expect(model.text.slice(range.from, range.to)).toBe('$$\nx\n$$\n^eq-named-equation');
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
    expect(fragmentRange(ordinary, '^eq-used')).toBeNull();
    const noncanonical = analyzeMarkdown('$$x$$ ^named');
    expect(equationTarget(equationContext(noncanonical), '^named')).toBeUndefined();
    expect(() => equationAnchor(noncanonical, equations(noncanonical)[0].from, 'unused')).toThrow();
  });
  it('retains quote source ranges and produces one source patch', () => {
    const model = analyzeMarkdown('> [!note]\n> $$\n> x\n> $$\n> ^eq-named\n');
    const formula = equations(model)[0];
    expect(formula.tex).not.toContain('>'); expect(formula.id).toBe('eq-named');
    expect(equationAnchor(model, formula.from, 'unused')).toEqual({ id: 'eq-named' });
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
  it('numbers every formula embed as its own instance and resolves references to the nearest preceding one', () => {
    const source = [
      '# A', '[[^eq-far]] 前', '$$a$$ ^eq-a', '[[#^eq-a]] 一', '![[^eq-a]]', '[[^eq-a]] 二', '[[^eq-a|甲]]',
      '![[其他#^eq-far]]', '`![[^eq-x]]`', '| ![[^eq-a]] |', '| --- |', '', '$$c$$ ^eq-c', '[[^eq-far]] 后',
    ].join('\n');
    const model = analyzeMarkdown(source), context = equationContext(model);
    // Formulas and formula embeds share one counter; code and tables do not take numbers.
    expect(context.occurrences.map(o => [o.id, o.number, o.embed])).toEqual([
      ['eq-a', '1-1', false], ['eq-a', '1-2', true], ['eq-far', '1-3', true], ['eq-c', '1-4', false],
    ]);
    expect(equationTarget(context, '^eq-c')?.number).toBe('1-4');
    const a = equationTarget(context, '^eq-a')!;
    const at = (text: string) => source.indexOf(text);
    const ref = (text: string, alias: string | null = null, sourceName?: string) =>
      equationReferenceText(a, alias, equationOccurrenceBefore(context, 'eq-a', at(text)), sourceName);
    expect(ref('[[#^eq-a]] 一')).toBe('(1-1)');
    expect(ref('[[^eq-a]] 二')).toBe('(1-2)');
    expect(ref('[[^eq-a|甲]]', '甲')).toBe('甲');
    expect(ref('[[^eq-a|甲]]', ' ')).toBe('a');
    // No instance before the reference: the original's own number, prefixed when it lives in another note.
    const far = { ...a, id: 'eq-far', number: '2-5' };
    expect(equationReferenceText(far, null, equationOccurrenceBefore(context, 'eq-far', at('[[^eq-far]] 前')), '其他')).toBe('其他 (2-5)');
    expect(equationReferenceText(far, null, equationOccurrenceBefore(context, 'eq-far', at('[[^eq-far]] 后')), '其他')).toBe('(1-3)');
    expect(equationReferenceText(a, null, undefined)).toBe('(1-1)');
    // The source's explicit tag or exemption is kept by every instance.
    const embed = context.occurrences[1];
    expect(equationInstanceNumber({ ...a, tag: 'A', number: 'A' }, embed)).toBe('A');
    expect(equationInstanceNumber({ ...a, number: null, counted: false }, embed)).toBeNull();
    expect(equationInstanceNumber(a, embed)).toBe('1-2');
  });
  it('numbers formulas inside embedded sections once the embed reports them', () => {
    const sourceNote = analyzeMarkdown('# 热力学 ^heading-thermo\n\n$$x$$ ^eq-x\n\n$$y \\notag$$\n\n$$z$$\n\n![[^eq-w]]\n');
    const sourceContext = equationContext(sourceNote);
    const items = embeddedFormulas(sourceContext, 0, sourceNote.text.length);
    expect(items.map(item => [item.id, item.counted])).toEqual([['eq-x', true], [undefined, true], ['eq-w', true]]);
    const host = analyzeMarkdown('# H\n\n$$a$$\n\n![[^heading-thermo]]\n\nR [[^eq-x]]\n\n$$b$$ ^eq-b\n');
    // Before the embed reports, a section embed takes no numbers.
    expect(equationTarget(equationContext(host), '^eq-b')?.number).toBe('1-2');
    const embedded = new Map([['^heading-thermo', items]]);
    const context = equationContext(host, 0, embedded);
    expect(context.revision).not.toBe(equationContext(host).revision);
    expect(equationTarget(context, '^eq-b')?.number).toBe('1-5');
    const instances = context.occurrences.filter(o => o.embed);
    expect(instances.map(o => o.number)).toEqual(['1-2', '1-3', '1-4']);
    const x = equationTarget(sourceContext, '^eq-x')!;
    expect(equationReferenceText(x, null, equationOccurrenceBefore(context, 'eq-x', host.text.indexOf('R [[')), '物化')).toBe('(1-2)');
    // The fragment renders with host numbers; the exempt formula stays unnumbered.
    const projected = embedEquationContext(sourceContext, instances);
    expect(projected.equations.map(e => e.number)).toEqual(['1-2', null, '1-3']);
    expect(projected.occurrences.find(o => o.embed)?.number).toBe('1-4');
  });
});
