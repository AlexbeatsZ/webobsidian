import simplified from './simplified.js';
import traditional from './traditional.js';
export * from './query.js';
export { prepareQuery, type PreparedQuery } from './literal.js';
import { prepareQuery, fuzzySearch as literalFuzzy } from './literal.js';

export interface SearchOptions {
  enabled?: boolean;
  traditional?: boolean;
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
export const SEARCH_VERSION = 'pinyin-1-e23a51a';
export const MAX_BODY = 100_000;
export const searchDefaults = {
  enabled: true,
  traditional: false,
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

const cache = new Map<string, readonly string[]>();
function forms(char: string, options: SearchOptions): readonly string[] {
  if (options.enabled === false) return [char];
  const key = `${options.traditional ? 1 : 0}:${JSON.stringify(options.fuzzyRules ?? [])}:${char}`;
  const old = cache.get(key);
  if (old) return old;
  const readings =
    (simplified as Record<string, string[]>)[char] ??
    (options.traditional ? (traditional as Record<string, string[]>)[char] : undefined) ??
    [];
  const values = new Set([char]);
  for (const reading of readings) {
    const variants = new Set([reading]);
    for (const [a, b] of options.fuzzyRules ?? []) {
      if (!a || !b) continue;
      for (const value of [reading]) {
        if (value.startsWith(a)) variants.add(b + value.slice(a.length));
        if (value.startsWith(b)) variants.add(a + value.slice(b.length));
        if (value.endsWith(a)) variants.add(value.slice(0, -a.length) + b);
        if (value.endsWith(b)) variants.add(value.slice(0, -b.length) + a);
      }
    }
    for (const value of variants) {
      values.add(value);
      values.add(value[0]);
    }
  }
  if (cache.size >= 8192) cache.delete(cache.keys().next().value!);
  const result = [...values];
  cache.set(key, result);
  return result;
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
  const output: TextMatch[] = [];
  const emitted = new Set<string>();
  let states = new Map<number, { from: number; pinyin: boolean }>();
  let offset = 0;
  for (const original of text) {
    const char = options.caseSensitive ? original : original.toLowerCase();
    states.set(0, { from: offset, pinyin: false });
    const next = allowGaps ? new Map(states) : new Map<number, { from: number; pinyin: boolean }>();
    next.delete(0);
    for (const [at, state] of states) {
      for (const form of forms(char, options)) {
        const remaining = q.slice(at);
        const prefix = form !== char && form.startsWith(remaining);
        if (!prefix && !q.startsWith(form, at)) continue;
        const end = prefix ? q.length : at + form.length,
          pinyin = state.pinyin || form !== char;
        if (end === q.length) {
          const match: TextMatch = {
            score: (pinyin ? -2 : 0) - state.from / 1000 - text.length / 100000,
            matches: [[state.from, offset + original.length]],
            kind: pinyin ? 'pinyin' : 'literal',
          };
          const id = `${state.from}:${offset + original.length}`;
          if (!emitted.has(id)) {
            emitted.add(id);
            output.push(match);
          }
          if (firstOnly) return output;
        } else {
          const previous = next.get(end);
          if (!previous || state.from > previous.from || (previous.pinyin && !pinyin))
            next.set(end, { from: state.from, pinyin });
        }
      }
    }
    states = next;
    offset += original.length;
  }
  return output;
}

export function matchText(query: string, text: string, options: SearchOptions = {}): TextMatch | null {
  if (!query.trim()) return { score: 0, matches: [], kind: 'literal' };
  const literal = literalFuzzy(prepareQuery(query), text);
  if (literal) return { ...literal, score: literal.score / (1 + Math.abs(literal.score)), kind: 'literal' };
  return options.enabled === false
    ? null
    : (findText(query, text, options, true)[0] ?? findText(query, text, options, true, true)[0] ?? null);
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
 * Always index both scripts. User preferences are applied during source verification.
 */
export function phoneticTokens(text: string): string[] {
  const tokens = new Set<string>();
  let previous = new Set<string>();
  for (const char of text.toLowerCase()) {
    const variants = forms(char, { traditional: true });
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
