import { StateField } from '@codemirror/state';
import { analyzeMarkdown, extractMetadata, blockContainers, mathBlocks, tableModels, type MarkdownModel, type Metadata } from '@webobsidian/markdown-core';
import { renderContext } from './renderContext';

/** Layout-independent complete model; never inferred from rendered/visible DOM. */
export const syntaxModel = StateField.define<MarkdownModel>({
  create: (state) => analyzeMarkdown(state.doc.toString(), state.facet(renderContext).sourcePath),
  update: (model, transaction) => transaction.docChanged
    ? analyzeMarkdown(transaction.newDoc.toString(), model.id, model.version + 1) : model,
});

export const documentMetadata = StateField.define<Metadata>({
  create: (state) => extractMetadata(state.field(syntaxModel)),
  update: (value, transaction) => transaction.docChanged ? extractMetadata(transaction.state.field(syntaxModel)) : value,
});

function blocks(model: MarkdownModel) {
  return { containers: blockContainers(model), math: mathBlocks(model), tables: tableModels(model) };
}
export const blockModel = StateField.define<ReturnType<typeof blocks>>({
  create: (state) => blocks(state.field(syntaxModel)),
  update: (value, transaction) => transaction.docChanged ? blocks(transaction.state.field(syntaxModel)) : value,
});
