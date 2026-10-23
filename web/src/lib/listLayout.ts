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

/** Measure the actual rendered marker (font/widgets included), not a guessed ch width. */
class ListLayout {
  private selector = '.cm-line[data-list-body-start], .cm-line[data-quote-prefix-end]';
  private observer: MutationObserver;
  private original = new WeakMap<HTMLElement, { padding: string; indent: string; base: number; classes: string }>();
  private previous = new Set<HTMLElement>();
  constructor(private view: EditorView) {
    this.observer = new MutationObserver(records => {
      // Selection/effect updates need no measurement unless they actually replace
      // list DOM or reveal a marker. Ignore our own measured inline styles.
      if (records.some(record => {
        const target = record.target instanceof Element ? record.target : record.target.parentElement;
        if (target?.closest('.cm-content') !== view.contentDOM) return false;
        if (record.attributeName === 'class' && target?.matches('.cm-quote-prefix')) return false;
        if (record.attributeName === 'data-list-body-start' || record.attributeName === 'data-quote-prefix-end') return true;
        return target?.closest(this.selector) || [...record.addedNodes, ...record.removedNodes].some(node =>
          node instanceof Element && (node.matches(this.selector) || node.querySelector(this.selector)));
      })) this.schedule();
    });
    this.observer.observe(view.contentDOM, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'data-list-body-start', 'data-quote-prefix-end'] });
    this.schedule();
  }
  destroy() { this.observer.disconnect(); }
  update(update: ViewUpdate) {
    // Async formula/font layout can rebuild line DOM and discard measured styles.
    if (update.docChanged || update.viewportChanged || update.geometryChanged) this.schedule();
  }
  private schedule() {
    this.view.requestMeasure({
      key: this,
      read: (view) => {
        const current = new Set([...view.contentDOM.querySelectorAll<HTMLElement>(this.selector)]
          .filter(line => line.closest('.cm-content') === view.contentDOM));
        const reset = [...this.previous].filter((line) => !current.has(line));
        const metrics = [...current].map((line) => {
          const old = this.original.get(line);
          if (old && old.classes !== line.className) return { line, reset: true, width: 0, quoteWidth: 0, base: 0 };
          const style = getComputedStyle(line);
          const base = old?.base ?? parseFloat(style.paddingLeft);
          if (!old) this.original.set(line, { padding: line.style.paddingLeft, indent: line.style.textIndent, base, classes: line.className });
          const quoteEnd = Number(line.dataset.quotePrefixEnd);
          const position = Number(line.dataset.listBodyStart ?? line.dataset.quotePrefixEnd);
          const start = view.coordsAtPos(view.posAtDOM(line), 1);
          const coordinates = position <= view.state.doc.length ? view.coordsAtPos(position) : null;
          const quoteCoordinates = quoteEnd <= view.state.doc.length ? view.coordsAtPos(quoteEnd) : null;
          const width = coordinates && start ? Math.max(0, coordinates.left - start.left) : 0;
          const quoteWidth = quoteCoordinates && start ? Math.max(0, quoteCoordinates.left - start.left) : 0;
          return { line, reset: false, width, quoteWidth, base };
        });
        return { current, reset, metrics };
      },
      write: ({ current, reset, metrics }) => {
        let again = false;
        const restore = (line: HTMLElement) => {
          const original = this.original.get(line);
          if (original) { line.style.paddingLeft = original.padding; line.style.textIndent = original.indent; }
          this.original.delete(line);
        };
        reset.forEach(restore);
        for (const metric of metrics) {
          if (metric.reset) { restore(metric.line); again = true; continue; }
          const padding = `${metric.base + metric.width - metric.quoteWidth}px`, indent = `${-metric.width}px`;
          if (metric.line.style.paddingLeft !== padding) metric.line.style.paddingLeft = padding;
          if (metric.line.style.textIndent !== indent) metric.line.style.textIndent = indent;
        }
        this.previous = current;
        if (again) this.schedule();
      },
    });
  }
}
export const listLayout = ViewPlugin.fromClass(ListLayout);
