import type { MarkdownModel, SourceSpan } from './syntax.js';
import type { SourceChange } from './source.js';
import { mathRegions, type MathRegion } from './math.js';
import { extractMetadata } from './metadata.js';
import { tableModels } from './tables.js';

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
/** Source coordinates stay absolute; fragments never restart the counter. */
export interface EquationContext {
  equations: readonly Equation[];
  from: number;
  revision: string;
  prefix?: string;
}
const cache = new WeakMap<MarkdownModel, Equation[]>();
const targetCache = new WeakMap<readonly Equation[], { ids: Map<string, Equation[]>; tags: Map<string, Equation[]> }>();
const normalizeTag = (value: string) => value.replace(/[\u2010-\u2014\u2212]/g, '-').replace(/\s*-\s*/g, '-').trim();

export function equations(model: MarkdownModel): Equation[] {
  const cached = cache.get(model); if (cached) return cached;
  const meta = extractMetadata(model), tables = tableModels(model);
  const headings = meta.headings.filter(h => h.level === 1);
  const ids = new Map<string, number>();
  for (const block of meta.blockIds) ids.set(block.id, (ids.get(block.id) ?? 0) + 1);
  let section = -1, activeSection = 0, counter = 0, table = 0, block = 0;
  const result: Equation[] = [];
  for (const region of mathRegions(model)) {
    if (!region.closed || !region.display || region.kind !== 'dollar') continue;
    while (section + 1 < headings.length && headings[section + 1].from < region.from) {
      section++; counter = 0;
    }
    while (table < tables.length && tables[table].to <= region.from) table++;
    const inTable = table < tables.length && tables[table].from <= region.from && region.to <= tables[table].to;
    const exempt = /\{\{\}\}\s*$|\\(?:notag|nonumber)\b/.test(region.tex);
    const tag = explicitTag(region.tex);
    const eligible = !inTable && !exempt;
    if (eligible) {
      if (!counter) activeSection++;
      counter++;
    }
    // A block ID must be on the closing line, or the immediately following
    // ID-only line in the same quote container. Never steal a distant block ID.
    while (block < meta.blockIds.length && meta.blockIds[block].from < region.to) block++;
    const candidate = meta.blockIds[block];
    const gap = candidate ? model.text.slice(region.to, candidate.from) : '';
    const openingLine = model.text.slice(model.text.lastIndexOf('\n', region.from - 1) + 1, region.bodyFrom);
    const depth = (openingLine.match(/>/g) ?? []).length;
    const sameContainer = !gap.includes('\n') || (gap.match(/>/g) ?? []).length === depth;
    const anchor = candidate && sameContainer && /^[\t ]*(?:\n(?:[\t ]*> ?)*[\t ]*)?$/.test(gap) ? candidate : undefined;
    const number = tag ?? (eligible ? `${activeSection}-${counter}` : null);
    const end = model.text.indexOf('\n', region.to);
    const referenceable = !inTable && (anchor !== undefined || !model.text.slice(region.to, end < 0 ? model.text.length : end).trim());
    result.push({ ...region, number, tag, referenceable, heading: headings[section]?.text ?? '',
      ...(anchor ? { id: anchor.id, anchor: { from: anchor.from, to: anchor.to }, ambiguous: ids.get(anchor.id)! > 1 } : {}) });
  }
  cache.set(model, result); return result;
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

export function equationContext(model: MarkdownModel, from = 0, prefix?: string): EquationContext {
  return { equations: equations(model), from, revision: `${model.id}:${model.version}`, prefix };
}
export function equationLabel(equation: Equation, context?: EquationContext): string | null {
  return equation.number === null ? null : `(${context?.prefix ? context.prefix + '-' : ''}${equation.number})`;
}
export function equationTarget(context: EquationContext, fragment: string): Equation | undefined {
  let key = fragment; try { key = decodeURIComponent(key); } catch { /* literal percent */ }
  const legacy = key.match(/^=\((.+)\)(?:§([1-9]\d*))?$/);
  let targets = targetCache.get(context.equations);
  if (!targets) {
    targets = { ids: new Map(), tags: new Map() };
    for (const e of context.equations) for (const [map, name] of [[targets.ids, e.id], [targets.tags, e.tag === undefined ? undefined : normalizeTag(e.tag)]] as const) {
      if (name !== undefined) { const values = map.get(name) ?? []; values.push(e); map.set(name, values); }
    }
    targetCache.set(context.equations, targets);
  }
  const candidates = key.startsWith('^') ? targets.ids.get(key.slice(1)) ?? [] : legacy ? targets.tags.get(normalizeTag(legacy[1])) ?? [] : [];
  if (legacy?.[2]) return candidates[Number(legacy[2]) - 1];
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
  if (equation.id) return { id: equation.id };
  if (!equation.referenceable) throw new Error('Put the formula on its own line before adding a block reference');
  const used = new Set(extractMetadata(model).blockIds.map(b => b.id));
  const base = `eq-${seed.replace(/[^a-z0-9]/gi, '').slice(0, 16) || 'formula'}`;
  let id = base, suffix = 1; while (used.has(id)) id = `${base}-${suffix++}`;
  return { id, change: { from: equation.to, to: equation.to, insert: ` ^${id}` } };
}
