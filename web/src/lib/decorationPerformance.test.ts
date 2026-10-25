import { describe, expect, it, vi } from 'vitest';
import { performance } from 'node:perf_hooks';
import { Compartment, EditorSelection, EditorState } from '@codemirror/state';
import { analyzeMarkdown, equationContext } from '@webobsidian/markdown-core';
import { renderContext, type RenderContext } from './renderContext';
import { syntaxModel, blockModel } from './syntaxModel';
import { compositionSelection } from './editorSelection';
import { livePreviewState, livePreviewReadonly, setLivePreviewReadonly } from './renderState';
import { sourceRegion, forcedRenderedRegion, toggleSourceRegion, renderSourceRegion } from './sourceControls';
import { latexSuiteConfig, getLatexSuiteConfig } from './writing/latex/snippets/codemirror/config';
import { refreshBlockEffects } from './blocks/model';
import { decorationInputsChanged } from './decorationDependencies';

const benchmark = vi.hoisted(() => ({ originalContextIdentity: false }));
vi.mock('./decorationDependencies', async importOriginal => {
  const actual = await importOriginal<typeof import('./decorationDependencies')>();
  return { ...actual, decorationInputsChanged: (...args: Parameters<typeof actual.decorationInputsChanged>) => {
    const [transaction] = args;
    if (benchmark.originalContextIdentity && transaction.startState.facet(renderContext) !== transaction.state.facet(renderContext)) return true;
    return actual.decorationInputsChanged(...args);
  } };
});
import { blockLayout } from './blockLayout';

const context: RenderContext = {
  sourcePath: 'performance.md', openLink: () => {}, openMenu: () => {}, rawUrl: target => target,
  files: () => [], tags: async () => [], properties: async () => [], propertyTypes: () => ({}),
  setPropertyType: async () => ({}), renderEmbed: async () => null,
  mountFragment: () => () => {}, allowBlockEffects: true, allowScriptExecution: false,
};
function fixture(source = '> [!note] Example\n> content $a+b$\n\n- item\n\nend', overrides: Partial<RenderContext> = {}) {
  const contextCompartment = new Compartment(), configCompartment = new Compartment();
  const initial = EditorState.create({ doc: source, extensions: [syntaxModel, blockModel, compositionSelection,
    livePreviewState, livePreviewReadonly, sourceRegion, forcedRenderedRegion, blockLayout,
    contextCompartment.of(renderContext.of({ ...context, ...overrides })), configCompartment.of([])] });
  return { initial, contextCompartment, configCompartment };
}

describe('decoration dependency correctness and bounded work', () => {
  it('reuses actual layout and immutable analysis for equivalent context wrappers', () => {
    const { initial, contextCompartment } = fixture();
    const transaction = initial.update({ effects: contextCompartment.reconfigure(renderContext.of({ ...context })) });
    expect(decorationInputsChanged(transaction)).toBe(false);
    expect(transaction.state.field(blockLayout)).toBe(initial.field(blockLayout));
    expect(transaction.state.field(syntaxModel)).toBe(initial.field(syntaxModel));
    expect(transaction.state.field(blockModel)).toBe(initial.field(blockModel));
  });

  it('retains equivalent source projections but invalidates their full model, offset and equation revision', () => {
    const model = analyzeMarkdown('$$a$$\n\ntext', 'performance.md');
    const equations = equationContext(model), mathSource = { model, from: 0 };
    const { initial, contextCompartment } = fixture(model.text, { equations, mathSource, embedTrail: ['parent.md'] });
    const changed = (overrides: Partial<RenderContext>) => decorationInputsChanged(initial.update({
      effects: contextCompartment.reconfigure(renderContext.of({ ...context, equations: { ...equations },
        mathSource: { ...mathSource }, embedTrail: ['parent.md'], ...overrides })),
    }));
    expect(changed({})).toBe(false);
    expect(changed({ mathSource: { model, from: 1 } })).toBe(true);
    expect(changed({ mathSource: { model: analyzeMarkdown(model.text + '\n\\def\\x{a}', model.id), from: 0 } })).toBe(true);
    expect(changed({ equations: { ...equations, revision: equations.revision + ':changed' } })).toBe(true);
    expect(changed({ equations: { ...equations, equations: [...equations.equations] } })).toBe(true);
    expect(changed({ embedTrail: ['other.md'] })).toBe(true);
  });

  it('keeps changed capabilities, callbacks, source paths and new context members conservative', () => {
    const { initial, contextCompartment } = fixture();
    for (const overrides of [{ allowScriptExecution: true }, { mountFragment: () => () => {} },
      { rawUrl: (target: string) => '/other/' + target }, { sourcePath: 'renamed.md' }, { footnoteBody: true }]) {
      expect(decorationInputsChanged(initial.update({ effects: contextCompartment.reconfigure(renderContext.of({ ...context, ...overrides })) }))).toBe(true);
    }
  });

  it('lets source-only consumers ignore services and LaTeX while retaining real ownership changes', () => {
    const { initial, contextCompartment, configCompartment } = fixture();
    const inputs = { context: ['allowBlockEffects', 'allowScriptExecution'] as const, latex: false };
    const service = initial.update({ effects: contextCompartment.reconfigure(renderContext.of({ ...context, rawUrl: target => '/new/' + target })) });
    expect(decorationInputsChanged(service, inputs)).toBe(false);
    expect(decorationInputsChanged(service)).toBe(true);
    const capabilities = initial.update({ effects: contextCompartment.reconfigure(renderContext.of({ ...context, allowScriptExecution: true })) });
    expect(decorationInputsChanged(capabilities, inputs)).toBe(true);
    const config = initial.update({ effects: configCompartment.reconfigure(latexSuiteConfig.of({ ...getLatexSuiteConfig(initial), snippetsEnabled: false })) });
    expect(decorationInputsChanged(config, inputs)).toBe(false);
    expect(decorationInputsChanged(config)).toBe(true);
  });

  it('preserves source, mode, block refresh, document and frozen selection invalidation', () => {
    const { initial } = fixture();
    expect(decorationInputsChanged(initial.update({ effects: toggleSourceRegion.of({ from: 0, to: 15 }) }))).toBe(true);
    expect(decorationInputsChanged(initial.update({ effects: renderSourceRegion.of({ from: 0, to: 15 }) }))).toBe(true);
    expect(decorationInputsChanged(initial.update({ effects: setLivePreviewReadonly.of(true) }))).toBe(true);
    expect(decorationInputsChanged(initial.update({ effects: refreshBlockEffects.of(undefined) }))).toBe(true);
    expect(decorationInputsChanged(initial.update({ changes: { from: initial.doc.length, insert: 'a' } }))).toBe(true);
    const selection = initial.update({ selection: EditorSelection.cursor(5) });
    expect(decorationInputsChanged(selection)).toBe(true);
    expect(decorationInputsChanged(selection, false)).toBe(false);
    expect(selection.state.field(syntaxModel)).toBe(initial.field(syntaxModel));
    expect(selection.state.field(blockModel)).toBe(initial.field(blockModel));
  });

  it('measures original identity invalidation against the same real CodeMirror layout fixture', () => {
    const source = Array.from({ length: 150 }, (_, index) => `> [!note] Section ${index}\n> $a_${index}+b$ with content\n\n- item ${index}\n\n`).join('');
    const run = (original: boolean) => {
      benchmark.originalContextIdentity = original;
      const { initial, contextCompartment } = fixture(source);
      let state = initial, rebuilds = 0;
      const start = performance.now();
      for (let iteration = 0; iteration < 100; iteration++) {
        const next = state.update({ effects: contextCompartment.reconfigure(renderContext.of({ ...context })) }).state;
        if (next.field(blockLayout) !== state.field(blockLayout)) rebuilds++;
        state = next;
      }
      benchmark.originalContextIdentity = false;
      expect(state.field(syntaxModel)).toBe(initial.field(syntaxModel));
      expect(state.field(blockModel)).toBe(initial.field(blockModel));
      return { milliseconds: performance.now() - start, rebuilds };
    };
    run(true); run(false);
    const original = [], narrowed = [];
    for (let sample = 0; sample < 5; sample++) {
      if (sample % 2) { narrowed.push(run(false)); original.push(run(true)); }
      else { original.push(run(true)); narrowed.push(run(false)); }
    }
    expect(original.map(sample => sample.rebuilds)).toEqual([100, 100, 100, 100, 100]);
    expect(narrowed.map(sample => sample.rebuilds)).toEqual([0, 0, 0, 0, 0]);
    console.info('R10 real EditorState benchmark', JSON.stringify({ codeUnits: source.length, sections: 150,
      transactionsPerSample: 100, original, narrowed }));
  });
});
