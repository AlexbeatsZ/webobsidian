export interface EventRef {
  owner: Events;
  name: string;
  callback: (...args: any[]) => any;
}
export class Events {
  private handlers = new Map<string, Set<EventRef>>();
  on(name: string, callback: (...args: any[]) => any, ctx?: any): EventRef {
    const ref = {
      owner: this,
      name,
      callback: ctx ? callback.bind(ctx) : callback,
    };
    if (!this.handlers.has(name)) this.handlers.set(name, new Set());
    this.handlers.get(name)!.add(ref);
    return ref;
  }
  off(name: string, callback: Function) {
    for (const ref of this.handlers.get(name) ?? [])
      if (ref.callback === callback) this.offref(ref);
  }
  offref(ref: EventRef) {
    ref.owner.handlers.get(ref.name)?.delete(ref);
  }
  trigger(name: string, ...args: any[]) {
    for (const ref of [...(this.handlers.get(name) ?? [])]) {
      try {
        Promise.resolve(ref.callback(...args)).catch(console.error);
      } catch (error) {
        console.error(error);
      }
    }
  }
  tryTrigger(ref: EventRef, args: any[]) {
    return ref.callback(...args);
  }
}
export class Component {
  private disposers: (() => any)[] = [];
  private children = new Set<Component>();
  private loaded = false;
  private loading?: Promise<void>;
  register(dispose: () => any) {
    this.disposers.push(dispose);
  }
  registerEvent(ref: EventRef) {
    this.register(() => ref.owner.offref(ref));
  }
  registerInterval(id: number) {
    this.register(() => window.clearInterval(id));
    return id;
  }
  registerDomEvent(
    el: EventTarget,
    type: string,
    callback: EventListener,
    options?: any
  ) {
    el.addEventListener(type, callback, options);
    this.register(() => el.removeEventListener(type, callback, options));
  }
  addChild<T extends Component>(child: T): T {
    this.children.add(child);
    if (this.loaded) void child.load().catch(() => {});
    return child;
  }
  removeChild<T extends Component>(child: T): T {
    this.children.delete(child);
    child.unload();
    return child;
  }
  load(): Promise<void> {
    if (this.loading) return this.loading;
    if (this.loaded) return Promise.resolve();
    this.loaded = true;
    return (this.loading = (async () => {
      await this.onload();
      for (const c of this.children) await c.load();
    })());
  }
  unload() {
    if (!this.loaded) return;
    this.loaded = false;
    this.loading = undefined;
    let failure: unknown;
    try {
      this.onunload();
    } finally {
      for (const c of this.children) {
        try {
          c.unload();
        } catch (error) {
          failure ??= error;
        }
      }
      this.children.clear();
      for (const dispose of this.disposers.splice(0).reverse()) {
        try {
          dispose();
        } catch (e) {
          console.error(e);
        }
      }
    }
    if (failure) throw failure;
  }
  onload(): void | Promise<void> {}
  onunload(): void {}
}
