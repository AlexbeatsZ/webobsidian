import { EditorView, KeyBinding } from '@codemirror/view';
import { EditorSelection, type ChangeSpec } from '@codemirror/state';
import { insertNewlineContinueMarkup, deleteMarkupBackward } from '@codemirror/lang-markdown';
import { getIndentUnit, indentUnit } from '@codemirror/language';
import { syntaxModel } from './syntaxModel';

/** List-only Tab fallback. Snippets and suggesters run before this keymap. */
function indentList(view: EditorView, outdent: boolean): boolean {
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
      let node = model.tree.resolveInner(number === first ? range.from : line.to, -1);
      while (node.name !== 'ListItem') {
        if (['FencedCode', 'CodeBlock', 'InlineCode'].includes(node.name) || !node.parent) return false;
        node = node.parent;
      }
      const header = state.doc.lineAt(node.from);
      const quoteDepth = header.text.match(/^(?: {0,3}>[ \t]?)+/)?.[0].match(/>/g)?.length ?? 0;
      const end = header.number === number ? state.doc.lineAt(node.to).number : number;
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
      const width = whitespace[0] === '\t' ? 1 : Math.min(getIndentUnit(state), whitespace.match(/^ */)![0].length);
      if (width) changes.push({ from: start, to: start + width });
    }
  }
  if (changes.length) {
    const changeSet = state.changes(changes);
    view.dispatch({ changes: changeSet, selection: state.selection.map(changeSet, 1), scrollIntoView: true, userEvent: 'input.indent' });
  }
  return lines.size > 0;
}

export const markdownListKeymap: KeyBinding[] = [
  { key: 'Tab', run: view => indentList(view, false) },
  { key: 'Shift-Tab', run: view => indentList(view, true) },
];

/**
 * Obsidian editor commands & default hotkeys (docs §4).
 * Format toggle pairs: bold `**`, italic `*`, code `` ` ``, highlight `==`,
 * strikethrough `~~`, comment `%%`, math `$`.
 */

/** Smart inline toggle: wrap selection (or word at caret); unwrap if already wrapped. */
export function toggleInline(view: EditorView, mark: string): boolean {
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

/** editor:toggle-checklist-status (Mod+L): any non-space status counts as done (§7). */
export function toggleChecklist(view: EditorView): boolean {
  const { state } = view;
  const { from, to } = state.selection.main;
  const a = state.doc.lineAt(from).number;
  const b = state.doc.lineAt(to).number;
  const changes: ChangeSpec[] = [];
  for (let n = a; n <= b; n++) {
    const line = state.doc.line(n);
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

/** Default Obsidian editor hotkeys (§4). `Mod` = Cmd on macOS / Ctrl elsewhere. */
export function obsidianKeymap(h: ObsidianKeymapHandlers): KeyBinding[] {
  return [
    { key: 'Mod-b', run: (v) => toggleInline(v, '**') },
    { key: 'Mod-i', run: (v) => toggleInline(v, '*') },
    { key: 'Mod-l', run: toggleChecklist },
    { key: 'Mod-d', run: deleteParagraph },
    { key: 'Mod-k', run: insertLink },
    { key: 'Mod-/', run: (v) => toggleInline(v, '%%') },
    { key: 'Alt-Enter', run: (v) => followLink(v, h.openLink) },
    {
      key: 'Mod-e',
      run: () => {
        h.togglePreview?.();
        return !!h.togglePreview;
      },
    },
    {
      key: 'Mod-s',
      run: () => {
        h.save?.();
        return true; // swallow the browser save dialog regardless
      },
    },
    // Obsidian list behaviour: Enter continues lists/quotes, Backspace eats markers.
    { key: 'Enter', run: insertNewlineContinueMarkup },
    { key: 'Backspace', run: deleteMarkupBackward },
  ];
}
