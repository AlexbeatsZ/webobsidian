import type { App } from '../obsidian/runtime';
import { Component } from '../obsidian/events';
import { registerCodeProcessor, type CodeBlockContext } from '../obsidian/markdown';
import { nonExecutingContext, type RenderContext } from '../renderContext';
import { documents } from '../documents';
import { executableSource } from './directive';
import { compileJavascript } from './execute';
import { createWidgets } from './widgets';
import type { ChartOptions } from './charts';
import type { EChartsOption } from 'echarts';
import './styles.css';

type Charts = typeof import('./charts');
let chartLoading: Promise<Charts> | undefined;
const loadCharts = () => chartLoading ??= import('./charts').catch(error => { chartLoading = undefined; throw error; });

/** One run owns everything it creates, including resources registered after await. */
export class JavascriptRun extends Component {
  private disposed = false;
  private abort = new AbortController();
  private paths = new Set<string>();
  private directories = new Set<string>();
  private observing = false;
  private versions = new Map<string, number>();
  readonly signal = this.abort.signal;
  readonly component = this;
  get sourcePath() { return this.context.sourcePath; }
  get containerEl() { return this.container; }
  constructor(readonly app: App, readonly container: HTMLElement, readonly context: RenderContext,
    private invalidate: () => void, private measure: () => void) { super(); }

  override register(cleanup: () => any) { if (this.disposed) { try { cleanup(); } catch (error) { console.error(error); } } else super.register(cleanup); }
  override addChild<T extends Component>(child: T): T {
    if (this.disposed) { child.unload(); return child; }
    return super.addChild(child);
  }
  onunload() { this.disposed = true; this.abort.abort(); this.container.remove(); }
  assertActive() { if (this.disposed) throw new DOMException('JavaScript run was disposed', 'AbortError'); }
  onCleanup = (cleanup: () => void) => this.register(cleanup);
  watch = (path: string) => {
    this.assertActive(); path = path.replace(/\\/g, '/').replace(/^\.\//, '');
    if (!this.paths.has(path)) {
      const version = documents.get(path)?.snapshot.version;
      if (version !== undefined) this.versions.set(path, version);
      this.paths.add(path);
    }
    this.observe();
  };
  watchDirectory(path: string) { this.assertActive(); this.directories.add(path); this.observe(); }
  private observe() {
    if (this.observing) return;
    this.observing = true;
    const matches = (path: string, structural: boolean) => this.paths.has(path) || (structural && [...this.directories].some(dir => !dir || path === dir || path.startsWith(dir + '/')));
    this.register(documents.subscribe(snapshot => {
      if (!this.paths.has(snapshot.id)) return;
      const prior = this.versions.get(snapshot.id);
      this.versions.set(snapshot.id, snapshot.version);
      if (prior !== snapshot.version && matches(snapshot.id, false)) this.invalidate();
    }));
    for (const event of ['modify', 'create', 'delete', 'rename']) this.registerEvent(this.app.vault.on(event, (file: { path: string }, oldPath?: string) => {
      if (!(matches(file.path, event !== 'modify') || (oldPath && matches(oldPath, true)))) return;
      if (event === 'modify' && this.paths.has(file.path) && documents.get(file.path)) {
        // Refresh existing sessions once across subscribers; preserve dirty/conflict state.
        void documents.refresh(file.path).then(this.invalidate, this.invalidate);
      } else this.invalidate();
    }));
  }
  async note(path: string) {
    this.watch(path);
    const note = documents.get(path) ?? await documents.open(path);
    this.assertActive();
    this.versions.set(path, note.snapshot.version);
    return note;
  }
  async renderMarkdown(markdown: string, target = this.container, context = this.context) {
    this.assertActive();
    const mount = this.context.mountFragment;
    if (!mount) throw new Error('Markdown fragment rendering is unavailable');
    // Register immediately, even if disposal happens before React reports ready.
    await new Promise<void>(resolve => {
      const done = () => { this.signal.removeEventListener('abort', done); resolve(); };
      this.signal.addEventListener('abort', done, { once: true });
      this.register(mount(target, markdown, { id: context.sourcePath, context: nonExecutingContext(context), onReady: () => { this.measure(); done(); } }));
    });
    this.assertActive();
  }
  targetContext(path: string): Promise<RenderContext> {
    if (path === this.sourcePath) return Promise.resolve(this.context);
    return this.context.renderEmbed(path, this.signal).then(note => {
      this.assertActive();
      if (!note) throw new Error(`Cannot resolve note: ${path}`);
      return note.context;
    });
  }
}

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
