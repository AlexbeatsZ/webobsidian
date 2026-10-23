import type { MarkdownConfig } from '@lezer/markdown';

/** A body-local title is referenceable, but is outside the H1–H6 hierarchy. */
export const BODY_HEADING_LEVEL = 7;
export const BODY_HEADING_NODE = 'BodyHeading';

/** Positions are relative to the start of the hash run (not the quote/list prefix). */
export function bodyHeadingParts(text: string): { contentFrom: number; contentTo: number; closingFrom: number | null } | null {
  const prefix = text.match(/^#######(?:[ \t]+|$)/);
  if (!prefix) return null;
  const contentFrom = prefix[0].length;
  const closing = text.slice(contentFrom).match(/(?:^|[ \t]+)#+[ \t]*$/);
  const contentTo = closing ? contentFrom + closing.index! : Math.max(contentFrom, text.trimEnd().length);
  return { contentFrom, contentTo, closingFrom: closing ? contentTo : null };
}

/** Shared by the complete source model and CodeMirror's language support. */
export const bodyHeadingSyntax: MarkdownConfig = {
  defineNodes: [{ name: BODY_HEADING_NODE, block: true }],
  parseBlock: [{
    name: 'TabATXHeading',
    before: 'ATXHeading',
    parse(cx, line) {
      if (line.next !== 35 || line.indent - line.baseIndent >= 4) return false;
      const raw = line.text.slice(line.pos), open = raw.match(/^(#{1,6})\t+[ \t]*/);
      if (!open) return false;
      const from = cx.lineStart + line.pos;
      const closing = raw.slice(open[0].length).match(/[ \t]+#+[ \t]*$/);
      const end = closing ? open[0].length + closing.index! : raw.length;
      const children = [cx.elt('HeaderMark', from, from + open[1].length),
        ...cx.parser.parseInline(raw.slice(open[0].length, end), from + open[0].length)];
      if (closing) children.push(cx.elt('HeaderMark', from + end, from + raw.length));
      const heading = cx.elt('ATXHeading' + open[1].length, from, from + raw.length, children);
      cx.nextLine(); cx.addElement(heading); return true;
    },
    endLeaf(_cx, line) {
      return line.next === 35 && line.indent - line.baseIndent < 4 && /^#{1,6}\t/.test(line.text.slice(line.pos));
    },
  }, {
    name: BODY_HEADING_NODE,
    before: 'ATXHeading',
    parse(cx, line) {
      if (line.next !== 35 || line.indent - line.baseIndent >= 4) return false;
      const parts = bodyHeadingParts(line.text.slice(line.pos));
      if (!parts) return false;
      const from = cx.lineStart + line.pos;
      const children = [cx.elt('HeaderMark', from, from + BODY_HEADING_LEVEL),
        ...cx.parser.parseInline(line.text.slice(line.pos + parts.contentFrom, line.pos + parts.contentTo), from + parts.contentFrom)];
      if (parts.closingFrom !== null) children.push(cx.elt('HeaderMark', from + parts.closingFrom, cx.lineStart + line.text.length));
      const heading = cx.elt(BODY_HEADING_NODE, from, cx.lineStart + line.text.length, children);
      cx.nextLine();
      cx.addElement(heading);
      return true;
    },
    endLeaf(_cx, line) {
      return line.next === 35 && line.indent - line.baseIndent < 4 && bodyHeadingParts(line.text.slice(line.pos)) !== null;
    },
  }],
};
