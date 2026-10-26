import type { MarkdownConfig } from '@lezer/markdown';

/** Footnotes remain ordinary Markdown children of one native composite block. */
export const footnoteSyntax: MarkdownConfig = {
  defineNodes: [{ name: 'FootnoteDefinition', block: true, composite(_cx, line, indent) {
    if (line.pos === line.text.length) return true;
    if (line.indent < line.baseIndent + indent) return false;
    line.moveBaseColumn(line.baseIndent + indent); return true;
  } }, 'FootnoteMark', 'FootnoteReference', 'InlineFootnote'],
  parseBlock: [{ name: 'FootnoteDefinition', before: 'LinkReference', parse(cx, line) {
    if (line.next !== 91 || line.indent - line.baseIndent >= 4) return false;
    const match = /^\[\^([^\]\s]+)\]:[\t ]*/.exec(line.text.slice(line.pos));
    if (!match) return false;
    const from = cx.lineStart + line.pos, end = line.pos + match[0].length;
    cx.startComposite('FootnoteDefinition', line.pos, 4);
    cx.addElement(cx.elt('FootnoteMark', from, cx.lineStart + end));
    line.moveBase(end); return null;
  }, endLeaf(cx, line) {
    return line.next === 91 && line.indent - line.baseIndent < 4 &&
      (/^\[\^[^\]\s]+\]:/.test(line.text.slice(line.pos)) || cx.parentType().name === 'FootnoteDefinition' && /^\[[^\]\n]+\]:/.test(line.text.slice(line.pos)));
  } }],
  parseInline: [{ name: 'Footnote', before: 'Link', parse(cx, next, pos) {
    if (next === 91 && cx.char(pos + 1) === 94) {
      if (pos > 0 && cx.char(pos - 1) === 91) return -1;
      const match = /^\[\^([^\]\s]+)\]/.exec(cx.slice(pos, cx.end));
      if (match) return cx.addElement(cx.elt('FootnoteReference', pos, pos + match[0].length));
    }
    if (next !== 94 || cx.char(pos + 1) !== 91) return -1;
    let depth = 1;
    for (let end = pos + 2; end < cx.end; end++) {
      const char = cx.char(end);
      if (char === 92) { end++; continue; }
      if (char === 91) depth++;
      if (char === 93 && --depth === 0) return cx.addElement(cx.elt('InlineFootnote', pos, end + 1,
        cx.parser.parseInline(cx.slice(pos + 2, end), pos + 2)));
    }
    return -1;
  } }],
};
