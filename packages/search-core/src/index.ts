import simplified from './simplified.js';
export * from './query.js';
export * from './hotkeys.js';
export { prepareQuery, type PreparedQuery } from './literal.js';

export interface SearchOptions {
  enabled?: boolean;
  fuzzyRules?: [string, string][];
  caseSensitive?: boolean;
}
export interface TextMatch {
  score: number;
  matches: [number, number][];
  kind: 'literal' | 'pinyin';
}
export interface CatalogEntry {
  path: string;
  kind: 'file' | 'folder';
  title: string;
  aliases: string[];
  tags: string[];
  headings: string[];
}
export const SEARCH_VERSION = 'pinyin-2-simplified';
export const MAX_BODY = 100_000;
export const searchDefaults = {
  enabled: true,
  fuzzyRules: [] as [string, string][],
  usePath: false,
  attachments: true,
  showTags: true,
  tagFilter: true,
  showFirstHeading: true,
  headingIndent: true,
  templateFolder: '',
  pinnedCommands: [] as string[],
  recentCommands: [] as string[],
  historyKeys: '1234567890',
  shortcuts: {} as Record<string, string>,
  migration: '',
};
export type SearchSettings = typeof searchDefaults;

const readings = simplified as Record<string, string[]>;

/** Pronunciation forms of one character under one fuzzy-rule set. */
interface FormTable {
  forms: Map<string, readonly string[]>;
  readings: Map<string, readonly string[]>;
  /** a–z letters reachable from a text, and those that can start a match. */
  masks: Map<string, { letters: number; starts: number }>;
}
const tables = new Map<string, FormTable>();
function tableFor(options: SearchOptions): FormTable {
  const rules = options.fuzzyRules ?? [];
  // Forms depend on pinyin being enabled and on the rule set; masks derive from forms.
  const key = (options.enabled === false ? '0:' : '1:') + (rules.length ? JSON.stringify(rules) : '');
  let table = tables.get(key);
  if (!table) {
    if (tables.size >= 16) tables.clear();
    table = { forms: new Map(), readings: new Map(), masks: new Map() };
    tables.set(key, table);
  }
  return table;
}
function forms(char: string, options: SearchOptions, table = tableFor(options)): readonly string[] {
  if (options.enabled === false) return [char];
  const old = table.forms.get(char);
  if (old) return old;
  const values = new Set([char]);
  for (const value of readingsOf(char, options, table)) {
    values.add(value);
    values.add(value[0]);
  }
  if (table.forms.size >= 16384) table.forms.clear();
  const result = [...values];
  table.forms.set(char, result);
  return result;
}
/** Readings of one character with fuzzy-sound variants (no character or initial forms). */
function readingsOf(char: string, options: SearchOptions, table: FormTable): readonly string[] {
  if (options.enabled === false) return [];
  const old = table.readings.get(char);
  if (old) return old;
  const values = new Set<string>();
  for (const reading of readings[char] ?? []) {
    values.add(reading);
    for (const [a, b] of options.fuzzyRules ?? []) {
      if (!a || !b) continue;
      if (reading.startsWith(a)) values.add(b + reading.slice(a.length));
      if (reading.startsWith(b)) values.add(a + reading.slice(b.length));
      if (reading.endsWith(a)) values.add(reading.slice(0, -a.length) + b);
      if (reading.endsWith(b)) values.add(reading.slice(0, -b.length) + a);
    }
  }
  if (table.readings.size >= 16384) table.readings.clear();
  const result = [...values];
  table.readings.set(char, result);
  return result;
}

const A = 97;
function letterMask(value: string): number {
  let mask = 0;
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i) - A;
    if (code >= 0 && code < 26) mask |= 1 << code;
  }
  return mask;
}
/**
 * Necessary conditions shared by literal, continuous and gap matching: every query
 * letter is reachable from the text (literally or through a reading), and the first
 * query letter starts some form (a character itself, a reading or its initial).
 */
function reachable(query: string, text: string, options: SearchOptions, table: FormTable): boolean {
  if (options.caseSensitive) return true;
  const needed = letterMask(query);
  if (!needed) return true;
  let mask = table.masks.get(text);
  if (mask === undefined) {
    let letters = 0, starts = 0;
    for (const char of text.toLowerCase())
      for (const form of forms(char, options, table)) {
        letters |= letterMask(form);
        starts |= letterMask(form[0]);
      }
    mask = { letters, starts };
    if (table.masks.size >= 65536) table.masks.clear();
    table.masks.set(text, mask);
  }
  if ((needed & ~mask.letters) !== 0) return false;
  const first = query.charCodeAt(0) - A;
  return first < 0 || first >= 26 || (mask.starts & (1 << first)) !== 0;
}

/** Continuous source matching. States are query offsets, never Cartesian products of readings. */
export function findText(
  query: string,
  text: string,
  options: SearchOptions = {},
  firstOnly = false,
  allowGaps = false,
): TextMatch[] {
  const q = (options.caseSensitive ? query : query.toLowerCase()).replace(/\s+/g, '');
  if (!q) return [];
  const table = tableFor(options);
  if (!reachable(q, text, options, table)) return [];
  const n = q.length;
  const suffixes: string[] = [];
  for (let at = 0; at < n; at++) suffixes.push(q.slice(at));
  const output: TextMatch[] = [];
  const emitted = new Set<string>();
  // States keyed by query offset; `order` keeps Map insertion order so the first
  // emitted match (and tie-breaking) is unchanged from the original algorithm.
  let order: number[] = [];
  let from = new Int32Array(n).fill(-1);
  let pinyin = new Uint8Array(n);
  let nextFrom = new Int32Array(n);
  let nextPinyin = new Uint8Array(n);
  let offset = 0;
  for (const original of text) {
    const char = options.caseSensitive ? original : original.toLowerCase();
    from[0] = offset;
    pinyin[0] = 0;
    order.push(0);
    let nextOrder: number[];
    if (allowGaps) {
      nextFrom.set(from);
      nextPinyin.set(pinyin);
      nextFrom[0] = -1;
      nextOrder = order.filter((at) => at !== 0);
    } else {
      nextFrom.fill(-1);
      nextOrder = [];
    }
    const variants = forms(char, options, table);
    for (const at of order) {
      const start = from[at],
        statePinyin = pinyin[at];
      const remaining = suffixes[at];
      for (const form of variants) {
        const prefix = form !== char && form.startsWith(remaining);
        if (!prefix && !q.startsWith(form, at)) continue;
        const end = prefix ? n : at + form.length,
          isPinyin = statePinyin === 1 || form !== char;
        if (end === n) {
          const id = `${start}:${offset + original.length}`;
          if (!emitted.has(id)) {
            emitted.add(id);
            output.push({
              score: (isPinyin ? -2 : 0) - start / 1000 - text.length / 100000,
              matches: [[start, offset + original.length]],
              kind: isPinyin ? 'pinyin' : 'literal',
            });
          }
          if (firstOnly) return output;
        } else {
          const previous = nextFrom[end];
          if (previous < 0) {
            nextOrder.push(end);
            nextFrom[end] = start;
            nextPinyin[end] = isPinyin ? 1 : 0;
          } else if (start > previous || (nextPinyin[end] === 1 && !isPinyin)) {
            nextFrom[end] = start;
            nextPinyin[end] = isPinyin ? 1 : 0;
          }
        }
      }
    }
    [from, nextFrom] = [nextFrom, from];
    [pinyin, nextPinyin] = [nextPinyin, pinyin];
    order = nextOrder;
    offset += original.length;
  }
  return output;
}

/** Longest syllable; the last syllable may be typed as a prefix of a reading. */
const MAX_READING = 6;
interface Step {
  /** Matched text units so far. */
  len: number;
  index: number;
  pinyin: boolean;
  prev: Step | null;
}
const START: Step = Object.freeze({ len: 0, index: -1, pinyin: false, prev: null });

/**
 * Name matching ported from lazyloong/obsidian-fuzzy-chinese (`Pinyin.matchAboveStart`,
 * based on zh-lx's work): a two-row DP over text units where each unit consumes the
 * literal character, a reading initial, a zh/ch/sh initial or a whole reading, and the
 * final unit may consume a reading prefix. Text units may be skipped.
 */
function matchUnits(query: string, text: string, options: SearchOptions, table: FormTable): Step | null {
  const n = text.length,
    m = query.length;
  const tails: string[] = new Array(m);
  for (let at = Math.max(0, m - 1 - MAX_READING); at < m; at++) tails[at] = query.slice(at);
  let prevRow: (Step | null)[] = new Array(m + 1).fill(null);
  let currRow: (Step | null)[] = new Array(m + 1).fill(null);
  prevRow[0] = START;
  let prevMax = 0;
  const put = (j: number, step: Step) => {
    const cur = currRow[j];
    if (cur === null || step.len > cur.len) currRow[j] = step;
  };
  for (let i = 0; i < n; i++) {
    currRow[0] = START;
    for (let j = 1; j <= m; j++) currRow[j - 1] = prevRow[j - 1];
    currRow[m] = null;
    let nextMax = prevMax < m ? prevMax : m - 1;
    const ch = text[i];
    const sounds = readingsOf(ch, options, table);
    const jEnd = prevMax + 1 < m ? prevMax + 1 : m;
    for (let j = 1; j <= jEnd; j++) {
      const prev = prevRow[j - 1];
      if (prev === null || (j !== 1 && prev.len === 0)) continue;
      const qj = query[j - 1];
      if (ch === qj) {
        const step = { len: prev.len + 1, index: i, pinyin: prev.pinyin, prev };
        if (j === m) return step;
        put(j, step);
        if (j > nextMax) nextMax = j;
      }
      if (!sounds.length) continue;
      const step = { len: prev.len + 1, index: i, pinyin: true, prev };
      if (m - j <= MAX_READING && sounds.some((reading) => reading.startsWith(tails[j - 1]))) return step;
      if (sounds.some((reading) => reading[0] === qj)) {
        put(j, step);
        if (j > nextMax) nextMax = j;
      }
      if (j < m && (qj === 'z' || qj === 'c' || qj === 's') && query[j] === 'h'
        && sounds.some((reading) => reading[0] === qj && reading[1] === 'h')) {
        put(j + 1, step);
        if (j + 1 > nextMax) nextMax = j + 1;
      }
      for (const reading of sounds)
        if (query.startsWith(reading, j - 1)) {
          const end = j - 1 + reading.length;
          put(end, step);
          if (end > nextMax) nextMax = end;
        }
    }
    [prevRow, currRow] = [currRow, prevRow];
    prevMax = nextMax;
  }
  return null;
}

/**
 * Upstream ranking: squared coverage of the name dominates, then an early first match,
 * fewer segments and longer continuous segments. Ranges are inclusive unit indexes.
 */
function nameScore(ranges: [number, number][], length: number): number {
  const coverage = ranges.reduce((sum, [a, b]) => sum + b - a + 1, 0) / length;
  let score = 100 * coverage * coverage + 15 / Math.sqrt(ranges[0][0] + 1) + 25 / ranges.length;
  for (const [a, b] of ranges) if (b > a) score += 5 * (b - a);
  return score;
}

export function matchText(query: string, text: string, options: SearchOptions = {}): TextMatch | null {
  const q = (options.caseSensitive ? query : query.toLowerCase()).replace(/\s+/g, '');
  if (!q) return { score: 0, matches: [], kind: 'literal' };
  const table = tableFor(options);
  if (!reachable(q, text, options, table)) return null;
  const end = matchUnits(q, options.caseSensitive ? text : text.toLowerCase(), options, table);
  if (!end) return null;
  const ranges: [number, number][] = [];
  for (let step: Step | null = end; step && step.len > 0; step = step.prev) {
    const last = ranges[0];
    if (last && last[0] === step.index + 1) last[0] = step.index;
    else ranges.unshift([step.index, step.index]);
  }
  return {
    score: nameScore(ranges, text.length),
    matches: ranges.map(([a, b]) => [a, b + 1]),
    kind: end.pinyin ? 'pinyin' : 'literal',
  };
}
export function matchPath(query: string, path: string, options: SearchOptions = {}): TextMatch | null {
  const offset = path.lastIndexOf('/') + 1;
  const match = matchText(query, path.slice(offset), options);
  if (match) return { ...match, matches: match.matches.map(([a, b]) => [a + offset, b + offset]) };
  const full = matchText(query, path, options);
  return full ? { ...full, score: full.score - 1 } : null;
}

/** Conservative bigram candidate encoding in the SAME MiniSearch index.
 * All one-character suffixes of the pronunciation graph suffice; no full transliteration copies.
 * User preferences (fuzzy sounds) are applied during source verification.
 */
export function phoneticTokens(text: string): string[] {
  const tokens = new Set<string>();
  let previous = new Set<string>();
  for (const char of text.toLowerCase()) {
    const variants = forms(char, {});
    if (variants.length > 1) tokens.add('han');
    const tails = new Set<string>();
    for (const form of variants) {
      const letters = [...form];
      for (let i = 0; i < letters.length; i++) {
        tokens.add('u' + letters[i].codePointAt(0)!.toString(16));
        if (i) tokens.add(pair(letters[i - 1], letters[i]));
      }
      for (const tail of previous) tokens.add(pair(tail, letters[0]));
      tails.add(letters.at(-1)!);
    }
    previous = tails;
  }
  return [...tokens];
}
const pair = (a: string, b: string) => `b${a.codePointAt(0)!.toString(16)}x${b.codePointAt(0)!.toString(16)}`;
export function candidateTokens(query: string): string[] {
  const chars = [...query.toLowerCase().replace(/\s+/g, '')];
  return [
    ...new Set(
      chars.length > 1
        ? chars.slice(1).map((c, i) => pair(chars[i], c))
        : chars.map((c) => 'u' + c.codePointAt(0)!.toString(16)),
    ),
  ];
}
