import { REPLACEMENT_SYNTAX } from './replacement.js';

// One-time importer only. Native editing/formatting never interprets JS replacement strings.
export function migrateLinterReplacement(value: string, find: string, flags = ''): string {
  for (const [encoded, decoded] of [
    ['\\f', '\f'],
    ['\\n', '\n'],
    ['\\r', '\r'],
    ['\\t', '\t'],
    ['\\v', '\v'],
    ['\\\\', '\\'],
  ])
    value = value.replaceAll(encoded!, decoded!);
  // The empty alternative exposes capture slots and named-group metadata without a sample match.
  const shape = new RegExp(`(?:${find})|`, flags).exec('')!;
  const count = shape.length - 1;
  let result = '',
    literal = '';
  const flush = () => {
    result += literal.replace(/\$(?=[\d{])|\[(?=\[)/g, (c) => (c === '$' ? '${DOLLAR}' : '${LBRACKET}'));
    literal = '';
  };
  for (let i = 0; i < value.length; i++) {
    if (value[i] !== '$' || i + 1 === value.length) {
      literal += value[i];
      continue;
    }
    const next = value[i + 1]!;
    if (next === '$') {
      literal += '$';
      i++;
      continue;
    }
    const context = ({ '&': 'MATCH', '`': 'BEFORE', "'": 'AFTER' } as Record<string, string>)[next];
    if (context) {
      flush();
      result += '${' + context + '}';
      i++;
      continue;
    }
    if (next === '<' && shape.groups) {
      const end = value.indexOf('>', i + 2);
      if (end !== -1) {
        flush();
        const name = value.slice(i + 2, end);
        if (Object.hasOwn(shape.groups, name)) result += '[[<' + name + '>]]';
        i = end;
        continue;
      }
    }
    if (/\d/.test(next)) {
      const two = value.slice(i + 1, i + 3);
      const length =
        /^\d{2}$/.test(two) && Number(two) > 0 && Number(two) <= count
          ? 2
          : Number(next) > 0 && Number(next) <= count
            ? 1
            : 0;
      if (length) {
        flush();
        result += '[[' + (Number(value.slice(i + 1, i + 1 + length)) - 1) + ']]';
        i += length;
        continue;
      }
    }
    literal += '$';
  }
  flush();
  return result;
}

export function migrateLinterReplacements<T extends Record<string, any>>(settings: T): T {
  if (settings.replacementSyntax === REPLACEMENT_SYNTAX) return settings;
  if (settings.replacementSyntax !== undefined)
    throw new Error('Unsupported replacement syntax: ' + settings.replacementSyntax);
  return {
    ...settings,
    replacementSyntax: REPLACEMENT_SYNTAX,
    customRegexes: (settings.customRegexes ?? []).map((rule: any) => ({
      ...rule,
      replace: migrateLinterReplacement(rule.replace ?? '', rule.find ?? '', rule.flags ?? ''),
    })),
  };
}
