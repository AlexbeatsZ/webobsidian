import { EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view';
import { Transaction } from '@codemirror/state';
import { recordDebug, registerDebugView, debugEnabled, debugText, debugSource, debugError, captureDebug } from './debug';
import { renderContext } from './renderContext';
import { syntaxModel, blockModel } from './syntaxModel';
import { sourceRegion, forcedRenderedRegion } from './sourceControls';
import { compositionSelection } from './editorSelection';
import { livePreviewPlugin, livePreviewState, livePreviewReadonly } from './livePreview';

let nextView = 0;
class EditorDebug {
  readonly id = ++nextView;
  private stop: () => void;
  private destroyed = false;
  constructor(private view: EditorView) {
    recordDebug('editor.create', { view: this.id, path: view.state.facet(renderContext).sourcePath });
    this.stop = registerDebugView(reason => this.capture(reason));
    // CM plugin construction is not a settled render; inspect after it completes.
    queueMicrotask(() => { if (!this.destroyed) this.capture('ready'); });
  }
  private state() {
    const state = this.view.state, model = state.field(syntaxModel), blocks = state.field(blockModel);
    return { view: this.id, path: state.facet(renderContext).sourcePath, version: model.version,
      length: state.doc.length, lines: state.doc.lines, selection: state.selection.toJSON(),
      composing: this.view.composing, composition: state.field(compositionSelection).active,
      frozenSelection: state.field(compositionSelection).selection.toJSON(),
      focused: this.view.hasFocus, readonly: state.readOnly, live: state.field(livePreviewState), reading: state.field(livePreviewReadonly),
      source: state.field(sourceRegion), forced: state.field(forcedRenderedRegion),
      livePlugin: Boolean(this.view.plugin(livePreviewPlugin)), viewport: this.view.viewport,
      math: blocks.mathRanges.filter(range => range.from <= state.selection.main.to && range.to >= state.selection.main.from).map(range => ({ from: range.from, to: range.to, kind: range.kind, block: range.block, closed: range.closed })),
    };
  }
  capture(reason: string) {
    if (!debugEnabled() || this.destroyed) return;
    try {
      const state = this.state(), view = this.view;
      const rect = (element: Element) => { const r = element.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; };
      recordDebug('editor.snapshot', { ...state, reason, document: debugText(view.state.doc.toString()),
        scroll: { top: view.scrollDOM.scrollTop, left: view.scrollDOM.scrollLeft, width: view.scrollDOM.clientWidth, height: view.scrollDOM.clientHeight },
        content: rect(view.contentDOM), font: getComputedStyle(view.contentDOM).font,
        nodes: [...view.contentDOM.querySelectorAll('.cm-line,.cm-math,.cm-math-rendered,.md-callout-title,.cm-prefixed-block')].filter(el => {
          const r = el.getBoundingClientRect(), v = view.scrollDOM.getBoundingClientRect(); return r.bottom >= v.top && r.top <= v.bottom;
        }).slice(0, 40).map(el => ({ class: el.className, rect: rect(el), ...(debugSource() ? { text: el.textContent?.slice(0, 500) } : {}),
          pending: el.querySelectorAll('[data-render-pending]').length,
          font: getComputedStyle(el).font, lineHeight: getComputedStyle(el).lineHeight })),
      });
    } catch (error) { recordDebug('editor.snapshot.error', { view: this.id, reason, ...debugError(error) }); }
  }
  update(update: ViewUpdate) {
    if (!debugEnabled()) return;
    for (const tr of update.transactions) {
      if (!tr.docChanged && !tr.selection && !tr.effects.length) continue;
      const changes: unknown[] = [];
      tr.changes.iterChanges((from, to, fromB, toB, inserted) => changes.push({ from, to, fromB, toB, inserted: debugText(inserted.toString()) }));
      recordDebug('editor.transaction', { ...this.state(), changes, userEvent: tr.annotation(Transaction.userEvent),
        effectCount: tr.effects.length, docChanged: tr.docChanged, selectionSet: Boolean(tr.selection),
        effects: { source: tr.startState.field(sourceRegion) !== tr.state.field(sourceRegion),
          rendered: tr.startState.field(forcedRenderedRegion) !== tr.state.field(forcedRenderedRegion),
          mode: tr.startState.field(livePreviewState) !== tr.state.field(livePreviewState) || tr.startState.field(livePreviewReadonly) !== tr.state.field(livePreviewReadonly) } });
    }
  }
  destroy() { recordDebug('editor.destroy', { view: this.id, path: this.view.state.facet(renderContext).sourcePath }); this.destroyed = true; this.stop(); }
}
const plugin = ViewPlugin.fromClass(EditorDebug);
function input(event: Event, view: EditorView) {
  if (!debugEnabled()) return;
  const key = event instanceof KeyboardEvent ? event : undefined;
  const data = event instanceof InputEvent || event instanceof CompositionEvent ? event.data : undefined;
  recordDebug('editor.input', { view: view.plugin(plugin)?.id, path: view.state.facet(renderContext).sourcePath,
    event: event.type, timeStamp: event.timeStamp, prevented: event.defaultPrevented,
    target: event.target instanceof Element ? { tag: event.target.tagName, class: event.target.getAttribute('class'),
      label: event.target.closest('[aria-label]')?.getAttribute('aria-label') } : undefined,
    pointer: event instanceof PointerEvent ? { x: event.clientX, y: event.clientY, button: event.button } : undefined,
    ...(key ? { key: key.key.length === 1 && !debugSource() ? '[character]' : key.key,
      ctrl: key.ctrlKey, alt: key.altKey, shift: key.shiftKey, meta: key.metaKey, repeat: key.repeat, composing: key.isComposing } : {}),
    ...(data != null ? { data: debugText(data) } : {}), inputType: event instanceof InputEvent ? event.inputType : undefined });
}
export const editorDebugging = [plugin,
  EditorView.exceptionSink.of(error => {
    recordDebug('editor.exception', debugError(error));
    if (debugEnabled()) queueMicrotask(() => captureDebug('editor.exception'));
    // Preserve CM's normal error visibility; recording never repairs/hides a crash.
    console.error(error);
  }),
  EditorView.domEventObservers({ keydown: input, beforeinput: input, input, compositionstart: input, compositionupdate: input,
    compositionend: input, pointerdown: input, focus: input, blur: input, paste: input, drop: input }),
];
