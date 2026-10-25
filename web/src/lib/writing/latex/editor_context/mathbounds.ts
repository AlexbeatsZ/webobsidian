import { EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view';
import type { EditorState } from '@codemirror/state';
import type { SyntaxNode } from '@lezer/common';
import { mathRegions, formulaAt, type MathRegion } from '@webobsidian/markdown-core';
import { syntaxModel } from '../../../syntaxModel';
import { getLatexSuiteConfig } from '../snippets/codemirror/config';
import { formulaTree } from '../parser/language';
import type { Bounds } from './context';
import { sourceIsOpen } from '../../../sourceControls';
import { mathSourceVisible } from './mathPresentation';

export enum MathMode {
  InlineMath,
  BlockMath,
  CodeMath,
}
export type MathBounds = Bounds & {
  mode: MathMode;
  tree: SyntaxNode | null;
  overlay: { from: number; to: number }[];
};
export class MathBoundsPlugin {
  private state: EditorState;
  private disabled = false;
  constructor(readonly view: EditorView) {
    this.state = view.state;
  }
  init(view: EditorView) {
    this.state = view.state;
    return this;
  }
  update(u: ViewUpdate) {
    this.state = u.state;
    if (u.docChanged) this.disabled = false;
  }
  reset() {
    this.disabled = true;
  }
  get regions() {
    return this.disabled
      ? []
      : mathRegions(this.state.field(syntaxModel), getLatexSuiteConfig(this.state).forceMathLanguages);
  }
  inMathBound(state: EditorState, pos: number): MathBounds | null {
    const r = formulaAt(this.regions, pos);
    if (r) return this.makeBound(r);
    // An empty $$ pair is also the insertion point of an inline snippet.
    const empty = this.regions.find((r) => r.kind === 'dollar' && pos === r.bodyFrom - 1 && r.display);
    return empty
      ? {
          outer_start: pos - 1,
          outer_end: pos + 1,
          inner_start: pos,
          inner_end: pos,
          mode: MathMode.InlineMath,
          tree: null,
          overlay: [],
        }
      : null;
  }
  private makeBound(r: MathRegion): MathBounds {
    const state = this.state;
    return {
      outer_start: r.kind === 'dollar' ? r.bodyFrom - (r.display ? 2 : 1) : r.from,
      outer_end: r.to,
      inner_start: r.bodyFrom,
      inner_end: r.bodyTo,
      mode: r.kind === 'code' ? MathMode.CodeMath : r.display ? MathMode.BlockMath : MathMode.InlineMath,
      get tree() {
        return formulaTree(state, r.bodyFrom, r.bodyTo).topNode.firstChild;
      },
      overlay: r.segments,
    };
  }
  get mathBounds() {
    return this.regions
      .filter((r) => this.view.visibleRanges.some((v) => r.from < v.to && r.to > v.from))
      .map((r) => this.makeBound(r));
  }
  getEquationOverlays(state: EditorState, concealing = false) {
    return this.mathBounds
      .filter(
        (b) =>
          mathSourceVisible(state, { from: b.outer_start, to: b.outer_end }) &&
          (!concealing || !sourceIsOpen(state, { from: b.outer_start, to: b.outer_end })),
      )
      .map((bound) => ({
        bound,
        overlay: { from: bound.inner_start, to: bound.inner_end },
        text: state.sliceDoc(bound.inner_start, bound.inner_end),
      }));
  }
}
export const mathBoundsPlugin = ViewPlugin.fromClass(MathBoundsPlugin);
export function getMathBoundsPlugin(view: EditorView, init = true) {
  const value = view.plugin(mathBoundsPlugin);
  if (!value) throw new Error('Native math bounds not installed');
  return init ? value.init(view) : value;
}
