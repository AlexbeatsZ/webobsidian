import { analyzeMarkdown, markdownComments, type MarkdownModel, type SourceSpan } from './syntax.js';
import { isGlobalContentTarget, parseLinkTarget } from './links.js';
import { BODY_HEADING_NODE, BODY_HEADING_LEVEL, bodyHeadingParts } from './bodyHeadings.js';
import { mathRegions } from './math.js';
import { decodeHtmlEntity } from './html.js';

export interface Heading extends SourceSpan { level: number; text: string; kind?: 'body' }
export interface LinkOccurrence extends SourceSpan {
  target: string; label: string; kind: 'wiki' | 'markdown' | 'reference' | 'url'; embed: boolean;
}
export interface Metadata {
  tags: string[]; links: string[]; headings: Heading[]; comments: SourceSpan[];
  blockIds: (SourceSpan & { id: string })[];
  linkOccurrences: LinkOccurrence[];
  linkDefinitions: (SourceSpan & { id: string; target: string })[];
}
const metadataCache = new WeakMap<MarkdownModel, Metadata>();

export function extractMetadata(source: string | MarkdownModel): Metadata {
  const model = typeof source === 'string' ? analyzeMarkdown(source) : source;
  const cached = metadataCache.get(model);
  if (cached) return cached;
  const { text } = model;
  const forbidden = [...model.literal, ...model.html, ...model.htmlBlocks, ...(model.frontmatter ? [model.frontmatter] : [])];
  const intersects = (from: number, to: number) => forbidden.some((range) => from < range.to && to > range.from);
  const comments = markdownComments(model);
  forbidden.push(...comments, ...mathRegions(model));
  const links = new Set<string>(), tags = new Set<string>(), linkOccurrences: LinkOccurrence[] = [];
  const escaped = (at: number) => { let count = 0; while (at > 0 && text[--at] === '\\') count++; return count % 2 !== 0; };
  for (const match of text.matchAll(/!?\[\[([^\]\n]+?)\]\]/g)) {
    if (intersects(match.index!, match.index! + match[0].length) || escaped(match.index!) || match[1].includes('[[')) continue;
    const target = parseLinkTarget(match[1]);
    const destination = isGlobalContentTarget(match[1]) ? target.fragment : target.path + (target.fragment ? '#' + target.fragment : '');
    linkOccurrences.push({ from: match.index!, to: match.index! + match[0].length, target: destination,
      label: target.alias ?? destination, kind: 'wiki', embed: match[0].startsWith('!') });
    links.add(destination);
  }
  const children = new Map<number, typeof model.nodes>();
  model.nodes.forEach(node => { if (node.parent !== null) { const list = children.get(node.parent) ?? []; list.push(node); children.set(node.parent, list); } });
  const linkDefinitions: Metadata['linkDefinitions'] = [];
  const labelKey = (label: string) => label.replace(/\s+/g, ' ').trim().toLocaleLowerCase();
  const destinationText = (value: string) => value.replace(/^<|>$/g, '').replace(/\\([!"#$%&'()*+,\-./:;<=>?@[\]^_`{|}~])/g, '$1')
    .replace(/&(?:#[xX][0-9a-fA-F]+|#\d+|[a-zA-Z][\w]+);/g, decodeHtmlEntity);
  model.nodes.forEach((node, index) => {
    if (node.name !== 'LinkReference' || intersects(node.from, node.to)) return;
    const parts = children.get(index) ?? [], label = parts.find(child => child.name === 'LinkLabel'), url = parts.find(child => child.name === 'URL');
    if (label && url) linkDefinitions.push({ from: node.from, to: node.to, id: labelKey(text.slice(label.from + 1, label.to - 1)),
      target: destinationText(text.slice(url.from, url.to)) });
  });
  const definitions = new Map(linkDefinitions.map(definition => [definition.id, definition.target]));
  const wikiRanges = linkOccurrences.slice();
  model.nodes.forEach((node, index) => {
    if (!['Link', 'Image', 'Autolink'].includes(node.name) || intersects(node.from, node.to) ||
      wikiRanges.some(wiki => node.from < wiki.to && node.to > wiki.from)) return;
    const parts = children.get(index) ?? [], url = parts.find(child => child.name === 'URL'), marks = parts.filter(child => child.name === 'LinkMark');
    const label = marks.length > 1 ? text.slice(marks[0].to, marks[1].from) : '';
    const reference = parts.find(child => child.name === 'LinkLabel');
    const target = url ? destinationText(text.slice(url.from, url.to))
      : definitions.get(labelKey(reference ? text.slice(reference.from + 1, reference.to - 1) || label : label));
    if (!target) return;
    linkOccurrences.push({ from: node.from, to: node.to, target, label, embed: node.name === 'Image',
      kind: node.name === 'Autolink' ? 'url' : url ? 'markdown' : 'reference' });
    if (!/^[a-z][a-z\d+.-]*:/i.test(target)) links.add(target);
  });
  for (const match of text.matchAll(/\b(?:https?:\/\/|mailto:)[^\s<>"\[\]]+/g)) {
    const from = match.index!, target = match[0].replace(/[.,;!?]+$/, ''), to = from + target.length;
    if (!intersects(from, to) && !linkOccurrences.some(link => from < link.to && to > link.from))
      linkOccurrences.push({ from, to, target, label: target, kind: 'url', embed: false });
  }
  linkOccurrences.sort((a, b) => a.from - b.from);
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
    const content = parts ? raw.slice(parts.contentFrom, parts.contentTo).trim() : raw.replace(/^#{1,6}[ \t]+/, '')
      .replace(/\n[ \t]*[=-]+[ \t]*$/, '').replace(/[ \t]+#+[ \t]*$/, '').trim();
    const anchor = content.match(/[\t ]+\^heading-[\p{L}\p{N}-]+[\t ]*$/u);
    const label = anchor ? content.slice(0, anchor.index).replace(/[\t ]+#+[\t ]*$/, '').trim() : content;
    headings.push({ from: node.from, to: node.to, level: body ? BODY_HEADING_LEVEL : Number(match![1]), text: label, ...(body ? { kind: 'body' as const } : {}) });
  }
  const blockIds: Metadata['blockIds'] = [];
  for (const match of text.matchAll(/(?:^|[ \t])(\^[\p{L}\p{N}-]+)([ \t]+#+)?[ \t]*$/gmu)) {
    const from = match.index! + match[0].indexOf(match[1]);
    if (match[2] && !model.nodes.some(node => (/^ATXHeading[1-6]$/.test(node.name) || node.name === BODY_HEADING_NODE) && node.from <= from && node.to >= from + match[0].trimStart().length)) continue;
    if (!intersects(from, from + match[1].length)) blockIds.push({ from, to: from + match[1].length, id: match[1].slice(1) });
  }
  const result = { tags: [...tags], links: [...links], headings, comments, blockIds, linkOccurrences, linkDefinitions };
  metadataCache.set(model, result);
  return result;
}
