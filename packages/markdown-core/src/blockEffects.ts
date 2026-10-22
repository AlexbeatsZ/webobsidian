import type { MarkdownModel, SourceSpan, SyntaxRange } from './syntax.js';
import { extractMetadata } from './metadata.js';
import { mathRegions } from './math.js';
import { BLOCK_EFFECT_MARK, blockEffectNames } from './blockEffectSyntax.js';
export { BLOCK_EFFECT_MARK, blockEffectNames, blockEffectSyntax } from './blockEffectSyntax.js';

export interface BlockEffectTarget extends SourceSpan {
  marker: SourceSpan; target: SourceSpan; names: readonly string[]; kind: string;
  /** Existing complete-model node, so scripts can reuse lists/tables without reparsing. */
  node: SyntaxRange; prefix: string;
}
const targets = new WeakMap<MarkdownModel, readonly BlockEffectTarget[]>();
export function blockEffectTargets(model: MarkdownModel): readonly BlockEffectTarget[] {
  const old = targets.get(model); if (old) return old;
  const excluded = [...extractMetadata(model).comments, ...mathRegions(model),
    ...(model.frontmatter ? [model.frontmatter] : [])];
  const siblings = new Map<number | null, SyntaxRange[]>();
  for (const node of model.nodes) {
    const group = siblings.get(node.parent) ?? []; group.push(node); siblings.set(node.parent, group);
  }
  const result: BlockEffectTarget[] = [];
  for (const group of siblings.values()) for (let i = 0; i + 1 < group.length; i++) {
    const mark = group[i], next = group[i + 1];
    if (mark.name !== BLOCK_EFFECT_MARK || next.name === BLOCK_EFFECT_MARK || excluded.some(r => mark.from < r.to && mark.to > r.from)) continue;
    const names = blockEffectNames(model.text.slice(mark.from, mark.to)); if (!names) continue;
    const lineFrom = model.text.lastIndexOf('\n', mark.from - 1) + 1;
    const prefix = model.text.slice(lineFrom, mark.from);
    // Only whitespace and the same containing quote may separate marker and target.
    if (model.text.slice(mark.to, next.from).split('\n').some(line => line.replace(/^[ \t]*(?:>[ \t]*)*/, '').trim())) continue;
    const targetFrom = model.text.lastIndexOf('\n', next.from - 1) + 1;
    result.push({ from: lineFrom, to: next.to, marker: { from: lineFrom, to: mark.to },
      target: { from: targetFrom, to: next.to }, names, kind: next.name, node: next, prefix });
  }
  result.sort((a, b) => a.from - b.from || b.to - a.to);
  targets.set(model, result); return result;
}

export interface ListEffectItem extends SourceSpan { depth: number; text: string; parent: number | null }
const lists = new WeakMap<MarkdownModel, Map<SyntaxRange, readonly ListEffectItem[]>>();
/** List hierarchy from the shared grammar; no second list parser or body cache. */
export function blockEffectList(model: MarkdownModel, root: SyntaxRange): readonly ListEffectItem[] {
  let cache = lists.get(model); if (!cache) { cache = new Map(); lists.set(model, cache); }
  const old = cache.get(root); if (old) return old;
  const result: ListEffectItem[] = [], indices = new Map<number, number>();
  const childrenByParent = new Map<number, SyntaxRange[]>();
  for (const node of model.nodes) if (node.parent !== null && node.from >= root.from && node.to <= root.to) {
    const children = childrenByParent.get(node.parent) ?? []; children.push(node); childrenByParent.set(node.parent, children);
  }
  for (let index = 0; index < model.nodes.length; index++) {
    const node = model.nodes[index];
    if (node.name !== 'ListItem' || node.from < root.from || node.to > root.to) continue;
    let ancestor = node.parent, parent: number | null = null;
    while (ancestor !== null) {
      if (indices.has(ancestor)) { parent = indices.get(ancestor)!; break; }
      ancestor = model.nodes[ancestor].parent;
    }
    const children = (childrenByParent.get(index) ?? []).filter(n => !['ListMark', 'BulletList', 'OrderedList'].includes(n.name));
    const text = children.map(n => model.text.slice(n.from, n.to)).join('\n\n');
    indices.set(index, result.length);
    result.push({ from: node.from, to: node.to, depth: parent === null ? 0 : result[parent].depth + 1, parent, text });
  }
  cache.set(root, result); return result;
}
