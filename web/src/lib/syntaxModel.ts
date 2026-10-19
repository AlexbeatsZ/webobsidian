import { StateEffect, StateField } from '@codemirror/state';
import { analyzeMarkdown, updateMarkdown, extractMetadata, blockContainers, mathBlocks, tableModels, type MarkdownModel, type Metadata } from '@webobsidian/markdown-core';
import { renderContext } from './renderContext';

/** Layout-independent complete model; never inferred from rendered/visible DOM. */
export const adoptSyntaxModel = StateEffect.define<MarkdownModel>();
export const syntaxModel = StateField.define<MarkdownModel>({
  create: (state) => analyzeMarkdown(state.doc.toString(), state.facet(renderContext).sourcePath),
  update(model, transaction) {
    if (!transaction.docChanged) return model;
    const text = transaction.newDoc.toString();
    const provided = transaction.effects.find((e) => e.is(adoptSyntaxModel))?.value as MarkdownModel | undefined;
    if (provided && provided.id === model.id && provided.text === text) return provided;
    const changes: { fromA: number; toA: number; fromB: number; toB: number }[] = [];
    transaction.changes.iterChanges((fromA, toA, fromB, toB) => changes.push({ fromA, toA, fromB, toB }));
    return updateMarkdown(model, text, changes);
  },
});

export const documentMetadata = StateField.define<Metadata>({
  create: (state) => extractMetadata(state.field(syntaxModel)),
  update: (value, transaction) => transaction.docChanged ? extractMetadata(transaction.state.field(syntaxModel)) : value,
});

type Blocks = { containers: ReturnType<typeof blockContainers>; math: ReturnType<typeof mathBlocks>; tables: ReturnType<typeof tableModels> };
const blockCache = new WeakMap<MarkdownModel, Blocks>();
function blocks(model: MarkdownModel): Blocks {
  let value = blockCache.get(model);
  if (!value) { value = { containers: blockContainers(model), math: mathBlocks(model), tables: tableModels(model) }; blockCache.set(model, value); }
  return value;
}
export const blockModel = StateField.define<ReturnType<typeof blocks>>({
  create: (state) => blocks(state.field(syntaxModel)),
  update: (value, transaction) => transaction.docChanged ? blocks(transaction.state.field(syntaxModel)) : value,
});
