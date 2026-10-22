import { parser, GFM } from '@lezer/markdown';
import { TreeFragment, type Tree, type ChangedRange } from '@lezer/common';

export const markdownParser = parser.configure(GFM);
export interface SourceSpan { from: number; to: number }
export interface SyntaxRange extends SourceSpan { name: string; parent: number | null }
export interface HtmlToken extends SourceSpan { raw: string; tag: string; closing: boolean }
export const simpleHtmlTags = new Set(['br', 'b', 'strong', 'i', 'em', 'kbd', 'mark', 'u', 's', 'del', 'sub', 'sup', 'small']);
export interface MarkdownModel {
  id: string; version: number; text: string; tree: Tree;
  nodes: SyntaxRange[]; literal: SourceSpan[]; html: HtmlToken[]; htmlBlocks: SourceSpan[];
  entities: SourceSpan[]; frontmatter: SourceSpan | null;
}
const predecessors=new WeakMap<MarkdownModel,{previous:WeakRef<MarkdownModel>;changes:readonly ChangedRange[]}>();
export const syntaxPredecessor=(model:MarkdownModel)=>predecessors.get(model);

/** One full-source grammar for views, fragments and metadata; never serializes Markdown. */
export function analyzeMarkdown(text: string, id = '', version = 0): MarkdownModel {
  return modelFromTree(text, id, version, markdownParser.parse(text));
}

/** Reuse unchanged grammar fragments; derived ranges still cover the full source. */
export function updateMarkdown(previous: MarkdownModel, text: string, changes: readonly ChangedRange[], version = previous.version + 1): MarkdownModel {
  const fragments = TreeFragment.applyChanges(TreeFragment.addTree(previous.tree), changes);
  const next=modelFromTree(text, previous.id, version, markdownParser.parse(text, fragments));
  predecessors.set(next,{previous:new WeakRef(previous),changes});return next;
}

function modelFromTree(text: string, id: string, version: number, tree: Tree): MarkdownModel {
  const nodes: SyntaxRange[] = [], literal: SourceSpan[] = [], html: HtmlToken[] = [], htmlBlocks: SourceSpan[] = [], entities: SourceSpan[] = [];
  const parents: number[] = [];
  const fm = text.match(/^---\n[\s\S]*?\n---[ \t]*(?:\n|$)/);
  const frontmatter = fm ? { from: 0, to: fm[0].length } : null;
  const readToken = (from: number, to: number): HtmlToken | null => {
    const raw = text.slice(from, to);
    const match = raw.match(/^<(\/?)\s*([A-Za-z][\w:-]*)\b/);
    return match ? { from, to, raw, tag: match[2].toLowerCase(), closing: match[1] === '/' } : null;
  };
  tree.iterate({
    enter(node) {
      const index = nodes.length;
      nodes.push({ name: node.name, from: node.from, to: node.to, parent: parents.at(-1) ?? null });
      parents.push(index);
      if (frontmatter && node.from < frontmatter.to && node.name !== 'Document') return;
      if (['FencedCode', 'CodeBlock', 'InlineCode'].includes(node.name)) literal.push({ from: node.from, to: node.to });
      if (node.name === 'Entity') entities.push({ from: node.from, to: node.to });
      if (node.name === 'HTMLTag') {
        const token = readToken(node.from, node.to);
        if (token) html.push(token);
      }
      if (node.name === 'HTMLBlock') {
        const tokens: HtmlToken[] = [];
        const value = text.slice(node.from, node.to);
        for (const match of value.matchAll(/<\/?[A-Za-z][^>]*>/g)) {
          const token = readToken(node.from + match.index!, node.from + match.index! + match[0].length);
          if (token) tokens.push(token);
        }
        if (tokens.length && tokens.every((token) => simpleHtmlTags.has(token.tag)) && !value.includes('<!--')) html.push(...tokens);
        else htmlBlocks.push({ from: node.from, to: node.to });
      }
    },
    leave() { parents.pop(); },
  });
  const isLiteral = (span: SourceSpan) =>
    (frontmatter && span.from < frontmatter.to) || literal.some((range) => span.from >= range.from && span.to <= range.to);
  return { id, version, text, tree, nodes, literal, html: html.filter((token) => !isLiteral(token)),
    entities: entities.filter((token) => !isLiteral(token)), htmlBlocks, frontmatter };
}

export function caretTouches(span: SourceSpan, selections: readonly { from: number; to: number }[], readonly = false): boolean {
  return !readonly && selections.some((selection) => selection.from === selection.to && selection.from >= span.from && selection.from <= span.to);
}
