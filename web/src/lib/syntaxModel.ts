import { StateEffect, StateField } from '@codemirror/state';
import { analyzeMarkdown, updateMarkdown, extractMetadata, blockContainers, mathRegions, tableModels, equationContext, type EmbeddedFormula, type EmbeddedFormulas, type MarkdownModel, type Metadata, type MathRegion, type MathBlock } from '@webobsidian/markdown-core';
import type { EditorState, Text } from '@codemirror/state';
import { renderContext } from './renderContext';

/** Formulas shown by this note's embeds, reported by each embed once its content resolves. */
export const setEmbeddedFormulas = StateEffect.define<{ key: string; items: readonly EmbeddedFormula[] }>();
export const embeddedFormulasField = StateField.define<EmbeddedFormulas>({
  create: () => new Map(),
  update(value, transaction) {
    let next: Map<string, readonly EmbeddedFormula[]> | undefined;
    for (const effect of transaction.effects) {
      if (!effect.is(setEmbeddedFormulas)) continue;
      const { key, items } = effect.value, current = (next ?? value).get(key);
      if (current && JSON.stringify(current) === JSON.stringify(items)) continue;
      (next ??= new Map(value)).set(key, items);
    }
    return next ?? value;
  },
});

export const equationsOf = (state: EditorState) => {
  const context = state.facet(renderContext), model = state.field(syntaxModel);
  // Local transactions precede the React snapshot update. A fragment retains
  // its original-note context; a full editor can already use its newest model.
  if (context.equations && (context.sourceFragment || context.equations.from !== 0)) return context.equations;
  // Embedded sections number their formulas as instances of this note.
  const embedded = state.field(embeddedFormulasField, false);
  const current = context.equations && context.mathSource?.model.text === model.text ? context.mathSource.model : undefined;
  if (current && !embedded?.size) return context.equations!;
  return equationContext(current ?? model, 0, embedded);
};
export function sourceOf(state: EditorState): { model: MarkdownModel; from: number } {
  const context = state.facet(renderContext);
  return context.mathSource && (context.sourceFragment || context.mathSource.from !== 0)
    ? context.mathSource : { model: state.field(syntaxModel), from: 0 };
}

/** Layout-independent complete model; never inferred from rendered/visible DOM. */
export const adoptSyntaxModel = StateEffect.define<MarkdownModel>();
export const syntaxModel = StateField.define<MarkdownModel>({
  create: (state) => analyzeMarkdown(state.doc.toString(), state.facet(renderContext).sourcePath),
  update(model, transaction) {
    const provided = transaction.effects.find((e) => e.is(adoptSyntaxModel))?.value as MarkdownModel | undefined;
    if (!transaction.docChanged && !provided) return model;
    const text = transaction.newDoc.toString();
    if (provided && provided.text === text && (provided.id === model.id || provided.id === transaction.state.facet(renderContext).sourcePath)) return provided;
    if (!transaction.docChanged) return model;
    const changes: { fromA: number; toA: number; fromB: number; toB: number }[] = [];
    transaction.changes.iterChanges((fromA, toA, fromB, toB) => changes.push({ fromA, toA, fromB, toB }));
    return updateMarkdown(model, text, changes);
  },
});

export const documentMetadata = StateField.define<Metadata>({
  create: (state) => extractMetadata(state.field(syntaxModel)),
  update: (value, transaction) => transaction.docChanged ? extractMetadata(transaction.state.field(syntaxModel)) : value,
});

type Blocks = {
  containers: ReturnType<typeof blockContainers>; math: MathBlock[]; tables: ReturnType<typeof tableModels>;
  mathRanges: readonly MathRegion[];
  mathCallout: ReadonlyMap<number, number>;
  calloutMath: ReadonlyMap<number, readonly MathRegion[]>;
  commentLines: ReadonlySet<number>; inlineMathByLine: ReadonlyMap<number, readonly MathRegion[]>;
};
const blockCache = new WeakMap<MarkdownModel, Blocks>();
function blocks(model: MarkdownModel, doc: Text): Blocks {
  let value = blockCache.get(model);
  if (!value) {
    // These source facts do not change with selection or viewport. Derive them
    // alongside the existing per-model blocks instead of rescanning on reveal.
    const commentLines = new Set<number>();
    let open = -1;
    for (let n = 1; n <= doc.lines; n++) {
      if (doc.line(n).text.trim() !== '%%') continue;
      if (open < 0) open = n;
      else { for (let k = open; k <= n; k++) commentLines.add(k); open = -1; }
    }
    const inlineMathByLine = new Map<number, MathRegion[]>();
    const mathRanges = mathRegions(model);
    for (const formula of mathRanges) {
      if (!formula.closed || formula.block || formula.kind !== 'dollar' || formula.tex.includes('\n')) continue;
      const number = doc.lineAt(formula.from).number;
      const list = inlineMathByLine.get(number) ?? [];
      list.push(formula); inlineMathByLine.set(number, list);
    }
    const displayMath = mathRanges.filter(formula => formula.closed && formula.kind === 'dollar' &&
      (formula.block || formula.tex.includes('\n')));
    const math = displayMath.map(formula => ({ from: formula.from, to: formula.to, tex: formula.tex.trim() }));
    const containers = blockContainers(model), callouts = containers.filter(block => block.kind === 'callout');
    const mathCallout = new Map<number, number>(), calloutMath = new Map<number, MathRegion[]>();
    // Containers are in grammar preorder; dollar formulas are ordered and do not
    // overlap. Keep only the containing Callout chain instead of pairing M x C.
    const activeCallouts: typeof containers = [];
    let nextCallout = 0;
    for (const formula of displayMath) {
      while (nextCallout < callouts.length && callouts[nextCallout].bodyFrom <= formula.from) {
        const callout = callouts[nextCallout++];
        while (activeCallouts.length && activeCallouts.at(-1)!.to <= callout.from) activeCallouts.pop();
        if (callout.to > formula.from) activeCallouts.push(callout);
      }
      // A formula crossing an inner boundary belongs to its containing ancestor.
      // Later dollar formulas start after this one, so popped entries stay spent.
      while (activeCallouts.length && activeCallouts.at(-1)!.to < formula.to) activeCallouts.pop();
      const owner = activeCallouts.at(-1);
      if (owner) {
        mathCallout.set(formula.from, owner.from);
        const formulas = calloutMath.get(owner.from) ?? [];
        formulas.push(formula); calloutMath.set(owner.from, formulas);
      }
    }
    value = { containers, math, tables: tableModels(model), mathRanges, mathCallout, calloutMath, commentLines, inlineMathByLine };
    blockCache.set(model, value);
  }
  return value;
}
export const blockModel = StateField.define<ReturnType<typeof blocks>>({
  create: (state) => blocks(state.field(syntaxModel), state.doc),
  update: (value, transaction) => transaction.docChanged ? blocks(transaction.state.field(syntaxModel), transaction.newDoc) : value,
});
