import { searchEntries, searchSettings, subscribeSearch, matchName, fileCandidates } from './search';
import { documents } from './documents';
import { extractMetadata } from '@webobsidian/markdown-core';
import { EditorView, ViewPlugin, ViewUpdate, keymap } from '@codemirror/view';
import { Prec } from '@codemirror/state';
import { contextOf } from './renderContext';
import { prepareQuery, fuzzySearch, fuzzySearchPath, type FuzzyMatch } from './fuzzy';

/**
 * Editor suggesters (docs §9):
 *  - `[[` link suggester — trigger when lastIndexOf("[[") > lastIndexOf("]") on the
 *    line text up to the cursor; `![[` works the same. Stops in display-text mode (`|`).
 *  - `#` tag suggester — trigger on /(^|\s)#…$/ before the cursor.
 * Ranking uses the exact Obsidian fuzzy score (lib/fuzzy.ts). Max 20 items.
 */

// Tag body charset (§7) — editor flavour additionally requires a letter.
const TAG_TAIL_RE = /(^|\s)#([^ -⁯⸀-⹿'!"#$%&()*+,.:;<=>?@^`{|}~[\]\\\s]*)$/;

interface Item {
  label: string; // main text (basename / tag)
  note?: string; // secondary text (folder path)
  insert: string; // text replacing the query
  match: FuzzyMatch;
}

interface Ctx {
  mode: 'link' | 'tag' | 'yaml';
  embed: boolean;
  from: number; // start of the query text (after the trigger)
  query: string;
}

function detect(view: EditorView): Ctx | null {
  const sel = view.state.selection.main;
  if (!sel.empty) return null;
  const line = view.state.doc.lineAt(sel.head);
  const before = line.text.slice(0, sel.head - line.from);

  const ob = before.lastIndexOf('[[');
  const cb = before.lastIndexOf(']');
  if (ob >= 0 && ob > cb) {
    const q = before.slice(ob + 2);
    // display-text / heading / block modes end basic file suggestions
    if (!q.includes('\n') && !q.includes('^')) {
      return { mode: 'link', embed: ob > 0 && before[ob - 1] === '!', from: line.from + ob + 2, query: q };
    }
    return null;
  }

  const all = view.state.doc.toString();
  const yamlEnd = all.startsWith('---\n') || all.startsWith('---\r\n') ? all.indexOf('\n---', 4) : -1;
  if (yamlEnd > sel.head) {
    const prefix = all.slice(0, line.from);
    const inTags =
      /^tags?:\s*/.test(before) ||
      (/^\s*-\s*/.test(before) && /(?:^|\n)tags?:\s*\n(?:[ \t]+-.*\n)*$/.test(prefix));
    if (inTags) {
      const value = before.match(/[^\s,\[\]"']*$/)?.[0] ?? '';
      return { mode: 'yaml', embed: false, from: sel.head - value.length, query: value };
    }
  }
  const tm = before.match(TAG_TAIL_RE);
  if (tm) {
    const after = line.text[sel.head - line.from];
    if (after !== '#') {
      const start = sel.head - tm[2].length;
      return { mode: 'tag', embed: false, from: start, query: tm[2] };
    }
  }
  return null;
}

function computeItems(ctx: Ctx, view: EditorView): Item[] {
  const pq = prepareQuery(ctx.query);
  const out: Item[] = [];
  if (ctx.mode === 'link') {
    const hash = ctx.query.indexOf('#'),
      pipe = ctx.query.indexOf('|');
    if (hash >= 0 || pipe >= 0) {
      const cut = hash >= 0 ? hash : pipe,
        target = ctx.query.slice(0, cut),
        query = ctx.query.slice(cut + 1);
      const matches = searchEntries().filter(
        (e) =>
          e.path.replace(/\.(md|markdown)$/i, '') === target ||
          e.path
            .split('/')
            .at(-1)!
            .replace(/\.(md|markdown)$/i, '') === target,
      );
      const entry = target
        ? matches.length === 1
          ? matches[0]
          : undefined
        : searchEntries().find((e) => e.path === contextOf(view).sourcePath);
      if (entry) {
        const session = documents.get(entry.path);
        const labels =
          hash >= 0
            ? session
              ? extractMetadata(session.analysis).headings.map((h) => h.text)
              : entry.headings
            : entry.aliases;
        for (const label of labels) {
          const match = matchName(query, label);
          if (match)
            out.push({
              label,
              insert: ctx.query.slice(0, cut + 1) + label,
              match: { ...match, matches: match.matches.map(([a, b]) => [a + cut + 1, b + cut + 1]) },
            });
        }
      }
    } else {
      const available = new Set(contextOf(view).files());
      const indexed = searchEntries().filter((e) => available.has(e.path));
      const entries = indexed.length
        ? indexed
        : [...available].map((path) => ({
            path,
            kind: 'file' as const,
            title: path
              .split('/')
              .at(-1)!
              .replace(/\.(md|markdown)$/i, ''),
            aliases: [],
            tags: [],
            headings: [],
          }));
      for (const { entry, label, match } of fileCandidates(ctx.query, entries)) {
        const target = entry.path.replace(/\.(md|markdown)$/i, '');
        const alias = entry.aliases.includes(label),
          insert = target + (alias ? '|' + label : '');
        const offset = insert.length - label.length;
        out.push({
          label,
          note: entry.path,
          insert,
          match: { ...match, matches: match.matches.map(([a, b]) => [a + offset, b + offset]) },
        });
      }
    }
  } else {
    for (const tag of [
      ...new Set(
        [...searchEntries().flatMap((e) => e.tags), ...(cachedTags.get(view) ?? [])].map((t) =>
          t.replace(/^#/, ''),
        ),
      ),
    ]) {
      const m = ctx.query ? fuzzySearch(pq, tag) : { score: 0, matches: [] as [number, number][] };
      if (!m) continue;
      out.push({ label: tag, insert: tag, match: m });
    }
  }
  out.sort((x, y) => y.match.score - x.match.score);
  return out.slice(0, 20);
}

/** Bold the matched ranges of `label` (suggestion-highlight). */
function renderLabel(el: HTMLElement, label: string, item: Item) {
  // matches are in target coordinates; map to the label when it's a suffix (basename)
  const offset = item.insert.length - label.length;
  let last = 0;
  for (const [a, b] of item.match.matches) {
    const from = Math.max(0, a - offset);
    const to = Math.max(0, b - offset);
    if (to <= 0 || from >= label.length || to <= from) continue;
    if (from > last) el.appendChild(document.createTextNode(label.slice(last, from)));
    const hl = document.createElement('span');
    hl.className = 'suggestion-highlight';
    hl.textContent = label.slice(from, to);
    el.appendChild(hl);
    last = to;
  }
  if (last < label.length) el.appendChild(document.createTextNode(label.slice(last)));
}

const cachedTags = new WeakMap<EditorView, string[]>();
class SuggestState {
  private destroyed = false;
  dom: HTMLElement | null = null;
  ctx: Ctx | null = null;
  items: Item[] = [];
  selected = 0;

  private stopSearch: () => void;
  constructor(readonly view: EditorView) {
    this.stopSearch = subscribeSearch(() => {
      if (this.active) this.refresh();
    });
    void contextOf(view)
      .tags()
      .then((tags) => {
        if (!this.destroyed) cachedTags.set(view, tags);
      });
  }

  update(u: ViewUpdate) {
    if (u.docChanged || u.selectionSet || u.focusChanged) {
      // defer: coordsAtPos must run after the view finishes updating
      requestAnimationFrame(() => this.refresh());
    }
  }

  refresh() {
    const view = this.view;
    if (this.destroyed || view.composing || view.state.readOnly || !view.hasFocus) return this.hide();
    const ctx = detect(view);
    if (!ctx) return this.hide();
    this.ctx = ctx;
    this.items = computeItems(ctx, view);
    this.selected = 0;
    if (!this.items.length) return this.hide();
    this.show();
  }

  show() {
    const view = this.view;
    if (!this.dom) {
      this.dom = document.createElement('div');
      this.dom.className = 'suggestion-container';
      const host = (document.querySelector('.theme-light, .theme-dark') as HTMLElement) ?? document.body;
      host.appendChild(this.dom);
    }
    const dom = this.dom;
    dom.textContent = '';
    this.items.forEach((item, i) => {
      const el = document.createElement('div');
      el.className = 'suggestion-item' + (i === this.selected ? ' is-selected' : '');
      const title = document.createElement('span');
      title.className = 'suggestion-title';
      renderLabel(title, item.label, item);
      el.appendChild(title);
      if (item.note) {
        const note = document.createElement('span');
        note.className = 'suggestion-note';
        note.textContent = item.note;
        el.appendChild(note);
      }
      el.addEventListener('mousedown', (e) => {
        e.preventDefault();
        this.selected = i;
        this.accept();
      });
      el.addEventListener('mousemove', () => {
        if (this.selected !== i) {
          this.selected = i;
          this.renderSelection();
        }
      });
      dom.appendChild(el);
    });
    const ctx = this.ctx!;
    const coords = view.coordsAtPos(
      Math.max(0, ctx.from - (ctx.mode === 'link' ? 2 : ctx.mode === 'yaml' ? 0 : 1)),
    );
    if (!coords) return this.hide();
    dom.style.left = `${Math.round(Math.min(coords.left, window.innerWidth - 320))}px`;
    dom.style.display = 'block';
    // Flip above the cursor when there is no room below (like Obsidian).
    const height = Math.min(dom.scrollHeight, 300);
    if (coords.bottom + 4 + height > window.innerHeight && coords.top - 4 - height > 0) {
      dom.style.top = `${Math.round(coords.top - 4 - height)}px`;
    } else {
      dom.style.top = `${Math.round(coords.bottom + 4)}px`;
    }
  }

  renderSelection() {
    if (!this.dom) return;
    [...this.dom.children].forEach((c, i) => c.classList.toggle('is-selected', i === this.selected));
    (this.dom.children[this.selected] as HTMLElement | undefined)?.scrollIntoView({ block: 'nearest' });
  }

  hide() {
    this.ctx = null;
    if (this.dom) {
      this.dom.remove();
      this.dom = null;
    }
  }

  get active() {
    return this.dom !== null && this.ctx !== null && this.items.length > 0;
  }

  accept() {
    const ctx = this.ctx;
    const item = this.items[this.selected];
    if (!ctx || !item || this.view.composing) return;
    const view = this.view;
    const head = view.state.selection.main.head;
    if (ctx.mode === 'link') {
      // consume a `]]` the user (or auto-pair) already typed after the cursor
      const after = view.state.sliceDoc(head, head + 2);
      const extra = after === ']]' ? 2 : 0;
      view.dispatch({
        changes: { from: ctx.from, to: head + extra, insert: `${item.insert}]]` },
        selection: { anchor: ctx.from + item.insert.length + 2 },
        userEvent: 'input.complete',
      });
    } else {
      view.dispatch({
        changes: { from: ctx.from, to: head, insert: item.insert },
        selection: { anchor: ctx.from + item.insert.length },
        userEvent: 'input.complete',
      });
    }
    this.hide();
    view.focus();
  }

  move(dir: 1 | -1) {
    this.selected = (this.selected + dir + this.items.length) % this.items.length;
    this.renderSelection();
  }

  destroy() {
    this.destroyed = true;
    this.stopSearch();
    cachedTags.delete(this.view);
    this.hide();
  }
}

const plugin = ViewPlugin.fromClass(SuggestState, {
  eventHandlers: {
    blur() {
      const self = this as unknown as SuggestState;
      // let an item mousedown win first
      setTimeout(() => self.hide(), 120);
      return false;
    },
  },
});

/** Run `f` when the suggester popup is open; otherwise let the key fall through. */
function whenActive(view: EditorView, f: (s: SuggestState) => void): boolean {
  const s = view.plugin(plugin);
  if (view.composing || !s || !s.active) return false;
  f(s);
  return true;
}

// Highest precedence so Enter/Tab/arrows beat the editor keymaps while open.
const suggesterKeys = Prec.highest(
  keymap.of([
    { key: 'ArrowDown', run: (v) => whenActive(v, (s) => s.move(1)) },
    { key: 'ArrowUp', run: (v) => whenActive(v, (s) => s.move(-1)) },
    { key: 'Enter', run: (v) => whenActive(v, (s) => s.accept()) },
    { key: 'Tab', run: (v) => whenActive(v, (s) => s.accept()) },
    { key: 'Escape', run: (v) => whenActive(v, (s) => s.hide()) },
  ]),
);

export const suggesterPlugin = [plugin, suggesterKeys];
