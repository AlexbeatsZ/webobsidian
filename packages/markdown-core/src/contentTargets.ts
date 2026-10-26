import { analyzeMarkdown, markdownComments, type MarkdownModel, type SourceSpan, type SyntaxRange } from './syntax.js';
import type { SourceChange } from './source.js';
import { extractMetadata } from './metadata.js';
import { blockContainers, sourceLinePrefix } from './blocks.js';
import { equations } from './equations.js';
import { mathRegions } from './math.js';

export interface ContentTarget extends SourceSpan {
  id: string;
  kind: 'heading' | 'equation' | 'code' | 'callout' | 'range';
  focus: SourceSpan;
  label: string;
  anchor?: SourceSpan;
  startAnchor?: SourceSpan;
  endAnchor?: SourceSpan;
  protectedSpans: SourceSpan[];
}
export interface ContentTargets {
  targets: ContentTarget[];
  issues: { id: string; message: string }[];
}
const cache = new WeakMap<MarkdownModel, ContentTargets>();
const validContentTargetId = (id: string) => /^(?:heading|eq|code|callout|range)-[\p{L}\p{N}-]+$/u.test(id);

export function contentTargets(model: MarkdownModel): ContentTargets {
  const cached = cache.get(model); if (cached) return cached;
  const { text, nodes } = model, meta = extractMetadata(model);
  const targets: ContentTarget[] = [], issues: ContentTargets['issues'] = [];
  const issue = (id: string, message: string) => { issues.push({ id, message }); };
  const lineStart = (at: number) => text.lastIndexOf('\n', at - 1) + 1;
  const lineEnd = (at: number) => { const end = text.indexOf('\n', at); return end < 0 ? text.length : end; };
  const prefix = (at: number) => sourceLinePrefix(text.slice(lineStart(at), lineEnd(at)));
  const counts = new Map<string, number>();
  for (const anchor of meta.blockIds) counts.set(anchor.id, (counts.get(anchor.id) ?? 0) + 1);
  const typed = meta.blockIds.filter(anchor => /^(?:heading|eq|code|callout|range)-/.test(anchor.id));
  const used = new Set<number>();
  const add = (target: Omit<ContentTarget, 'protectedSpans'>) => {
    targets.push({ ...target, protectedSpans: [target.anchor, target.startAnchor, target.endAnchor].filter((span): span is SourceSpan => !!span) });
    if (target.anchor) used.add(target.anchor.from);
  };
  for (const heading of meta.headings) {
    const anchor = typed.find(candidate => candidate.id.startsWith('heading-') && candidate.from >= heading.from && candidate.to <= heading.to);
    if (!anchor || !validContentTargetId(anchor.id) || !/^(?:[\t ]*(?:#+[\t ]*)?|[\t ]*\n[\t ]*[=-]+[\t ]*)$/.test(text.slice(anchor.to, heading.to))) continue;
    const owner = nodes.find(node => node.from === heading.from && node.to === heading.to && /^(?:ATXHeading[1-6]|SetextHeading[1-6]|BodyHeading)$/.test(node.name));
    const containerEnd = owner?.parent === null || owner?.parent === undefined ? text.length : nodes[owner.parent].to;
    const next = meta.headings.find(candidate => candidate.from > heading.from && candidate.level <= heading.level &&
      nodes.some(node => node.from === candidate.from && node.to === candidate.to && node.parent === owner?.parent));
    add({ id: anchor.id, kind: 'heading', from: heading.from, to: Math.min(next?.from ?? containerEnd, containerEnd),
      focus: { from: heading.from, to: heading.to }, label: heading.text, anchor });
  }
  for (const equation of equations(model)) {
    if (!equation.id?.startsWith('eq-') || !equation.anchor || !validContentTargetId(equation.id)) continue;
    if (!equation.referenceable || equation.ambiguous) { issue(equation.id, 'Equation is not a unique referenceable target'); continue; }
    const start = lineStart(equation.from);
    add({ id: equation.id, kind: 'equation', from: /^(?:[\t ]*> ?)*[\t ]*$/.test(text.slice(start, equation.from)) ? start : equation.from, to: equation.anchor.to,
      focus: { from: equation.from, to: equation.to }, label: equation.number ? `(${equation.number})` : equation.tex.trim(), anchor: equation.anchor });
  }
  for (const block of blockContainers(model)) {
    if (block.kind === 'quote' || (block.kind === 'code' && !block.closed)) continue;
    const namespace = block.kind + '-';
    const anchor = typed.find(candidate => {
      if (!candidate.id.startsWith(namespace) || !validContentTargetId(candidate.id)) return false;
      if (block.kind === 'callout' && candidate.from >= block.bodyFrom && candidate.to === block.to) {
        const containing = blockContainers(model).filter(container => container.from <= candidate.from && container.to >= candidate.to);
        return containing.at(-1) === block;
      }
      if (candidate.from < block.to || lineStart(candidate.from) !== lineEnd(block.to) + 1) return false;
      const rawPrefix = text.slice(lineStart(candidate.from), candidate.from);
      const ownerPrefix = block.kind === 'callout' ? prefix(block.from).replace(/>[\t ]?$/, '') : prefix(block.from);
      return rawPrefix === prefix(candidate.from) && prefix(candidate.from) === ownerPrefix;
    });
    if (!anchor) continue;
    add({ id: anchor.id, kind: block.kind, from: block.from, to: Math.max(block.to, anchor.to),
      focus: { from: block.from, to: block.to }, label: block.kind === 'code' ? block.language || 'Code' : block.title || block.type, anchor });
  }
  const forbidden = [...model.literal, ...model.html, ...model.htmlBlocks, ...markdownComments(model), ...mathRegions(model), ...(model.frontmatter ? [model.frontmatter] : [])];
  const markers: { id: string; edge: string; from: number; to: number; node?: SyntaxRange }[] = [];
  for (const match of text.matchAll(/^(?:[\t ]*>[\t ]?)*[\t ]*(\^range-[^\s:]+):([^\s]+)[\t ]*$/gm)) {
    const from = match.index! + match[0].indexOf(match[1]), to = from + match[1].length + match[2].length + 1;
    if (forbidden.some(span => from < span.to && to > span.from)) continue;
    const id = match[1].slice(1);
    if (!['start', 'end'].includes(match[2])) { issue(id, 'Invalid range boundary syntax'); continue; }
    const node = nodes.find(candidate => candidate.name === 'Paragraph' && candidate.from === from && candidate.to >= to && !text.slice(to, candidate.to).trim());
    markers.push({ id, edge: match[2], from, to, node });
  }
  const groups = new Map<string, typeof markers>();
  for (const marker of markers) { const group = groups.get(marker.id) ?? []; group.push(marker); groups.set(marker.id, group); }
  for (const [id, group] of groups) {
    const [start, end] = group;
    if (!validContentTargetId(id) || group.length !== 2 || start.edge !== 'start' || end.edge !== 'end' || counts.has(id)) {
      issue(id, 'Range requires one unique start and end'); continue;
    }
    if (!start.node || !end.node || start.node.parent !== end.node.parent || prefix(start.from) !== prefix(end.from)) {
      issue(id, 'Range boundaries must be complete blocks in the same container'); continue;
    }
    if (markers.some(marker => marker.id !== id && ((marker.from > start.from && marker.from < end.from) !==
      (groups.get(marker.id)?.every(other => other.from > start.from && other.from < end.from) ?? false)))) {
      issue(id, 'Crossing range boundaries'); continue;
    }
    const from = Math.min(text.length, lineEnd(start.to) + 1), to = lineStart(end.from);
    const children = nodes.filter(node => node.parent === start.node!.parent && node.from >= from && node.to <= to);
    if (!children.some(node => !markers.some(marker => marker.node === node))) { issue(id, 'Range has no complete content blocks'); continue; }
    add({ id, kind: 'range', from, to, focus: { from, to }, label: id.slice(6),
      startAnchor: { from: start.from, to: start.to }, endAnchor: { from: end.from, to: end.to } });
  }
  for (const anchor of typed) {
    if (!used.has(anchor.from)) issue(anchor.id, 'Typed anchor does not match a structural target');
  }
  for (const [id, count] of counts) if (count > 1 && /^(?:heading|eq|code|callout|range)-/.test(id)) issue(id, 'Duplicate content target ID');
  const result = { targets: targets.filter(target => (counts.get(target.id) ?? 0) <= 1 && !issues.some(item => item.id === target.id)).sort((a, b) => a.from - b.from), issues };
  cache.set(model, result); return result;
}

export function createContentTarget(model: MarkdownModel, selection: SourceSpan, kind?: ContentTarget['kind'], id?: string): { id: string; changes: SourceChange[] } {
  const { text } = model;
  if (!Number.isInteger(selection.from) || !Number.isInteger(selection.to) || selection.from < 0 || selection.to < selection.from || selection.to > text.length)
    throw new Error('Invalid content selection');
  const requested = selection;
  if (selection.to > selection.from && text[selection.to - 1] === '\n') selection = { ...selection, to: selection.to - 1 };
  const contains = (span: SourceSpan) => selection.from >= span.from && selection.to <= span.to;
  const existing = contentTargets(model).targets.filter(target => (!kind || target.kind === kind) &&
    (target.kind === 'range' ? requested.from === target.from && requested.to === target.to : contains(target.focus)))
    .sort((left, right) => left.focus.to - left.focus.from - (right.focus.to - right.focus.from))[0];
  if (existing) return { id: existing.id, changes: [] };
  const meta = extractMetadata(model);
  const heading = meta.headings.find(contains);
  const equation = equations(model).find(contains);
  const block = blockContainers(model).filter(candidate => candidate.kind !== 'quote' && contains(candidate))
    .sort((left, right) => left.to - left.from - (right.to - right.from))[0];
  const inferred = kind ?? (heading ? 'heading' : equation ? 'equation' : block?.kind ?? 'range');
  const namespace = inferred === 'equation' ? 'eq' : inferred;
  const name = id ?? `${namespace}-${globalThis.crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
  if (!name.startsWith(namespace + '-') || !validContentTargetId(name)) throw new Error('Invalid typed content target ID');
  if (meta.blockIds.some(anchor => anchor.id === name) || contentTargets(model).issues.some(issue => issue.id === name) || contentTargets(model).targets.some(target => target.id === name))
    throw new Error('Content target ID already exists');
  const changes: SourceChange[] = [];
  let owner: SourceSpan | undefined;
  let extendOwner = false;
  const append = (at: number, insert: string) => changes.push({ from: at, to: at, insert });
  if (inferred === 'heading') {
    if (!heading) throw new Error('Select a heading');
    owner = heading; extendOwner = true;
    if (meta.blockIds.some(anchor => anchor.from >= heading.from && anchor.to <= heading.to)) throw new Error('Heading already has an anchor');
    const raw = text.slice(heading.from, heading.to);
    const suffix = raw.match(/\n[\t ]*[=-]+[\t ]*$/);
    append(heading.to - (suffix?.[0].length ?? 0), ` ^${name}`);
  } else if (inferred === 'equation') {
    if (!equation?.referenceable || equation.id) throw new Error('Select an unanchored referenceable display equation');
    owner = equation;
    append(equation.to, ` ^${name}`);
  } else if (inferred === 'code' || inferred === 'callout') {
    if (!block || block.kind !== inferred || (inferred === 'code' && !block.closed)) throw new Error('Select a complete typed block');
    owner = block; extendOwner = inferred === 'callout';
    if (inferred === 'callout') {
      const end = text.indexOf('\n', block.from);
      const prefix = sourceLinePrefix(text.slice(block.from, end < 0 ? text.length : end));
      append(block.to, `\n${prefix.trimEnd()}\n${prefix}^${name}`);
    }
    else {
      const start = text.lastIndexOf('\n', block.from - 1) + 1;
      const prefix = sourceLinePrefix(text.slice(start, block.from) + text.slice(block.from, text.indexOf('\n', block.from) < 0 ? text.length : text.indexOf('\n', block.from)));
      append(block.to, `\n${prefix}^${name}`);
    }
  } else {
    const lineFrom = text.lastIndexOf('\n', selection.from - 1) + 1;
    if (selection.from === selection.to || selection.from !== lineFrom || (selection.to !== text.length && text[selection.to] !== '\n'))
      throw new Error('Select complete blocks for a range');
    const sourcePrefix = sourceLinePrefix(text.slice(lineFrom, text.indexOf('\n', lineFrom) < 0 ? text.length : text.indexOf('\n', lineFrom)));
    const candidates = model.nodes.filter(node => (node.from === selection.from || node.from === selection.from + sourcePrefix.length) &&
      /^(?:Paragraph|ATXHeading\d|SetextHeading\d|FencedCode|Blockquote|BulletList|OrderedList|Table|HorizontalRule|BodyHeading)$/.test(node.name));
    const first = candidates.find(node => model.nodes.some(last => last.to === selection.to && last.parent === node.parent));
    if (!first) throw new Error('Range must start and end on complete blocks in the same container');
    const prefix = text.slice(lineFrom, first.from);
    append(selection.from, `${prefix}^${name}:start\n${prefix.trimEnd()}\n`);
    append(selection.to, `\n${prefix.trimEnd()}\n${prefix}^${name}:end`);
  }
  let next = text;
  for (const change of [...changes].sort((left, right) => right.from - left.from)) next = next.slice(0, change.from) + change.insert + next.slice(change.to);
  const created = contentTargets(analyzeMarkdown(next)).targets.find(target => target.id === name);
  if (!created || created.kind !== inferred) throw new Error('Anchor cannot be attached to this structural selection');
  if (owner) {
    const to = owner.to + changes.filter(change => change.from < owner!.to || (extendOwner && change.from === owner!.to))
      .reduce((length, change) => length + change.insert.length - (change.to - change.from), 0);
    if (created.focus.from !== owner.from || created.focus.to !== to) throw new Error('Anchor attached to a different structural target');
  }
  return { id: name, changes };
}
