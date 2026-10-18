import { ViewPlugin, type EditorView, type ViewUpdate } from '@codemirror/view';

/** Measure the actual rendered marker (font/widgets included), not a guessed ch width. */
class ListLayout {
  private original = new WeakMap<HTMLElement, { padding: string; indent: string; base: number; classes: string }>();
  private previous = new Set<HTMLElement>();
  constructor(private view: EditorView) { this.schedule(); }
  update(update: ViewUpdate) {
    // Async formula/font layout can rebuild line DOM and discard measured styles.
    if (update.docChanged || update.selectionSet || update.geometryChanged || update.transactions.some((tr) => tr.effects.length)) this.schedule();
  }
  private schedule() {
    this.view.requestMeasure({
      key: this,
      read: (view) => {
        const current = new Set(view.dom.querySelectorAll<HTMLElement>('.cm-line[data-list-body-start]'));
        const reset = [...this.previous].filter((line) => !current.has(line));
        const metrics = [...current].map((line) => {
          const old = this.original.get(line);
          if (old && old.classes !== line.className) return { line, reset: true, width: 0, base: 0 };
          const style = getComputedStyle(line);
          const base = old?.base ?? parseFloat(style.paddingLeft);
          if (!old) this.original.set(line, { padding: line.style.paddingLeft, indent: line.style.textIndent, base, classes: line.className });
          const position = Number(line.dataset.listBodyStart);
          const coordinates = position <= view.state.doc.length ? view.coordsAtPos(position) : null;
          const width = coordinates ? Math.max(0, coordinates.left - line.getBoundingClientRect().left - base - parseFloat(style.borderLeftWidth || '0')) : 0;
          return { line, reset: false, width, base };
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
          const padding = `${metric.base + metric.width}px`, indent = `${-metric.width}px`;
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
