import {
  EditorState,
  StateEffect,
  StateField,
  type Range,
} from '@codemirror/state';
import {
  Decoration,
  EditorView,
  WidgetType,
  ViewPlugin,
  type DecorationSet,
} from '@codemirror/view';
import { blockModel } from '../syntaxModel';
import { livePreviewState, livePreviewReadonly } from '../livePreview';
import { caretTouches, type SourceSpan } from '@webobsidian/markdown-core';
import { forceRendered, sourceIsOpen, sourceButton } from '../sourceControls';
import { contextOf } from '../renderContext';
import { Component } from './events';
import { decorationInputsChanged } from '../decorationDependencies';

export class MarkdownRenderChild extends Component {
  constructor(public containerEl: HTMLElement) {
    super();
  }
}
type Processor = {
  owner: Component;
  callback: (el: HTMLElement, ctx: any) => any;
  sortOrder: number;
};
export const postProcessors = new Set<Processor>();
export const codeProcessors = new Map<string, Processor>();
const refresh = StateEffect.define<void>();
const views = new Set<EditorView>();
export function refreshPluginMarkdown() {
  for (const view of views) view.dispatch({ effects: refresh.of() });
}
export function markdownContext(
  path: string,
  owner: Component,
  section?: { lineStart: number; lineEnd: number; text: string }
) {
  return {
    sourcePath: path,
    docId: path,
    frontmatter: undefined,
    addChild: (child: Component) => {
      owner.addChild(child);
      void child.load();
    },
    getSectionInfo: (_el: HTMLElement) => section ?? null,
  };
}
class CodeWidget extends WidgetType {
  private child?: Component;
  constructor(
    readonly lang: string,
    readonly source: string,
    readonly range: SourceSpan,
    readonly processor: Processor
  ) {
    super();
  }
  eq(other: CodeWidget) {
    return (
      this.lang === other.lang &&
      this.source === other.source &&
      this.processor === other.processor &&
      this.range.from === other.range.from
    );
  }
  toDOM(view: EditorView) {
    const host = document.createElement('div');
    host.className = 'block-language-' + this.lang + ' plugin-code-block';
    host.dataset.renderPending = 'true';
    const content = document.createElement('div');
    host.append(content);
    this.child = new Component();
    void this.child.load();
    const doc = view.state.doc,
      from = doc.lineAt(this.range.from).number - 1,
      to = doc.lineAt(this.range.to).number - 1;
    const ctx = markdownContext(contextOf(view).sourcePath, this.child, {
      lineStart: from,
      lineEnd: to,
      text: doc.toString(),
    });
    Promise.resolve()
      .then(() => this.processor.callback(content, ctx))
      .catch((error) => {
        content.textContent = String(error);
        host.classList.add('mod-error');
      })
      .finally(() => {
        delete host.dataset.renderPending;
        view.requestMeasure();
      });
    // Code processors receive their fenced body, matching Obsidian's contract.
    (ctx as any).source = this.source;
    if (!view.state.readOnly)
      host.append(sourceButton(view, this.range, 'plugin block'));
    return host;
  }
  destroy() {
    this.child?.unload();
  }
  ignoreEvent() {
    return true;
  }
}
function build(state: EditorState): DecorationSet {
  if (!state.field(livePreviewState, false)) return Decoration.none;
  const ro = state.field(livePreviewReadonly, false) ?? false;
  const ranges: Range<Decoration>[] = [];
  for (const block of state.field(blockModel).containers) {
    if (block.kind !== 'code') continue;
    const processor = codeProcessors.get(block.language.toLowerCase());
    if (
      !processor ||
      sourceIsOpen(state, block) ||
      (!forceRendered(state, block) &&
        caretTouches(block, state.selection.ranges, ro))
    )
      continue;
    ranges.push(
      Decoration.replace({
        widget: new CodeWidget(block.language, block.body, block, processor),
        block: true,
      }).range(block.from, block.to)
    );
  }
  return Decoration.set(ranges, true);
}
export const pluginCodeBlocks = StateField.define<DecorationSet>({
  create: build,
  update: (value, tr) => decorationInputsChanged(tr) || !!tr.selection || tr.effects.some((e) => e.is(refresh)) ? build(tr.state) : value,
  provide: (field) => EditorView.decorations.from(field),
});
export const pluginPostProcessing = ViewPlugin.fromClass(
  class {
    observer: MutationObserver;
    pending = false;
    destroyed = false;
    processed = new Map<
      HTMLElement,
      { doc: unknown; viewport: string; children: Component[] }
    >();
    constructor(readonly view: EditorView) {
      views.add(view);
      this.observer = new MutationObserver(() => this.schedule());
      this.observe();
      this.schedule();
    }
    observe() {
      this.observer.observe(this.view.contentDOM, {
        childList: true,
        subtree: true,
        characterData: true,
      });
    }
    schedule() {
      if (this.pending || this.destroyed || !postProcessors.size) return;
      this.pending = true;
      window.setTimeout(() => {
        this.pending = false;
        this.run();
      }, 0);
    }
    run() {
      if (this.destroyed) return;
      this.observer.disconnect();
      // Never hand source-mode text to a rendered-markdown processor.
      const roots = this.view.state.field(livePreviewState, false)
        ? this.view.state.readOnly
          ? [this.view.contentDOM]
          : [
              ...this.view.contentDOM.querySelectorAll<HTMLElement>(
                '.cm-html-block,.plugin-code-block'
              ),
            ]
        : [];
      const viewport = `${this.view.viewport.from}:${this.view.viewport.to}`;
      for (const [root, entry] of this.processed) {
        if (
          !roots.includes(root) ||
          entry.doc !== this.view.state.doc ||
          entry.viewport !== viewport
        ) {
          entry.children.forEach((child) => child.unload());
          this.processed.delete(root);
        }
      }
      for (const root of roots) {
        // Async plugin output also changes the DOM. Do not recreate its render
        // children in response to its own output (e.g. Dataview's React render).
        if (this.processed.has(root)) continue;
        const entry = {
          doc: this.view.state.doc,
          viewport,
          children: [] as Component[],
        };
        this.processed.set(root, entry);
        for (const processor of [...postProcessors].sort(
          (a, b) => a.sortOrder - b.sortOrder
        )) {
          const child = new Component();
          void child.load();
          entry.children.push(child);
          try {
            Promise.resolve(
              processor.callback(
                root,
                markdownContext(contextOf(this.view).sourcePath, child)
              )
            ).catch(console.error);
          } catch (error) {
            console.error(error);
          }
        }
      }
      this.observe();
    }
    update(update: any) {
      const registrationsChanged = update.transactions.some((tr: any) =>
        tr.effects.some((e: any) => e.is(refresh))
      );
      if (registrationsChanged) {
        for (const entry of this.processed.values())
          entry.children.forEach((child) => child.unload());
        this.processed.clear();
      }
      if (update.docChanged || update.viewportChanged || registrationsChanged)
        this.schedule();
    }
    destroy() {
      this.destroyed = true;
      views.delete(this.view);
      this.observer.disconnect();
      for (const entry of this.processed.values())
        entry.children.forEach((child) => child.unload());
      this.processed.clear();
    }
  }
);
export function registerPostProcessor(
  owner: Component,
  callback: Processor['callback'],
  sortOrder = 0
) {
  const processor = { owner, callback, sortOrder };
  postProcessors.add(processor);
  owner.register(() => {
    postProcessors.delete(processor);
    refreshPluginMarkdown();
  });
  refreshPluginMarkdown();
  return processor;
}
export function registerCodeProcessor(
  owner: Component,
  lang: string,
  callback: (source: string, el: HTMLElement, ctx: any) => any,
  sortOrder = 0
) {
  const key = lang.toLowerCase();
  if (codeProcessors.has(key))
    throw new Error(`Markdown processor already registered: ${lang}`);
  const processor: Processor = {
    owner,
    sortOrder,
    callback: (el, ctx) => callback(ctx.source, el, ctx),
  };
  codeProcessors.set(key, processor);
  owner.register(() => {
    if (codeProcessors.get(key) === processor) codeProcessors.delete(key);
    refreshPluginMarkdown();
  });
  refreshPluginMarkdown();
  return processor;
}
