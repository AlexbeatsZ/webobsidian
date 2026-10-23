import type { App } from '../obsidian/runtime';
import { Component } from '../obsidian/events';
import { nonExecutingContext, type RenderContext } from '../renderContext';
import { documents } from '../documents';

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
  assertActive() { if (this.disposed) throw new DOMException('JavaScript 运行已释放', 'AbortError'); }
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
    if (!mount) throw new Error('Markdown 片段渲染不可用');
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
