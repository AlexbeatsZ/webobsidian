import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import { MapMode, StateEffect, StateField, countColumn, type EditorState, type Line, type Range } from '@codemirror/state';
import type { SyntaxNode } from '@lezer/common';
import { stripQuotePrefix, type MarkdownModel, type SourceSpan } from '@webobsidian/markdown-core';
import { syntaxModel } from './syntaxModel';

/** One source owner for list headers and marker-free paragraphs/continuations. */
export function markdownListLine(state: EditorState, line: Line) {
  const model = state.field(syntaxModel);
  if (model.frontmatter && line.from < model.frontmatter.to) return null;
  let paragraph = false;
  for (let node: SyntaxNode | null = model.tree.resolveInner(line.to, -1); node; node = node.parent) {
    if (['FencedCode', 'CodeBlock'].includes(node.name)) return null;
    if (['Paragraph', 'Task'].includes(node.name) && node.parent?.name === 'ListItem') paragraph = true;
    if (node.name !== 'ListItem' || node.to < line.from) continue;
    let quoteDepth = 0;
    for (let parent = node.parent; parent; parent = parent.parent) if (parent.name === 'Blockquote') quoteDepth++;
    const body = stripQuotePrefix(line.text, quoteDepth);
    const quoteTo = line.text.length - body.length;
    return { item: node, quoteDepth, quoteTo, paragraph,
      indentTo: quoteTo + (body.match(/^[ \t]*/)?.[0].length ?? 0),
      header: state.doc.lineAt(node.from).from === line.from };
  }
  return null;
}

const foldBounds = new WeakMap<MarkdownModel, Map<number, { tabSize: number; range: SourceSpan | null }>>();

/** UI folding requires explicit source indentation, even for grammar-lazy text. */
export function markdownListFold(state: EditorState, line: Line): SourceSpan | null {
  const context = markdownListLine(state, line);
  if (!context?.header) return null;
  const model = state.field(syntaxModel);
  let cached = foldBounds.get(model);
  if (!cached) { cached = new Map(); foldBounds.set(model, cached); }
  const known = cached.get(line.from);
  if (known?.tabSize === state.tabSize) return known.range;

  const marker = context.item.getChild('ListMark');
  let end = line.to;
  if (marker) {
    const afterMarker = marker.to - line.from;
    const whitespace = line.text.slice(afterMarker).match(/^[ \t]*/)?.[0] ?? '';
    const contentColumn = countColumn(line.text.slice(context.quoteTo, afterMarker + whitespace.length), state.tabSize);
    const last = state.doc.lineAt(context.item.to).number;
    for (let number = line.number + 1; number <= last; number++) {
      const candidate = state.doc.line(number);
      const body = stripQuotePrefix(candidate.text, context.quoteDepth);
      if (!body.trim()) continue;
      const quotes = candidate.text.match(/^(?: {0,3}> ?)+/)?.[0].match(/>/g)?.length ?? 0;
      const indent = body.match(/^[ \t]*/)?.[0] ?? '';
      if (quotes < context.quoteDepth || countColumn(indent, state.tabSize) < contentColumn) break;
      end = Math.min(candidate.to, context.item.to);
    }
  }
  const range = end > line.to ? { from: line.to, to: end } : null;
  cached.set(line.from, { tabSize: state.tabSize, range });
  return range;
}

/**
 * Measured prefix advances, keyed by line start. They reach the DOM only as
 * line-decoration style attributes, which CodeMirror applies and re-applies on
 * its own tile syncs. Writing the variables as external inline styles made CM's
 * attribute synchronization treat them as foreign DOM edits: each restore armed
 * the next sync to clear them again, so every selection update shifted the
 * text by the prefix advance and back.
 */
interface PrefixWidths { quote: string; list: string }

const setPrefixWidths = StateEffect.define<ReadonlyMap<number, PrefixWidths>>();

export const prefixWidths = StateField.define<{ widths: ReadonlyMap<number, PrefixWidths>; deco: DecorationSet }>({
  create: () => ({ widths: new Map(), deco: Decoration.none }),
  update(value, tr) {
    let widths = value.widths;
    for (const effect of tr.effects) if (effect.is(setPrefixWidths)) widths = effect.value;
    if (tr.docChanged && widths === value.widths) {
      // Follow surviving prefix content, not a deleted line or its preceding newline.
      const mapped = new Map<number, PrefixWidths>();
      for (const [from, w] of widths) {
        const pos = tr.changes.mapPos(from, 1, MapMode.TrackAfter);
        if (pos !== null && tr.newDoc.lineAt(pos).from === pos) mapped.set(pos, w);
      }
      widths = mapped;
    }
    if (widths === value.widths) return value;
    const ranges: Range<Decoration>[] = [];
    for (const [from, w] of widths) ranges.push(Decoration.line({ attributes: {
      style: `--cm-quote-prefix-width:${w.quote};--cm-list-prefix-width:${w.list}`,
    } }).range(from));
    return { widths, deco: ranges.length ? Decoration.set(ranges, true) : Decoration.none };
  },
  provide: (field) => EditorView.decorations.from(field, (value) => value.deco),
});

/** Measure only native prefix boxes, independent of the line's applied indent. */
class ListLayout {
  private selector = '.cm-line[data-prefix-layout]';
  private observer: MutationObserver;
  private destroyed = false;
  constructor(private view: EditorView) {
    this.observer = new MutationObserver(records => {
      if (records.some(record => {
        const target = record.target instanceof Element ? record.target : record.target.parentElement;
        if (target?.closest('.cm-content') !== view.contentDOM) return false;
        if (record.type === 'attributes') return record.attributeName === 'data-prefix-layout';
        // Formula/body changes cannot alter the isolated prefix advance. Only
        // prefix/line insertion, removal or actual prefix content needs a read.
        return target?.closest('.cm-quote-prefix, .cm-list-prefix') ||
          [...record.addedNodes, ...record.removedNodes].some(node => node instanceof Element &&
            (node.matches(this.selector + ', .cm-quote-prefix, .cm-list-prefix') ||
             node.querySelector(this.selector + ', .cm-quote-prefix, .cm-list-prefix')));
      })) this.schedule();
    });
    this.observer.observe(view.contentDOM, { childList: true, characterData: true, subtree: true,
      attributes: true, attributeFilter: ['data-prefix-layout'] });
    this.schedule();
  }
  destroy() {
    this.observer.disconnect();
    this.destroyed = true;
  }
  update(update: ViewUpdate) {
    // Font/geometry changes still invalidate widths; selection-only color
    // changes do not. Widths reach the DOM through the state field above.
    if (update.docChanged || update.viewportChanged || update.geometryChanged) this.schedule();
  }
  private schedule() {
    this.view.requestMeasure({
      key: this,
      read: (view) => {
        const widths = new Map<number, PrefixWidths>();
        for (const line of view.contentDOM.querySelectorAll<HTMLElement>(this.selector)) {
          if (line.closest('.cm-content') !== view.contentDOM) continue;
          let quoteWidth = 0, listWidth = 0;
          for (const prefix of line.querySelectorAll<HTMLElement>('.cm-quote-prefix, .cm-list-prefix')) {
            if (prefix.closest('.cm-line') !== line) continue;
            const width = prefix.getBoundingClientRect().width / view.scaleX;
            if (prefix.classList.contains('cm-quote-prefix')) quoteWidth += width;
            else listWidth += width;
          }
          // Stable subpixel values avoid dispatches caused only by float noise.
          widths.set(Number(line.dataset.prefixLayout), {
            quote: `${Math.round(quoteWidth * 64) / 64}px`,
            list: `${Math.round(listWidth * 64) / 64}px`,
          });
        }
        return widths;
      },
      write: (widths, view) => {
        const current = view.state.field(prefixWidths).widths;
        if (current.size === widths.size && [...widths].every(([from, w]) =>
          current.get(from)?.quote === w.quote && current.get(from)?.list === w.list)) return;
        // Dispatching runs a view update, which is not allowed inside a
        // measure write; the microtask still lands before the next paint.
        const doc = view.state.doc;
        queueMicrotask(() => {
          if (!this.destroyed && view.state.doc === doc) view.dispatch({ effects: setPrefixWidths.of(widths) });
        });
      },
    });
  }
}
export const listLayout = ViewPlugin.fromClass(ListLayout);
