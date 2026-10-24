import { type EditorView, type TooltipView, type ViewUpdate } from '@codemirror/view';
import { renderMath, readMathMetrics, subscribeMathConfiguration, type MathMetrics } from './mathjax';

/** Cursor and reference previews share the MathJax/measurement/abort lifecycle. */
export function createMathTooltip(view: EditorView, tex: string, options: {
  display: boolean; sourcePath: string; definitions: readonly string[]; above?: boolean;
}): TooltipView {
  const dom = document.createElement('div');
  dom.className = 'cm-tooltip-cursor' + (options.above === undefined ? '' : options.above ? ' cm-tooltip-above' : ' cm-tooltip-below');
  const body = document.createElement('div'); body.className = 'cm-math-tooltip-body';
  body.textContent = '正在渲染…'; dom.appendChild(body);
  let controller = new AbortController(), previous: MathMetrics | undefined;
  let invalid = true, destroyed = false;
  const render = (force = false) => {
    invalid ||= force;
    view.requestMeasure({ key: dom, read: () => {
      if (destroyed || !dom.isConnected || !view.contentDOM.clientWidth) return;
      const metrics = readMathMetrics(body, view.contentDOM);
      if (!invalid && previous?.em === metrics.em && previous.containerWidth === metrics.containerWidth && previous.family === metrics.family) return;
      return metrics;
    }, write: metrics => {
      if (!metrics || destroyed || !dom.isConnected) return;
      previous = metrics; invalid = false;
      controller.abort(); controller = new AbortController();
      const signal = controller.signal;
      void renderMath(body, tex, options.display, signal, {
        transient: true, sourcePath: options.sourcePath, definitions: options.definitions, metrics,
      }).catch(() => { if (!signal.aborted) body.textContent = '无法渲染公式'; });
    } });
  };
  let stop = () => {};
  return { dom, mount() { stop = subscribeMathConfiguration(() => render(true)); render(); },
    update(update: ViewUpdate) { if (update.geometryChanged) render(); },
    destroy() { destroyed = true; controller.abort(); stop(); } };
}
