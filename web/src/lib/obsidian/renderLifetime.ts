import { Component } from './events';

/** A render instance ends permanently; the public Component remains reloadable. */
export class RenderLifetime extends Component {
  private disposed = false;
  private controller = new AbortController();
  readonly signal = this.controller.signal;
  assertActive() { if (this.disposed) throw new DOMException('渲染任务已释放', 'AbortError'); }
  override register(cleanup: () => any) {
    if (this.disposed) { try { cleanup(); } catch (error) { console.error(error); } }
    else super.register(cleanup);
  }
  override addChild<T extends Component>(child: T): T {
    if (this.disposed) { child.unload(); return child; }
    return super.addChild(child);
  }
  override load(): Promise<void> { return this.disposed ? Promise.resolve() : super.load(); }
  override unload() {
    this.disposed = true;
    this.controller.abort();
    super.unload();
  }
}
