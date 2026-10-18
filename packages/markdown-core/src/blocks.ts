import type { MarkdownModel, SourceSpan, SyntaxRange } from './syntax.js';
import { extractMetadata } from './metadata.js';

export interface BlockContainer extends SourceSpan {
  kind: 'quote' | 'callout' | 'code'; depth: number;
  type: string; title: string; fold: string; prefixTo: number; titleFrom: number; bodyFrom: number;
  language: string; body: string;
}
export const stripQuotePrefix = (line: string, depth: number): string => {
  for (let index = 0; index < depth; index++) line = line.replace(/^ {0,3}> ?/, '');
  return line;
};

export function blockContainers(model: MarkdownModel): BlockContainer[] {
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
    result.push({ from, to: node.to, depth, kind: code ? 'code' : callout ? 'callout' : 'quote',
      type: callout?.[1].split('|')[0].trim().toLowerCase() ?? '', title: callout?.[3] ?? '', fold: callout?.[2] ?? '',
      prefixTo: from + prefixLength + (callout ? logical.length - callout[3].length : 0),
      titleFrom: from + prefixLength + (callout ? logical.length - callout[3].length : 0),
      bodyFrom: Math.min(node.to, firstEnd + 1),
      language: code ? logical.match(/^\s*(?:`{3,}|~{3,})\s*([^\s`]*)/)?.[1] ?? '' : '',
      body: code ? contentLines.slice(1, -1).map((line) => stripQuotePrefix(line, depth)).join('\n') : '',
    });
  }
  return result;
}

export interface MathBlock extends SourceSpan { tex: string }
export function mathBlocks(model: MarkdownModel): MathBlock[] {
  const ranges: MathBlock[] = [];
  const lines = model.text.split('\n');
  const offsets: number[] = [];
  let offset = 0;
  for (const line of lines) { offsets.push(offset); offset += line.length + 1; }
  const excluded = [...model.literal, ...model.htmlBlocks, ...extractMetadata(model).comments, ...(model.frontmatter ? [model.frontmatter] : [])];
  const blocked = (from: number, to: number) => excluded.some((range) => from < range.to && to > range.from);
  for (let index = 0; index < lines.length; index++) {
    const raw = lines[index];
    const prefix = raw.match(/^(?: {0,3}> ?)*/)?.[0] ?? '';
    const depth = (prefix.match(/>/g) ?? []).length;
    if (!/^\s*\$\$\s*$/.test(raw.slice(prefix.length)) || blocked(offsets[index], offsets[index] + raw.length)) continue;
    let end = index + 1;
    for (; end < lines.length; end++) {
      const line = stripQuotePrefix(lines[end], depth);
      if (/^\s*\$\$\s*$/.test(line)) break;
    }
    if (end === lines.length) continue;
    ranges.push({ from: offsets[index], to: offsets[end] + lines[end].length,
      tex: lines.slice(index + 1, end).map((line) => stripQuotePrefix(line, depth)).join('\n') });
    index = end;
  }
  return ranges;
}
