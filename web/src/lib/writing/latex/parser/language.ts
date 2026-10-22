import { NodeType, Tree } from '@lezer/common';
import type { EditorState } from '@codemirror/state';
import { parser } from './mathjax/latex-parser';
import { mathRegions } from '@webobsidian/markdown-core';
import { syntaxModel } from '../../../syntaxModel';
import { getLatexSuiteConfig } from '../snippets/codemirror/config';

const rootType = NodeType.define({ id: 0, name: 'FormulaDocument', top: true });
const cache = new Map<string, Tree>();
const positioned = new WeakMap<EditorState, Map<string, Tree>>();
/** TeX trees are local to formulas. Markdown parsing remains owned by the host. */
export function formulaTree(state: EditorState, from: number, to: number): Tree {
  let trees = positioned.get(state);
  if (!trees) {
    trees = new Map();
    positioned.set(state, trees);
  }
  const key = from + ':' + to;
  const existing = trees.get(key);
  if (existing) return existing;
  const model = state.field(syntaxModel);
  let source = model.text.slice(from, to);
  const region = mathRegions(model, getLatexSuiteConfig(state).forceMathLanguages).find(
    (r) => r.bodyFrom === from && r.bodyTo === to,
  );
  if (region) {
    const parts: string[] = [];
    let p = from;
    for (const s of region.segments) {
      parts.push(model.text.slice(p, s.from).replace(/[^\n]/g, ' '), model.text.slice(s.from, s.to));
      p = s.to;
    }
    parts.push(model.text.slice(p, to).replace(/[^\n]/g, ' '));
    source = parts.join('');
  }
  let tree = cache.get(source);
  if (!tree) {
    tree = parser.parse(source);
    cache.set(source, tree);
    if (cache.size > 256) cache.delete(cache.keys().next().value!);
  }
  const wrapped = new Tree(rootType, [tree], [from], state.doc.length);
  trees.set(key, wrapped);
  return wrapped;
}
