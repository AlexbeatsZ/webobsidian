import {
  Compartment,
  StateField,
  StateEffect,
  EditorSelection,
  type Extension,
} from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { livePreviewState } from '../livePreview';
import { contextOf } from '../renderContext';
const setEditorInfo = StateEffect.define<any>();
export const editorInfoField = StateField.define<any>({
  create: () => ({}),
  update: (value, transaction) => transaction.effects.find(effect => effect.is(setEditorInfo))?.value ?? value,
});
export const editorLivePreviewField = StateField.define<boolean>({
  create: (state) => state.field(livePreviewState, false) ?? false,
  update: (_value, tr) => tr.state.field(livePreviewState, false) ?? false,
});
const extensions = new Map<object, Extension[]>();
const mounted = new Map<EditorView, { compartment: Compartment; info: any }>();
const bindings = new WeakMap<EditorView, Compartment>();
export function refreshPluginExtensions() {
  // Plugins such as LaTeX Suite mutate the registered array in place and call
  // workspace.updateOptions(). Re-resolve it for every mounted CM instance.
  for (const [view, { compartment }] of mounted) {
    view.dispatch({
      effects: compartment.reconfigure([...extensions.values()].flat()),
    });
  }
}
export function setPluginExtensions(owner: object, value: Extension[]) {
  if (value.length) extensions.set(owner, value);
  else extensions.delete(owner);
  refreshPluginExtensions();
}
export function attachPluginEditor(view: EditorView, info: any, onChange?: () => void) {
  const compartment = new Compartment();
  let binding = bindings.get(view);
  const installed = !!binding;
  if (!binding) { binding = new Compartment(); bindings.set(view, binding); }
  mounted.set(view, { compartment, info });
  const config = [editorInfoField.init(() => info), editorLivePreviewField,
    compartment.of([...extensions.values()].flat()),
    EditorView.updateListener.of(update => { if (update.docChanged) onChange?.(); })];
  view.dispatch({
    effects: [installed ? binding.reconfigure(config) : StateEffectAppend(binding.of(config)), setEditorInfo.of(info)],
  });
  return () => {
    if (mounted.get(view)?.info !== info) return;
    mounted.delete(view);
    if (view.dom.isConnected) view.dispatch({ effects: binding!.reconfigure([]) });
  };
}
const StateEffectAppend = (extension: Extension) =>
  StateEffect.appendConfig.of(extension);
export function editorFor(view: EditorView) {
  return new Editor(view);
}
export function editorEntries() {
  return [...mounted].map(([cm, data]) => ({ cm, ...data }));
}
export class Editor {
  constructor(public cm: EditorView) {}
  private offset(pos: { line: number; ch: number }) {
    const line = this.cm.state.doc.line(
      Math.max(1, Math.min(this.cm.state.doc.lines, pos.line + 1))
    );
    return Math.min(line.to, line.from + Math.max(0, pos.ch));
  }
  offsetToPos(offset: number) {
    const line = this.cm.state.doc.lineAt(
      Math.max(0, Math.min(this.cm.state.doc.length, offset))
    );
    return { line: line.number - 1, ch: offset - line.from };
  }
  posToOffset(pos: { line: number; ch: number }) {
    return this.offset(pos);
  }
  getValue() {
    return this.cm.state.doc.toString();
  }
  setValue(value: string) {
    this.cm.dispatch({
      changes: { from: 0, to: this.cm.state.doc.length, insert: value },
      userEvent: 'input',
    });
  }
  getLine(line: number) {
    return this.cm.state.doc.line(line + 1).text;
  }
  setLine(line: number, text: string) {
    const range = this.cm.state.doc.line(line + 1);
    this.cm.dispatch({
      changes: { from: range.from, to: range.to, insert: text },
      userEvent: 'input',
    });
  }
  lineCount() {
    return this.cm.state.doc.lines;
  }
  lastLine() {
    return this.lineCount() - 1;
  }
  getCursor(which: 'from' | 'to' | 'head' | 'anchor' = 'head') {
    return this.offsetToPos(this.cm.state.selection.main[which]);
  }
  setCursor(line: number | { line: number; ch: number }, ch?: number) {
    const pos = typeof line === 'number' ? { line, ch: ch ?? 0 } : line;
    this.cm.dispatch({
      selection: { anchor: this.offset(pos) },
      scrollIntoView: true,
    });
  }
  setSelection(anchor: any, head = anchor) {
    this.cm.dispatch({
      selection: { anchor: this.offset(anchor), head: this.offset(head) },
    });
  }
  setSelections(ranges: any[]) {
    this.cm.dispatch({
      selection: EditorSelection.create(
        ranges.map((r) =>
          EditorSelection.range(this.offset(r.anchor), this.offset(r.head))
        )
      ),
    });
  }
  listSelections() {
    return this.cm.state.selection.ranges.map((r) => ({
      anchor: this.offsetToPos(r.anchor),
      head: this.offsetToPos(r.head),
    }));
  }
  somethingSelected() {
    return !this.cm.state.selection.main.empty;
  }
  getSelection() {
    const r = this.cm.state.selection.main;
    return this.cm.state.sliceDoc(r.from, r.to);
  }
  getRange(from: any, to: any) {
    return this.cm.state.sliceDoc(this.offset(from), this.offset(to));
  }
  replaceRange(text: string, from: any, to = from) {
    this.cm.dispatch({
      changes: { from: this.offset(from), to: this.offset(to), insert: text },
      userEvent: 'input',
    });
  }
  replaceSelection(text: string) {
    this.cm.dispatch({
      ...this.cm.state.replaceSelection(text),
      userEvent: 'input',
    });
  }
  transaction(tx: any) {
    this.cm.dispatch({
      changes: (tx.changes ?? []).map((c: any) => ({
        from: this.offset(c.from),
        to: this.offset(c.to ?? c.from),
        insert: c.text,
      })),
      userEvent: 'input',
    });
    if (tx.selections) this.setSelections(tx.selections);
  }
  focus() {
    this.cm.focus();
  }
  hasFocus() {
    return this.cm.hasFocus;
  }
  refresh() {
    this.cm.requestMeasure();
  }
  getDoc() {
    return this;
  }
  scrollIntoView(range: any, center = false) {
    this.cm.dispatch({
      effects: EditorView.scrollIntoView(this.offset(range.from), {
        y: center ? 'center' : 'nearest',
      }),
    });
  }
  getScrollInfo() {
    const el = this.cm.scrollDOM;
    return {
      top: el.scrollTop,
      left: el.scrollLeft,
      height: el.scrollHeight,
      clientHeight: el.clientHeight,
      width: el.scrollWidth,
    };
  }
  scrollTo(x: number | null, y: number | null) {
    this.cm.scrollDOM.scrollTo(
      x ?? this.cm.scrollDOM.scrollLeft,
      y ?? this.cm.scrollDOM.scrollTop
    );
  }
  get sourcePath() {
    return contextOf(this.cm).sourcePath;
  }
}
