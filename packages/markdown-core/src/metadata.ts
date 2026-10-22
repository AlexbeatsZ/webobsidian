import { analyzeMarkdown, type MarkdownModel, type SourceSpan } from './syntax.js';
import { parseLinkTarget } from './links.js';
import { BODY_HEADING_NODE, BODY_HEADING_LEVEL, bodyHeadingParts } from './bodyHeadings.js';

export interface Heading extends SourceSpan { level: number; text: string; kind?: 'body' }
export interface Metadata {
  tags: string[]; links: string[]; headings: Heading[]; comments: SourceSpan[];
  blockIds: (SourceSpan & { id: string })[];
}
const metadataCache = new WeakMap<MarkdownModel, Metadata>();

export function extractMetadata(source: string | MarkdownModel): Metadata {
  const model = typeof source === 'string' ? analyzeMarkdown(source) : source;
  const cached = metadataCache.get(model);
  if (cached) return cached;
  const { text } = model;
  const forbidden = [...model.literal, ...model.html, ...model.htmlBlocks, ...(model.frontmatter ? [model.frontmatter] : [])];
  const intersects = (from: number, to: number) => forbidden.some((range) => from < range.to && to > range.from);
  const comments: SourceSpan[] = [];
  for (const match of text.matchAll(/%%[\s\S]*?%%/g)) {
    if (!intersects(match.index!, match.index! + match[0].length)) comments.push({ from: match.index!, to: match.index! + match[0].length });
  }
  forbidden.push(...comments);
  const links = new Set<string>(), tags = new Set<string>();
  for (const match of text.matchAll(/!?\[\[([^\]\n]+?)\]\]/g)) {
    if (intersects(match.index!, match.index! + match[0].length)) continue;
    const target = parseLinkTarget(match[1]);
    links.add(target.path + (target.fragment ? '#' + target.fragment : ''));
  }
  for (const match of text.matchAll(/!?\[[^\]\n]*\]\(([^)\n]+)\)/g)) {
    if (intersects(match.index!, match.index! + match[0].length)) continue;
    const target = match[1].replace(/\s+"[^"]*"$/, '').trim().replace(/^<|>$/g, '');
    if (!/^[a-z][a-z\d+.-]*:/i.test(target)) links.add(target);
  }
  for (const match of text.matchAll(/(^|[\s>])(#[\p{L}\p{N}_/-]+)/gu)) {
    const from = match.index! + match[1].length;
    if (!intersects(from, from + match[2].length) && /\p{L}/u.test(match[2])) tags.add(match[2].slice(1));
  }
  const headings: Heading[] = [];
  for (const node of model.nodes) {
    const match = node.name.match(/^(?:ATX|Setext)Heading([1-6])$/);
    const body = node.name === BODY_HEADING_NODE;
    if ((!match && !body) || intersects(node.from, node.to)) continue;
    const raw = text.slice(node.from, node.to);
    const parts = body ? bodyHeadingParts(raw)! : null;
    const label = parts ? raw.slice(parts.contentFrom, parts.contentTo).trim() : raw.replace(/^#{1,6}[ \t]+/, '')
      .replace(/\n[ \t]*[=-]+[ \t]*$/, '').replace(/[ \t]+#+[ \t]*$/, '').trim();
    headings.push({ from: node.from, to: node.to, level: body ? BODY_HEADING_LEVEL : Number(match![1]), text: label, ...(body ? { kind: 'body' as const } : {}) });
  }
  const blockIds: Metadata['blockIds'] = [];
  for (const match of text.matchAll(/(?:^|[ \t])(\^[\p{L}\p{N}-]+)[ \t]*$/gmu)) {
    const from = match.index! + match[0].indexOf(match[1]);
    if (!intersects(from, from + match[1].length)) blockIds.push({ from, to: from + match[1].length, id: match[1].slice(1) });
  }
  const result = { tags: [...tags], links: [...links], headings, comments, blockIds };
  metadataCache.set(model, result);
  return result;
}

export function fragmentRange(model: MarkdownModel, fragment: string): SourceSpan | null {
  if (!fragment) return { from: 0, to: model.text.length };
  const meta = extractMetadata(model);
  let decoded = fragment;
  try { decoded = decodeURIComponent(fragment); } catch { /* literal percent */ }
  if (decoded.startsWith('^')) {
    const block = meta.blockIds.find((candidate) => candidate.id === decoded.slice(1));
    if (!block) return null;
    const paragraph = model.nodes.filter((node) => ['Paragraph', 'ListItem', 'Blockquote'].includes(node.name) && node.from <= block.from && node.to >= block.to)
      .sort((a, b) => a.to - a.from - (b.to - b.from))[0];
    return paragraph ? { from: paragraph.from, to: paragraph.to } : { from: model.text.lastIndexOf('\n', block.from - 1) + 1, to: block.to };
  }
  const index = meta.headings.findIndex((heading) => heading.text.normalize('NFC').toLocaleLowerCase() === decoded.normalize('NFC').toLocaleLowerCase());
  if (index < 0) return null;
  const heading = meta.headings[index];
  const next = meta.headings.slice(index + 1).find((candidate) => candidate.level <= heading.level);
  return { from: heading.from, to: next?.from ?? model.text.length };
}
