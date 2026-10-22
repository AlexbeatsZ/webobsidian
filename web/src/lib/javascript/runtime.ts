import type { App } from '../obsidian/runtime';
import { Component } from '../obsidian/events';
import { registerCodeProcessor, type CodeBlockContext } from '../obsidian/markdown';
import { JavascriptRun } from './lifetime';
export { JavascriptRun } from './lifetime';

import { executableSource } from './directive';
import { compileJavascript } from './execute';
import { createWidgets } from './widgets';
import type { ChartOptions } from './charts';
import type { EChartsOption } from 'echarts';
import './styles.css';

type Charts = typeof import('./charts');
let chartLoading: Promise<Charts> | undefined;
const loadCharts = () => chartLoading ??= import('./charts').catch(error => { chartLoading = undefined; throw error; });

class JavascriptBlock extends Component {
  private disposed = false;
  private timer?: number;
  private run?: JavascriptRun;
  private execute?: (...args: any[]) => Promise<unknown>;
  private error?: HTMLElement;
  private button: HTMLButtonElement;
  constructor(private app: App, private source: string, private host: HTMLElement, private ctx: CodeBlockContext) {
    super();
    host.classList.add('interactive-js-render');
    const toolbar = host.ownerDocument.createElement('div'); toolbar.className = 'interactive-js-toolbar';
    this.button = host.ownerDocument.createElement('button'); this.button.type = 'button'; this.button.textContent = '重新运行';
    this.button.addEventListener('click', () => { void this.render(); });
    toolbar.append(this.button); host.append(toolbar);
  }
  onload() { return this.render(); }
  onunload() { this.disposed = true; window.clearTimeout(this.timer); this.error?.remove(); }
  private schedule = () => {
    if (this.disposed || this.timer !== undefined) return;
    this.timer = window.setTimeout(() => { this.timer = undefined; void this.render(); }, 80);
  };
  private async render() {
    if (this.disposed || this.ctx.signal.aborted) return;
    window.clearTimeout(this.timer); this.timer = undefined;
    this.error?.remove(); this.error = undefined;
    if (this.run) this.removeChild(this.run);
    const output = this.host.ownerDocument.createElement('div'); output.className = 'interactive-js-output'; this.host.append(output);
    const run = new JavascriptRun(this.app, output, this.ctx.renderContext, this.schedule, this.ctx.requestMeasure);
    this.run = this.addChild(run); void run.load();
    this.host.dataset.renderPending = 'true'; this.host.setAttribute('aria-busy', 'true');
    try {
      this.execute ??= compileJavascript(this.source,
        ['app', 'container', 'sourcePath', 'component', 'echarts', 'chart', 'widgets', 'watch', 'onCleanup', 'renderMarkdown', 'signal'],
        'webobsidian-js/' + encodeURIComponent(this.ctx.sourcePath));
      const charts = await loadCharts(); run.assertActive();
      await this.execute(this.app, output, run.sourcePath, run, charts.echarts,
        (option: EChartsOption, options?: ChartOptions) => { run.assertActive(); return charts.chart(output, run.onCleanup, option, options); },
        createWidgets(run), run.watch, run.onCleanup, run.renderMarkdown.bind(run), run.signal);
    } catch (error) {
      if (!run.signal.aborted) {
        // Dispose partial output as well as charts/observers created before errors.
        this.removeChild(run);
        const pre = this.host.ownerDocument.createElement('pre'); pre.className = 'interactive-js-error';
        pre.textContent = error instanceof Error ? error.stack ?? error.message : String(error);
        this.host.append(pre); this.error = pre;
      }
    } finally {
      if (!this.disposed && this.run === run) {
        delete this.host.dataset.renderPending; this.host.removeAttribute('aria-busy'); this.ctx.requestMeasure();
      }
    }
  }
}

/** Called by application bootstrap with the existing app, never imported back. */
export function installJavascript(app: App): () => void {
  const owner = new Component(); void owner.load();
  for (const language of ['js-widget', 'javascript-widget', 'js', 'javascript']) {
    const dedicated = language.endsWith('-widget');
    registerCodeProcessor(owner, language, (source, element, context: CodeBlockContext) => {
      const block = new JavascriptBlock(app, executableSource(source, dedicated)!, element, context);
      context.addChild(block);
      return block.load();
    }, 0, { scope: 'script', accepts: source => executableSource(source, dedicated) !== null });
  }
  return () => owner.unload();
}
