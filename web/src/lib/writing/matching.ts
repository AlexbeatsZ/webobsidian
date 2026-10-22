import type { EditorView } from '@codemirror/view';

const local = new WeakMap<RegExp, boolean>();
/** Conservative proof that an end-anchored trigger cannot cross a line boundary. */
export function lineLocalTrigger(regex: RegExp): boolean {
  const cached = local.get(regex);
  if (cached !== undefined) return cached;
  const source = regex.source,
    flags = regex.flags.replace(/[gy]/g, '');
  let safe = regex.constructor === RegExp && !/[mvy]/.test(regex.flags) && source.endsWith('$');
  for (let i = 0; safe && i < source.length; i++) {
    const c = source[i];
    let atom = '';
    if (c === '^' || c === '\n' || c === '\r') {
      safe = false;
      break;
    }
    if (c === '[') {
      let end = i + 1;
      for (; end < source.length; end++) {
        if (source[end] === '\\') {
          end++;
          continue;
        }
        if (source[end] === ']') break;
      }
      if (end >= source.length) {
        safe = false;
        break;
      }
      atom = source.slice(i, end + 1);
      i = end;
    } else if (c === '\\') {
      const start = i;
      const next = source[++i];
      if (!next || /[1-9k]/.test(next)) {
        safe = false;
        break;
      }
      if (next === 'x') i += 2;
      else if (next === 'u') {
        if (source[i + 1] === '{') {
          const end = source.indexOf('}', i + 2);
          if (end < 0) {
            safe = false;
            break;
          }
          i = end;
        } else i += 4;
      } else if (next === 'p' || next === 'P') {
        const end = source.indexOf('}', i + 2);
        if (source[i + 1] !== '{' || end < 0) {
          safe = false;
          break;
        }
        i = end;
      } else if (next === 'c') i++;
      atom = source.slice(start, i + 1);
    } else if (c === '.') atom = '.';
    if (atom) {
      try {
        const test = new RegExp('^(?:' + atom + ')$', flags);
        if (test.test('\n') || test.test('\r')) safe = false;
      } catch {
        safe = false;
      }
    }
  }
  local.set(regex, safe);
  return safe;
}
export function snippetInput(
  view: EditorView,
  trigger: string | RegExp,
  to: number,
  key: string,
  cache = new Map<number, SnippetInput>(),
) {
  let from = 0;
  if (typeof trigger === 'string') from = Math.max(0, to - trigger.length);
  else if (
    lineLocalTrigger(trigger) &&
    !key.includes('\n') &&
    view.state.sliceDoc(Math.max(0, to - 1), to) !== '\n'
  )
    from = view.state.doc.lineAt(to).from;
  let value = cache.get(from);
  if (!value) {
    value = {
      effectiveLine: view.state.sliceDoc(from, to) + key,
      baseOffset: from,
      originalPrefix: () => view.state.sliceDoc(0, to) + key,
    };
    cache.set(from, value);
  }
  return value;
}
interface SnippetInput {
  effectiveLine: string;
  baseOffset: number;
  originalPrefix: () => string;
}
