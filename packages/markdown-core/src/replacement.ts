/** LaTeX Suite replacement templates, shared by snippets and document formatting. */
export const REPLACEMENT_SYNTAX = 'latex-suite-v1' as const;
export type ReplacementPart =
  | { kind: 'text'; text: string }
  | { kind: 'capture'; key: number | string; source: string }
  | { kind: 'context'; key: 'MATCH' | 'BEFORE' | 'AFTER' | 'VISUAL' | 'VISUAL_ORIGINAL' }
  | { kind: 'tabstop'; index: number; value: readonly ReplacementPart[] };
export interface ReplacementContext {
  captures?: readonly (string | undefined)[];
  groups?: Record<string, string | undefined>;
  match?: string;
  before?: string;
  after?: string;
  visual?: string;
  visualOriginal?: string;
}
export interface ReplacementResult {
  text: string;
  tabstops: { index: number; from: number; to: number }[];
}

// Parse the template once. Captured/selected text is always data, never parsed again.
export function compileReplacement(source: string, tabstops = true): readonly ReplacementPart[] {
  const pattern =
    /\[\[(\d+)\]\]|\[\[<([^>]+)>\]\]|\$\{(DOLLAR|LBRACKET|MATCH|BEFORE|AFTER|VISUAL|VISUAL_ORIGINAL)\}|\$(\d)|\$\{(\d+):([^}]*)\}/g;
  const parts: ReplacementPart[] = [];
  let offset = 0;
  for (const token of source.matchAll(pattern)) {
    if (token.index > offset) parts.push({ kind: 'text', text: source.slice(offset, token.index) });
    if (token[1] !== undefined || token[2] !== undefined) {
      parts.push({
        kind: 'capture',
        key: token[1] !== undefined ? Number(token[1]) : token[2]!,
        source: token[0],
      });
    } else if (token[3] === 'DOLLAR' || token[3] === 'LBRACKET') {
      parts.push({ kind: 'text', text: token[3] === 'DOLLAR' ? '$' : '[' });
    } else if (token[3]) {
      parts.push({ kind: 'context', key: token[3] as Extract<ReplacementPart, { kind: 'context' }>['key'] });
    } else if (tabstops) {
      parts.push({
        kind: 'tabstop',
        index: Number(token[4] ?? token[5]),
        value: compileReplacement(token[6] ?? '', false),
      });
    } else {
      parts.push({ kind: 'text', text: token[0] });
    }
    offset = token.index + token[0].length;
  }
  if (offset < source.length) parts.push({ kind: 'text', text: source.slice(offset) });
  return parts;
}

export function expandReplacement(
  parts: readonly ReplacementPart[],
  context: ReplacementContext = {},
  interactive = false,
): ReplacementResult {
  let text = '';
  const tabstops: ReplacementResult['tabstops'] = [];
  for (const part of parts) {
    if (part.kind === 'text') text += part.text;
    else if (part.kind === 'capture') {
      text +=
        typeof part.key === 'number'
          ? part.key < (context.captures?.length ?? 0)
            ? (context.captures![part.key] ?? '')
            : part.source
          : context.groups
            ? (context.groups[part.key] ?? '')
            : part.source;
    } else if (part.kind === 'tabstop') {
      const from = text.length;
      text += expandReplacement(part.value, context).text;
      if (interactive) tabstops.push({ index: part.index, from, to: text.length });
    } else {
      const key = {
        MATCH: 'match',
        BEFORE: 'before',
        AFTER: 'after',
        VISUAL: 'visual',
        VISUAL_ORIGINAL: 'visualOriginal',
      } as const;
      text += context[key[part.key]] ?? '';
    }
  }
  return { text, tabstops };
}

/** String.replace callback: the native RegExp engine still owns matching and flags. */
export function replacementCallback(template: readonly ReplacementPart[]) {
  return (...args: any[]): string => {
    const named = typeof args[args.length - 1] === 'object';
    const tail = named ? args.length - 3 : args.length - 2;
    const offset = args[tail] as number,
      input = args[tail + 1] as string;
    return expandReplacement(template, {
      match: args[0],
      captures: args.slice(1, tail),
      groups: named ? args[args.length - 1] : undefined,
      get before() {
        return input.slice(0, offset);
      },
      get after() {
        return input.slice(offset + args[0].length);
      },
    }).text;
  };
}
