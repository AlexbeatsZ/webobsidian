import { describe, expect, it } from 'vitest';
import { analyzeMarkdown, updateMarkdown } from './syntax.js';
import { blockEffectTargets, blockEffectList } from './blockEffects.js';
import { tableModels } from './tables.js';

describe('block effects use the complete source grammar', () => {
  it('recognizes a marker immediately before a table without reparsing it', () => {
    const source = '[nowrap]\n| A | B |\n| --- | --- |\n| 1 | 2 |';
    const model = analyzeMarkdown(source), [effect] = blockEffectTargets(model);
    expect(effect.names).toEqual(['nowrap']); expect(effect.kind).toBe('Table');
    expect(effect.target).toEqual({ from: 9, to: source.length });
    expect(tableModels(model)[0].from).toBe(effect.target.from);
    expect(blockEffectTargets(model)).toBe(blockEffectTargets(model));
  });
  it('keeps same-container quote ranges and the entire nested list', () => {
    const source = '> [custom]\n>\n> - parent\n>   - child\n> - sibling\n\noutside';
    const model = analyzeMarkdown(source), [effect] = blockEffectTargets(model);
    expect(effect.prefix).toBe('> '); expect(effect.kind).toBe('BulletList');
    expect(source.slice(effect.target.from, effect.to)).not.toContain('outside');
    expect(blockEffectList(model, effect.node).map(i => [i.depth, i.text])).toEqual([[0, 'parent'], [1, 'child'], [0, 'sibling']]);
  });
  it('does not discover effects in frontmatter, literal code, math or comments', () => {
    const source = '---\nvalue: yes\n[bad]\n---\n\n```md\n[bad]\n- code\n```\n\n%%\n[bad]\n- comment\n%%\n\n$$\n[bad]\n- math\n$$';
    expect(blockEffectTargets(analyzeMarkdown(source))).toEqual([]);
  });
  it('retains exact source and updates offsets after a prefix edit', () => {
    const source = '[custom]\n\n- a\n  - b\n', previous = analyzeMarkdown(source);
    const next = updateMarkdown(previous, 'prefix\n\n' + source, [{ fromA: 0, toA: 0, fromB: 0, toB: 8 }]);
    expect(blockEffectTargets(next)[0].from).toBe(blockEffectTargets(previous)[0].from + 8);
    expect(next.text).toBe('prefix\n\n' + source);
  });
});
