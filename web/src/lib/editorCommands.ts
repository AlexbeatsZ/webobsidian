import { EditorView, KeyBinding } from '@codemirror/view';
import { countColumn, EditorSelection, type ChangeSpec } from '@codemirror/state';
import { insertNewlineContinueMarkup, deleteMarkupBackward } from '@codemirror/lang-markdown';
import { getIndentUnit, indentString, indentUnit } from '@codemirror/language';
import { syntaxModel } from './syntaxModel';
import { mathRegions } from '@webobsidian/markdown-core';
import { markdownListFold, markdownListLine } from './listLayout';

/** Source indentation for list items and plain continuation lines, never bullets. */
export function indentMarkdown(view: EditorView, outdent: boolean): boolean {
  const { state } = view;
  if (state.readOnly || view.composing) return false;
  const model = state.field(syntaxModel);
  const lines = new Map<number, number>();
  for (const range of state.selection.ranges) {
    const first = state.doc.lineAt(range.from).number;
    const last = state.doc.lineAt(range.to > range.from ? range.to - 1 : range.to).number;
    for (let number = first; number <= last; number++) {
      const line = state.doc.line(number);
      if (model.frontmatter && line.from < model.frontmatter.to) return false;
      const position = number === first ? range.from : line.to;
      for (let node = model.tree.resolveInner(position, position === line.from ? 1 : -1); node; node = node.parent!) {
        if (['FencedCode', 'CodeBlock', 'InlineCode'].includes(node.name)) return false;
        if (['Paragraph', 'ListItem'].includes(node.name)) break;
      }
      const context = markdownListLine(state, line);
      const quoteDepth = context?.quoteDepth ?? line.text.match(/^(?: {0,3}>[ \t]?)+/)?.[0].match(/>/g)?.length ?? 0;
      const descendants = context?.header ? markdownListFold(state, line) : null;
      const end = descendants ? state.doc.lineAt(descendants.to).number : number;
      for (let child = number; child <= end; child++) lines.set(child, Math.min(lines.get(child) ?? quoteDepth, quoteDepth));
    }
  }
  const changes: ChangeSpec[] = [];
  for (const [number, quoteDepth] of [...lines].sort(([a], [b]) => a - b)) {
    const line = state.doc.line(number);
    // Quote prefixes stay in place; only the list's own indentation changes.
    let quote = 0;
    for (let depth = 0; depth < quoteDepth; depth++) quote += line.text.slice(quote).match(/^ {0,3}>[ \t]?/)?.[0].length ?? 0;
    const start = line.from + quote;
    if (!outdent) changes.push({ from: start, insert: state.facet(indentUnit) });
    else {
      const whitespace = line.text.slice(quote).match(/^[ \t]*/)?.[0] ?? '';
      const indent = indentString(state, Math.max(0, countColumn(whitespace, state.tabSize) - getIndentUnit(state)));
      let keep = 0;
      while (keep < whitespace.length && keep < indent.length && whitespace[keep] === indent[keep]) keep++;
      if (keep < whitespace.length || keep < indent.length) changes.push({ from: start + keep, to: start + whitespace.length, insert: indent.slice(keep) });
    }
  }
  if (changes.length) {
    const changeSet = state.changes(changes);
    view.dispatch({ changes: changeSet, selection: state.selection.map(changeSet, 1), scrollIntoView: true, userEvent: 'input.indent' });
  }
  return lines.size > 0;
}

/** Native marker continuation remains authoritative; plain list text keeps its own indent. */
function continueMarkdown(view: EditorView): boolean {
  const { state } = view;
  if (state.readOnly || view.composing) return false;
  const lines = state.selection.ranges.map(range => {
    const line = state.doc.lineAt(range.from), context = markdownListLine(state, line);
    return range.empty && context?.paragraph && !context.header && line.text.slice(context.indentTo).trim() && range.from >= line.from + context.indentTo
      ? { line, prefix: line.text.slice(0, context.indentTo) } : null;
  });
  if (lines.some(line => !line)) return insertNewlineContinueMarkup(view);
  let index = 0;
  const change = state.changeByRange(range => {
    const { line, prefix } = lines[index++]!;
    let from = range.from;
    while (from > line.from + prefix.length && /[ \t]/.test(state.sliceDoc(from - 1, from))) from--;
    const insert = state.lineBreak + prefix;
    return { changes: { from, to: range.to, insert }, range: EditorSelection.cursor(from + insert.length) };
  });
  view.dispatch(change, { scrollIntoView: true, userEvent: 'input' });
  return true;
}

/** Removing an empty list marker must not rewrite the user's indentation. */
function deleteMarkdownMarkup(view: EditorView): boolean {
  const { state } = view;
  if (state.readOnly || view.composing) return false;
  const markers = state.selection.ranges.map(range => {
    if (!range.empty) return null;
    const line = state.doc.lineAt(range.from), context = markdownListLine(state, line);
    const marker = context?.header ? context.item.getChild('ListMark') : null;
    return marker && range.from === line.to && /^[ \t]*$/.test(state.sliceDoc(marker.to, line.to))
      ? { from: marker.from, to: line.to } : null;
  });
  if (markers.some(marker => !marker)) return deleteMarkupBackward(view);
  let index = 0;
  const change = state.changeByRange(() => {
    const marker = markers[index++]!;
    return { changes: marker, range: EditorSelection.cursor(marker.from) };
  });
  view.dispatch(change, { scrollIntoView: true, userEvent: 'delete.backward' });
  return true;
}

export const markdownListKeymap: KeyBinding[] = [
  { key: 'Tab', run: view => indentMarkdown(view, false) },
  { key: 'Shift-Tab', run: view => indentMarkdown(view, true) },
];

/**
 * Obsidian editor commands & default hotkeys (docs §4).
 * Format toggle pairs: bold `**`, italic `*`, code `` ` ``, highlight `==`,
 * strikethrough `~~`, comment `%%`, math `$`.
 */

/** Smart inline toggle: wrap selection (or word at caret); unwrap if already wrapped. */
export function toggleInline(view: EditorView, mark: string): boolean {
  if (view.state.readOnly) return false;
  const tr = view.state.changeByRange((range) => {
    let { from, to } = range;
    if (from === to) {
      const w = view.state.wordAt(from);
      if (w) {
        from = w.from;
        to = w.to;
      }
    }
    const n = mark.length;
    const before = view.state.sliceDoc(Math.max(0, from - n), from);
    const after = view.state.sliceDoc(to, Math.min(view.state.doc.length, to + n));
    const inner = view.state.sliceDoc(from, to);
    // unwrap: marks just outside the selection
    if (before === mark && after === mark) {
      return {
        changes: [
          { from: from - n, to: from },
          { from: to, to: to + n },
        ],
        range: EditorSelection.range(from - n, to - n),
      };
    }
    // unwrap: marks included in the selection
    if (inner.length >= 2 * n && inner.startsWith(mark) && inner.endsWith(mark)) {
      return {
        changes: [
          { from, to: from + n },
          { from: to - n, to },
        ],
        range: EditorSelection.range(from, to - 2 * n),
      };
    }
    return {
      changes: [
        { from, insert: mark },
        { from: to, insert: mark },
      ],
      range: EditorSelection.range(from + n, to + n),
    };
  });
  view.dispatch(tr, { scrollIntoView: true, userEvent: 'input' });
  view.focus();
  return true;
}

/** Explicit surrounding insertion, shared by menus and native code-block insertion. */
export function surroundSelection(view: EditorView, before: string, after: string): boolean {
  if (view.state.readOnly) return false;
  view.dispatch(view.state.changeByRange(range => ({
    changes: [{ from: range.from, insert: before }, { from: range.to, insert: after }],
    range: EditorSelection.range(range.from + before.length, range.to + before.length),
  })), { userEvent: 'input.format' });
  view.focus();
  return true;
}

/** editor:toggle-checklist-status (Mod+L): any non-space status counts as done (§7). */
export function toggleChecklist(view: EditorView): boolean {
  const { state } = view;
  if (state.readOnly) return false;
  const changes: ChangeSpec[] = [];
  for (const line of selectedMarkdownLines(view).values()) {
    const task = line.text.match(/^(\s*)((?:[-*+]|\d+[.)])\s+)\[(.)\]\s/);
    if (task) {
      const boxPos = line.from + task[1].length + task[2].length + 1;
      changes.push({ from: boxPos, to: boxPos + 1, insert: task[3] === ' ' ? 'x' : ' ' });
      continue;
    }
    const list = line.text.match(/^(\s*)((?:[-*+]|\d+[.)])\s+)/);
    if (list) {
      changes.push({ from: line.from + list[0].length, insert: '[ ] ' });
    } else if (line.text.trim() !== '') {
      changes.push({ from: line.from + (line.text.match(/^\s*/)?.[0].length ?? 0), insert: '- [ ] ' });
    }
  }
  if (!changes.length) return false;
  view.dispatch({ changes, userEvent: 'input' });
  return true;
}

/** editor:delete-paragraph (Mod+D): remove the blank-line-delimited block at the caret. */
export function deleteParagraph(view: EditorView): boolean {
  const { state } = view;
  const doc = state.doc;
  const cur = doc.lineAt(state.selection.main.head);
  let first = cur.number;
  let last = cur.number;
  if (cur.text.trim() !== '') {
    while (first > 1 && doc.line(first - 1).text.trim() !== '') first--;
    while (last < doc.lines && doc.line(last + 1).text.trim() !== '') last++;
  }
  const from = doc.line(first).from;
  const to = last < doc.lines ? doc.line(last + 1).from : doc.line(last).to;
  view.dispatch({ changes: { from, to }, selection: { anchor: Math.min(from, doc.length - (to - from)) }, userEvent: 'delete' });
  return true;
}

/** editor:insert-link (Mod+K): `[selection](caret)`. */
export function insertLink(view: EditorView): boolean {
  const tr = view.state.changeByRange((range) => {
    const sel = view.state.sliceDoc(range.from, range.to);
    return {
      changes: { from: range.from, to: range.to, insert: `[${sel}]()` },
      range: EditorSelection.cursor(range.from + sel.length + 3),
    };
  });
  view.dispatch(tr, { userEvent: 'input' });
  view.focus();
  return true;
}

/** editor:follow-link (Alt+Enter): open the wikilink / markdown link under the caret. */
export function followLink(view: EditorView, open: (target: string) => void): boolean {
  const { state } = view;
  const pos = state.selection.main.head;
  const line = state.doc.lineAt(pos);
  const col = pos - line.from;
  const wiki = /!?\[\[(.+?)\]\]/g;
  let m: RegExpExecArray | null;
  while ((m = wiki.exec(line.text))) {
    if (col >= m.index && col <= m.index + m[0].length) {
      const inner = m[1];
      if (inner.includes('[[')) continue;
      const pi = inner.indexOf('|');
      open((pi > 0 ? inner.slice(0, pi) : inner).trim());
      return true;
    }
  }
  const md = /\[[^\]]*?\]\(([^)]+)\)/g;
  while ((m = md.exec(line.text))) {
    if (col >= m.index && col <= m.index + m[0].length) {
      const href = m[1].replace(/\s+"[^"]*"$/, '').trim();
      if (/^https?:\/\//i.test(href)) window.open(href, '_blank', 'noopener');
      else open(href.replace(/\.(md|markdown)$/i, ''));
      return true;
    }
  }
  return false;
}

export interface ObsidianKeymapHandlers {
  openLink: (target: string) => void;
  /** markdown:toggle-preview (Mod+E) */
  togglePreview?: () => void;
  /** editor:save-file (Mod+S) */
  save?: () => void;
}

/** Named commands belong to CommandManager; only structural editing stays here. */
export function obsidianKeymap(_h: ObsidianKeymapHandlers): KeyBinding[] {
  return [
    // Native marker continuation plus exact indentation for unmarked list text.
    { key: 'Enter', run: continueMarkdown },
    { key: 'Backspace', run: deleteMarkdownMarkup },
  ];
}

/** Local source patches over the shared syntax snapshot; no serialization. */
function selectedMarkdownLines(view: EditorView, bodyHeading = false) {
  const state = view.state;
  const model = state.field(syntaxModel), formulas = mathRegions(model);
  const lines = new Map<number, ReturnType<typeof state.doc.line>>();
  for (const range of state.selection.ranges) {
    const first = state.doc.lineAt(range.from).number, last = state.doc.lineAt(range.to > range.from ? range.to - 1 : range.to).number;
    for (let n = first; n <= last; n++) {
      const line = state.doc.line(n);
      if (model.frontmatter && line.from < model.frontmatter.to || formulas.some(region => line.from < region.to && line.to >= region.from)) continue;
      let excluded = false;
      for (let node = model.tree.resolveInner(line.from + (line.text.match(/^[ \t]*/)?.[0].length ?? 0), 1); node; node = node.parent!) {
        if (['FencedCode', 'CodeBlock'].includes(node.name) || !bodyHeading && node.name === 'BodyHeading') { excluded = true; break; }
      }
      if (!excluded && !/^[ \t]*>\s*\[!/.test(line.text)) lines.set(n, line);
    }
  }
  return lines;
}

export function toggleLineStyle(view: EditorView, style: 'bullet' | 'ordered' | 'quote' | number): boolean {
  const state = view.state;
  if (state.readOnly) return false;
  const lines = selectedMarkdownLines(view, style === 7);
  const marker = style === 'bullet' ? /^(?:[-+*])[ \t]+/ : style === 'ordered' ? /^\d+[.)][ \t]+/ : style === 'quote' ? /^>[ \t]?/ : /^#{1,7}(?:[ \t]+|$)/;
  const rows = [...lines.values()].map(line => {
    const indent = line.text.match(/^[ \t]*/)?.[0].length ?? 0;
    return { line, indent, mark: marker.exec(line.text.slice(indent))?.[0] ?? '' };
  });
  const remove = typeof style !== 'number' && rows.every(row => !!row.mark);
  const changes = rows.map(({ line, indent, mark }, index) => {
    let length = mark.length;
    if (style === 'bullet' || style === 'ordered') length = /^(?:[-+*]|\d+[.)])[ \t]+/.exec(line.text.slice(indent))?.[0].length ?? 0;
    const insert = remove || style === 0 ? '' : typeof style === 'number' ? '#'.repeat(style) + ' ' : style === 'bullet' ? '- ' : style === 'ordered' ? `${index + 1}. ` : '> ';
    return { from: line.from + indent, to: line.from + indent + length, insert };
  }).filter(change => state.sliceDoc(change.from, change.to) !== change.insert);
  if (!changes.length) return false;
  const changeSet = state.changes(changes);
  view.dispatch({ changes: changeSet, selection: state.selection.map(changeSet, 1), userEvent: 'input.format' }); view.focus(); return true;
}
