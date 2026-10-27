import { searchEntries, searchSettings, subscribeSearch, matchName, fileCandidates } from './search';
import { documents } from './documents';
import { contentReferenceSuggestions, resolveContentLink } from './contentReferences';
import { extractMetadata, mathRegions, equations, equationAnchor, equationLabel, equationReferenceName, type MarkdownModel, type Equation } from '@webobsidian/markdown-core';
import { syntaxModel } from './syntaxModel';
import { api } from './api';
import { renderMath, mathDefinitionContext } from './mathjax';
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
  equation?: { value: Equation; model: MarkdownModel; path: string; target: string };
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
    const model = view.state.field(syntaxModel);
    if (model.literal.some(r => sel.head >= r.from && sel.head <= r.to) ||
      mathRegions(model).some(r => sel.head >= r.from && sel.head <= r.to) ||
      model.frontmatter && sel.head < model.frontmatter.to) return null;
    const q = before.slice(ob + 2);
    // display-text / heading / block modes end basic file suggestions
    if (!q.includes('\n')) {
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
  private preview?: AbortController;
  private previewItem?: Item['equation'];
  private generation = 0;
  private targetPath = '';
  private targetLoad?: Promise<import('@webobsidian/markdown-core').DocumentSession>;
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
    if (ctx.mode === 'link' && ctx.query.includes('^') && !/[#|]/.test(ctx.query)) {
      void this.contentItems(ctx); return;
    }
    if (ctx.mode === 'link' && ctx.query.includes('#^') && !ctx.query.includes('|')) {
      void this.formulaItems(ctx); return;
    }
    this.items = computeItems(ctx, view);
    this.selected = 0;
    if (!this.items.length) return this.hide();
    this.show();
  }

  private async contentItems(ctx: Ctx) {
    this.hide(); this.ctx = ctx;
    const generation = this.generation, captured = this.view.state;
    try {
      const caret = ctx.query.indexOf('^');
      const file = ctx.query.slice(0, caret).trim(), query = ctx.query.slice(caret + 1);
      const targets = await contentReferenceSuggestions(query, file, contextOf(this.view).sourcePath);
      const ranked = targets.flatMap(target => {
        const match = matchName(query, `${target.id} ${target.label} ${target.path}`);
        return match ? [{ target, match }] : [];
      }).sort((left, right) => right.match.score - left.match.score).slice(0, 20);
      const resolved = await Promise.all(ranked.map(async item => ({ ...item,
        resolved: await resolveContentLink('^' + item.target.id, contextOf(this.view).sourcePath) })));
      if (this.destroyed || generation !== this.generation || this.view.state !== captured || this.ctx?.query !== ctx.query) return;
      this.items = resolved.filter(item => item.resolved.status === 'resolved' && item.resolved.path === item.target.path)
        .map(({ target, match }) => ({ label: target.label || target.id, note: `${target.kind} · ${target.path}`,
          insert: '^' + target.id, match: { score: match.score, matches: [] } }));
      this.selected = 0;
      if (this.items.length) this.show(); else this.hide();
    } catch (error) {
      if (generation === this.generation && !this.destroyed) { this.hide(); contextOf(this.view).reportError?.(String(error)); }
    }
  }

  private async formulaItems(ctx: Ctx) {
    // A different target may need IO. Never accept the previous target's list
    // while its replacement is loading.
    this.hide(); this.ctx = ctx;
    const generation = this.generation, captured = this.view.state;
    const [target, query = ''] = ctx.query.split('#^');
    const formulaMode = query === 'eq' || query.startsWith('eq-');
    try {
      let model = captured.field(syntaxModel), path = contextOf(this.view).sourcePath;
      if (target) {
        if (this.targetPath !== target || !this.targetLoad) {
          this.targetPath = target;
          this.targetLoad = api.resolve(target, path).then(result => {
            if (!result.path || result.status === 'ambiguous' || result.status === 'denied') throw new Error('目标笔记不存在或有歧义');
            if (!/\.(md|markdown)$/i.test(result.path)) throw new Error('公式引用只支持 Markdown 笔记');
            return documents.open(result.path);
          });
        }
        const session = await this.targetLoad; path = session.id;
        model = path === contextOf(this.view).sourcePath ? captured.field(syntaxModel) : session.analysis;
      }
      if (this.destroyed || generation !== this.generation || this.view.state !== captured || this.ctx?.query !== ctx.query) return;
      const search = formulaMode ? query.slice(2).replace(/^-/, '').trim() : query;
      const formulas = equations(model);
      const blocks = extractMetadata(model).blockIds, counts = new Map<string, number>();
      for (const block of blocks) counts.set(block.id, (counts.get(block.id) ?? 0) + 1);
      this.items = formulaMode ? formulas.filter(e => !e.ambiguous && e.referenceable &&
        (!e.id || equationReferenceName('^' + e.id) !== undefined)).flatMap(value => {
        const label = `${equationLabel(value) ?? '未编号'} ${value.id ?? value.tex.replace(/\s+/g, ' ').slice(0, 80)}`;
        const match = matchName(search, `${label} ${value.heading} ${value.tex}`);
        return match ? [{ label, note: value.heading || path, insert: '', match: { score: match.score, matches: [] },
          equation: { value, model, path, target } }] : [];
      }) : blocks.filter(b => counts.get(b.id) === 1)
        .flatMap(block => {
          const match = matchName(query, block.id);
          return match ? [{ label: block.id, insert: `${target}#^${block.id}`, match }] : [];
        });
      this.items.sort((a,b) => b.match.score - a.match.score);
      this.items = this.items.slice(0, 20);
      this.selected = 0;
      if (this.items.length) this.show(); else this.hide();
    } catch (error) {
      if (generation === this.generation) { this.targetLoad = undefined; this.hide(); contextOf(this.view).reportError?.(String(error)); }
    }
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
    this.renderPreview();
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
    this.renderPreview();
  }

  private renderPreview() {
    this.preview?.abort();
    const item = this.items[this.selected]?.equation;
    let preview = this.dom?.querySelector<HTMLElement>('.suggestion-equation-preview');
    if (item !== this.previewItem) { preview?.remove(); preview = null; }
    this.previewItem = item;
    if (!this.dom || !item) return;
    if (!preview) {
      preview = document.createElement('div'); preview.className = 'suggestion-equation-preview'; this.dom.appendChild(preview);
    }
    preview.querySelector('[role="status"]')?.remove();
    const status = document.createElement('span'); status.setAttribute('role', 'status'); status.textContent = '正在渲染公式…';
    preview.appendChild(status); preview.setAttribute('aria-busy', 'true');
    this.preview = new AbortController();
    const signal = this.preview.signal, host = preview;
    void renderMath(host, item.value.tex, true, signal, { transient: true, sourcePath: item.path,
      definitions: mathDefinitionContext(item.model, item.value.from) }).then(() => {
      if (!signal.aborted) host.removeAttribute('aria-busy');
    }, error => {
      if (signal.aborted) return;
      host.removeAttribute('aria-busy'); status.textContent = '无法渲染公式'; status.title = String(error);
    });
  }

  hide() {
    this.preview?.abort();
    this.previewItem = undefined;
    this.generation++;
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
    if (!ctx || !item || this.view.composing || this.view.state.readOnly) return;
    const view = this.view;
    const head = view.state.selection.main.head;
    if (item.equation) {
      try {
        const { value, model, path, target } = item.equation;
        const local = path === contextOf(view).sourcePath;
        const session = local ? undefined : documents.get(path);
        if ((local ? view.state.field(syntaxModel) : session?.analysis) !== model) throw new Error('文档已改变，请重新选择公式');
        const prepared = equationAnchor(model, value.from, crypto.randomUUID());
        const insert = `${target}#^${prepared.id}]]`;
        const extra = view.state.sliceDoc(head, head + 2) === ']]' ? 2 : 0;
        const changes = [{ from: ctx.from, to: head + extra, insert }, ...(local && prepared.change ? [prepared.change] : [])].sort((a,b) => a.from - b.from);
        const mapped = view.state.changes(changes).mapPos(head + extra, 1);
        if (session && prepared.change) {
          if (session.snapshot.conflict) throw new Error('目标笔记有冲突，请先解决冲突');
          session.edit(session.snapshot.version, [prepared.change], 'equation-anchor');
        }
        view.dispatch({ changes, selection: { anchor: mapped }, userEvent: 'input.complete' });
        if (session?.snapshot.dirty) void session.save().catch(error => contextOf(view).reportError?.(String(error)));
        this.hide(); view.focus();
      } catch (error) { this.hide(); contextOf(view).reportError?.(String(error)); }
      return;
    }
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
