import {
  Decoration,
  DecorationSet,
  EditorView,
  ViewPlugin,
  ViewUpdate,
  WidgetType,
} from '@codemirror/view';
import { StateField, StateEffect, type EditorState, type Range } from '@codemirror/state';
import { getIndentUnit, foldedRanges } from '@codemirror/language';
import { CALLOUT_SLOT, CALLOUT_RE, calloutDefaultTitle, calloutIconSvg } from './callouts';
import { iconPaths } from './icons';
import { openLightbox } from './imageLightbox';
import { applyImagePresentation, presentHtmlImages } from './imagePresentation';
import { VIDEO_EXT_RE, AUDIO_EXT_RE } from './media';
import { syntaxModel, blockModel, equationsOf } from './syntaxModel';
import { compositionSelection } from './inlineHtml';
import { sourceButton, sourceIsOpen, sourceOwns, forceRendered } from './sourceControls';
import { livePreviewState, livePreviewReadonly, setLivePreviewEnabled, setLivePreviewReadonly } from './renderState';
export { livePreviewState, livePreviewReadonly, setLivePreviewEnabled, setLivePreviewReadonly } from './renderState';
import { BODY_HEADING_NODE, BODY_HEADING_LEVEL, bodyHeadingParts, changeTable, editTableCell, type SourceChange, type TableModel, type TableOperation, canEditProperties, patchPropertyRows, readPropertyRows, stripQuotePrefix, caretTouches, sanitizeHtmlFragment as sanitizeHtml } from '@webobsidian/markdown-core';
import { contextOf, renderContext, type RenderMenuItem as LpMenuItem } from './renderContext';
import { renderMath, mathDefinitionContext, subscribeMathConfiguration } from './mathjax';
import { editorMathRegions, mathSourceVisible, mathPreview, mathPreviewTex } from './writing/latex/editor_context/mathPresentation';
import { decorationInputsChanged } from './decorationDependencies';
import { blockEffectOwns } from './blocks/model';
import { equationLabel, equationTarget, equationAt, fragmentRange, parseLinkTarget, type Equation } from '@webobsidian/markdown-core';

/**
 * Live Preview for CodeMirror 6 — an Obsidian-style WYSIWYG editing mode.
 *
 * Formatting is *rendered* (bold is bold, italic italic, code monospaced, headings
 * sized, links/embeds/checkboxes become widgets) while the raw Markdown syntax is
 * concealed. Syntax for a given span is revealed only when the caret is inside
 * THAT span — not the whole paragraph — so editing one word never dumps raw
 * markup across the line. (PRD FR-2)
 */

/**
 * Start Obsidian's "Add file property" flow: focus a new property-key field in
 * the Properties widget and open the key suggester dropdown — the same UI the
 * widget's own "+ Add property" button drives. If the note has no frontmatter
 * yet, an empty block is created first so the widget (and its button) renders.
 * Requires Live Preview, non-readonly — the caller switches to live mode first.
 */
export function triggerAddProperty(view: EditorView): void {
  if (view.state.readOnly) return;
  const click = (): boolean => {
    const btn = view.dom.querySelector<HTMLElement>('.cm-props-add');
    if (!btn) return false;
    btn.scrollIntoView({ block: 'nearest' });
    btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    return true;
  };
  if (click()) return;
  if (!/^---\r?\n[\s\S]*?\r?\n---/.test(view.state.doc.toString())) {
    view.dispatch({ changes: { from: 0, to: 0, insert: '---\n\n---\n\n' } });
  }
  // The widget mounts on the next decoration build; poll briefly for its button.
  let tries = 0;
  const iv = window.setInterval(() => {
    if (click() || ++tries > 30) window.clearInterval(iv);
  }, 25);
}

/* ---------------- widgets ---------------- */

// Small "external link" glyph appended after outgoing http(s) links, like Obsidian.
function externalLinkIcon(): SVGElement {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'cm-external-icon');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  for (const d of ['M15 3h6v6', 'M10 14 21 3', 'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6']) {
    const p = document.createElementNS(NS, 'path');
    p.setAttribute('d', d);
    svg.appendChild(p);
  }
  return svg;
}

class WikilinkWidget extends WidgetType {
  private cleanup = new WeakMap<HTMLElement, () => void>();
  destroy(dom: HTMLElement) { this.cleanup.get(dom)?.(); }
  /** `aria` = default display text, set when an alias overrides it (like Obsidian). */
  constructor(readonly target: string, readonly label: string, readonly embed: boolean, readonly aria?: string, readonly numberReference = false, readonly revision?: string) {
    super();
  }
  eq(o: WikilinkWidget) {
    return o.target === this.target && o.label === this.label && o.embed === this.embed && o.aria === this.aria && o.numberReference === this.numberReference && o.revision === this.revision;
  }
  toDOM(view: EditorView) {
    const a = document.createElement('a');
    a.className = 'cm-hmd-internal-link cm-wikilink internal-link' + (this.embed ? ' embed' : '');
    a.dataset.menuLink = this.target;
    a.textContent = this.label;
    const destination = parseLinkTarget(this.target);
    if (this.numberReference && /^[\^=]/.test(destination.fragment)) {
      const context = contextOf(view), controller = new AbortController();
      let unsubscribe: (() => void) | undefined;
      this.cleanup.set(a, () => { controller.abort(); unsubscribe?.(); });
      const paint = (equation?: Equation, missing = false) => {
        if (controller.signal.aborted) return;
        if (equation) {
          a.textContent = equationLabel(equation, !destination.path ? equationsOf(view.state) : undefined) ?? this.label;
          a.title = `${this.target}\n${equation.tex}`;
          a.classList.toggle('is-unresolved', !!equation.ambiguous);
        } else { a.textContent = this.label; a.classList.toggle('is-unresolved', missing); a.title = this.target; }
      };
      if (!destination.path) paint(equationTarget(equationsOf(view.state), destination.fragment),
        !fragmentRange(context.mathSource?.model ?? view.state.field(syntaxModel), destination.fragment));
      else void context.renderEmbed(this.target, controller.signal).then(note => {
        if (controller.signal.aborted) return;
        if (!note) { paint(undefined, true); return; }
        const refresh = () => { const data = note.read(); paint(data?.equations ? equationTarget(data.equations, destination.fragment) : undefined, !data); };
        unsubscribe = note.subscribe(refresh); refresh();
      }).catch(() => {});
    }
    if (this.aria) a.setAttribute('aria-label', this.aria);
    a.onmousedown = (e) => {
      e.preventDefault();
      contextOf(view).openLink(this.target);
    };
    return a;
  }
  ignoreEvent() {
    return false;
  }
}

class MdLinkWidget extends WidgetType {
  constructor(readonly label: string, readonly href: string) {
    super();
  }
  eq(o: MdLinkWidget) {
    return o.label === this.label && o.href === this.href;
  }
  toDOM(view: EditorView) {
    const external = /^https?:\/\//i.test(this.href);
    const a = document.createElement('a');
    a.className = 'cm-md-link' + (external ? ' external-link' : ' internal-link');
    a.dataset.menuLink = this.href;
    a.textContent = this.label;
    a.title = this.href;
    if (external) a.appendChild(externalLinkIcon());
    a.onmousedown = (e) => {
      e.preventDefault();
      if (external) window.open(this.href, '_blank', 'noopener');
      else if (this.href.startsWith('#')) { /* in-note anchor — no-op */ }
      else contextOf(view).openLink(this.href.replace(/\.(md|markdown)$/i, ''));
    };
    return a;
  }
  ignoreEvent() {
    return false;
  }
}

class CheckboxWidget extends WidgetType {
  constructor(readonly checked: boolean, readonly pos: number) {
    super();
  }
  eq(o: CheckboxWidget) {
    return o.checked === this.checked && o.pos === this.pos;
  }
  toDOM(view: EditorView) {
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.className = 'cm-task-checkbox';
    box.checked = this.checked;
    box.onmousedown = (e) => {
      e.preventDefault();
      if (view.state.readOnly) return;
      view.dispatch({ changes: { from: this.pos, to: this.pos + 1, insert: this.checked ? ' ' : 'x' } });
    };
    return box;
  }
  ignoreEvent() {
    return true;
  }
}

const pointX = (e: MouseEvent | TouchEvent): number =>
  'touches' in e ? (e.touches[0] ?? e.changedTouches[0]).clientX : e.clientX;

/**
 * Write a new pixel width back into the embed source that `wrap` renders, as the
 * Obsidian size param: `![[img|W]]` for wikilink embeds, `![alt|W](url)` for
 * markdown images. The widget's document position is recovered via posAtDOM, then
 * the embed token covering it is re-found and rewritten (an existing trailing
 * numeric size segment is replaced; otherwise one is appended).
 */
function writeImageWidth(view: EditorView, wrap: HTMLElement, width: number): void {
  if (view.state.readOnly) return;
  let pos: number;
  try {
    pos = view.posAtDOM(wrap);
  } catch {
    return;
  }
  const line = view.state.doc.lineAt(pos);
  const off = pos - line.from;
  const isSize = (s: string) => /^\s*\d+\s*(?:x\s*\d+\s*)?$/.test(s);
  const withSize = (segs: string[]): string => {
    if (segs.length > 1 && isSize(segs[segs.length - 1])) segs.pop();
    segs.push(String(width));
    return segs.join('|');
  };
  const tokens: Array<{ re: RegExp; build: (m: RegExpExecArray) => string }> = [
    { re: /!\[\[([^\]]+?)\]\]/g, build: (m) => `![[${withSize(m[1].split('|'))}]]` },
    { re: /!\[([^\]]*)\]\(([^)]+)\)/g, build: (m) => `![${withSize(m[1].split('|'))}](${m[2]})` },
  ];
  for (const { re, build } of tokens) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(line.text))) {
      if (m.index <= off && off <= m.index + m[0].length) {
        const from = line.from + m.index;
        view.dispatch({ changes: { from, to: from + m[0].length, insert: build(m) } });
        return;
      }
    }
  }
}

class ImageWidget extends WidgetType {
  /** `width`/`height` from the Obsidian size param `![[img|300]]` / `![[img|300x200]]`. */
  constructor(readonly src: string, readonly alt: string, readonly width?: number, readonly height?: number, readonly ro = false, readonly target = src) {
    super();
  }
  eq(o: ImageWidget) {
    return o.src === this.src && o.alt === this.alt && o.width === this.width && o.height === this.height && o.ro === this.ro && o.target === this.target;
  }
  toDOM(view: EditorView) {
    const wrap = document.createElement('span');
    applyImagePresentation(wrap, this.target, this.alt);
    const img = document.createElement('img');
    img.src = this.src;
    img.alt = this.alt;
    img.className = 'cm-embed-image image-embed';
    img.draggable = false;
    img.addEventListener('load', () => view.requestMeasure(), { once: true });
    if (this.width) img.width = this.width;
    if (this.height) img.height = this.height;
    // Missing attachment → Obsidian-style "could not be found" box.
    img.onerror = () => {
      img.remove();
      wrap.querySelectorAll('.cm-image-resize').forEach((h) => h.remove());
      const miss = document.createElement('span');
      miss.textContent = '';
      wrap.appendChild(miss);
      embedNotFound(miss, this.alt);
    };
    // Plain click (no drag) → full-screen zoom/pan viewer.
    img.addEventListener('click', (e) => {
      e.preventDefault();
      openLightbox(this.src, this.alt);
    });
    wrap.appendChild(img);

    // Drag-to-resize — left/right edge bars; width is written back as `|W`,
    // keeping aspect ratio (height auto), like Obsidian's image resize.
    const startResize = (e: MouseEvent | TouchEvent, side: 'left' | 'right') => {
      e.preventDefault();
      e.stopPropagation();
      const startX = pointX(e);
      const zoom = Number(getComputedStyle(img).zoom) || 1;
      const startW = img.getBoundingClientRect().width / zoom;
      const maxW = Math.max(80, view.contentDOM.clientWidth / zoom);
      let curW = Math.round(startW);
      wrap.classList.add('is-resizing');
      const onMove = (ev: MouseEvent | TouchEvent) => {
        if ('touches' in ev) ev.preventDefault();
        const dx = (pointX(ev) - startX) / zoom;
        curW = Math.min(maxW, Math.max(40, Math.round(side === 'right' ? startW + dx : startW - dx)));
        img.style.width = curW + 'px';
        img.style.height = 'auto';
        img.setAttribute('width', String(curW));
        img.removeAttribute('height');
      };
      const onUp = () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        window.removeEventListener('touchmove', onMove);
        window.removeEventListener('touchend', onUp);
        wrap.classList.remove('is-resizing');
        writeImageWidth(view, wrap, curW);
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
      window.addEventListener('touchmove', onMove, { passive: false });
      window.addEventListener('touchend', onUp);
    };
    for (const side of (view.state.readOnly ? [] : ['left', 'right']) as ('left' | 'right')[]) {
      const h = document.createElement('span');
      h.className = `cm-image-resize cm-image-resize-${side}`;
      h.addEventListener('mousedown', (e) => startResize(e, side));
      h.addEventListener('touchstart', (e) => startResize(e, side), { passive: false });
      wrap.appendChild(h);
    }
    return wrap;
  }
}

/** Embedded audio/video player for `![[clip.mp4]]` / `![[song.mp3]]` (FR-2). */
class MediaWidget extends WidgetType {
  constructor(
    readonly src: string,
    readonly alt: string,
    readonly kind: 'video' | 'audio',
    readonly width?: number,
  ) {
    super();
  }
  eq(o: MediaWidget) {
    return o.src === this.src && o.kind === this.kind && o.width === this.width;
  }
  // Let the native player controls receive pointer/keyboard events (same as the
  // note-embed widget) instead of CodeMirror handling them.
  ignoreEvent() {
    return true;
  }
  toDOM() {
    const wrap = document.createElement('span');
    wrap.className = `cm-media-wrap cm-media-${this.kind}`;
    const el = document.createElement(this.kind) as HTMLMediaElement;
    el.src = this.src;
    el.controls = true;
    el.preload = 'metadata';
    el.className = this.kind === 'video' ? 'cm-embed-video media-embed' : 'cm-embed-audio media-embed';
    if (this.kind === 'video' && this.width) (el as HTMLVideoElement).width = this.width;
    // Missing attachment → Obsidian-style "could not be found" box.
    el.onerror = () => {
      el.remove();
      const miss = document.createElement('span');
      wrap.appendChild(miss);
      embedNotFound(miss, this.alt);
    };
    wrap.appendChild(el);
    return wrap;
  }
}

/* ---------------- callouts (§21) — constants shared with Reading view ---------------- */

/** Replaces only the source marker; custom title text stays editable. */
class CalloutHeadWidget extends WidgetType {
  constructor(readonly slot: string, readonly defaultTitle: string) { super(); }
  eq(o: CalloutHeadWidget) { return o.slot === this.slot && o.defaultTitle === this.defaultTitle; }
  toDOM() {
    const span = document.createElement('span');
    span.className = 'cm-callout-head';
    const icon = document.createElement('span');
    icon.className = 'cm-callout-icon';
    icon.innerHTML = calloutIconSvg(this.slot);
    span.appendChild(icon);
    if (this.defaultTitle) {
      const title = document.createElement('span');
      title.className = 'cm-callout-title';
      title.textContent = this.defaultTitle;
      span.appendChild(title);
    }
    return span;
  }
  ignoreEvent(event: Event) { return event.type === 'mousedown'; }
}

/** Trailing control, separate from the leading icon so it follows custom titles. */
class CalloutFoldWidget extends WidgetType {
  constructor(readonly folded: boolean, readonly titleFrom: number) { super(); }
  eq(o: CalloutFoldWidget) { return o.folded === this.folded && o.titleFrom === this.titleFrom; }
  toDOM(view: EditorView) {
    const control = document.createElement('button');
    control.type = 'button';
    control.className = 'cm-callout-fold' + (this.folded ? ' is-folded' : '');
    control.setAttribute('aria-label', this.folded ? 'Expand callout' : 'Collapse callout');
    control.setAttribute('aria-expanded', String(!this.folded));
    control.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + iconPaths['chevron-down'] + '</svg>';
    control.addEventListener('mousedown', event => { event.preventDefault(); });
    control.addEventListener('click', event => {
      event.preventDefault(); event.stopPropagation();
      if (view.composing) return;
      const block = view.state.field(blockModel).containers.find(block => block.kind === 'callout' && block.from === this.titleFrom);
      const hidesCaret = !this.folded && block && view.state.selection.ranges.some(range => range.to >= block.bodyFrom && range.from <= block.to);
      view.dispatch({ effects: toggleCalloutFold.of(this.titleFrom),
        ...(hidesCaret ? { selection: { anchor: view.state.doc.lineAt(this.titleFrom).to } } : {}),
      });
    });
    return control;
  }
  ignoreEvent() { return true; }
}

/* ---------------- math (locally bundled MathJax, loaded on demand) ---------------- */

class MathWidget extends WidgetType {
  private controllers = new WeakMap<HTMLElement, AbortController>();
  private subscriptions = new WeakMap<HTMLElement, () => void>();
  destroy(dom: HTMLElement) { this.controllers.get(dom)?.abort(); this.subscriptions.get(dom)?.(); }
  constructor(readonly tex: string, readonly display: boolean, readonly range?: { from: number; to: number }, readonly number?: string, readonly anchor?: string, readonly definitions: readonly string[] = [], readonly preview = false) {
    super();
  }
  eq(o: MathWidget) {
    return o.tex === this.tex && o.display === this.display && o.range?.from === this.range?.from && o.range?.to === this.range?.to && o.number === this.number && o.anchor === this.anchor && o.preview === this.preview && o.definitions.length === this.definitions.length && o.definitions.every((d,i) => d === this.definitions[i]);
  }
  toDOM(view: EditorView) {
    const span = document.createElement('span');
    span.className = 'cm-math-rendered' + (this.display ? ' math-block' : ' math-inline') + (this.preview ? ' cm-math-edit-preview' : '');
    if (this.number) span.classList.add('cm-numbered-equation');
    const body = document.createElement('span');
    body.textContent = this.tex;
    span.appendChild(body); // shown until MathJax finishes, or if loading fails
    if (this.anchor) span.dataset.equationId = this.anchor;
    if (this.number) {
      const label = document.createElement('span'); label.className = 'cm-equation-number'; label.textContent = this.number;
      span.appendChild(label);
    }
    span.dataset.renderPending = 'true';
    const render = () => {
      this.controllers.get(span)?.abort();
      const controller = new AbortController(); this.controllers.set(span, controller);
      const context = contextOf(view), source = context.mathSource;
      const model = source?.model ?? view.state.field(syntaxModel);
      const from = (this.range?.from ?? 0) + (source?.from ?? 0);
      span.dataset.renderPending = 'true';
      void renderMath(body, this.tex, this.display, controller.signal, { transient: this.preview, sourcePath: context.sourcePath, definitions: mathDefinitionContext(model, from) })
        .then(() => { if (!controller.signal.aborted) { span.classList.remove('mod-error'); span.removeAttribute('title'); } })
        .catch(error => {
          if (controller.signal.aborted) return;
          span.classList.add('mod-error');
          span.title = `Formula rendering failed: ${error instanceof Error ? error.message : String(error)}`;
        })
        .finally(() => { if (!controller.signal.aborted) { delete span.dataset.renderPending; view.requestMeasure(); } });
    };
    this.subscriptions.set(span, subscribeMathConfiguration(render)); render();
    if (this.display && this.range && !this.preview && !view.state.readOnly) {
      const formula = editorMathRegions(view.state).find(r => r.from === this.range!.from && r.to === this.range!.to);
      span.appendChild(sourceButton(view, this.range, 'formula', { kind: 'formula',
        selection: formula ? { from: formula.bodyFrom, to: formula.bodyTo } : this.range }));
    }
    return span;
  }
  ignoreEvent() {
    return false;
  }
}

class HrWidget extends WidgetType {
  eq() {
    return true;
  }
  toDOM() {
    const span = document.createElement('span');
    span.className = 'cm-hr-widget';
    span.appendChild(document.createElement('hr'));
    return span;
  }
}

/* ---------------- note embeds (transclusion, like Obsidian ![[note]]) ---------------- */

// Injected from Editor.tsx: resolves a wikilink target and returns rendered,
// sanitized HTML (api.resolve + renderMarkdown — same pipeline as Reading view).
function embedNotFound(el: HTMLElement, target: string) {
  el.classList.add('cm-embed-missing');
  el.textContent = `"${target}" could not be found.`;
}

class NoteEmbedWidget extends WidgetType {
  private controllers = new WeakMap<HTMLElement, AbortController>();
  private cleanup = new WeakMap<HTMLElement, (() => void)[]>();
  destroy(dom: HTMLElement) { this.controllers.get(dom)?.abort(); this.cleanup.get(dom)?.forEach(stop => stop()); }
  constructor(readonly target: string) {
    super();
  }
  eq(o: NoteEmbedWidget) {
    return o.target === this.target;
  }
  ignoreEvent() {
    return true;
  }
  toDOM(view: EditorView) {
    const box = document.createElement('div');
    box.className = 'internal-embed markdown-embed cm-note-embed';
    const open = document.createElement('span');
    open.className = 'markdown-embed-link';
    open.title = 'Open link';
    open.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></svg>';
    open.addEventListener('mousedown', (e) => {
      e.preventDefault();
      contextOf(view).openLink(this.target);
    });
    const content = document.createElement('div');
    content.className = 'markdown-embed-content';
    content.textContent = '…';
    box.append(open, content);
    const controller = new AbortController();
    this.controllers.set(box, controller);
    const context = contextOf(view);
    const trail = context.embedTrail ?? [context.sourcePath];
    const cleanup: (() => void)[] = []; this.cleanup.set(box, cleanup);
    if (trail.length > 4) { content.textContent = 'Embed depth limit reached'; return box; }
    box.dataset.renderPending = 'true';
    void context.renderEmbed(this.target, controller.signal).then(res => {
      if (controller.signal.aborted) return;
      if (!res) { embedNotFound(content, this.target); return; }
      if (trail.includes(res.path)) { content.textContent = 'Circular embed: ' + res.path; return; }
      let stop: (() => void) | undefined, previous: string | undefined, revision: string | undefined;
      cleanup.push(() => stop?.());
      const refresh = () => {
        if (controller.signal.aborted) return;
        const fragment = res.read();
        if (!fragment) { stop?.(); content.textContent = 'Embedded section or block could not be found'; return; }
        if (fragment.source === previous && fragment.equations?.revision === revision) return;
        previous = fragment.source; revision = fragment.equations?.revision; stop?.(); content.replaceChildren();
        const host = document.createElement('div'); host.className = 'cm-note-fragment'; content.appendChild(host);
        stop = context.mountFragment?.(host, fragment.source, { id: res.path, sourceFrom: fragment.from, equations: fragment.equations, mathSource: fragment.mathSource,
          context: { ...res.context, embedTrail: [...trail, res.path] } });
        if (!stop) host.textContent = fragment.source;
      };
      cleanup.push(res.subscribe(refresh)); refresh();
    }).catch(error => {
      if (!controller.signal.aborted) { content.textContent = 'Unable to load embed'; context.reportError?.(String(error)); }
    }).finally(() => { delete box.dataset.renderPending; });
    return box;
  }
}

/* ---------------- mermaid (lazy, like Obsidian) ---------------- */

let mermaidPromise: Promise<typeof import('mermaid')['default']> | null = null;
function ensureMermaid() {
  if (!mermaidPromise) {
    mermaidPromise = import('mermaid').then((m) => {
      m.default.initialize({
        startOnLoad: false, securityLevel: 'strict',
        theme: 'base', fontFamily: '"MathJax_Main", "MathJax_Math", "Noto Serif SC", serif',
        themeVariables: { fontSize: '16px', primaryColor: '#fafafa', primaryTextColor: '#000000', lineColor: '#888888' },
      });
      return m.default;
    });
  }
  return mermaidPromise;
}
let mermaidSeq = 0;

class MermaidWidget extends WidgetType {
  constructor(readonly code: string, readonly range?: { from: number; to: number }) {
    super();
  }
  eq(o: MermaidWidget) {
    return o.code === this.code && o.range?.from === this.range?.from && o.range?.to === this.range?.to;
  }
  ignoreEvent() {
    return true;
  }
  toDOM(view: EditorView) {
    const div = document.createElement('div');
    div.className = 'mermaid cm-mermaid';
    const body = document.createElement('div');
    body.textContent = '…'; div.appendChild(body);
    div.dataset.renderPending = 'true';
    void ensureMermaid()
      .then(async mermaid => {
        await Promise.all(['MathJax_Main', 'MathJax_Math', 'Noto Serif SC'].map(font => document.fonts.load('16px "' + font + '"')));
        return mermaid.render(`cm-mmd-${++mermaidSeq}`, this.code);
      })
      .then(({ svg }) => {
        body.innerHTML = svg;
      })
      .catch((err) => {
        div.classList.add('mod-error');
        body.textContent = String(err?.message ?? err);
        // mermaid leaves an orphaned error element in <body> on parse failure
        document.getElementById(`dcm-mmd-${mermaidSeq}`)?.remove();
      }).finally(() => { delete div.dataset.renderPending; });
    if (this.range && !view.state.readOnly) div.appendChild(sourceButton(view, this.range, 'diagram'));
    return div;
  }
}

function buildMermaid(state: EditorState): DecorationSet {
  if (!state.field(livePreviewState, false)) return Decoration.none;
  const ro = state.field(livePreviewReadonly, false) ?? false;
  const ranges: Range<Decoration>[] = [];
  for (const block of state.field(blockModel).containers) {
    if (block.kind !== 'code' || block.language.toLowerCase() !== 'mermaid' || sourceIsOpen(state, block) || blockEffectOwns(state, block)) continue;
    if (!forceRendered(state, block) && caretTouches(block, state.field(compositionSelection).selection.ranges, ro)) continue;
    ranges.push(Decoration.replace({ widget: new MermaidWidget(block.body, block), block: true }).range(block.from, block.to));
  }
  return Decoration.set(ranges, true);
}

function buildMathBlocks(state: EditorState): DecorationSet {
  const decorations: Range<Decoration>[] = [];
  if (state.field(livePreviewState, false)) for (const region of state.field(blockModel).mathRanges) {
    if (region.closed && region.kind === 'dollar' && (region.block || region.tex.includes('\n')) &&
      !blockEffectOwns(state, region) && !mathSourceVisible(state, region))
      decorations.push(Decoration.replace({ widget: numberedMath(state, region.tex, true, region), block: true }).range(region.from, region.to));
  }
  const preview = mathPreview(state);
  if (preview?.placement === 'document' && !blockEffectOwns(state, preview.region))
    decorations.push(Decoration.widget({ widget: numberedMath(state, mathPreviewTex(state, preview.region), true, preview.region, true),
      block: true, side: 1 }).range(preview.region.to));
  return Decoration.set(decorations, true);
}
function numberedMath(state: EditorState, tex: string, display: boolean, range: { from: number; to: number }, preview = false) {
  const context = equationsOf(state);
  const equation = display ? equationAt(context, range.from) : undefined;
  const source = state.facet(renderContext).mathSource;
  const definitions = mathDefinitionContext(source?.model ?? state.field(syntaxModel), range.from + (source?.from ?? 0));
  return new MathWidget(tex, display, range, equation && !equation.tag ? equationLabel(equation, context) ?? undefined : undefined,
    preview || equation?.ambiguous ? undefined : equation?.id, definitions, preview);
}
export const mathBlockField = StateField.define<DecorationSet>({
  create: buildMathBlocks, update: (value, transaction) => decorationInputsChanged(transaction) ? buildMathBlocks(transaction.state) : value,
  provide: (field) => EditorView.decorations.from(field),
});

export const mermaidField = StateField.define<DecorationSet>({
  create: (state) => buildMermaid(state),
  update(value, tr) {
    if (decorationInputsChanged(tr)) {
      return buildMermaid(tr.state);
    }
    return value.map(tr.changes);
  },
  provide: (f) => EditorView.decorations.from(f),
});

/* ---------------- ```html preview (Render HTML button) ---------------- */

/** Toggle the rendered state of the ```html block whose opening fence starts at
 *  the given position. Tracked in editor state so we can BOTH show the iframe and
 *  hide the source code block while rendered. */
export const toggleHtmlRender = StateEffect.define<number>();

/** Positions (opening-fence line starts) whose ```html block is rendered. */
export const htmlRenderedState = StateField.define<readonly number[]>({
  create: () => [],
  update(value, tr) {
    let v = tr.docChanged ? value.map((p) => tr.changes.mapPos(p, 1)) : value;
    for (const e of tr.effects) {
      if (e.is(toggleHtmlRender)) {
        v = v.includes(e.value) ? v.filter((x) => x !== e.value) : [...v, e.value];
      }
    }
    return v;
  },
});

/** "Render HTML" / "Hide HTML" toggle for a ```html fenced block. Collapsed it
 *  sits above the code (which stays visible); rendered it REPLACES the code block
 *  with a full-width sandboxed iframe (scripts run but isolated — no same-origin,
 *  so a saved page can't touch the vault/app). */
class HtmlPreviewWidget extends WidgetType {
  private onResize: (() => void) | null = null;
  constructor(readonly code: string, readonly key: number, readonly rendered: boolean) {
    super();
  }
  eq(o: HtmlPreviewWidget) {
    return o.key === this.key && o.rendered === this.rendered && o.code === this.code;
  }
  ignoreEvent() {
    return false;
  }
  toDOM(view: EditorView) {
    const wrap = document.createElement('div');
    wrap.className = 'cm-html-preview' + (this.rendered ? ' is-rendered' : '');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'cm-html-render-btn';
    btn.textContent = this.rendered ? 'Hide HTML' : 'Render HTML';
    btn.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      view.dispatch({ effects: toggleHtmlRender.of(this.key) });
    });
    wrap.appendChild(btn);
    if (this.rendered) {
      const frame = document.createElement('iframe');
      frame.className = 'cm-html-render-frame';
      frame.setAttribute('sandbox', 'allow-scripts allow-popups allow-forms allow-modals');
      frame.srcdoc = this.code;
      wrap.appendChild(frame);
      // Break out of the readable-line-width column to the full editor width.
      // (.is-rendered CSS centres on the scroller via left:50%/translateX; we just
      //  feed it the scroller's pixel width and keep it in sync on resize.)
      const sync = () => {
        wrap.style.width = view.scrollDOM.clientWidth + 'px';
      };
      requestAnimationFrame(sync);
      this.onResize = sync;
      window.addEventListener('resize', sync);
    }
    return wrap;
  }
  destroy() {
    if (this.onResize) window.removeEventListener('resize', this.onResize);
  }
}

function buildHtmlPreview(state: EditorState): DecorationSet {
  if (!state.field(livePreviewState, false) || !state.facet(renderContext).allowHtmlExecution) return Decoration.none;
  const doc = state.doc;
  const renderedKeys = state.field(htmlRenderedState, false) ?? [];
  const ranges: Range<Decoration>[] = [];
  for (let n = 1; n <= doc.lines; n++) {
    const line = doc.line(n);
    const open = line.text.match(/^\s*(`{3,}|~{3,})\s*html\s*$/i);
    if (!open) continue;
    if (blockEffectOwns(state, line)) continue;
    let end = -1;
    for (let j = n + 1; j <= doc.lines; j++) {
      if (doc.line(j).text.trim().startsWith(open[1][0].repeat(3))) {
        end = j;
        break;
      }
    }
    if (end < 0) continue;
    const key = line.from;
    const rendered = renderedKeys.includes(key);
    if (rendered) {
      // Replace the whole block — hides the source code AND shows the iframe.
      const code = end > n + 1 ? doc.sliceString(doc.line(n + 1).from, doc.line(end - 1).to) : '';
      const to = doc.line(end).to;
      ranges.push(
        Decoration.replace({ widget: new HtmlPreviewWidget(code, key, true), block: true }).range(line.from, to),
      );
    } else {
      // Button ABOVE the fence (side:-1) — html blocks can be huge (a whole saved
      // page), so a button after the block would sit off-screen and be unreachable.
      ranges.push(
        Decoration.widget({ widget: new HtmlPreviewWidget('', key, false), block: true, side: -1 }).range(line.from),
      );
    }
    n = end;
  }
  return Decoration.set(ranges, true);
}

export const htmlPreviewField = StateField.define<DecorationSet>({
  create: (state) => buildHtmlPreview(state),
  update(value, tr) {
    if (
      decorationInputsChanged(tr, false) || tr.effects.some((e) => e.is(toggleHtmlRender))
    ) {
      return buildHtmlPreview(tr.state);
    }
    return value.map(tr.changes);
  },
  provide: (f) => EditorView.decorations.from(f),
});

/* ---------------- callout folding (only `-` defaults to folded) ---------------- */

export const toggleCalloutFold = StateEffect.define<number>();

const QUOTE_LINE_RE = /^ {0,3}>/;
const QUOTE_MARKERS_RE = /^(?: {0,3}> ?)+/;

/**
 * Positions (title-line starts) whose fold state the user TOGGLED. The effective
 * state is `default(- = folded) XOR toggled`, so `[!x]-` callouts are folded by
 * default no matter when the document content arrives (async load, sync, …).
 */
export const calloutFoldState = StateField.define<readonly number[]>({
  create: () => [],
  update(value, tr) {
    let v = tr.docChanged ? value.map((p) => tr.changes.mapPos(p, 1)) : value;
    for (const e of tr.effects) {
      if (e.is(toggleCalloutFold)) {
        v = v.includes(e.value) ? v.filter((x) => x !== e.value) : [...v, e.value];
      }
    }
    return v;
  },
});

/** Effective fold state of the callout whose title line starts at `titleFrom`. */
function isCalloutFolded(state: EditorState, titleFrom: number, foldChar: string): boolean {
  const toggled = (state.field(calloutFoldState, false) ?? []).includes(titleFrom);
  return (foldChar === '-') !== toggled;
}

function buildCalloutFolds(state: EditorState): DecorationSet {
  if (!state.field(livePreviewState, false)) return Decoration.none;
  const claimed: { from: number; to: number }[] = [];
  const ranges: Range<Decoration>[] = [];
  for (const block of state.field(blockModel).containers) {
    if (block.kind !== 'callout' || !isCalloutFolded(state, block.from, block.fold) || sourceIsOpen(state, block) || blockEffectOwns(state, block)) continue;
    if (block.bodyFrom >= block.to) continue;
    const from = Math.max(block.from, block.bodyFrom - 1);
    if (from >= block.to || claimed.some((outer) => from >= outer.from && block.to <= outer.to)) continue;
    claimed.push({ from, to: block.to });
    // Keep the trailing title control outside the folded body boundary.
    ranges.push(Decoration.replace({ block: true, inclusiveStart: false }).range(from, block.to));
  }
  return Decoration.set(ranges, true);
}

export const calloutFoldDeco = StateField.define<DecorationSet>({
  create: (state) => buildCalloutFolds(state),
  update(value, tr) {
    if (decorationInputsChanged(tr, false) || tr.startState.field(calloutFoldState) !== tr.state.field(calloutFoldState)) {
      return buildCalloutFolds(tr.state);
    }
    return value.map(tr.changes);
  },
  provide: (f) => EditorView.decorations.from(f),
});

/* ---------------- tables ---------------- */

type TableBlock = TableModel;

class TableWidget extends WidgetType {
  private cleanup = new WeakMap<HTMLElement, (() => void)[]>();
  constructor(readonly block: TableBlock, readonly ro: boolean, readonly mathDependencies: string) { super(); }
  eq(o: TableWidget) { return o.block.key === this.block.key && o.block.from === this.block.from && o.ro === this.ro && o.mathDependencies === this.mathDependencies; }
  ignoreEvent() { return true; }
  destroy(dom: HTMLElement) { this.cleanup.get(dom)?.forEach(stop => stop()); }
  toDOM(view: EditorView) {
    const b = this.block, context = contextOf(view);
    const wrap = document.createElement('div'); wrap.className = 'cm-table-wrap';
    const frame = document.createElement('div'); frame.className = 'cm-table-frame'; wrap.appendChild(frame);
    const cleanup: (() => void)[] = []; this.cleanup.set(wrap, cleanup);
    if (!this.ro) frame.appendChild(sourceButton(view, b, 'table'));
    const table = document.createElement('table'); table.className = 'cm-table'; frame.appendChild(table);
    const apply = (changes: SourceChange[]) => {
      if (view.state.readOnly || view.state.sliceDoc(b.from, b.to) !== b.key) return;
      view.dispatch({ changes });
    };
    const structural = (operation: TableOperation) => apply(changeTable(b, operation));
    b.rows.forEach((row, ri) => {
      const section = ri === 0 ? document.createElement('thead') : table.querySelector('tbody') ?? document.createElement('tbody');
      const tr = document.createElement('tr');
      for (let col = 0; col < b.align.length; col++) {
        const cell = document.createElement(ri === 0 ? 'th' : 'td');
        cell.className = 'cm-cell-edit'; cell.style.textAlign = b.align[col] ?? '';
        const token = row.cells[col];
        const raw = token?.text ?? '';
        let stop: (() => void) | undefined;
        let editing = false;
        const mount = (mode: 'live' | 'reading') => {
          stop?.(); cell.replaceChildren();
          const host = document.createElement('div'); cell.appendChild(host);
          stop = context.mountFragment?.(host, raw, {
            id: context.sourcePath + ':cell:' + ri + ':' + col, sourceFrom: token?.from ?? row.to,
            equations: { ...equationsOf(view.state), from: equationsOf(view.state).from + (token?.from ?? row.to) },
            mathSource: { model: context.mathSource?.model ?? view.state.field(syntaxModel),
              from: (context.mathSource?.from ?? 0) + (token?.from ?? row.to) },
            mode, autoFocus: mode === 'live',
            onCommit: (value) => { editing = false; if (value !== raw) apply([editTableCell(b, ri, col, value)]); else mount('reading'); },
          });
          if (!stop) host.textContent = raw;
        };
        cleanup.push(() => stop?.()); mount('reading');
        if (!this.ro && b.editable) {
          cell.addEventListener('click', (e) => {
            if (editing || (e.target as HTMLElement).closest('a,button,input')) return;
            editing = true; mount('live');
          });
          cell.addEventListener('keydown', (e) => {
            if ((e.key === 'Enter' && !e.shiftKey || e.key === 'Escape') && !e.isComposing) {
              e.preventDefault(); e.stopPropagation();
              if (e.key === 'Escape') { editing = false; mount('reading'); } else (document.activeElement as HTMLElement)?.blur();
            }
          }, true);
          cell.addEventListener('contextmenu', (e) => {
            e.preventDefault(); e.stopPropagation(); if (editing) return;
            context.openMenu({ x: e.clientX, y: e.clientY, items: [
              { label: 'Insert column left', onClick: () => structural({ kind: 'insertColumn', column: col }) },
              { label: 'Insert column right', onClick: () => structural({ kind: 'insertColumn', column: col + 1 }) },
              { label: 'Insert row above', onClick: () => structural({ kind: 'insertRow', row: Math.max(0, ri - 1) }) },
              { label: 'Insert row below', onClick: () => structural({ kind: 'insertRow', row: ri }) },
              { label: 'Move column left', onClick: () => structural({ kind: 'moveColumn', column: col, to: col - 1 }) },
              { label: 'Move column right', onClick: () => structural({ kind: 'moveColumn', column: col, to: col + 1 }) },
              ...(ri > 0 ? [
                { label: 'Move row up', onClick: () => structural({ kind: 'moveRow', row: ri - 1, to: ri - 2 }) },
                { label: 'Move row down', onClick: () => structural({ kind: 'moveRow', row: ri - 1, to: ri }) },
              ] : []),
              ...(['left', 'center', 'right'] as const).map(align => ({ label: 'Align ' + align, onClick: () => structural({ kind: 'align', column: col, align }) })),
              { label: 'Delete column', onClick: () => structural({ kind: 'deleteColumn', column: col }) },
              ...(ri > 0 ? [{ label: 'Delete row', onClick: () => structural({ kind: 'deleteRow', row: ri - 1 }) }] : []),
            ] });
          });
        }
        tr.appendChild(cell);
      }
      section.appendChild(tr); if (!section.parentNode) table.appendChild(section);
    });
    if (!this.ro && b.editable) {
      for (const [className, title, action] of [
        ['cm-table-addrow', 'Add row', () => structural({ kind: 'insertRow', row: b.rows.length - 1 })],
        ['cm-table-addcol', 'Add column', () => structural({ kind: 'insertColumn', column: b.align.length })],
      ] as const) {
        const button = document.createElement('button'); button.type = 'button'; button.className = className; button.title = title; button.textContent = '+';
        button.onmousedown = event => { event.preventDefault(); if (!wrap.querySelector('[contenteditable="true"]')) action(); };
        frame.appendChild(button);
      }
    }
    return wrap;
  }
}

class BulletWidget extends WidgetType {
  eq() {
    return true;
  }
  toDOM() {
    const s = document.createElement('span');
    s.className = 'cm-bullet';
    s.setAttribute('aria-hidden', 'true');
    return s;
  }
}

/* ---------------- raw HTML blocks ---------------- */

// Strip scripts/handlers/dangerous URLs from raw note HTML before rendering it
// inline (Obsidian renders embedded HTML, e.g. CKEditor/Trilium tables, the same).
class HtmlBlockWidget extends WidgetType {
  constructor(readonly html: string, readonly range?: { from: number; to: number }) {
    super();
  }
  eq(o: HtmlBlockWidget) {
    return o.html === this.html;
  }
  toDOM(view: EditorView) {
    const div = document.createElement('div');
    div.className = 'cm-html-block';
    const imageTargets: string[] = [];
    const safe = sanitizeHtml(this.html);
    const parsed = document.createElement('template'); parsed.innerHTML = safe;
    parsed.content.querySelectorAll('img').forEach(img => imageTargets.push(img.getAttribute('src') ?? ''));
    div.innerHTML = sanitizeHtml(this.html, contextOf(view).rawUrl);
    presentHtmlImages(div, imageTargets, () => view.requestMeasure());
    if (!view.state.readOnly && this.range) div.appendChild(sourceButton(view, this.range, 'HTML'));
    div.addEventListener('mousedown', (e) => {
      const a = (e.target as HTMLElement).closest('a');
      if (!a) return;
      e.preventDefault();
      const href = a.getAttribute('href') || '';
      if (/^https?:\/\//i.test(href)) window.open(href, '_blank', 'noopener');
      else if (href && !href.startsWith('#')) contextOf(view).openLink(href.replace(/\.(md|markdown)$/i, ''));
    });
    return div;
  }
  ignoreEvent() {
    return false;
  }
}

/** Locate raw HTML blocks (whole-line ranges) via the markdown syntax tree. */
function scanHtmlBlocks(state: EditorState): { from: number; to: number }[] {
  return state.field(syntaxModel).htmlBlocks.map((range) => ({
    from: state.doc.lineAt(range.from).from,
    to: state.doc.lineAt(Math.max(range.from, range.to - 1)).to,
  }));
}

interface Prop {
  key: string;
  values: string[];
  list: boolean;
  editable?: boolean; scalarType?: string; forceList?: boolean;
}

const stripQuotes = (s: string) => s.replace(/^["'](.*)["']$/, '$1');

// Tags / cssclasses can't contain spaces (invalid in Obsidian) — collapse runs of
// whitespace to a hyphen and drop a leading '#'. Other list values pass through.
function sanitizeListValue(key: string, raw: string): string {
  const v = raw.trim();
  if (key === 'tags' || key === 'cssclasses') return v.replace(/^#+/, '').replace(/\s+/g, '-');
  return v;
}

/** Parse the YAML subset Obsidian uses for properties. */
const parseFrontmatter = readPropertyRows;

// Obsidian's built-in List properties.
const CORE_LIST_PROPS = new Set(['tags', 'aliases', 'cssclasses']);

// Property type → small glyph for the leading icon (display only, like Obsidian).
function propType(p: Prop): string {
  if (p.list || CORE_LIST_PROPS.has(p.key)) return 'list';
  const v = p.values[0] ?? '';
  if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(v)) return 'datetime';
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return 'date';
  if (v !== '' && /^-?\d+(\.\d+)?$/.test(v)) return 'number';
  if (/^(true|false)$/i.test(v)) return 'checkbox';
  return 'text';
}
const TYPE_GLYPH: Record<string, string> = {
  text: 'T',
  list: '≣',
  date: '🗓',
  datetime: '🕒',
  number: '#',
  checkbox: '☑',
};

// Obsidian type id ↔ our display type.
const OBS_TO_DT: Record<string, string> = {
  text: 'text',
  multitext: 'list',
  tags: 'list',
  aliases: 'list',
  number: 'number',
  checkbox: 'checkbox',
  date: 'date',
  datetime: 'datetime',
};
function dtToObs(dt: string, key: string): string {
  if (dt === 'list') return key === 'tags' ? 'tags' : key === 'aliases' ? 'aliases' : 'multitext';
  return dt;
}
/** Effective display type: the vault registry wins, else inferred from the value. */
function displayTypeOf(p: Prop, registry: Record<string, string>): string {
  const reg = registry[p.key];
  if (reg && OBS_TO_DT[reg]) return OBS_TO_DT[reg];
  return propType(p);
}
// The six selectable types shown in the right-click "Property type" submenu.
const PROP_TYPE_OPTIONS: { label: string; dt: string }[] = [
  { label: 'Text', dt: 'text' },
  { label: 'List', dt: 'list' },
  { label: 'Number', dt: 'number' },
  { label: 'Checkbox', dt: 'checkbox' },
  { label: 'Date', dt: 'date' },
  { label: 'Date & time', dt: 'datetime' },
];

class FrontmatterWidget extends WidgetType {
  /** `ro` = reading mode: display-only properties. */
  constructor(readonly yaml: string, readonly ro: boolean) {
    super();
  }
  eq(o: FrontmatterWidget) {
    return o.yaml === this.yaml && o.ro === this.ro;
  }
  ignoreEvent() {
    return true;
  }
  toDOM(view: EditorView) {
    const box = document.createElement('div');
    box.className = 'properties cm-properties';
    const range = view.state.field(syntaxModel).frontmatter;
    if (!this.ro && range) box.appendChild(sourceButton(view, range, 'properties'));

    // Commit source patches only, preserving every unrelated YAML token.
    const commit = (props: Prop[]) => {
      if (view.state.readOnly) return;
      const text = view.state.doc.toString();
      const fm = text.match(/^---\n([\s\S]*?)\n---[ \t]*(?:\n|$)/);
      try {
        if (!fm || fm[1] !== this.yaml) throw new Error('Properties changed while editing; draft was not written');
        const offset = fm[0].indexOf('\n') + 1;
        const changes = patchPropertyRows(this.yaml, props).map((change) => ({ ...change, from: change.from + offset, to: change.to + offset }));
        if (changes.length) view.dispatch({ changes, userEvent: 'input.properties' });
        view.focus();
      } catch (error) { contextOf(view).reportError?.((error as Error).message); }
    };
    const readProps = (): Prop[] =>
      ([...box.querySelectorAll('.prop-row:not(.prop-newrow)')] as HTMLElement[]).map((row) => ({
        key: (row.querySelector('.prop-key') as HTMLElement).innerText,
        list: row.dataset.list === '1',
        scalarType: (row.querySelector('.prop-val-field') as HTMLElement | null)?.dataset.propertyType,
        values:
          row.dataset.list === '1'
            ? ([...row.querySelectorAll('.prop-pill')] as HTMLElement[]).map((p) => p.dataset.val ?? '')
            : [(row.querySelector('.prop-val-field') as HTMLElement)?.dataset.raw ?? ''],
      }));
    // Flush an in-progress inline edit (pill text or scalar text) into its data
    // attribute so a concurrent structural change never drops it.
    const flushActive = () => {
      const a = document.activeElement as HTMLElement | null;
      if (!a) return;
      if (a.classList.contains('prop-pill-text')) {
        const pill = a.closest('.prop-pill') as HTMLElement | null;
        const rowKey = (a.closest('.prop-row')?.querySelector('.prop-key') as HTMLElement | null)?.innerText.trim() ?? '';
        if (pill) pill.dataset.val = sanitizeListValue(rowKey, a.innerText);
      } else if (a.classList.contains('prop-val-input')) {
        a.dataset.raw = a.innerText;
      }
    };
    const mutate = (fn: (p: Prop[]) => void) => {
      flushActive();
      const p = readProps();
      fn(p);
      commit(p);
    };

    // Change a property's type: persist to .obsidian/types.json, then convert the
    // note's YAML if list-ness changed (else just refresh the icon in place).
    const setType = async (key: string, dt: string) => {
      try {
        const types = await contextOf(view).setPropertyType(key, dtToObs(dt, key));
        void types;
      } catch {
        /* keep going with local change */
      }
      const row = ([...box.querySelectorAll('.prop-row:not(.prop-newrow)')] as HTMLElement[]).find(
        (r) => (r.querySelector('.prop-key') as HTMLElement).innerText.trim() === key,
      );
      const curIsList = row?.dataset.list === '1';
      const newIsList = dt === 'list';
      if (newIsList !== curIsList) {
        mutate((ps) => {
          const p = ps.find((x) => x.key === key);
          if (!p) return;
          p.forceList = true;
          if (newIsList) p.list = true;
          else {
            p.list = false;
            p.values = [p.values.filter(Boolean).join(', ')];
          }
        });
      } else if (row) {
        // Scalar → scalar: no YAML change needed; just refresh the icon and swap
        // the value control to match the new type (e.g. date → number input).
        const ic = row.querySelector('.prop-icon') as HTMLElement | null;
        if (ic) {
          ic.textContent = TYPE_GLYPH[dt] ?? 'T';
          ic.title = dt;
        }
        const valCell = row.querySelector('.prop-val');
        const oldField = row.querySelector('.prop-val-field') as HTMLElement | null;
        if (valCell && oldField) valCell.replaceChild(makeScalarField(dt, oldField.dataset.raw ?? ''), oldField);
      }
    };

    const propMenu = (key: string, idx: number, curDt: string): LpMenuItem[] => [
      {
        label: 'Property type',
        icon: 'list',
        submenu: PROP_TYPE_OPTIONS.map((o) => ({
          label: (o.dt === curDt ? '✓  ' : '  ') + o.label,
          onClick: () => void setType(key, o.dt),
        })),
      },
      { label: '', separator: true },
      {
        label: 'Copy value',
        icon: 'file-text',
        onClick: () => {
          const p = readProps()[idx];
          if (p) navigator.clipboard.writeText(p.values.join(', ')).catch(() => {});
        },
      },
      { label: '', separator: true },
      { label: 'Remove', icon: 'trash-2', onClick: () => mutate((ps) => ps.splice(idx, 1)) },
    ];

    const props = parseFrontmatter(this.yaml);

    const header = document.createElement('div');
    header.className = 'cm-props-header';
    header.textContent = 'Properties';
    box.appendChild(header);
    if (!canEditProperties(this.yaml)) {
      const hint = document.createElement('div'); hint.className = 'prop-unsupported';
      hint.textContent = 'Complex or invalid YAML. Use the source entry to edit.'; box.appendChild(hint); return box;
    }

    const editable = (el: HTMLElement, onCommit: () => void) => {
      if (this.ro) return; // reading mode: no inline editing
      el.setAttribute('contenteditable', 'true');
      el.spellcheck = false;
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          el.blur();
        }
      });
      el.addEventListener('blur', onCommit);
    };

    // A value editor whose control matches the property type. `dataset.raw` always
    // holds the canonical YAML value so readProps never rewrites untouched fields.
    const makeScalarField = (dt: string, value: string): HTMLElement => {
      const commitChange = () => mutate(() => {});
      if (dt === 'number') {
        const inp = document.createElement('input');
        inp.type = 'number';
        inp.className = 'prop-val-field prop-input';
        inp.value = value;
        inp.dataset.raw = value;
        inp.addEventListener('change', () => {
          inp.dataset.raw = inp.value;
          commitChange();
        });
        inp.dataset.propertyType = dt;
        return inp;
      }
      if (dt === 'checkbox') {
        const inp = document.createElement('input');
        inp.type = 'checkbox';
        inp.className = 'prop-val-field prop-checkbox';
        const on = /^(true|yes|1)$/i.test(value);
        inp.checked = on;
        inp.dataset.raw = value;
        inp.addEventListener('change', () => {
          inp.dataset.raw = inp.checked ? 'true' : 'false';
          commitChange();
        });
        inp.dataset.propertyType = dt;
        return inp;
      }
      if (dt === 'date' || dt === 'datetime') {
        const inp = document.createElement('input');
        inp.type = dt === 'date' ? 'date' : 'datetime-local';
        inp.className = 'prop-val-field prop-input';
        if (dt === 'date') {
          inp.value = value.slice(0, 10);
        } else {
          const m = value.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/);
          inp.value = m ? `${m[1]}T${m[2]}` : '';
        }
        inp.dataset.raw = value;
        inp.addEventListener('change', () => {
          inp.dataset.raw = inp.value;
          commitChange();
        });
        inp.dataset.propertyType = dt;
        return inp;
      }
      // text (default)
      const span = document.createElement('span');
      span.className = 'prop-val-field prop-val-input';
      span.dataset.raw = value;
      span.textContent = value;
      editable(span, () => {
        if (span.innerText !== span.dataset.raw) {
          span.dataset.raw = span.innerText;
          mutate(() => {});
        }
      });
      span.dataset.propertyType = dt;
      return span;
    };

    // Add an item to a list property via a typed input + suggestion dropdown
    // (vault tags for the `tags` property; free text otherwise), like Obsidian.
    const startAddItem = async (key: string, idx: number, container: HTMLElement, addBtn: HTMLElement) => {
      addBtn.style.display = 'none';
      const inp = document.createElement('span');
      inp.className = 'prop-pill-input';
      inp.setAttribute('contenteditable', 'true');
      inp.spellcheck = false;
      const dd = document.createElement('div');
      dd.className = 'cm-props-dropdown prop-val-dropdown';
      container.insertBefore(inp, addBtn);
      // Mount inside the theme wrapper (not <body>) so the CSS variables that give
      // the dropdown its background resolve — otherwise it renders transparent.
      const host = (document.querySelector('.theme-light, .theme-dark') as HTMLElement) ?? document.body;
      host.appendChild(dd);
      // Fixed-position just below the input (viewport coords; rect forces reflow).
      const ir = inp.getBoundingClientRect();
      dd.style.left = `${Math.round(ir.left)}px`;
      dd.style.top = `${Math.round(ir.bottom + 2)}px`;
      inp.focus();

      const suggestions = key === 'tags' ? await contextOf(view).tags() : [];
      const existing = new Set(([...container.querySelectorAll('.prop-pill')] as HTMLElement[]).map((p) => p.dataset.val));
      let done = false;
      const cleanup = () => {
        if (container.contains(inp)) inp.remove();
        dd.remove();
        addBtn.style.display = '';
      };
      const choose = (val: string) => {
        if (done) return;
        done = true;
        const vv = sanitizeListValue(key, val);
        // Always tear down first: the dropdown is mounted on the theme wrapper
        // (outside the widget DOM), so mutate()'s rebuild won't remove it — skip
        // this and the suggester stays stuck on screen after picking a value.
        cleanup();
        if (!vv) return;
        mutate((ps) => ps[idx]?.values.push(vv));
      };
      const render = () => {
        const q = inp.innerText.trim().toLowerCase();
        const matches = suggestions.filter((s) => !existing.has(s) && s.toLowerCase().includes(q));
        dd.textContent = '';
        for (const s of matches) {
          const it = document.createElement('div');
          it.className = 'cm-props-dd-item';
          const ic = document.createElement('span');
          ic.className = 'prop-icon';
          ic.textContent = '#';
          const nm = document.createElement('span');
          nm.textContent = s;
          it.append(ic, nm);
          it.addEventListener('mousedown', (e) => {
            e.preventDefault();
            choose(s);
          });
          dd.appendChild(it);
        }
        dd.style.display = matches.length ? 'block' : 'none';
      };
      render();
      inp.addEventListener('input', render);
      inp.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          choose(inp.innerText);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          done = true;
          cleanup();
        }
      });
      inp.addEventListener('blur', () =>
        setTimeout(() => {
          if (!done) {
            if (inp.innerText.trim()) choose(inp.innerText);
            else cleanup();
          }
        }, 160),
      );
    };

    props.forEach((p, idx) => {
      const dt = displayTypeOf(p, contextOf(view).propertyTypes());
      const renderAsList = dt === 'list' || p.list;
      const row = document.createElement('div');
      row.className = 'prop-row';
      row.dataset.list = renderAsList ? '1' : '0';

      const icon = document.createElement('span');
      icon.className = 'prop-icon';
      icon.textContent = TYPE_GLYPH[renderAsList ? 'list' : dt] ?? 'T';
      icon.title = renderAsList ? 'list' : dt;

      const k = document.createElement('span');
      k.className = 'prop-key';
      k.textContent = p.key;
      editable(k, () => mutate(() => {}));

      // Right-click the key or icon → Property type / Copy / Remove (like Obsidian).
      const openPropMenu = (e: MouseEvent) => {
        if (this.ro || p.editable === false) return;
        e.preventDefault();
        e.stopPropagation();
        contextOf(view).openMenu({ x: e.clientX, y: e.clientY, items: propMenu(p.key, idx, renderAsList ? 'list' : dt) });
      };
      k.addEventListener('contextmenu', openPropMenu);
      icon.addEventListener('contextmenu', openPropMenu);
      icon.style.cursor = 'pointer';
      // Left-click the icon also opens the menu. Use `click` (not `mousedown`):
      // openPropMenu stops propagation, so the trailing click never reaches the
      // window close-listener — opening on mousedown let that click slam it shut
      // again (the "jitter / won't open" on left-click).
      icon.addEventListener('click', openPropMenu);

      const v = document.createElement('div');
      v.className = 'prop-val';
      if (renderAsList) {
        for (const val of p.values) {
          const pill = document.createElement('span');
          pill.className = 'prop-pill';
          pill.dataset.val = val;
          if (/^tags?$/i.test(p.key)) pill.dataset.nativeTag = val.replace(/^#/, '');
          const txt = document.createElement('span');
          txt.className = 'prop-pill-text';
          txt.textContent = val;
          txt.setAttribute('contenteditable', 'true');
          txt.spellcheck = false;
          txt.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              txt.blur();
            }
          });
          txt.addEventListener('blur', () => {
            const nv = sanitizeListValue(p.key, txt.innerText);
            if (nv !== pill.dataset.val) {
              pill.dataset.val = nv;
              txt.textContent = nv; // reflect the sanitized value
              mutate(() => {});
            } else if (txt.innerText !== nv) {
              txt.textContent = nv;
            }
          });
          const x = document.createElement('span');
          x.className = 'prop-pill-x';
          x.textContent = '×';
          x.addEventListener('mousedown', (e) => {
            e.preventDefault();
            mutate((ps) => {
              const pp = ps[idx];
              if (!pp) return;
              const i = pp.values.indexOf(pill.dataset.val ?? '');
              if (i >= 0) pp.values.splice(i, 1);
            });
          });
          pill.append(txt, x);
          v.appendChild(pill);
        }
        const add = document.createElement('span');
        add.className = 'prop-pill-add';
        add.textContent = '+';
        add.title = 'Add item';
        add.addEventListener('mousedown', (e) => {
          e.preventDefault();
          void startAddItem(p.key, idx, v, add);
        });
        v.appendChild(add);
      } else {
        v.appendChild(makeScalarField(dt, p.values[0] ?? ''));
      }

      const del = document.createElement('span');
      del.className = 'prop-del';
      del.textContent = '×';
      del.title = 'Delete property';
      del.addEventListener('mousedown', (e) => {
        e.preventDefault();
        mutate((ps) => ps.splice(idx, 1));
      });

      row.append(icon, k, v, del);
      if (p.editable === false) {
        row.classList.add('prop-unsupported');
        row.querySelectorAll('[contenteditable]').forEach((element) => element.removeAttribute('contenteditable'));
        row.querySelectorAll('.prop-del, .prop-pill-x, .prop-pill-add').forEach((element) => element.remove());
        for (const input of row.querySelectorAll('input')) { input.readOnly = true; input.tabIndex = -1; }
      }
      box.appendChild(row);
    });

    const addBtn = document.createElement('div');
    addBtn.className = 'cm-props-add';
    addBtn.textContent = '+ Add property';

    // Add a property with a name-suggester dropdown (existing vault keys), like Obsidian.
    const startAdd = async () => {
      addBtn.style.display = 'none';
      const editorRow = document.createElement('div');
      editorRow.className = 'prop-row prop-newrow';
      const icon = document.createElement('span');
      icon.className = 'prop-icon';
      icon.textContent = 'T';
      const input = document.createElement('span');
      input.className = 'prop-key prop-new-key';
      input.setAttribute('contenteditable', 'true');
      input.spellcheck = false;
      const dd = document.createElement('div');
      dd.className = 'cm-props-dropdown';
      editorRow.append(icon, input);
      box.insertBefore(editorRow, addBtn);
      box.insertBefore(dd, addBtn);
      input.focus();

      const existing = new Set(readProps().map((p) => p.key));
      const all = (await contextOf(view).properties()).filter((p) => !existing.has(p.key));

      let done = false;
      const choose = (key: string, type: string) => {
        if (done) return;
        done = true;
        const k = key.trim();
        if (!k) {
          cleanup();
          return;
        }
        mutate((ps) => ps.push({ key: k, values: type === 'list' ? [] : [''], list: type === 'list' }));
      };
      const cleanup = () => {
        if (box.contains(editorRow)) editorRow.remove();
        if (box.contains(dd)) dd.remove();
        addBtn.style.display = '';
      };
      const renderDD = () => {
        const q = input.innerText.trim().toLowerCase();
        const matches = all.filter((p) => p.key.toLowerCase().includes(q)); // scrollable, show all
        dd.textContent = '';
        for (const p of matches) {
          const it = document.createElement('div');
          it.className = 'cm-props-dd-item';
          const ic = document.createElement('span');
          ic.className = 'prop-icon';
          ic.textContent = TYPE_GLYPH[p.type] ?? 'T';
          const nm = document.createElement('span');
          nm.textContent = p.key;
          it.append(ic, nm);
          it.addEventListener('mousedown', (e) => {
            e.preventDefault();
            choose(p.key, p.type);
          });
          dd.appendChild(it);
        }
        dd.style.display = matches.length ? 'block' : 'none';
      };
      renderDD();
      input.addEventListener('input', renderDD);
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          choose(input.innerText, 'text');
        } else if (e.key === 'Escape') {
          e.preventDefault();
          done = true;
          cleanup();
        }
      });
      input.addEventListener('blur', () => {
        // Allow a dropdown mousedown to win first; otherwise cancel an empty add.
        setTimeout(() => {
          if (!done) {
            if (input.innerText.trim()) choose(input.innerText, 'text');
            else cleanup();
          }
        }, 160);
      });
    };
    addBtn.addEventListener('mousedown', (e) => {
      e.preventDefault();
      void startAdd();
    });
    box.appendChild(addBtn);
    // Reading mode: strip any remaining editing affordances (pill texts, inputs).
    if (this.ro) {
      for (const el of box.querySelectorAll('[contenteditable]')) el.removeAttribute('contenteditable');
      for (const inp of box.querySelectorAll('input')) {
        inp.readOnly = true; inp.tabIndex = -1;
        inp.addEventListener('click', (event) => event.preventDefault());
      }
    }
    return box;
  }
}

/* ---------------- helpers ---------------- */

// Obsidian line/span classes (§20): HyperMD-header-N lines, cm-header-N spans.
const HEADING_LEVEL: Record<string, number> = {
  ATXHeading1: 1, ATXHeading2: 2, ATXHeading3: 3,
  ATXHeading4: 4, ATXHeading5: 5, ATXHeading6: 6,
};

const EMPHASIS_CLASS: Record<string, string> = {
  StrongEmphasis: 'cm-strong',
  Emphasis: 'cm-em',
  InlineCode: 'cm-inline-code cm-code',
  Strikethrough: 'cm-strikethrough cm-strike',
};

const hidden = Decoration.replace({});

function attachmentUrl(target: string, view: EditorView): string {
  return contextOf(view).rawUrl(target);
}

function buildDecorations(view: EditorView): DecorationSet {
  const all: Range<Decoration>[] = [];
  const sel = view.state.field(compositionSelection).selection;
  const doc = view.state.doc;

  // Overlap guard: two content-replacing decorations may not overlap, or CM
  // throws and the whole plugin is disabled. Track claimed replace ranges and
  // skip any new replace that collides. Marks/line decos don't need this.
  const replaced: { from: number; to: number }[] = [];
  const pushReplace = (from: number, to: number, deco: Decoration) => {
    if (from >= to) return;
    for (const r of replaced) if (from < r.to && to > r.from) return;
    replaced.push({ from, to });
    all.push(deco.range(from, to));
  };

  // selection overlaps [from,to] (inclusive) → reveal raw syntax for that span.
  // In reading mode (readonly) nothing is ever revealed — same render, no edit.
  const readonly = view.state.field(livePreviewReadonly, false) ?? false;
  const touches = (from: number, to: number) => {
    if (readonly || forceRendered(view.state, { from, to })) return false;
    for (const r of sel.ranges) if (r.empty && r.from <= to && r.to >= from) return true;
    return false;
  };
  const lineActive = (pos: number) => {
    if (readonly) return false;
    const line = doc.lineAt(pos);
    return touches(line.from, line.to);
  };

  const { commentLines, inlineMathByLine, mathRanges } = view.state.field(blockModel);
  // Frontmatter range (rendered by frontmatterField) — the regex passes skip it.
  const fmEnd = view.state.field(syntaxModel).frontmatter?.to ?? 0;

  // Tables are rendered as block widgets by `tableField`. When a table is shown
  // (selection not inside it) the plugin must NOT decorate inside its range, or
  // its inline replaces would collide with the block widget. Editable tables
  // (selection inside) get normal raw-markdown handling.
  const tables = view.state.field(blockModel).tables.filter((table) => !sourceIsOpen(view.state, table));
  const renderedTable = (from: number, to: number) =>
    tables.some((t) => from >= t.from && to <= t.to);

  // Raw HTML blocks are rendered by `htmlBlockField` (block widget). Same rule as
  // tables: skip plugin decorations inside a block that's shown (caret outside).
  const htmlBlocks = scanHtmlBlocks(view.state);
  const renderedHtml = (from: number, to: number) =>
    htmlBlocks.some((h) => from >= h.from && to <= h.to && !touches(h.from, h.to));

  // Inline code and code blocks are literal — wikilink/embed/link/tag syntax
  // inside them must stay raw (e.g. `![[file]]` in backticks is not an embed).
  const model = view.state.field(syntaxModel);
  const equationInfo = equationsOf(view.state);
  for (const equation of equationInfo.equations) {
    if (!equation.anchor) continue;
    const from = equation.anchor.from - equationInfo.from, to = equation.anchor.to - equationInfo.from;
    if (from >= 0 && to <= doc.length && !lineActive(from)) pushReplace(from, to, Decoration.replace({}));
  }
  const codeRanges = [...model.literal, ...model.html, ...model.entities, ...view.state.field(blockModel).math];
  const inCode = (from: number, to: number, ignoreMath = false) => {
    for (const r of codeRanges) if (from < r.to && to > r.from) return true;
    return !ignoreMath && mathRanges.some(r => r.kind === 'dollar' && from < r.to && to > r.from);
  };

  const tree = view.state.field(syntaxModel).tree;

  for (const { from, to } of view.visibleRanges) {
    tree.iterate({
      from,
      to,
      enter: (node) => {
        const name = node.name;
        if (blockEffectOwns(view.state, node) || sourceOwns(view.state, node) ||
          mathRanges.some(formula => formula.kind === 'dollar' && node.from >= formula.from && node.to <= formula.to)) return false;

        // Record code spans/blocks so the regex passes below can skip them.
        if (name === 'InlineCode' || name === 'FencedCode' || name === 'CodeBlock') {
          codeRanges.push({ from: node.from, to: node.to });
        }

        // Don't decorate inside a rendered table/HTML block — their fields own it.
        if (renderedTable(node.from, node.to) || renderedHtml(node.from, node.to)) return;

        // Code block lines: HyperMD-codeblock(-begin/-end) like Obsidian.
        // The ``` fences are concealed while the caret is outside the block.
        // Indented code (4 spaces): mono font, NO background — just the indent
        // guide on the leading unit, like Obsidian.
        if (name === 'CodeBlock') {
          const first = doc.lineAt(node.from).number;
          const last = doc.lineAt(Math.min(node.to, doc.length)).number;
          for (let i = first; i <= last; i++) {
            const l = doc.line(i);
            all.push(Decoration.line({ class: 'HyperMD-codeblock' }).range(l.from, l.from));
            const ws = l.text.match(/^(\t| {4})/);
            if (ws) all.push(Decoration.mark({ class: 'cm-indent' }).range(l.from, l.from + ws[1].length));
          }
          return;
        }

        if (name === 'FencedCode') {
          const first = doc.lineAt(node.from).number;
          const last = doc.lineAt(Math.min(node.to, doc.length)).number;
          const blockTouched = touches(node.from, Math.min(node.to, doc.length));
          // language from the fence info-string (§7) → flair label top-right
          const code = view.state.field(blockModel).containers.find((block) => block.kind === 'code' && block.from === doc.line(first).from);
          const lang = code?.language ?? '';
          for (let i = first; i <= last; i++) {
            const l = doc.line(i);
            const logical = stripQuotePrefix(l.text, code?.depth ?? 0);
            const prefixLength = l.text.length - logical.length;
            const isFence = /^\s*(`{3,}|~{3,})/.test(logical);
            all.push(
              Decoration.line({
                class:
                  'HyperMD-codeblock HyperMD-codeblock-bg' +
                  (i === first ? ' HyperMD-codeblock-begin' : '') +
                  (i === last ? ' HyperMD-codeblock-end' : ''),
                attributes: i === first && lang ? { 'data-lang': lang } : undefined,
              }).range(l.from, l.from),
            );
            if (!blockTouched && isFence && (i === first || i === last) && l.to > l.from) {
              pushReplace(l.from, l.to, hidden);
            } else if (!blockTouched && prefixLength) pushReplace(l.from, l.from + prefixLength, hidden);
          }
          return;
        }

        // Body-local titles keep native text/caret ownership and ordinary link targets.
        if (name === BODY_HEADING_NODE) {
          const line = doc.lineAt(node.from);
          const parts = bodyHeadingParts(doc.sliceString(node.from, node.to))!;
          all.push(Decoration.line({ class: 'cm-body-heading', attributes: {
            role: 'heading', 'aria-level': String(BODY_HEADING_LEVEL),
          } }).range(line.from));
          const marks = [{ from: node.from, to: node.from + parts.contentFrom }];
          if (parts.closingFrom !== null) marks.push({ from: node.from + parts.closingFrom, to: node.to });
          for (const mark of marks) {
            if (!lineActive(node.from)) pushReplace(mark.from, mark.to, hidden);
            else if (mark.to > mark.from) all.push(Decoration.mark({ class: 'cm-formatting cm-formatting-header' }).range(mark.from, mark.to));
          }
          return;
        }

        // Headings: size the line; conceal "# " unless caret on the line.
        if (HEADING_LEVEL[name]) {
          const line = doc.lineAt(node.from);
          const lv = HEADING_LEVEL[name];
          all.push(
            Decoration.line({ class: `cm-h${lv} HyperMD-header HyperMD-header-${lv}${!doc.sliceString(fmEnd, line.from).trim() ? ' cm-leading-heading' : ''}${lineActive(node.from) ? "" : " cm-heading-labelled"}`, attributes: { "data-heading-label": `H${lv}` } }).range(line.from, line.from),
          );
          const m = doc.sliceString(line.from, line.to).match(/^((?: {0,3}> ?)*)(#{1,6}\s+)/);
          if (m) {
            if (!lineActive(node.from)) pushReplace(line.from + m[1].length, line.from + m[1].length + m[2].length, hidden);
            else
              all.push(
                Decoration.mark({ class: 'cm-formatting cm-formatting-header' }).range(
                  line.from + m[1].length,
                  line.from + m[1].length + m[2].length,
                ),
              );
          }
          return;
        }

        // Inline emphasis / code / strikethrough: always style; conceal marks
        // only when the caret is outside the span.
        if (EMPHASIS_CLASS[name]) {
          all.push(Decoration.mark({ class: EMPHASIS_CLASS[name] }).range(node.from, node.to));
          const ownsCaret = touches(node.from, node.to) && !model.nodes.some((child) =>
            EMPHASIS_CLASS[child.name] && child.from >= node.from && child.to <= node.to &&
            (child.from !== node.from || child.to !== node.to) && touches(child.from, child.to));
          if (!ownsCaret) {
            const sn = node.node;
            for (let c = sn.firstChild; c; c = c.nextSibling) {
              if (/Mark$/.test(c.name)) pushReplace(c.from, c.to, hidden);
            }
          }
          return;
        }
      },
    });
  }

  // Regex passes (links, images, wikilinks, tasks, bullets, blockquotes, tags).
  for (const { from, to } of view.visibleRanges) {
    const startLine = doc.lineAt(from).number;
    const endLine = doc.lineAt(to).number;
    for (let ln = startLine; ln <= endLine; ln++) {
      const line = doc.line(ln);
      const text = line.text;
      if (blockEffectOwns(view.state, line) || sourceOwns(view.state, line)) continue;

      // Skip lines covered by a rendered table / HTML block widget.
      if (renderedTable(line.from, line.to) || renderedHtml(line.from, line.to)) continue;
      // Skip the frontmatter block (rendered by frontmatterField).
      if (line.to <= fmEnd) continue;
      // Skip lines fully inside code (fences) — bullets/tags there are literal.
      if (codeRanges.some((r) => r.from <= line.from && r.to >= line.to)) continue;
      // Whole-line %% block comment region → grey out, keep raw.
      if (commentLines.has(ln)) {
        all.push(Decoration.line({ class: 'cm-comment' }).range(line.from, line.from));
        continue;
      }

      // Inline-HTML paragraph line (e.g. `<u>…</u> và <mark>…`): Lezer only marks
      // block-level openers as HTMLBlock, so render whole-line inline HTML here.
      if (/^<[a-zA-Z][^>]*>/.test(text) && !lineActive(line.from) && !view.state.field(syntaxModel).html.some((tag) => tag.from >= line.from && tag.to <= line.to)) {
        pushReplace(line.from, line.to, Decoration.replace({ widget: new HtmlBlockWidget(text, { from: line.from, to: line.to }) }));
        continue;
      }

      // Horizontal rule: `---` / `***` / `___` → <hr> when the caret is elsewhere.
      if (/^ {0,3}([-*_])(?:\s*\1){2,}\s*$/.test(text) && !inCode(line.from, line.to)) {
        all.push(Decoration.line({ class: 'HyperMD-hr' }).range(line.from, line.from));
        if (!lineActive(line.from) && line.to > line.from) {
          pushReplace(line.from, line.to, Decoration.replace({ widget: new HrWidget() }));
        }
        continue;
      }

      // Blockquote / callout (callout regex + colors/icons per §7/§21).
      // `bodyStart` = offset past the `>` markers so list/task handling below
      // also works INSIDE quotes and callouts.
      let bodyStart = 0;
      if (QUOTE_LINE_RE.test(text)) {
        const prefix = text.match(QUOTE_MARKERS_RE)![0];
        bodyStart = prefix.length;
        const header = view.state.field(blockModel).containers.find((block) => block.kind === 'callout' && block.from === line.from);
        if (header) {
          const slot = CALLOUT_SLOT[header.type] ?? 'default';
          const folded = isCalloutFolded(view.state, header.from, header.fold);
          if (!touches(line.from, header.prefixTo)) {
            pushReplace(line.from, header.prefixTo, Decoration.replace({
              widget: new CalloutHeadWidget(slot, header.title ? '' : calloutDefaultTitle(header.type)),
            }));
          }
          all.push(Decoration.widget({
            widget: new CalloutFoldWidget(folded, header.from), side: -1,
          }).range(line.to));
          if (header.title && header.titleFrom < line.to) all.push(Decoration.mark({ class: 'cm-callout-title' }).range(header.titleFrom, line.to));
          bodyStart = header.prefixTo - line.from;
        } else if (!touches(line.from, line.from + bodyStart)) pushReplace(line.from, line.from + bodyStart, hidden);
      }

      // Task checkbox + bullet — applied to the line body (works in quotes /
      // callouts too). Per §7 any single char is a valid status and any
      // non-space status counts as checked (no hard-coded custom-state list).
      const body = bodyStart ? text.slice(bodyStart) : text;
      const bodyFrom = line.from + bodyStart;
      const prefix = body.match(/^\s*(?:[-*+]|\d+[.)])\s+(?:\[.\]\s+)?/);
      if (prefix) all.push(Decoration.line({ attributes: {
        'data-list-body-start': String(bodyFrom + prefix[0].length),
      } }).range(line.from));
      // Use the same indentation unit as contextual Tab, not a fixed four spaces.
      const indentGuides = (ws: string) => {
        let i = 0;
        while (i < ws.length) {
          const end = Math.min(i + (ws[i] === '\t' ? 1 : getIndentUnit(view.state)), ws.length);
          all.push(Decoration.mark({ class: 'cm-indent' }).range(bodyFrom + i, bodyFrom + end));
          i = end;
        }
      };
      const task = body.match(/^(\s*)([-*+])\s+\[(.)\]\s/);
      if (task) {
        all.push(
          Decoration.line({
            class: 'HyperMD-list-line HyperMD-task-line',
            attributes: { 'data-task': task[3] },
          }).range(line.from, line.from),
        );
        indentGuides(task[1]);
        const boxPos = bodyFrom + task[1].length + task[2].length + 2;
        if (!touches(line.from, boxPos + 2)) {
          pushReplace(bodyFrom + task[1].length, boxPos + 2, Decoration.replace({ widget: new CheckboxWidget(task[3] !== ' ', boxPos) }));
        }
      } else {
        const bullet = body.match(/^(\s*)([-*+])(\s+)/);
        if (bullet) {
          all.push(Decoration.line({ class: 'HyperMD-list-line' }).range(line.from, line.from));
          indentGuides(bullet[1]);
          // Replace the `-`/`*`/`+` marker with a bullet and collapse its trailing
          // whitespace to a single space, so `-   Item` reads `• Item` like Obsidian.
          const start = bodyFrom + bullet[1].length;
          const markerEnd = start + 1;
          const spaceEnd = markerEnd + bullet[3].length;
          if (!touches(start, markerEnd)) {
            pushReplace(start, markerEnd, Decoration.replace({ widget: new BulletWidget() }));
            if (bullet[3].length > 1) pushReplace(markerEnd + 1, spaceEnd, hidden);
          }
        } else {
          // Ordered list: keep the `1.` but collapse extra spaces after it.
          const ol = body.match(/^(\s*)(\d{1,9}[.)])(\s+)/);
          if (ol) {
            all.push(Decoration.line({ class: 'HyperMD-list-line' }).range(line.from, line.from));
            indentGuides(ol[1]);
            if (ol[3].length > 1) {
              const markerEnd = bodyFrom + ol[1].length + ol[2].length;
              const spaceEnd = markerEnd + ol[3].length;
              if (!touches(bodyFrom + ol[1].length, spaceEnd)) pushReplace(markerEnd + 1, spaceEnd, hidden);
            }
          }
        }
      }

      // Inline tags → pill styling. Charset per §7; an editor tag must contain a
      // letter and a pure-number tag (#123) is not a tag.
      const tagRe = /(^|\s)(#[^ -⁯⸀-⹿'!"#$%&()*+,.:;<=>?@^`{|}~[\]\\\s]+)/g;
      let tm: RegExpExecArray | null;
      while ((tm = tagRe.exec(text))) {
        const tag = tm[2];
        if (/^#\d+$/.test(tag) || !/\p{L}/u.test(tag)) continue;
        const s = line.from + tm.index + tm[1].length;
        if (inCode(s, s + tag.length)) continue;
        all.push(Decoration.mark({ class: 'cm-hashtag cm-hashtag-begin cm-tag', attributes: { 'data-native-tag': tag.slice(1) } }).range(s, s + 1));
        all.push(Decoration.mark({ class: 'cm-hashtag cm-hashtag-end cm-tag', attributes: { 'data-native-tag': tag.slice(1) } }).range(s + 1, s + tag.length));
      }

      // Footnote definition `[^1]: text` → superscript marker, brackets concealed.
      const fdef = text.match(/^\[\^([^\]\s]+)\]:/);
      if (fdef) {
        all.push(Decoration.line({ class: 'HyperMD-footnote' }).range(line.from, line.from));
        all.push(Decoration.mark({ class: 'cm-footref' }).range(line.from + 2, line.from + 2 + fdef[1].length));
        if (!lineActive(line.from)) {
          pushReplace(line.from, line.from + 2, hidden);
          const close = line.from + 2 + fdef[1].length;
          pushReplace(close, close + 2, hidden);
        }
      }

      // ==Highlight== → <mark>-style; conceal the markers when the caret is outside.
      const hlRe = /==(?![\s=])(.+?)==/g;
      let m: RegExpExecArray | null;
      while ((m = hlRe.exec(text))) {
        const s = line.from + m.index;
        const e = s + m[0].length;
        if (inCode(s, e)) continue;
        all.push(Decoration.mark({ class: 'cm-highlight' }).range(s + 2, e - 2));
        if (!touches(s, e)) {
          pushReplace(s, s + 2, hidden);
          pushReplace(e - 2, e, hidden);
        } else {
          all.push(Decoration.mark({ class: 'cm-formatting cm-formatting-highlight' }).range(s, s + 2));
          all.push(Decoration.mark({ class: 'cm-formatting cm-formatting-highlight' }).range(e - 2, e));
        }
      }

      // %%Comment%% — greyed out (dropped from reading view, visible faint in editor).
      const cmtRe = /%%(.+?)%%/g;
      while ((m = cmtRe.exec(text))) {
        const s = line.from + m.index;
        const e = s + m[0].length;
        if (inCode(s, e)) continue;
        all.push(Decoration.mark({ class: 'cm-comment' }).range(s, e));
      }

      // Formula boundaries are shared with snippets, diagnostics and formatting.
      for (const formula of inlineMathByLine.get(line.number) ?? []) {
        const s=formula.from,e=formula.to;
        if(inCode(s,e,true))continue;
        if(!mathSourceVisible(view.state,formula))pushReplace(s,e,Decoration.replace({widget:numberedMath(view.state,formula.tex,formula.display,formula)}));
        else all.push(Decoration.mark({class:'cm-math'}).range(s,e));
      }

      // Footnote refs [^id] (not a definition) → superscript.
      const fnRe = /\[\^([^\]\s]+)\](?!:)/g;
      while ((m = fnRe.exec(text))) {
        const s = line.from + m.index;
        const e = s + m[0].length;
        if (inCode(s, e)) continue;
        all.push(Decoration.mark({ class: 'cm-footref' }).range(s, e));
      }

      // Inline footnote ^[note] → superscript styling for the whole token (§7).
      const ifnRe = /\^\[([^\]]+)\]/g;
      while ((m = ifnRe.exec(text))) {
        const s = line.from + m.index;
        const e = s + m[0].length;
        if (inCode(s, e)) continue;
        all.push(Decoration.mark({ class: 'cm-footref' }).range(s, e));
      }

      // Trailing block id ` ^abc-123` (charset [a-zA-Z0-9-] only, §7).
      const bid = text.match(/(^|\s)(\^[a-zA-Z0-9-]+)$/);
      if (bid) {
        const s = line.to - bid[2].length;
        all.push(Decoration.mark({ class: 'cm-blockid' }).range(s, line.to));
      }

      // Bare URLs → styled like links (Obsidian cm-url).
      const urlRe = /(^|[\s(<])((?:https?|ftp):\/\/[^\s<>)"']+)/g;
      while ((m = urlRe.exec(text))) {
        const s = line.from + m.index + m[1].length;
        const e = s + m[2].length;
        if (inCode(s, e)) continue;
        all.push(Decoration.mark({ class: 'cm-url' }).range(s, e));
      }

      // Wikilinks / embeds — alias after the FIRST `|`; default display text
      // `href.split('#').filter(Boolean).join(' > ')`; nested `[[` rejected (§7).
      let hasRenderedImage = false;
      const wikiRe = /(!?)\[\[(.+?)\]\]/g;
      while ((m = wikiRe.exec(text))) {
        const s = line.from + m.index;
        const e = s + m[0].length;
        if (touches(s, e) || inCode(s, e)) continue;
        const inner = m[2];
        if (inner.includes('[[')) continue;
        const isEmbed = m[1] === '!';
        const pi = inner.indexOf('|');
        const href = (pi > 0 ? inner.slice(0, pi) : inner)
          .replace(/\\$/, '')
          .replace(/ /g, ' ')
          .trim()
          .normalize('NFC');
        const alias = pi > 0 ? inner.slice(pi + 1).trim() : null;
        const defaultDisplay = href.split('#').filter(Boolean).join(' > ');
        if (isEmbed && /\.(bmp|png|jpe?g|gif|svg|webp|avif)$/i.test(href.split(/[?#]/)[0])) {
          // image size param: the LAST `|` segment, `300` or `300x200`
          let w: number | undefined;
          let h: number | undefined;
          let caption = alias ?? href;
          if (pi > 0) {
            const segs = inner.split('|');
            const sm = segs[segs.length - 1].match(/^\s*([0-9]+)\s*(?:x\s*([0-9]+)\s*)?$/);
            if (sm) {
              w = Number(sm[1]);
              h = sm[2] ? Number(sm[2]) : undefined;
              caption = segs.slice(1, -1).join('|') || href;
            }
          }
          hasRenderedImage = true;
          pushReplace(s, e, Decoration.replace({ widget: new ImageWidget(attachmentUrl(href, view), caption, w, h, readonly, href) }));
        } else if (isEmbed && (VIDEO_EXT_RE.test(href) || AUDIO_EXT_RE.test(href))) {
          // `![[clip.mp4]]` / `![[song.mp3]]` → native HTML5 player like Obsidian.
          const kind = VIDEO_EXT_RE.test(href) ? 'video' : 'audio';
          // width param (video only): last `|` segment `300` / `300x200`
          let w: number | undefined;
          if (kind === 'video' && pi > 0) {
            const segs = inner.split('|');
            const sm = segs[segs.length - 1].match(/^\s*([0-9]+)\s*(?:x\s*[0-9]+\s*)?$/);
            if (sm) w = Number(sm[1]);
          }
          pushReplace(s, e, Decoration.replace({ widget: new MediaWidget(attachmentUrl(href, view), href, kind, w) }));
        } else if (isEmbed && (/\.(?:md|markdown)$/i.test(href.split('#')[0]) || !/\.[a-z0-9]{1,5}$/i.test(href.split('#')[0]))) {
          // `![[note]]` (no binary extension) → real transclusion like Obsidian.
          pushReplace(s, e, Decoration.replace({ widget: new NoteEmbedWidget(href) }));
        } else {
          // LP shows the raw target text (`Note#Head`); the `Note > Head` display
          // form is reading-view behaviour and goes into aria-label like Obsidian.
          const label = alias || href;
          pushReplace(
            s,
            e,
            Decoration.replace({ widget: new WikilinkWidget(href, label, isEmbed, defaultDisplay !== label ? defaultDisplay : undefined, alias === null, alias === null && /#[\^=]/.test(href) ? equationsOf(view.state).revision : undefined) }),
          );
        }
      }

      // Markdown images ![alt](url) — URL may contain spaces (real-world vaults)
      const imgRe = /!\[([^\]]*)\]\(([^)]+)\)/g;
      while ((m = imgRe.exec(text))) {
        const s = line.from + m.index;
        const e = s + m[0].length;
        if (touches(s, e) || inCode(s, e)) continue;
        // size param lives in the alt text: `![alt|300](url)` / `![|300x200](url)`
        let alt = m[1];
        let w: number | undefined;
        let h: number | undefined;
        const ai = alt.lastIndexOf('|');
        if (ai >= 0) {
          const sm = alt.slice(ai + 1).match(/^\s*([0-9]+)\s*(?:x\s*([0-9]+)\s*)?$/);
          if (sm) {
            w = Number(sm[1]);
            h = sm[2] ? Number(sm[2]) : undefined;
            alt = alt.slice(0, ai);
          }
        }
        const url = m[2].replace(/\s+"[^"]*"$/, '').trim();
        // Browser-loadable URLs load directly; anything else (a relative path or
        // any custom scheme) is resolved by basename via the vault file index.
        const webLoadable = /^(https?|data|blob|file):/i.test(url);
        const src = webLoadable ? url : attachmentUrl(url, view);
        hasRenderedImage = true;
        pushReplace(s, e, Decoration.replace({ widget: new ImageWidget(src, alt, w, h, readonly, url) }));
      }

      const imageOnly = text.replace(/^(?: {0,3}> ?)*/, '')
        .replace(/!\[\[[^\]]+\]\]|!\[[^\]]*\]\([^)]+\)/g, '').trim() === '';
      if (imageOnly && hasRenderedImage && !lineActive(line.from)) all.push(Decoration.line({ class: 'cm-image-row' }).range(line.from));

      // Markdown links [text](url) — not preceded by ! (those are images)
      const linkRe = /(?<!\!)\[([^\]]+?)\]\(([^)]+)\)/g;
      while ((m = linkRe.exec(text))) {
        const s = line.from + m.index;
        const e = s + m[0].length;
        if (touches(s, e) || inCode(s, e)) continue;
        const url = m[2].replace(/\s+"[^"]*"$/, '').trim();
        pushReplace(s, e, Decoration.replace({ widget: new MdLinkWidget(m[1], url) }));
      }

      // Markdown escapes `\.` `\*` … — conceal the backslash like Obsidian LP
      // (e.g. Trilium/turndown exports escape `2\.` to avoid list parsing).
      // MUST run LAST: pushReplace's overlap guard would otherwise block math/
      // link widgets whose range contains an escape (e.g. `\,` inside $$…$$).
      if (!lineActive(line.from)) {
        const escRe = /\\([!"#$%&'()*+,\-./:;<=>?@[\]^_`{|}~])/g;
        let em: RegExpExecArray | null;
        while ((em = escRe.exec(text))) {
          const s = line.from + em.index;
          if (inCode(s, s + 2)) continue;
          pushReplace(s, s + 1, hidden);
        }
      }
    }
  }

  return Decoration.set(all, true);
}

/* ---------------- frontmatter (block widget; needs a StateField) ---------------- */

function buildFrontmatter(state: EditorState): DecorationSet {
  if (!state.field(livePreviewState, false)) return Decoration.none;
  const text = state.doc.toString();
  const fm = text.match(/^---\r?\n([\s\S]*?)\r?\n---[ \t]*(\r?\n|$)/);
  if (!fm) return Decoration.none;
  const end = fm[0].length;
  const blockEnd = text[end - 1] === '\n' ? end - 1 : end;
  if (sourceIsOpen(state, { from: 0, to: blockEnd })) return Decoration.none;
  // Always show the interactive Properties editor (like Obsidian); editing happens
  // in the widget, so the caret no longer reveals raw YAML in Live mode.
  const ro = state.field(livePreviewReadonly, false) ?? false;
  return Decoration.set([
    Decoration.replace({ widget: new FrontmatterWidget(fm[1], ro), block: true }).range(0, blockEnd),
  ]);
}

/* ---------------- inline title (note filename, Obsidian-style) ---------------- */

class TitleWidget extends WidgetType {
  constructor(readonly title: string) {
    super();
  }
  eq(o: TitleWidget) {
    return o.title === this.title;
  }
  toDOM() {
    const d = document.createElement('div');
    d.className = 'cm-inline-title';
    d.textContent = this.title;
    return d;
  }
}

export const setNoteTitle = StateEffect.define<string>();

export const noteTitleField = StateField.define<string>({
  create: () => '',
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setNoteTitle)) return e.value;
    return value;
  },
});

function buildInlineTitle(state: EditorState): DecorationSet {
  if (!state.field(livePreviewState, false)) return Decoration.none;
  const title = state.field(noteTitleField, false) ?? '';
  if (!title) return Decoration.none;
  // Skip when the note already opens with an H1 equal to the title — the Trilium
  // export repeats the title as a heading, and Obsidian would otherwise show it twice.
  const head = state.doc.sliceString(0, Math.min(state.doc.length, 2000));
  const noFm = head.replace(/^---\r?\n[\s\S]*?\r?\n---[ \t]*\r?\n?/, '');
  const firstLine = noFm.split(/\r?\n/).find((l) => l.trim() !== '');
  const h1 = firstLine?.match(/^#\s+(.+?)\s*$/);
  if (h1 && h1[1].trim().toLowerCase() === title.trim().toLowerCase()) return Decoration.none;
  return Decoration.set([Decoration.widget({ widget: new TitleWidget(title), block: true, side: -1 }).range(0)]);
}

export const inlineTitleField = StateField.define<DecorationSet>({
  create: (state) => buildInlineTitle(state),
  update(value, tr) {
    if (tr.docChanged || tr.effects.some((e) => e.is(setNoteTitle) || e.is(setLivePreviewEnabled))) {
      return buildInlineTitle(tr.state);
    }
    return value.map(tr.changes);
  },
  provide: (f) => EditorView.decorations.from(f),
});

export const frontmatterField = StateField.define<DecorationSet>({
  create: (state) => buildFrontmatter(state),
  update(value, tr) {
    if (decorationInputsChanged(tr, false)) {
      return buildFrontmatter(tr.state);
    }
    return value.map(tr.changes);
  },
  provide: (f) => EditorView.decorations.from(f),
});

/* ---------------- tables (block widgets; need a StateField) ---------------- */

function buildTables(state: EditorState): DecorationSet {
  if (!state.field(livePreviewState, false)) return Decoration.none;
  const tables = state.field(blockModel).tables.filter((table) => !sourceIsOpen(state, table) && !blockEffectOwns(state, table));
  if (!tables.length) return Decoration.none;
  const ro = state.field(livePreviewReadonly, false) ?? false;
  const source = state.facet(renderContext).mathSource;
  const model = source?.model ?? state.field(syntaxModel);
  const equations = equationsOf(state);
  // Source version alone changes on every keystroke. Cells depend on prior
  // definitions and reference presentation, not unrelated paragraph edits.
  const referenceKey = tables.some(t => t.key.includes('[[')) ? JSON.stringify([equations.prefix,
    equations.equations.map(e => [e.id, e.tag, e.number, e.ambiguous, e.tex])]) : '';
  // Like Obsidian, tables are ALWAYS shown as the interactive widget (never as raw
  // pipes) — editing happens in-cell, so the selection no longer reveals raw.
  const ranges: Range<Decoration>[] = tables.map((t) =>
    Decoration.replace({ widget: new TableWidget(t, ro, JSON.stringify([
      t.key.includes('[[') ? referenceKey : '', mathDefinitionContext(model, t.to + (source?.from ?? 0)),
    ])), block: true }).range(t.from, t.to),
  );
  return Decoration.set(ranges, true);
}

export const tableField = StateField.define<DecorationSet>({
  create: (state) => buildTables(state),
  update(value, tr) {
    if (decorationInputsChanged(tr, false)) {
      return buildTables(tr.state);
    }
    return value.map(tr.changes);
  },
  provide: (f) => EditorView.decorations.from(f),
});

/* ---------------- raw HTML blocks (block widgets; need a StateField) ---------------- */

function buildHtmlBlocks(state: EditorState): DecorationSet {
  if (!state.field(livePreviewState, false)) return Decoration.none;
  const blocks = scanHtmlBlocks(state);
  if (!blocks.length) return Decoration.none;
  const ro = state.field(livePreviewReadonly, false) ?? false;
  const ranges: Range<Decoration>[] = [];
  for (const b of blocks) {
    if (sourceIsOpen(state, b) || blockEffectOwns(state, b)) continue;
    let touched = false;
    if (!ro && !forceRendered(state, b))
      for (const r of state.field(compositionSelection).selection.ranges) {
        if (r.empty && r.from <= b.to && r.to >= b.from) {
          touched = true;
          break;
        }
      }
    if (touched) continue;
    const html = state.doc.sliceString(b.from, b.to);
    ranges.push(Decoration.replace({ widget: new HtmlBlockWidget(html, b), block: true }).range(b.from, b.to));
  }
  return Decoration.set(ranges, true);
}

export const htmlBlockField = StateField.define<DecorationSet>({
  create: (state) => buildHtmlBlocks(state),
  update(value, tr) {
    if (decorationInputsChanged(tr)) {
      return buildHtmlBlocks(tr.state);
    }
    return value.map(tr.changes);
  },
  provide: (f) => EditorView.decorations.from(f),
});

export const livePreviewPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = view.state.field(livePreviewState) ? buildDecorations(view) : Decoration.none;
    }
    update(u: ViewUpdate) {
      if (!u.state.field(livePreviewState)) {
        this.decorations = Decoration.none;
        return;
      }
      if (u.viewportChanged || u.transactions.some((tr) => decorationInputsChanged(tr) ||
        tr.effects.some(effect => effect.is(toggleCalloutFold) || effect.is(toggleHtmlRender))) ||
        foldedRanges(u.startState) !== foldedRanges(u.state)) {
        this.decorations = buildDecorations(u.view);
      }
    }
  },
  { decorations: (v) => v.decorations },
);

export const livePreviewTheme = EditorView.baseTheme({
  // Heading sizes/weights come from the stylesheet (.cm-s-obsidian .HyperMD-header-N,
  // §19 tokens). The theme only strips CodeMirror's default heading underline.
  '.cm-h1, .cm-h2, .cm-h3, .cm-h4, .cm-h5, .cm-h6': { textDecoration: 'none' },
  '.cm-h1 span, .cm-h2 span, .cm-h3 span, .cm-h4 span, .cm-h5 span, .cm-h6 span': {
    textDecoration: 'none !important',
  },
  // Inline title = h1 alias (§19).
  '.cm-inline-title': {
    fontSize: 'var(--h1-size)',
    fontWeight: 'var(--h1-weight)',
    lineHeight: 'var(--line-height-tight)',
    letterSpacing: '-0.015em',
    color: 'var(--text-normal)',
    margin: '0 0 0.5em',
    padding: '0',
  },
  '.cm-em': { fontStyle: 'italic' },
  '.cm-strike': { textDecoration: 'line-through' },
  '.cm-code': {
    fontFamily: 'var(--font-mono)',
    background: 'var(--document-surface)',
    borderRadius: '4px',
    padding: '0.5px 4px',
    fontSize: 'var(--font-smaller)',
  },
  '.cm-bullet': { color: 'var(--text-faint)' },
  // Links: accent-coloured and underlined like Obsidian. `inline-block` gives the
  // browser a soft-wrap opportunity after the widget, so text glued to `]]` in the
  // source (e.g. `]]and`) can still wrap onto the next line as it does in Obsidian.
  '.cm-wikilink, .cm-md-link': {
    color: 'var(--text-accent)',
    cursor: 'pointer',
    textDecoration: 'underline',
    textDecorationThickness: '1px',
    textUnderlineOffset: '2px',
    display: 'inline-block',
    verticalAlign: 'baseline',
  },
  '.cm-wikilink:hover, .cm-md-link:hover': { textDecoration: 'underline' },
  // External-link arrow glyph trailing http(s) links.
  '.cm-external-icon': {
    width: '0.78em',
    height: '0.78em',
    display: 'inline-block',
    verticalAlign: 'baseline',
    margin: '0 1px 0 3px',
    position: 'relative',
    top: '1px',
  },
  '.cm-task-checkbox': { verticalAlign: 'middle', marginRight: '4px', cursor: 'pointer' },
  '.cm-properties': { margin: '4px 0 18px' },
  // Compound `.cm-line.cm-blockquote` selector beats CodeMirror's own `.cm-line`
  // padding rule (equal specificity, declared later) so the gap actually applies —
  // otherwise text sits flush against the bar. Blockquote: 3px text-color bar +
  // 24px padding (§19). Callout colors live in obsidian.css (--callout-* slots).
  '.cm-line.cm-blockquote': {
    borderLeft: '3px solid var(--text-normal)',
    paddingLeft: '24px',
    color: 'var(--text-normal)',
  },
  // Markdown tables — mirror Obsidian's table CSS variables
  // (https://docs.obsidian.md/Reference/CSS+variables/Editor/Table): 1px border,
  // left-aligned + top-valigned cells, semibold header with a subtle background.
  '.cm-table': { borderCollapse: 'collapse', margin: '0', width: 'auto' },
  '.cm-table th, .cm-table td': {
    border: '1px solid var(--bg-modifier-border)',
    padding: '4px 10px',
    textAlign: 'left',
    verticalAlign: 'top',
    lineHeight: '1.5',
    position: 'relative',
  },
  '.cm-table th': { fontWeight: '600', background: 'var(--bg-secondary)' },
  // Interactive table editor (Obsidian-style): click-to-edit cells + hover controls.
  '.cm-cell-edit': { outline: 'none', cursor: 'text', minWidth: '1em' },
  '.cm-cell-edit:focus': { boxShadow: 'inset 0 0 0 2px var(--interactive-accent)', background: 'var(--bg-primary)' },
  '.cm-table-addcol, .cm-table-addrow': {
    position: 'absolute',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    color: 'var(--text-faint)',
    background: 'var(--bg-secondary)',
    border: '1px solid var(--bg-modifier-border)',
    borderRadius: '4px',
    opacity: '0',
    fontSize: '14px',
    lineHeight: '1',
    userSelect: 'none',
    transition: 'opacity 0.1s',
  },
  '.cm-table-addcol': { top: '0', right: '-16px', width: '14px', height: '100%' },
  '.cm-table-addrow': { left: '0', bottom: '-16px', height: '14px', width: '100%' },
  '.cm-table-wrap:hover .cm-table-addcol, .cm-table-wrap:hover .cm-table-addrow': { opacity: '1' },
  // Column handle (top strip of each header cell) + row handle (left strip of first cell).
  '.cm-col-handle': { position: 'absolute', top: '0', left: '0', right: '0', height: '5px', cursor: 'pointer' },
  '.cm-row-handle': { position: 'absolute', top: '0', bottom: '0', left: '0', width: '5px', cursor: 'pointer' },
  '.cm-col-handle:hover, .cm-row-handle:hover': { background: 'var(--interactive-accent)' },
  '.cm-cell-hl': { background: 'var(--tag-bg)' },
  '.cm-table-addcol:hover, .cm-table-addrow:hover': {
    color: 'var(--text-accent)',
    background: 'var(--bg-modifier-hover)',
    borderColor: 'var(--interactive-accent)',
  },
  // Raw embedded HTML (e.g. CKEditor/Trilium tables) — table metrics match the
  // reading view (4px 10px cells, semibold header) so both modes look alike.
  '.cm-html-block': { margin: '6px 0' },
  '.cm-html-block table': { borderCollapse: 'collapse', margin: '4px 0', width: 'auto' },
  '.cm-html-block th, .cm-html-block td': {
    border: '1px solid var(--bg-modifier-border)',
    padding: '4px 10px',
    textAlign: 'left',
    verticalAlign: 'top',
    lineHeight: '1.5',
  },
  '.cm-html-block th': { fontWeight: '600', background: 'var(--bg-secondary)' },
  '.cm-html-block ul, .cm-html-block ol': { paddingLeft: '1.4em', margin: '2px 0' },
  '.cm-html-block a': { color: 'var(--text-accent)', textDecoration: 'underline', cursor: 'pointer' },
});
