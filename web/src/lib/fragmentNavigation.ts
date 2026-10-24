import { RangeSet, StateEffect, StateField, type Extension, type EditorState } from '@codemirror/state';
import { BlockWrapper, Decoration, EditorView, ViewPlugin } from '@codemirror/view';
import { foldedRanges, unfoldEffect } from '@codemirror/language';
import { fragmentRange, parseLinkTarget, type SourceSpan } from '@webobsidian/markdown-core';
import { syntaxModel, sourceOf } from './syntaxModel';
import { contextOf } from './renderContext';
import { renderSourceRegion } from './sourceControls';
import '../styles/navigation.css';
import { livePreviewReadonly } from './renderState';
import { setEditorMode } from './activeEditor';

export interface NavigationLocation {
  path: string; viewId: string; anchor?: number; head?: number;
  scrollAnchor?: number; scrollOffset?: number; scrollLeft?: number;
  fragment?: string; mode?: 'live' | 'reading' | 'source'; version?: number;
  context?: { text: string; offset: number };
}
export interface LinkIntent { disposition?: 'current' | 'tab' | 'side'; source?: EditorView; viewId?: string; focus?: boolean; line?: number }
export interface NavigationRequest extends LinkIntent {
  fragment?: string; range?: SourceSpan; text?: string; location?: NavigationLocation; history?: boolean;
}
export type NavigationResult = { status: 'opened'; location: NavigationLocation } | { status: 'missing' | 'cancelled' };
type Binding = { id: string; full: boolean };
const views = new Map<EditorView, Binding>();
const pending = new Map<string, { path: string; request: NavigationRequest; resolve: (result: NavigationResult) => void; timer: ReturnType<typeof setTimeout>; modeApplied?: boolean }>();
const positions = new WeakMap<EditorView, Set<NavigationLocation>>();
/** Existing Callout fold state consumes this request; navigation owns no fold state. */
export const revealNavigation = StateEffect.define<SourceSpan>();
const setHighlight = StateEffect.define<{ range: SourceSpan; inline: boolean } | null>();
const highlight = StateField.define<{ range: SourceSpan; inline: boolean } | null>({
  create: () => null,
  update(value, tr) {
    for (const effect of tr.effects) if (effect.is(setHighlight)) return effect.value;
    return value && tr.docChanged ? { ...value, range: { from: tr.changes.mapPos(value.range.from, -1), to: tr.changes.mapPos(value.range.to, 1) } } : value;
  },
  provide: field => [EditorView.decorations.from(field, value => value?.inline && value.range.to > value.range.from
    ? Decoration.set([Decoration.mark({ class: 'cm-navigation-target' }).range(value.range.from, value.range.to)]) : Decoration.none),
    EditorView.blockWrappers.from(field, value => value && !value.inline && value.range.to > value.range.from
      ? BlockWrapper.set([BlockWrapper.create({ tagName: 'div', attributes: { class: 'cm-navigation-target' }, rank: 200 })
        .range(value.range.from, value.range.to)]) : RangeSet.empty)],
});
export const navigationHighlight = (state: EditorState) => state.field(highlight, false)?.range;

function available(view: EditorView) { return view.dom.isConnected && !view.dom.closest('[hidden], [aria-hidden="true"]'); }
export function navigationView(path: string, id?: string): EditorView | undefined {
  const candidates = [...views].filter(([view, binding]) => binding.full && available(view) && contextOf(view).sourcePath === path && (!id || binding.id === id));
  return candidates.find(([view]) => view.hasFocus)?.[0] ?? candidates[0]?.[0];
}
export function captureLocation(path: string, id = 'main', target?: EditorView): NavigationLocation {
  const view = target ?? navigationView(path, id);
  if (!view) return { path, viewId: id };
  const offset = contextOf(view).mathSource?.from ?? 0, selection = view.state.selection.main;
  const top = view.lineBlockAtHeight(view.scrollDOM.scrollTop - view.contentDOM.offsetTop);
  const from = Math.max(0, selection.anchor - 32), to = Math.min(view.state.doc.length, selection.anchor + 32);
  const location: NavigationLocation = { path, viewId: views.get(view)?.id ?? id,
    anchor: selection.anchor + offset, head: selection.head + offset, scrollAnchor: top.from + offset,
    scrollOffset: view.scrollDOM.scrollTop - top.top - view.contentDOM.offsetTop, scrollLeft: view.scrollDOM.scrollLeft,
    version: view.state.field(syntaxModel).version,
    mode: (view.dom.closest('[data-mode]')?.getAttribute('data-mode') as NavigationLocation['mode']) ?? undefined,
    context: { text: view.state.sliceDoc(from, to), offset: selection.anchor - from } };
  const saved = positions.get(view) ?? new Set(); saved.add(location);
  if (saved.size > 220) saved.delete(saved.values().next().value!);
  positions.set(view, saved); return location;
}

function reveal(view: EditorView, request: NavigationRequest): NavigationResult {
  const context = contextOf(view), { model, from: offset } = sourceOf(view.state);
  const target = request.fragment ? fragmentRange(model, request.fragment) : null;
  if (request.fragment && !target) return { status: 'missing' };
  let range = target?.focus ?? request.range;
  if (!range && request.line !== undefined && Number.isFinite(request.line)) {
    const from = view.state.doc.line(Math.max(1, Math.min(view.state.doc.lines, Math.trunc(request.line) + 1))).from + offset;
    range = { from, to: from };
  }
  const restored = request.location;
  let restoredDelta = 0;
  if (restored?.anchor !== undefined) {
    let anchor = restored.anchor;
    if (restored.context?.text && model.text.slice(anchor - restored.context.offset, anchor - restored.context.offset + restored.context.text.length) !== restored.context.text) {
      const at = model.text.indexOf(restored.context.text);
      if (at >= 0 && model.text.indexOf(restored.context.text, at + 1) < 0) anchor = at + restored.context.offset;
      else if (restored.fragment) {
        const resolved = fragmentRange(model, restored.fragment); if (!resolved) return { status: 'missing' }; anchor = resolved.focus.from;
      } else return { status: 'missing' };
    }
    restoredDelta = anchor - restored.anchor;
    range = { from: anchor, to: anchor };
  }
  if (range && request.text && model.text.slice(range.from, range.to) !== request.text) {
    const at = model.text.indexOf(request.text);
    if (at < 0 || model.text.indexOf(request.text, at + 1) >= 0) return { status: 'missing' };
    range = { from: at, to: at + request.text.length };
  }
  if (!range) range = { from: 0, to: 0 };
  const from = range.from - offset, to = range.to - offset;
  if (from < 0 || to < from || to > view.state.doc.length) return { status: 'missing' };
  const before = captureLocation(context.sourcePath, views.get(view)?.id, view);
  const effects: StateEffect<unknown>[] = [revealNavigation.of({ from, to }), renderSourceRegion.of({ from, to })];
  foldedRanges(view.state).between(from, Math.max(from, to), (start, end) => { effects.push(unfoldEffect.of({ from: start, to: end })); });
  effects.push(setHighlight.of(restored ? null : { range: { from, to }, inline: target?.kind === 'reference' || !!request.range }));
  const footer = target?.kind === 'footnote' && view.state.field(livePreviewReadonly) && !context.footnoteBody;
  const scrollAnchor = footer ? view.state.doc.length : restored?.scrollAnchor === undefined ? from : Math.max(0, Math.min(view.state.doc.length, restored.scrollAnchor + restoredDelta - offset));
  effects.push(EditorView.scrollIntoView(scrollAnchor, { y: restored ? 'start' : 'center' }));
  view.dispatch({ selection: { anchor: from, head: restored?.head === undefined ? from : Math.max(0, Math.min(view.state.doc.length, restored.head + restoredDelta - offset)) }, effects });
  if (footer) view.requestMeasure({ read: () => view.dom.querySelector<HTMLElement>('[data-footnote-target="' + CSS.escape(request.fragment!) + '"]'),
    write: element => element?.scrollIntoView({ block: 'center' }) });
  if (restored) view.requestMeasure({ read: () => view.lineBlockAt(scrollAnchor).top + view.contentDOM.offsetTop + (restored.scrollOffset ?? 0),
    write: top => { view.scrollDOM.scrollTop = top; view.scrollDOM.scrollLeft = restored.scrollLeft ?? 0; } });
  if (request.focus !== false) view.focus();
  const after = captureLocation(context.sourcePath, views.get(view)?.id, view);
  after.fragment = request.fragment;
  if (request.history !== false) context.recordNavigation?.(before, after);
  return { status: 'opened', location: after };
}

/** File loading adapters supply a stable view identity; newer requests cancel older ones. */
export function navigateTo(path: string, request: NavigationRequest = {}, target?: EditorView): Promise<NavigationResult> {
  const id = request.viewId ?? (target && views.get(target)?.id) ?? 'main';
  const previous = pending.get(id);
  if (previous) { clearTimeout(previous.timer); previous.resolve({ status: 'cancelled' }); pending.delete(id); }
  return new Promise(resolve => {
    const timer = setTimeout(() => { if (pending.get(id)?.resolve === resolve) { pending.delete(id); resolve({ status: 'cancelled' }); } }, 5000);
    pending.set(id, { path, request: { ...request, viewId: id }, resolve, timer });
    const attempt = () => {
      if (pending.get(id)?.resolve !== resolve) return;
      const view = target ?? navigationView(path, id);
      if (view && available(view)) consume(view, id);
      else requestAnimationFrame(attempt);
    };
    requestAnimationFrame(attempt);
  });
}
export function cancelNavigation(viewId: string, exceptPath?: string) {
  const request = pending.get(viewId);
  if (!request || request.path === exceptPath) return;
  clearTimeout(request.timer); pending.delete(viewId); request.resolve({ status: 'cancelled' });
}
function consume(view: EditorView, id: string) {
  const item = pending.get(id);
  if (!item || item.path !== contextOf(view).sourcePath || !available(view)) return;
  if (!item.modeApplied && item.request.location?.mode) {
    item.modeApplied = true; setEditorMode(view, item.request.location.mode);
    requestAnimationFrame(() => consume(view, id)); return;
  }
  pending.delete(id); clearTimeout(item.timer);
  const result = reveal(view, item.request);
  if (result.status === 'missing') contextOf(view).reportError?.('未找到链接目标，内容可能已经改变');
  item.resolve(result);
}
export function openFragment(path: string, fragment: string, target?: EditorView, request: NavigationRequest = {}) {
  return navigateTo(path, { ...request, fragment }, target);
}
export function bindFragmentNavigation(view: EditorView, _path: string, full: boolean): () => void {
  const id = contextOf(view).navigationId ?? (full ? 'main' : 'fragment:' + Math.random().toString(36).slice(2));
  views.set(view, { id, full });
  requestAnimationFrame(() => consume(view, id));
  return () => { views.delete(view); positions.delete(view); };
}

/** Click, keyboard and menu adapters pass the same target and opening intent. */
export function followRenderedLink(view: EditorView, target: string, intent: LinkIntent = {}) {
  if (/^(?:https?|mailto):/i.test(target)) { window.open(target, '_blank', 'noopener'); return; }
  if (/^[a-z][a-z\d+.-]*:/i.test(target)) { contextOf(view).reportError?.('不支持打开此链接'); return; }
  const context = contextOf(view), fragment = parseLinkTarget(target).fragment;
  if (target.startsWith('#') && fragment && (!intent.disposition || intent.disposition === 'current')) {
    const source = sourceOf(view.state), range = fragmentRange(source.model, fragment);
    const offset = source.from;
    if (range && range.focus.from >= offset && range.focus.to <= offset + view.state.doc.length) {
      void openFragment(context.sourcePath, fragment, view); return;
    }
  }
  context.openLink(target, { ...intent, source: view, viewId: intent.viewId ?? views.get(view)?.id });
}
export function linkIntent(event: MouseEvent): LinkIntent {
  return { disposition: event.shiftKey ? 'side' : event.ctrlKey || event.metaKey || event.button === 1 ? 'tab' : 'current' };
}

export const navigationExtensions: Extension = [highlight, ViewPlugin.fromClass(class {
  timer: ReturnType<typeof setTimeout> | undefined;
  constructor(readonly view: EditorView) {}
  update(update: import('@codemirror/view').ViewUpdate) {
    if (update.docChanged) for (const location of positions.get(this.view) ?? []) {
      const offset = contextOf(this.view).mathSource?.from ?? 0;
      for (const key of ['anchor', 'head', 'scrollAnchor'] as const) if (location[key] !== undefined)
        location[key] = update.changes.mapPos(location[key]! - offset, 1) + offset;
      location.version = update.state.field(syntaxModel).version;
      if (location.anchor !== undefined) {
        const anchor = location.anchor - offset, from = Math.max(0, anchor - 32), to = Math.min(update.state.doc.length, anchor + 32);
        location.context = { text: update.state.sliceDoc(from, to), offset: anchor - from };
      }
    }
    if (update.transactions.some(tr => tr.effects.some(effect => effect.is(setHighlight)))) {
      clearTimeout(this.timer);
      if (update.state.field(highlight)) this.timer = setTimeout(() => { if (this.view.dom.isConnected) this.view.dispatch({ effects: setHighlight.of(null) }); }, 3000);
    }
  }
  destroy() { clearTimeout(this.timer); }
})];
