import { StateEffect, type EditorState } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { blockEffectTargets, type BlockEffectTarget, type MarkdownModel, type SourceSpan } from '@webobsidian/markdown-core';
import { syntaxModel } from '../syntaxModel';
import { renderContext } from '../renderContext';
import { livePreviewState } from '../renderState';
import { sourceIsOpen } from '../sourceControls';

export interface BlockDefinition { names: string[]; classes: string[]; script?: string; code?: string; css?: string; }
export interface LoadedBlockDefinition extends BlockDefinition { execute?: (...args: unknown[]) => Promise<unknown> }
export interface BoundBlock extends BlockEffectTarget { definitions: LoadedBlockDefinition[]; classes: string[]; script?: LoadedBlockDefinition }
export const refreshBlockEffects = StateEffect.define<void>();
export const blockEffectViews = new Set<EditorView>();
export function refreshBlockViews() { for (const view of blockEffectViews) view.dispatch({ effects: refreshBlockEffects.of() }); }
let definitions = new Map<string, LoadedBlockDefinition>();
let revision = 0;
const bound = new WeakMap<MarkdownModel, { revision: number; values: BoundBlock[] }>();
export function setBlockDefinitions(value: readonly LoadedBlockDefinition[]) {
  definitions = new Map(value.flatMap(d => d.names.map(name => [name, d] as const))); revision++;
}
export function boundBlocks(model: MarkdownModel): readonly BoundBlock[] {
  if (!definitions.size) return [];
  const cached = bound.get(model); if (cached?.revision === revision) return cached.values;
  const values: BoundBlock[] = [];
  for (const target of blockEffectTargets(model)) {
    const selected = target.names.map(name => definitions.get(name));
    if (selected.some(d => !d)) continue;
    const unique = [...new Set(selected as LoadedBlockDefinition[])];
    const scripts = unique.filter(d => d.execute);
    // A single replacement owner avoids a second generic conversion pipeline.
    if (scripts.length > 1) continue;
    values.push({ ...target, definitions: unique, classes: unique.flatMap(d => d.classes), script: scripts[0] });
  }
  bound.set(model, { revision, values }); return values;
}
export function activeBlockReplacements(state: EditorState): readonly BoundBlock[] {
  const cached = replacements.get(state); if (cached?.revision === revision) return cached.values;
  const context = state.facet(renderContext);
  if (!context.allowBlockEffects || !context.allowScriptExecution || !state.field(livePreviewState, false)) return [];
  const result: BoundBlock[] = [];
  for (const block of boundBlocks(state.field(syntaxModel))) {
    if (!block.script || sourceIsOpen(state, block) || result.some(outer => block.from >= outer.from && block.to <= outer.to)) continue;
    result.push(block);
  }
  replacements.set(state, { revision, values: result });
  return result;
}
const replacements = new WeakMap<EditorState, { revision: number; values: BoundBlock[] }>();
const ownership = new WeakMap<EditorState, { revision: number; ranges: SourceSpan[] }>();
/** Shared exclusion for every native renderer; CSS-only effects own no text. */
export function blockEffectOwns(state: EditorState, span: SourceSpan): boolean {
  if (!state.facet(renderContext).allowBlockEffects || !state.field(livePreviewState, false)) return false;
  let cached = ownership.get(state);
  if (cached?.revision !== revision) {
    const spans = [...activeBlockReplacements(state).map(block => block.target),
      ...boundBlocks(state.field(syntaxModel)).filter(block => !sourceIsOpen(state, block) &&
        (!block.script || state.facet(renderContext).allowScriptExecution)).map(block => block.marker)]
      .sort((a, b) => a.from - b.from);
    const ranges: SourceSpan[] = [];
    for (const range of spans) {
      const last = ranges.at(-1);
      if (last && range.from <= last.to) last.to = Math.max(last.to, range.to);
      else ranges.push({ ...range });
    }
    cached = { revision, ranges }; ownership.set(state, cached);
  }
  let lo = 0, hi = cached.ranges.length;
  while (lo < hi) { const mid = (lo + hi) >>> 1; if (cached.ranges[mid].from <= span.from) lo = mid + 1; else hi = mid; }
  return lo > 0 && span.to <= cached.ranges[lo - 1].to;
}
