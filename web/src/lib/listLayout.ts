import { ViewPlugin, type EditorView, type ViewUpdate } from '@codemirror/view';
import { countColumn, type EditorState, type Line } from '@codemirror/state';
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

/** Measure only native prefix boxes, independent of the line's applied indent. */
class ListLayout {
  private selector = '.cm-line[data-prefix-layout]';
  private observer: MutationObserver;
  private previous = new Set<HTMLElement>();
  constructor(private view: EditorView) {
    this.observer = new MutationObserver(records => {
      if (records.some(record => {
        const target = record.target instanceof Element ? record.target : record.target.parentElement;
        if (target?.closest('.cm-content') !== view.contentDOM) return false;
        if (record.type === 'attributes') {
          if (record.attributeName === 'data-prefix-layout') return true;
          // CM may clear external inline properties when it reuses a line.
          // Ignore our own writes once both values are present.
          return target?.matches(this.selector) && record.attributeName === 'style' &&
            (!(target as HTMLElement).style.getPropertyValue('--cm-quote-prefix-width') ||
             !(target as HTMLElement).style.getPropertyValue('--cm-list-prefix-width'));
        }
        // Formula/body changes cannot alter the isolated prefix advance. Only
        // prefix/line insertion, removal or actual prefix content needs a read.
        return target?.closest('.cm-quote-prefix, .cm-list-prefix') ||
          [...record.addedNodes, ...record.removedNodes].some(node => node instanceof Element &&
            (node.matches(this.selector + ', .cm-quote-prefix, .cm-list-prefix') ||
             node.querySelector(this.selector + ', .cm-quote-prefix, .cm-list-prefix')));
      })) this.schedule();
    });
    this.observer.observe(view.contentDOM, { childList: true, characterData: true, subtree: true,
      attributes: true, attributeFilter: ['data-prefix-layout', 'style'] });
    this.schedule();
  }
  destroy() {
    this.observer.disconnect();
    for (const line of this.previous) {
      line.style.removeProperty('--cm-quote-prefix-width');
      line.style.removeProperty('--cm-list-prefix-width');
    }
  }
  update(update: ViewUpdate) {
    // Font/geometry changes still invalidate widths; selection-only color
    // changes do not. All reads/writes stay in the existing coalesced measure.
    if (update.docChanged || update.viewportChanged || update.geometryChanged) this.schedule();
  }
  private schedule() {
    this.view.requestMeasure({
      key: this,
      read: (view) => {
        const current = new Set([...view.contentDOM.querySelectorAll<HTMLElement>(this.selector)]
          .filter(line => line.closest('.cm-content') === view.contentDOM));
        const reset = [...this.previous].filter(line => !current.has(line));
        const metrics = [...current].map(line => {
          let quoteWidth = 0, listWidth = 0;
          for (const prefix of line.querySelectorAll<HTMLElement>('.cm-quote-prefix, .cm-list-prefix')) {
            if (prefix.closest('.cm-line') !== line) continue;
            const width = prefix.getBoundingClientRect().width / view.scaleX;
            if (prefix.classList.contains('cm-quote-prefix')) quoteWidth += width;
            else listWidth += width;
          }
          // Stable subpixel values avoid writes caused only by float noise.
          return { line, quote: `${Math.round(quoteWidth * 64) / 64}px`, list: `${Math.round(listWidth * 64) / 64}px` };
        });
        return { current, reset, metrics };
      },
      write: ({ current, reset, metrics }) => {
        for (const line of reset) {
          line.style.removeProperty('--cm-quote-prefix-width');
          line.style.removeProperty('--cm-list-prefix-width');
        }
        for (const { line, quote, list } of metrics) {
          if (line.style.getPropertyValue('--cm-quote-prefix-width') !== quote) line.style.setProperty('--cm-quote-prefix-width', quote);
          if (line.style.getPropertyValue('--cm-list-prefix-width') !== list) line.style.setProperty('--cm-list-prefix-width', list);
        }
        this.previous = current;
      },
    });
  }
}
export const listLayout = ViewPlugin.fromClass(ListLayout);
