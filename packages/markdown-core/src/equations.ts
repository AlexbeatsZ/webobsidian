import type { MarkdownModel, SourceSpan } from './syntax.js';
import type { SourceChange } from './source.js';
import { mathRegions, type MathRegion } from './math.js';
import { extractMetadata } from './metadata.js';
import { tableModels } from './tables.js';
import { parseLinkTarget } from './links.js';

export interface Equation extends MathRegion {
  id?: string;
  anchor?: SourceSpan;
  ambiguous?: boolean;
  number: string | null;
  /** Explicit source tags retain their own MathJax presentation. */
  tag?: string;
  heading: string;
  referenceable: boolean;
}
/**
 * A displayed instance of a formula: the original (`embed: false`) or one `![[^eq-ID]]`
 * embed. Each instance takes its own number from its position in the containing note.
 */
export interface EquationOccurrence extends SourceSpan {
  id: string;
  number: string | null;
  embed: boolean;
}
/** Source coordinates stay absolute; fragments never restart the counter. */
export interface EquationContext {
  equations: readonly Equation[];
  /** Ordered explicit instances of identified formulas in the same source note. */
  occurrences: readonly EquationOccurrence[];
  from: number;
  revision: string;
}
const cache = new WeakMap<MarkdownModel, { equations: Equation[]; occurrences: EquationOccurrence[] }>();
const targetCache = new WeakMap<readonly Equation[], Map<string, Equation[]>>();

export function equations(model: MarkdownModel): Equation[] {
  return analyze(model).equations;
}
export function equationOccurrences(model: MarkdownModel): EquationOccurrence[] {
  return analyze(model).occurrences;
}
function analyze(model: MarkdownModel): { equations: Equation[]; occurrences: EquationOccurrence[] } {
  const cached = cache.get(model); if (cached) return cached;
  const meta = extractMetadata(model), tables = tableModels(model);
  const headings = meta.headings.filter(h => h.level === 1);
  const ids = new Map<string, number>();
  for (const block of meta.blockIds) ids.set(block.id, (ids.get(block.id) ?? 0) + 1);
  // A formula embed is a real formula instance of this note: it shares the counter.
  const embeds: { from: number; to: number; id: string }[] = [];
  for (const link of meta.linkOccurrences) {
    if (link.kind !== 'wiki' || !link.embed) continue;
    const name = equationReferenceName(parseLinkTarget(link.target).fragment);
    if (name !== undefined) embeds.push({ from: link.from, to: link.to, id: 'eq-' + name });
  }
  let section = -1, activeSection = 0, counter = 0, table = 0, block = 0, embed = 0;
  const result: Equation[] = [], occurrences: EquationOccurrence[] = [];
  const enter = (from: number, to: number) => {
    while (section + 1 < headings.length && headings[section + 1].from < from) {
      section++; counter = 0;
    }
    while (table < tables.length && tables[table].to <= from) table++;
    return table < tables.length && tables[table].from <= from && to <= tables[table].to;
  };
  const next = () => {
    if (!counter) activeSection++;
    counter++;
    return `${activeSection}-${counter}`;
  };
  const embedsBefore = (position: number) => {
    for (; embed < embeds.length && embeds[embed].from < position; embed++) {
      const item = embeds[embed];
      if (!enter(item.from, item.to)) occurrences.push({ ...item, number: next(), embed: true });
    }
  };
  for (const region of mathRegions(model)) {
    if (!region.closed || !region.display || region.kind !== 'dollar') continue;
    embedsBefore(region.from);
    const inTable = enter(region.from, region.to);
    const exempt = /\{\{\}\}\s*$|\\(?:notag|nonumber)\b/.test(region.tex);
    const tag = explicitTag(region.tex);
    const eligible = !inTable && !exempt;
    const automatic = eligible ? next() : null;
    // A block ID must be on the closing line, or the immediately following
    // ID-only line in the same quote container. Never steal a distant block ID.
    while (block < meta.blockIds.length && meta.blockIds[block].from < region.to) block++;
    const candidate = meta.blockIds[block];
    const gap = candidate ? model.text.slice(region.to, candidate.from) : '';
    const openingLine = model.text.slice(model.text.lastIndexOf('\n', region.from - 1) + 1, region.bodyFrom);
    const depth = (openingLine.match(/>/g) ?? []).length;
    const sameContainer = !gap.includes('\n') || (gap.match(/>/g) ?? []).length === depth;
    const anchor = candidate && sameContainer && /^[\t ]*(?:\n(?:[\t ]*> ?)*[\t ]*)?$/.test(gap) ? candidate : undefined;
    const number = tag ?? automatic;
    const end = model.text.indexOf('\n', region.to);
    const referenceable = !inTable && (anchor !== undefined || !model.text.slice(region.to, end < 0 ? model.text.length : end).trim());
    result.push({ ...region, number, tag, referenceable, heading: headings[section]?.text ?? '',
      ...(anchor ? { id: anchor.id, anchor: { from: anchor.from, to: anchor.to }, ambiguous: ids.get(anchor.id)! > 1 } : {}) });
    if (anchor) occurrences.push({ from: region.from, to: region.to, id: anchor.id, number, embed: false });
  }
  embedsBefore(Infinity);
  const value = { equations: result, occurrences };
  cache.set(model, value); return value;
}

/** Small balanced TeX argument reader, scoped to one known formula. */
function explicitTag(tex: string): string | undefined {
  const command = /\\tag\*?\s*\{/g;
  for (let match; (match = command.exec(tex)); ) {
    let escaped = 0; for (let p = match.index - 1; p >= 0 && tex[p] === '\\'; p--) escaped++;
    if (escaped % 2) continue;
    let depth = 1, end = command.lastIndex;
    for (; end < tex.length; end++) {
      if (tex[end] === '\\') { end++; continue; }
      if (tex[end] === '{') depth++;
      if (tex[end] === '}' && --depth === 0) break;
    }
    if (!depth) return tex.slice(command.lastIndex, end).trim();
  }
  return undefined;
}

export function equationContext(model: MarkdownModel, from = 0): EquationContext {
  const { equations, occurrences } = analyze(model);
  return { equations, occurrences, from, revision: `${model.id}:${model.version}` };
}
export function equationLabel(equation: Equation): string | null {
  return equation.number === null ? null : `(${equation.number})`;
}
/** The only formula-reference namespace; other IDs remain ordinary block links. */
export function equationReferenceName(fragment: string): string | undefined {
  let key = fragment; try { key = decodeURIComponent(key); } catch { /* literal percent */ }
  return key.match(/^\^eq-([\p{L}\p{N}-]+)$/u)?.[1];
}
export function equationReferenceLabel(equation: Equation, alias: string | null): string {
  const name = equation.id!.slice(3);
  return alias === null ? equationLabel(equation) ?? name : alias || name;
}
const occurrenceCache = new WeakMap<readonly EquationOccurrence[], Map<string, EquationOccurrence[]>>();
/** The closest explicit instance of `id` that starts before the absolute source position `at`. */
export function equationOccurrenceBefore(context: EquationContext, id: string, at: number): EquationOccurrence | undefined {
  let byId = occurrenceCache.get(context.occurrences);
  if (!byId) {
    byId = new Map();
    for (const occurrence of context.occurrences) {
      const list = byId.get(occurrence.id) ?? []; list.push(occurrence); byId.set(occurrence.id, list);
    }
    occurrenceCache.set(context.occurrences, byId);
  }
  const list = byId.get(id) ?? [];
  let lo = 0, hi = list.length;
  while (lo < hi) { const mid = (lo + hi) >>> 1; if (list[mid].from < at) lo = mid + 1; else hi = mid; }
  return list[lo - 1];
}
/** Number an embedded instance shows: the source's own tag or exemption wins over the host counter. */
export function equationInstanceNumber(equation: Equation, occurrence: EquationOccurrence | undefined): string | null {
  return equation.tag !== undefined || equation.number === null || !occurrence ? equation.number : occurrence.number;
}
/**
 * `[[^eq-ID]]` display. An alias wins; otherwise the nearest preceding explicit instance in the
 * referencing note; otherwise the original's number, prefixed with its note name when it lives elsewhere.
 */
export function equationReferenceText(equation: Equation, alias: string | null, local?: EquationOccurrence, sourceName?: string): string {
  const name = equation.id!.slice(3);
  if (alias !== null) return alias.trim() || name;
  const number = equationInstanceNumber(equation, local);
  const label = number === null ? name : `(${number})`;
  return !local && sourceName ? `${sourceName} ${label}` : label;
}
export function equationTarget(context: EquationContext, fragment: string): Equation | undefined {
  const name = equationReferenceName(fragment);
  if (name === undefined) return;
  let targets = targetCache.get(context.equations);
  if (!targets) {
    targets = new Map();
    for (const e of context.equations) if (e.id && equationReferenceName('^' + e.id) !== undefined) {
      const values = targets.get(e.id) ?? []; values.push(e); targets.set(e.id, values);
    }
    targetCache.set(context.equations, targets);
  }
  const candidates = targets.get('eq-' + name) ?? [];
  return candidates.length === 1 && !candidates[0].ambiguous ? candidates[0] : undefined;
}

export function equationAt(context: EquationContext, localFrom: number): Equation | undefined {
  const from = context.from + localFrom;
  let lo = 0, hi = context.equations.length;
  while (lo < hi) { const mid = (lo + hi) >>> 1; if (context.equations[mid].from < from) lo = mid + 1; else hi = mid; }
  return context.equations[lo]?.from === from ? context.equations[lo] : undefined;
}

/** Called only after a candidate was selected. The caller commits this patch. */
export function equationAnchor(model: MarkdownModel, from: number, seed: string): { id: string; change?: SourceChange } {
  const equation = equations(model).find(e => e.from === from);
  if (!equation) throw new Error('Formula changed; select it again');
  if (equation.ambiguous) throw new Error('Duplicate block ID; rename it before referencing this formula');
  if (equation.id) {
    if (equationReferenceName('^' + equation.id) === undefined) throw new Error('Formula block ID must start with eq-');
    return { id: equation.id };
  }
  if (!equation.referenceable) throw new Error('Put the formula on its own line before adding a block reference');
  const used = new Set(extractMetadata(model).blockIds.map(b => b.id));
  const base = `eq-${seed.replace(/[^a-z0-9]/gi, '').slice(0, 16) || 'formula'}`;
  let id = base, suffix = 1; while (used.has(id)) id = `${base}-${suffix++}`;
  return { id, change: { from: equation.to, to: equation.to, insert: ` ^${id}` } };
}
