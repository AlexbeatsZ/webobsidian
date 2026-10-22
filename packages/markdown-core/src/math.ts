import type { MarkdownModel, SourceSpan } from './syntax.js';
import { syntaxPredecessor } from './syntax.js';
import { extractMetadata } from './metadata.js';

export interface MathRegion extends SourceSpan {
  bodyFrom: number;
  bodyTo: number;
  display: boolean;
  closed: boolean;
  kind: 'dollar' | 'code' | 'html';
  block: boolean;
  tex: string;
  /** Source segments exclude quote prefixes without losing source coordinates. */
  segments: SourceSpan[];
}
const cache = new WeakMap<MarkdownModel, Map<string, MathRegion[]>>();
export function isEscaped(text: string, at: number): boolean {
  let n = 0;
  while (at > 0 && text[--at] === '\\') n++;
  return n % 2 === 1;
}

/** Formula boundaries belong to the source model, never to visible DOM. */
export function mathRegions(model: MarkdownModel, languages: readonly string[] = ['math']): MathRegion[] {
  const key = languages.join('\0');
  let configurations = cache.get(model);
  if (!configurations) {
    configurations = new Map();
    cache.set(model, configurations);
  }
  const existing = configurations.get(key);
  if (existing) return existing;
  const predecessor = syntaxPredecessor(model),
    previous = predecessor?.previous.deref();
  const old = previous && cache.get(previous)?.get(key);
  if (predecessor && previous && old && old.every((r) => r.closed)) {
    const changes = predecessor.changes;
    const boundary = /[$\\\r\n`~<>%#]/;
    const protectedRanges = [...old, ...previous.literal, ...previous.htmlBlocks, ...previous.html];
    const harmless = changes.every(
      (c) =>
        !boundary.test(previous.text.slice(c.fromA, c.toA)) &&
        !boundary.test(model.text.slice(c.fromB, c.toB)) &&
        !protectedRanges.some((r) => c.fromA <= r.to + 1 && c.toA >= r.from - 1),
    );
    const map = (pos: number) => {
      let delta = 0;
      for (const c of changes) {
        if (c.toA > pos) break;
        delta += c.toB - c.fromB - (c.toA - c.fromA);
      }
      return pos + delta;
    };
    const same = (a: readonly SourceSpan[], b: readonly SourceSpan[]) =>
      a.length === b.length && a.every((r, i) => map(r.from) === b[i].from && map(r.to) === b[i].to);
    if (
      harmless &&
      same(previous.literal, model.literal) &&
      same(previous.htmlBlocks, model.htmlBlocks) &&
      ((!previous.frontmatter && !model.frontmatter) ||
        (previous.frontmatter && model.frontmatter && same([previous.frontmatter], [model.frontmatter])))
    ) {
      const mapped = old.map((r) => ({
        ...r,
        from: map(r.from),
        to: map(r.to),
        bodyFrom: map(r.bodyFrom),
        bodyTo: map(r.bodyTo),
        segments: r.segments.map((s) => ({ from: map(s.from), to: map(s.to) })),
      }));
      configurations.set(key, mapped);
      return mapped;
    }
  }
  const { text } = model;
  const result: MathRegion[] = [];
  const excluded = [
    ...model.literal,
    ...model.htmlBlocks,
    ...extractMetadata(model).comments,
    ...(model.frontmatter ? [model.frontmatter] : []),
  ].sort((a, b) => a.from - b.from);
  const add = (
    from: number,
    to: number,
    bodyFrom: number,
    bodyTo: number,
    display: boolean,
    closed: boolean,
    kind: MathRegion['kind'],
    block = false,
  ) => {
    bodyTo = Math.max(bodyFrom, bodyTo);
    const segments: SourceSpan[] = [];
    let start = bodyFrom;
    // Strip only quote prefixes on subsequent lines. Offsets remain absolute.
    const depth = (text.slice(text.lastIndexOf('\n', from - 1) + 1, from).match(/>/g) ?? []).length;
    for (let p = bodyFrom; p <= bodyTo; p++)
      if (p === bodyTo || text[p] === '\n') {
        let a = start;
        if (start !== bodyFrom && depth) {
          for (let d = 0; d < depth; d++) {
            const m = text.slice(a, p).match(/^ {0,3}> ?/);
            if (m) a += m[0].length;
          }
        }
        segments.push({ from: a, to: p });
        start = p + 1;
      }
    result.push({
      from,
      to,
      bodyFrom,
      bodyTo,
      display,
      closed,
      kind,
      block,
      segments,
      tex: segments.map((s) => text.slice(s.from, s.to)).join('\n'),
    });
  };
  for (const node of model.nodes)
    if (node.name === 'FencedCode') {
      const raw = text.slice(node.from, node.to);
      const open = raw.match(/^(`{3,}|~{3,})\s*([^\s`]*)[^\n]*(?:\n|$)/);
      if (!open || !languages.includes(open[2])) continue;
      const lastLine = raw.lastIndexOf('\n');
      const closed =
        lastLine >= 0 &&
        new RegExp('^(?: {0,3}> ?)*\\s*' + open[1][0] + '{' + open[1].length + ',}\\s*$').test(
          raw.slice(lastLine + 1),
        );
      add(
        node.from,
        node.to,
        node.from + open[0].length,
        closed ? node.from + lastLine : node.to,
        true,
        closed,
        'code',
        true,
      );
    }
  const htmlScopes = [...model.htmlBlocks];
  for (let i = 0; i < model.html.length; i++) {
    const open = model.html[i];
    if (open.closing || !['span', 'div'].includes(open.tag) || !open.raw.includes('class')) continue;
    let depth = 1;
    for (let j = i + 1; j < model.html.length; j++)
      if (model.html[j].tag === open.tag) {
        const close = model.html[j];
        if (!close.closing && !/\/\s*>$/.test(close.raw)) depth++;
        else if (close.closing) depth--;
        if (depth === 0) {
          if (!htmlScopes.some((r) => open.from >= r.from && close.to <= r.to))
            htmlScopes.push({ from: open.from, to: close.to });
          break;
        }
      }
  }
  for (const range of htmlScopes) {
    const html = text.slice(range.from, range.to);
    for (const m of html.matchAll(/<(span|div)\b[^>]*class=["']([^"']*)["'][^>]*>/gi)) {
      const classes = m[2].split(/\s+/);
      if (!classes.some((c) => ['math', 'math-inline', 'math-block'].includes(c))) continue;
      const from = range.from + m.index!,
        bodyFrom = from + m[0].length;
      const tags = new RegExp('<(\\/?)' + m[1] + '\\b[^>]*>', 'gi');
      tags.lastIndex = m.index! + m[0].length;
      let depth = 1,
        close: RegExpExecArray | null = null;
      for (let tag; (tag = tags.exec(html)); ) {
        if (tag[1]) depth--;
        else if (!/\/\s*>$/.test(tag[0])) depth++;
        if (!depth) {
          close = tag;
          break;
        }
      }
      if (!close) continue;
      const bodyTo = range.from + close.index,
        to = bodyTo + close[0].length;
      if (!result.some((r) => r.from === from && r.to === to))
        add(from, to, bodyFrom, bodyTo, !classes.includes('math-inline'), true, 'html');
    }
  }
  excluded.push(...result.filter((r) => r.kind === 'html'));
  excluded.sort((a, b) => a.from - b.from);

  let blocked = 0;
  for (let p = 0; p < text.length; ) {
    while (blocked < excluded.length && excluded[blocked].to <= p) blocked++;
    if (blocked < excluded.length && excluded[blocked].from <= p) {
      p = excluded[blocked].to;
      continue;
    }
    if (text[p] !== '$' || isEscaped(text, p)) {
      p++;
      continue;
    }
    const display = text[p + 1] === '$';
    const width = display ? 2 : 1;
    if (text[p - 1] === '$' || text[p + width] === '$') {
      p += width;
      continue;
    }
    if (!display && /\s/.test(text[p + 1] ?? '')) {
      p++;
      continue;
    }
    const from = p,
      bodyFrom = p + width;
    let end = bodyFrom,
      closed = false;
    for (; end < text.length; end++) {
      if (!display && text[end] === '\n') break;
      if (display && text[end] === '\n' && /^\n(?: {0,3}> ?)*#{1,7}\s/.test(text.slice(end))) break;
      if (text[end] !== '$' || isEscaped(text, end)) continue;
      if (
        display
          ? text[end + 1] === '$' && text[end + 2] !== '$'
          : text[end + 1] !== '$' && !/\d/.test(text[end + 1] ?? '') && !/\s/.test(text[end - 1] ?? '')
      ) {
        closed = true;
        break;
      }
    }
    const to = closed ? end + width : end;
    const lineFrom = text.lastIndexOf('\n', from - 1) + 1;
    const standalone =
      display &&
      /^(?: {0,3}> ?)*\s*$/.test(text.slice(lineFrom, from)) &&
      /^\s*(?:\n|$)/.test(text.slice(bodyFrom)) &&
      text.slice(bodyFrom, end).includes('\n');
    add(standalone ? lineFrom : from, to, bodyFrom, end, display, closed, 'dollar', standalone);
    p = Math.max(to, bodyFrom);
  }
  result.sort((a, b) => a.from - b.from);
  configurations.set(key, result);
  return result;
}

export function formulaAt(regions: readonly MathRegion[], pos: number): MathRegion | undefined {
  let low = 0,
    high = regions.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (regions[mid].from <= pos) low = mid + 1;
    else high = mid;
  }
  const r = regions[low - 1];
  return r && pos >= r.bodyFrom && pos <= r.bodyTo ? r : undefined;
}
