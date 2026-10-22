import type { MarkdownModel, SourceSpan, SyntaxRange } from './syntax.js';
import { mathRegions } from './math.js';

export interface BlockContainer extends SourceSpan {
  kind: 'quote' | 'callout' | 'code'; depth: number;
  type: string; title: string; fold: string; prefixTo: number; titleFrom: number; bodyFrom: number;
  language: string; body: string; closed?: boolean;
}
export const stripQuotePrefix = (line: string, depth: number): string => {
  for (let index = 0; index < depth; index++) line = line.replace(/^ {0,3}> ?/, '');
  return line;
};

const containerCache = new WeakMap<MarkdownModel, BlockContainer[]>();
export function blockContainers(model: MarkdownModel): BlockContainer[] {
  const cached = containerCache.get(model); if (cached) return cached;
  const result: BlockContainer[] = [];
  for (const node of model.nodes) {
    if (!['Blockquote', 'FencedCode', 'CodeBlock'].includes(node.name)) continue;
    if (model.frontmatter && node.from < model.frontmatter.to) continue;
    let parent = node.parent, depth = node.name === 'Blockquote' ? 1 : 0;
    while (parent !== null) { const ancestor: SyntaxRange = model.nodes[parent]; if (ancestor.name === 'Blockquote') depth++; parent = ancestor.parent; }
    const from = model.text.lastIndexOf('\n', node.from - 1) + 1;
    const endOfLine = model.text.indexOf('\n', from);
    const firstEnd = endOfLine < 0 ? model.text.length : endOfLine;
    const firstRaw = model.text.slice(from, firstEnd);
    const logical = stripQuotePrefix(firstRaw, depth);
    const prefixLength = firstRaw.length - logical.length;
    const callout = logical.match(/^\[!([^\]]+)\]([+-]?)[ \t]*(.*)$/);
    const code = node.name !== 'Blockquote';
    const contentLines = model.text.slice(from, node.to).split('\n');
    const fence = code ? logical.match(/^\s*(`{3,}|~{3,})/)?.[1] : undefined;
    const closing = fence ? stripQuotePrefix(contentLines.at(-1) ?? '', depth).match(/^[\t ]*(`+|~+)[\t ]*$/)?.[1] : undefined;
    result.push({ from, to: node.to, depth, kind: code ? 'code' : callout ? 'callout' : 'quote',
      type: callout?.[1].split('|')[0].trim().toLowerCase() ?? '', title: callout?.[3] ?? '', fold: callout?.[2] ?? '',
      prefixTo: from + prefixLength + (callout ? logical.length - callout[3].length : 0),
      titleFrom: from + prefixLength + (callout ? logical.length - callout[3].length : 0),
      bodyFrom: Math.min(node.to, firstEnd + 1),
      language: code ? logical.match(/^\s*(?:`{3,}|~{3,})\s*([^\s`]*)/)?.[1] ?? '' : '',
      body: code ? contentLines.slice(1, -1).map((line) => stripQuotePrefix(line, depth)).join('\n') : '',
      closed: Boolean(fence && closing && contentLines.length > 1 && closing[0] === fence[0] && closing.length >= fence.length),
    });
  }
  containerCache.set(model, result); return result;
}

export interface MathBlock extends SourceSpan { tex: string }
export function mathBlocks(model: MarkdownModel): MathBlock[] {
  return mathRegions(model).filter(r => r.closed && r.block && r.kind === 'dollar')
    .map(r => ({ from: r.from, to: r.to, tex: r.tex.trim() }));
}
