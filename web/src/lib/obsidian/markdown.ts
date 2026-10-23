import {
  EditorState,
  StateEffect,
  StateField,
  type Range,
  type Transaction,
} from '@codemirror/state';
import {
  Decoration,
  EditorView,
  WidgetType,
  ViewPlugin,
  type DecorationSet,
} from '@codemirror/view';
import { blockModel } from '../syntaxModel';
import { livePreviewState, livePreviewReadonly } from '../renderState';
import { caretTouches, type SourceSpan } from '@webobsidian/markdown-core';
import { forceRendered, sourceIsOpen, sourceButton } from '../sourceControls';
import { compositionSelection } from '../editorSelection';
import { contextOf, renderContext, type RenderContext } from '../renderContext';
import { Component } from './events';
import { decorationInputsChanged } from '../decorationDependencies';
import { blockEffectOwns } from '../blocks/model';

export class MarkdownRenderChild extends Component {
  constructor(public containerEl: HTMLElement) {
    super();
  }
}
type Processor = {
  owner: Component;
  callback: (el: HTMLElement, ctx: any) => any;
  sortOrder: number;
  scope?: 'script';
  accepts?: (source: string) => boolean;
};
export interface CodeBlockContext {
  sourcePath: string;
  source: string;
  renderContext: RenderContext;
  signal: AbortSignal;
  requestMeasure: () => void;
  addChild: <T extends Component>(child: T) => T;
  getSectionInfo: (el?: HTMLElement) => { lineStart: number; lineEnd: number; text: string };
}
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
      return child;
    },
    getSectionInfo: (_el: HTMLElement) => section ?? null,
  };
}
type BlockIdentity = { range: SourceSpan };
const mounts = new WeakMap<HTMLElement, { child: Component; controller: AbortController }>();
class CodeWidget extends WidgetType {
  constructor(
    readonly lang: string,
    readonly source: string,
    readonly identity: BlockIdentity,
    readonly processor: Processor,
    readonly sourcePath: string,
    readonly readonly: boolean,
  ) {
    super();
  }
  eq(other: CodeWidget) {
    return (
      this.lang === other.lang &&
      this.source === other.source &&
      this.processor === other.processor &&
      this.identity === other.identity &&
      this.sourcePath === other.sourcePath && this.readonly === other.readonly
    );
  }
  toDOM(view: EditorView) {
    const host = document.createElement('div');
    host.className = 'block-language-' + this.lang + (this.processor.scope === 'script' ? ' native-js-code-block' : ' plugin-code-block');
    host.dataset.renderPending = 'true';
    const content = document.createElement('div');
    host.append(content);
    const child = new Component(), controller = new AbortController();
    mounts.set(host, { child, controller });
    void child.load();
    const ctx = {
      ...markdownContext(this.sourcePath, child),
      source: this.source,
      get renderContext() { return contextOf(view); },
      signal: controller.signal,
      addChild: <T extends Component>(component: T): T => {
        if (controller.signal.aborted) { component.unload(); return component; }
        child.addChild(component); void component.load(); return component;
      },
      requestMeasure: () => { if (!controller.signal.aborted) view.requestMeasure(); },
      getSectionInfo: () => ({
        lineStart: view.state.doc.lineAt(this.identity.range.from).number - 1,
        lineEnd: view.state.doc.lineAt(this.identity.range.to).number - 1,
        text: view.state.doc.toString(),
      }),
    };
    Promise.resolve()
      .then(() => { if (!controller.signal.aborted) return this.processor.callback(content, ctx); })
      .catch((error) => {
        if (controller.signal.aborted) return;
        content.textContent = String(error);
        host.classList.add('mod-error');
      })
      .finally(() => {
        if (!controller.signal.aborted) { delete host.dataset.renderPending; view.requestMeasure(); }
      });
    // Code processors receive their fenced body, matching Obsidian's contract.
    if (!view.state.readOnly)
      host.append(sourceButton(view, () => this.identity.range, 'code block'));
    return host;
  }
  destroy(dom: HTMLElement) {
    const mount = mounts.get(dom);
    mount?.controller.abort();
    mount?.child.unload();
    mounts.delete(dom);
  }
  ignoreEvent() {
    return true;
  }
}
function build(state: EditorState, previous?: DecorationSet, tr?: Transaction): DecorationSet {
  if (!state.field(livePreviewState, false)) return Decoration.none;
  const ro = state.field(livePreviewReadonly, false) ?? false;
  const ranges: Range<Decoration>[] = [];
  const prior = new Map<string, CodeWidget>();
  previous?.between(0, tr?.startState.doc.length ?? state.doc.length, (from, to, decoration) => {
    const widget = decoration.spec.widget;
    if (widget instanceof CodeWidget) {
      const mappedFrom = tr?.changes.mapPos(from, 1) ?? from;
      const mappedTo = tr?.changes.mapPos(to, -1) ?? to;
      prior.set(`${mappedFrom}:${mappedTo}`, widget);
    }
  });
  const context = state.facet(renderContext);
  for (const block of state.field(blockModel).containers) {
    if (block.kind !== 'code') continue;
    if (blockEffectOwns(state, block)) continue;
    const processor = codeProcessors.get(block.language.toLowerCase());
    if (
      !processor ||
      (processor.scope === 'script' && !block.closed) ||
      !(processor.scope === 'script' ? context.allowScriptExecution : context.allowPlugins) ||
      (processor.accepts && !processor.accepts(block.body)) ||
      sourceIsOpen(state, block) ||
      (!forceRendered(state, block) &&
        caretTouches(block, state.field(compositionSelection).selection.ranges, ro))
    )
      continue;
    const old = prior.get(`${block.from}:${block.to}`);
    const identity = old?.source === block.body && old.lang === block.language && old.processor === processor &&
      old.sourcePath === context.sourcePath && old.readonly === state.readOnly ? old.identity : { range: block };
    identity.range = block;
    ranges.push(
      Decoration.replace({
        widget: new CodeWidget(block.language, block.body, identity, processor, context.sourcePath, state.readOnly),
        block: true,
      }).range(block.from, block.to)
    );
  }
  return Decoration.set(ranges, true);
}
const codeBlockViews = ViewPlugin.fromClass(class {
  constructor(readonly view: EditorView) { views.add(view); }
  destroy() { views.delete(this.view); }
});
export const codeBlocks = StateField.define<DecorationSet>({
  create: build,
  update: (value, tr) => decorationInputsChanged(tr) || tr.startState.facet(renderContext) !== tr.state.facet(renderContext) || tr.effects.some((e) => e.is(refresh)) ? build(tr.state, value, tr) : value,
  provide: (field) => [EditorView.decorations.from(field), codeBlockViews],
});
export const pluginCodeBlocks = codeBlocks;
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
  sortOrder = 0,
  options: Pick<Processor, 'scope' | 'accepts'> = {},
) {
  const key = lang.toLowerCase();
  if (codeProcessors.has(key))
    throw new Error(`Markdown processor already registered: ${lang}`);
  const processor: Processor = {
    ...options,
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
