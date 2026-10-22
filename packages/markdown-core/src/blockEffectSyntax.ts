import type { MarkdownConfig } from '@lezer/markdown';

export const BLOCK_EFFECT_MARK = 'BlockEffectMark';
const marker = /^\[([^\[\]\n]+)\][ \t]*$/;
export function blockEffectNames(value: string): string[] | null {
  const match = marker.exec(value);
  if (!match || /^[!^]/.test(match[1])) return null;
  const names = match[1].split('|').map(name => name.trim());
  return names.every(Boolean) ? names : null;
}

/** Grammar has no dependency on document analysis or the configured effects. */
export const blockEffectSyntax: MarkdownConfig = {
  defineNodes: [{ name: BLOCK_EFFECT_MARK, block: true }],
  parseBlock: [{ name: BLOCK_EFFECT_MARK, before: 'ATXHeading',
    parse(cx, line) {
      if (line.next !== 91 || line.indent - line.baseIndent >= 4 || !blockEffectNames(line.text.slice(line.pos))) return false;
      const from = cx.lineStart + line.pos;
      const element = cx.elt(BLOCK_EFFECT_MARK, from, cx.lineStart + line.text.length,
        cx.parser.parseInline(line.text.slice(line.pos), from));
      cx.nextLine(); cx.addElement(element); return true;
    },
    endLeaf(_cx, line) { return line.next === 91 && line.indent - line.baseIndent < 4 && blockEffectNames(line.text.slice(line.pos)) !== null; },
  }],
};
