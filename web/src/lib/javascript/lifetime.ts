import type { App } from '../obsidian/runtime';
import { RenderLifetime } from '../obsidian/renderLifetime';
import { nonExecutingContext, type RenderContext } from '../renderContext';
import { documents } from '../documents';

/** One run owns everything it creates, including resources registered after await. */
export class JavascriptRun extends RenderLifetime {
  private paths = new Set<string>();
  private directories = new Set<string>();
  private observing = false;
  private versions = new Map<string, number>();
  readonly component = this;
  get sourcePath() { return this.context.sourcePath; }
  get containerEl() { return this.container; }
  constructor(readonly app: App, readonly container: HTMLElement, readonly context: RenderContext,
    private invalidate: () => void, private measure: () => void) { super(); }

  onunload() { this.container.remove(); }
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
      // Disk synchronization belongs to DocumentRegistry before the Vault event.
      this.invalidate();
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
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const clear = () => {
        if (settled) return false;
        settled = true; this.signal.removeEventListener('abort', done); return true;
      };
      const done = () => { if (clear()) resolve(); };
      const failed = (error: unknown) => { if (clear()) reject(error); };
      this.signal.addEventListener('abort', done, { once: true });
      try {
        this.register(mount(target, markdown, { id: context.sourcePath, context: nonExecutingContext(context),
          onReady: () => { if (settled || this.signal.aborted) return; this.measure(); done(); }, onError: failed }));
      } catch (error) { failed(error); }
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
