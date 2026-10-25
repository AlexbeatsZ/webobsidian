import { describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import { parser } from './latex/parser/mathjax/latex-parser';
import { EquationText } from './latex/utils/tokenizer';
import { createMacroMap, traverseTree } from './latex/editor_extensions/concealMacros';
import { DEFAULT_SETTINGS, processLatexSuiteSettings } from './latex/settings/settings';
import { getLatexSuiteConfig, getLatexSuiteConfigExtension, latexSuiteConfig } from './latex/snippets/codemirror/config';

const compile = (patch = {}) => processLatexSuiteSettings({ ...DEFAULT_SETTINGS, ...patch }, {
  snippets: [], snippetVariables: {}, rawConcealMaps: [], updateHandlers: [],
});

describe('acyclic LaTeX configuration and conceal compilation', () => {
  it('initializes the facet eagerly and reuses defaults without a view or DOM', () => {
    const first = EditorState.create();
    const second = EditorState.create();
    expect(first.facet(latexSuiteConfig)).toBe(getLatexSuiteConfig(first));
    expect(getLatexSuiteConfig(first)).toBe(getLatexSuiteConfig(second));
    expect(getLatexSuiteConfig(first).forceMathLanguages).toEqual(compile().forceMathLanguages);
    const configured = compile({ mathPreviewEnabled: false });
    expect(getLatexSuiteConfig(EditorState.create({ extensions: getLatexSuiteConfigExtension(configured) })))
      .toBe(configured);
  });

  it.each([
    ['\\alpha', 'α'],
    ['\\frac{1}{2}', '½'],
    ['\\text{sample}', 'sample'],
    ['\\operatorname{sin}', 'sin'],
    ['\\mathbb{R}', 'ℝ'],
    ['\\hat{x}', 'x\u0302'],
    ['x^😀', '😀'],
  ])('retains pure conceal handling for %s', (source, replacement) => {
    const settings = compile();
    const maps = settings.concealMaps.maps;
    const specs = traverseTree(parser.parse(source).topNode, new EquationText(source, 0, source.length), {
      maps, macroMap: createMacroMap(maps),
    }).flat();
    expect(specs.some(spec => spec.text === replacement)).toBe(true);
    expect(specs.every(spec => spec.start >= 0 && spec.end <= source.length)).toBe(true);
  });
});
