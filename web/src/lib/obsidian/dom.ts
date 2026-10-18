// Obsidian's documented DOM helpers. Define non-enumerably, once per realm.
type Options =
  | string
  | {
      cls?: string | string[];
      text?: string;
      attr?: Record<string, any>;
      parent?: HTMLElement;
      type?: string;
      value?: string;
      title?: string;
    };
const insertionWatchers = new Set<{
  el: Element;
  callback: () => void;
  connected: boolean;
}>();
let insertionObserver: MutationObserver | undefined;
function onNodeInserted(el: Element, callback: () => void) {
  const entry = { el, callback, connected: el.isConnected };
  insertionWatchers.add(entry);
  if (!insertionObserver) {
    insertionObserver = new MutationObserver(() => {
      for (const item of insertionWatchers) {
        const connected = item.el.isConnected;
        if (connected && !item.connected) item.callback();
        item.connected = connected;
      }
    });
    insertionObserver.observe(document, { childList: true, subtree: true });
  }
  if (el.isConnected)
    queueMicrotask(() => {
      if (insertionWatchers.has(entry)) callback();
    });
  return () => {
    insertionWatchers.delete(entry);
    if (!insertionWatchers.size) {
      insertionObserver?.disconnect();
      insertionObserver = undefined;
    }
  };
}
function define(proto: any, name: string, value: any) {
  if (!(name in proto))
    Object.defineProperty(proto, name, {
      value,
      configurable: true,
      writable: true,
    });
}
export function createEl(
  tag: string,
  options?: Options,
  callback?: (el: any) => void
): any {
  const el = document.createElement(tag);
  const opts = typeof options === 'string' ? { cls: options } : (options ?? {});
  if (opts.cls)
    el.classList.add(
      ...(Array.isArray(opts.cls) ? opts.cls : opts.cls.split(/\s+/)).filter(
        Boolean
      )
    );
  if (opts.text !== undefined) el.textContent = opts.text;
  for (const [key, val] of Object.entries(opts.attr ?? {}))
    el.setAttribute(key, String(val));
  for (const key of ['type', 'value', 'title'] as const)
    if (opts[key] !== undefined) (el as any)[key] = opts[key];
  opts.parent?.appendChild(el);
  callback?.(el);
  return el;
}
export const createDiv = (options?: Options, callback?: (el: any) => void) =>
  createEl('div', options, callback);
export const createSpan = (options?: Options, callback?: (el: any) => void) =>
  createEl('span', options, callback);
export function createFragment(
  callback?: (fragment: DocumentFragment) => void
) {
  const fragment = document.createDocumentFragment();
  callback?.(fragment);
  return fragment;
}
export function installDomHelpers() {
  define(Node.prototype, 'empty', function (this: Node) {
    while (this.firstChild) this.removeChild(this.firstChild);
  });
  define(Node.prototype, 'detach', function (this: Node) {
    this.parentNode?.removeChild(this);
  });
  define(Node.prototype, 'appendText', function (this: Node, text: string) {
    this.appendChild(document.createTextNode(text));
  });
  define(Node.prototype, 'setText', function (this: Node, text: string) {
    this.textContent = text;
  });
  define(Node.prototype, 'instanceOf', function (this: Node, type: any) {
    return this instanceof type;
  });
  define(
    Node.prototype,
    'insertAfter',
    function (this: Node, node: Node, after: Node | null) {
      return this.insertBefore(
        node,
        after ? after.nextSibling : this.firstChild
      );
    }
  );
  for (const [key, get] of Object.entries({
    doc: function (this: Node) {
      return this.ownerDocument ?? document;
    },
    win: function (this: Node) {
      return this.ownerDocument?.defaultView ?? window;
    },
  })) {
    if (!(key in Node.prototype))
      Object.defineProperty(Node.prototype, key, { get, configurable: true });
  }
  for (const proto of [Element.prototype, DocumentFragment.prototype]) {
    define(
      proto,
      'createEl',
      function (this: Element, tag: string, opts: Options, cb: any) {
        const el = createEl(tag, opts, cb);
        this.appendChild(el);
        return el;
      }
    );
    for (const [name, tag] of [
      ['createDiv', 'div'],
      ['createSpan', 'span'],
    ])
      define(proto, name, function (this: any, opts: Options, cb: any) {
        return this.createEl(tag, opts, cb);
      });
  }
  const methods: Record<string, Function> = {
    addClass(...classes: string[]) {
      (this as any).classList.add(
        ...classes.flatMap((c) => c.split(/\s+/)).filter(Boolean)
      );
    },
    addClasses(classes: string[]) {
      (this as any).classList.add(...classes);
    },
    removeClasses(classes: string[]) {
      (this as any).classList.remove(...classes);
    },
    removeClass(...classes: string[]) {
      (this as any).classList.remove(
        ...classes.flatMap((c) => c.split(/\s+/)).filter(Boolean)
      );
    },
    toggleClass(cls: string, value: boolean) {
      (this as any).classList.toggle(cls, value);
    },
    hasClass(cls: string) {
      return (this as any).classList.contains(cls);
    },
    setAttr(key: string, value: any) {
      if (value === null) (this as any).removeAttribute(key);
      else (this as any).setAttribute(key, String(value));
    },
    setAttrs(attrs: any) {
      for (const key in attrs) (this as any).setAttr(key, attrs[key]);
    },
    getAttr(key: string) {
      return (this as any).getAttribute(key);
    },
    setCssProps(props: any) {
      for (const key in props) (this as any).style.setProperty(key, props[key]);
    },
    setCssStyles(styles: any) {
      Object.assign((this as any).style, styles);
    },
    find(selector: string) {
      return (this as any).querySelector(selector);
    },
    findAll(selector: string) {
      return [...(this as any).querySelectorAll(selector)];
    },
    findAllSelf(selector: string) {
      return [
        ...((this as any).matches(selector) ? [this] : []),
        ...(this as any).querySelectorAll(selector),
      ];
    },
    findSelf(selector: string) {
      return (this as any).matches(selector)
        ? this
        : (this as any).querySelector(selector);
    },
    matchParent(selector: string) {
      return (this as any).closest(selector);
    },
    hide() {
      (this as any).style.display = 'none';
    },
    show() {
      (this as any).style.display = '';
    },
    toggle(value: boolean) {
      (this as any).style.display = value ? '' : 'none';
    },
    isShown() {
      return (this as any).getClientRects().length > 0;
    },
    onNodeInserted(callback: () => void) {
      return onNodeInserted(this as any, callback);
    },
    on(type: string, selector: string, cb: Function, options: any) {
      (this as any).addEventListener(
        type,
        (evt: Event) => {
          const target = (evt.target as Element).closest?.(selector);
          if (target && (this as any).contains(target)) cb(evt, target);
        },
        options
      );
    },
  };
  for (const [name, method] of Object.entries(methods))
    define(Element.prototype, name, method);
  define(Array.prototype, 'contains', Array.prototype.includes);
  define(Array.prototype, 'first', function (this: any[]) {
    return this[0];
  });
  define(Array.prototype, 'last', function (this: any[]) {
    return this[this.length - 1];
  });
  define(Array.prototype, 'remove', function (this: any[], item: any) {
    let at;
    while ((at = this.indexOf(item)) >= 0) this.splice(at, 1);
  });
  define(Array.prototype, 'unique', function (this: any[]) {
    return [...new Set(this)];
  });
  define(String.prototype, 'contains', String.prototype.includes);
  define(String.prototype, 'format', function (this: string, ...args: any[]) {
    return this.replace(/\{(\d+)\}/g, (_, n) => args[n] ?? '');
  });
  define(Math, 'clamp', (n: number, a: number, b: number) =>
    Math.max(a, Math.min(n, b))
  );
  define(Object, 'isEmpty', (v: object) => Object.keys(v).length === 0);
  Object.assign(window, {
    createEl,
    createDiv,
    createSpan,
    createFragment,
    activeDocument: document,
    activeWindow: window,
  });
}
