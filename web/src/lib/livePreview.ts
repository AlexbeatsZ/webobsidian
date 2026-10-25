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
import { markdownListLine } from './listLayout';
import { CALLOUT_SLOT, calloutDefaultTitle, calloutIconSvg } from './callouts';
import { iconPaths, setIcon } from './icons';
import { openLightbox } from './imageLightbox';
import { applyImagePresentation, presentHtmlImages, markdownImageAt } from './imagePresentation';
import { VIDEO_EXT_RE, AUDIO_EXT_RE } from './media';
import { syntaxModel, blockModel, equationsOf, documentMetadata } from './syntaxModel';
import { compositionSelection } from './inlineHtml';
import { sourceButton, sourceIsOpen, sourceOwns, forceRendered } from './sourceControls';
import { livePreviewState, livePreviewReadonly, setLivePreviewEnabled, setLivePreviewReadonly } from './renderState';
export { livePreviewState, livePreviewReadonly, setLivePreviewEnabled, setLivePreviewReadonly } from './renderState';
import { BODY_HEADING_NODE, BODY_HEADING_LEVEL, bodyHeadingParts, changeTable, editTableCell, type SourceChange, type TableModel, type TableOperation, type MathRegion, canEditProperties, patchPropertyRows, readPropertyRows, stripQuotePrefix, sourceLinePrefix, caretTouches, sanitizeHtmlFragment as sanitizeHtml } from '@webobsidian/markdown-core';
import { contextOf, renderContext, type RenderMenuItem as LpMenuItem } from './renderContext';
import { followRenderedLink, revealNavigation } from './fragmentNavigation';
import { bindRenderedLink } from './linkPreview';
import { renderMath, readMathMetrics, type MathMetrics, mathDefinitionContext, subscribeMathConfiguration } from './mathjax';
import { editorMathRegions, mathSourceVisible, mathPreview, mathPreviewTex } from './writing/latex/editor_context/mathPresentation';
import { decorationInputsChanged } from './decorationDependencies';
import { blockEffectOwns } from './blocks/model';
import { sourceBlockReplacement, sourceBlockPresentation } from './blockLayout';
import { RenderLifetime } from './obsidian/renderLifetime';
import { equationLabel, equationReferenceLabel, equationReferenceName, equationTarget, equationAt, parseLinkTarget, type Equation, type MarkdownModel } from '@webobsidian/markdown-core';

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

interface EquationLinkMount {
  controller: AbortController; stop?: () => void;
  read: () => { equation: Equation; model: MarkdownModel; path: string; length: number } | undefined;
}
const equationLinkMounts = new WeakMap<HTMLElement, EquationLinkMount>();

class WikilinkWidget extends WidgetType {
  destroy(dom: HTMLElement) {
    const mount = equationLinkMounts.get(dom); equationLinkMounts.delete(dom);
    mount?.controller.abort(); mount?.stop?.();
  }
  /** `aria` = default display text, set when an alias overrides it (like Obsidian). */
  constructor(readonly target: string, readonly label: string, readonly embed: boolean, readonly aria: string | undefined, readonly alias: string | null, readonly sourceLength: number, readonly sourcePath?: string) {
    super();
  }
  eq(o: WikilinkWidget) {
    return o.target === this.target && o.label === this.label && o.embed === this.embed && o.aria === this.aria && o.alias === this.alias && o.sourceLength === this.sourceLength && o.sourcePath === this.sourcePath;
  }
  toDOM(view: EditorView) {
    const a = document.createElement('a');
    a.className = 'cm-hmd-internal-link cm-wikilink internal-link' + (this.embed ? ' embed' : '');
    a.dataset.menuLink = this.target;
    a.textContent = this.label;
    const destination = parseLinkTarget(this.target);
    if (equationReferenceName(destination.fragment) !== undefined) {
      a.dataset.equationReference = '';
      const context = contextOf(view), controller = new AbortController();
      const mount: EquationLinkMount = { controller, read: () => undefined }; equationLinkMounts.set(a, mount);
      const paint = () => {
        if (controller.signal.aborted) return;
        const preview = mount.read();
        a.textContent = preview ? equationReferenceLabel(preview.equation, this.alias) : this.label;
        a.classList.toggle('is-unresolved', !preview);
      };
      if (!destination.path) {
        mount.read = () => {
          const context = contextOf(view), formulas = equationsOf(view.state);
          const equation = equationTarget(formulas, destination.fragment);
          const model = (formulas === context.equations ? context.mathSource?.model : undefined) ?? view.state.field(syntaxModel);
          return equation ? { equation, model, path: context.sourcePath, length: this.sourceLength } : undefined;
        };
        paint();
      }
      else void context.renderEmbed(this.target, controller.signal).then(note => {
        if (controller.signal.aborted) return;
        if (!note) { paint(); return; }
        mount.read = () => {
          const data = note.read(), equation = data?.equations ? equationTarget(data.equations, destination.fragment) : undefined;
          return equation && data?.mathSource ? { equation, model: data.mathSource.model, path: note.path, length: this.sourceLength } : undefined;
        };
        mount.stop = note.subscribe(paint); paint();
      }).catch(paint);
    }
    if (this.aria && equationReferenceName(destination.fragment) === undefined) a.setAttribute('aria-label', this.aria);
    bindRenderedLink(a, view, this.target);
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
      const from = line.from + m.index;
      const parsed = line.text.slice(m.index, m.index + 3) !== '![[' ? markdownImageAt(view.state.field(syntaxModel), from) : undefined;
      const to = parsed?.to ?? from + m[0].length;
      re.lastIndex = to - line.from;
      if (from <= pos && pos <= to) {
        if (parsed) {
          // Resize only the alt; preserve every byte of the URL/title/payload.
          view.dispatch({ changes: { from: from + 2, to: parsed.altTo, insert: withSize(parsed.alt.split('|')) } });
          return;
        }
        view.dispatch({ changes: { from, to: from + m[0].length, insert: build(m) } });
        return;
      }
    }
  }
}

const imageMounts = new WeakMap<HTMLElement, RenderLifetime>();
class ImageWidget extends WidgetType {
  destroy(dom: HTMLElement) { const lifetime = imageMounts.get(dom); imageMounts.delete(dom); lifetime?.unload(); }
  /** `width`/`height` from the Obsidian size param `![[img|300]]` / `![[img|300x200]]`. */
  constructor(readonly src: string, readonly alt: string, readonly width?: number, readonly height?: number, readonly ro = false, readonly target = src) {
    super();
  }
  eq(o: ImageWidget) {
    return o.src === this.src && o.alt === this.alt && o.width === this.width && o.height === this.height && o.ro === this.ro && o.target === this.target;
  }
  toDOM(view: EditorView) {
    const doc = view.dom.ownerDocument, win = doc.defaultView!;
    const wrap = doc.createElement('span');
    const lifetime = new RenderLifetime(); imageMounts.set(wrap, lifetime);
    let cancelResize: (() => void) | undefined;
    lifetime.register(() => cancelResize?.());
    applyImagePresentation(wrap, this.target, this.alt);
    const img = doc.createElement('img');
    img.src = this.src;
    img.alt = this.alt;
    img.className = 'cm-embed-image image-embed';
    img.draggable = false;
    img.addEventListener('load', () => view.requestMeasure(), { once: true, signal: lifetime.signal });
    if (this.width) img.width = this.width;
    if (this.height) img.height = this.height;
    // Missing attachment → Obsidian-style "could not be found" box.
    img.addEventListener('error', () => {
      cancelResize?.();
      img.remove();
      wrap.querySelectorAll('.cm-image-resize').forEach((h) => h.remove());
      wrap.dataset.renderError = 'image';
      const miss = doc.createElement('span');
      miss.textContent = '';
      wrap.appendChild(miss);
      embedNotFound(miss, this.alt);
    }, { once: true, signal: lifetime.signal });
    // Plain click (no drag) → full-screen zoom/pan viewer.
    img.addEventListener('click', (e) => {
      e.preventDefault();
      openLightbox(this.src, this.alt);
    }, { signal: lifetime.signal });
    wrap.appendChild(img);

    // Drag-to-resize — left/right edge bars; width is written back as `|W`,
    // keeping aspect ratio (height auto), like Obsidian's image resize.
    const startResize = (e: MouseEvent | TouchEvent, side: 'left' | 'right') => {
      if (lifetime.signal.aborted || view.state.readOnly) return;
      cancelResize?.();
      e.preventDefault();
      e.stopPropagation();
      const startX = pointX(e);
      const zoom = Number(win.getComputedStyle(img).zoom) || 1;
      const startW = img.getBoundingClientRect().width / zoom;
      const maxW = Math.max(80, view.contentDOM.clientWidth / zoom);
      let curW = Math.round(startW);
      wrap.classList.add('is-resizing');
      const stopResize = () => {
        win.removeEventListener('mousemove', onMove);
        win.removeEventListener('mouseup', onUp);
        win.removeEventListener('touchmove', onMove);
        win.removeEventListener('touchend', onUp);
        wrap.classList.remove('is-resizing');
        cancelResize = undefined;
      };
      const onMove = (ev: MouseEvent | TouchEvent) => {
        if (cancelResize !== stopResize) return;
        if ('touches' in ev) ev.preventDefault();
        const dx = (pointX(ev) - startX) / zoom;
        curW = Math.min(maxW, Math.max(40, Math.round(side === 'right' ? startW + dx : startW - dx)));
        img.style.width = curW + 'px';
        img.style.height = 'auto';
        img.setAttribute('width', String(curW));
        img.removeAttribute('height');
      };
      const onUp = () => {
        if (cancelResize !== stopResize) return;
        stopResize();
        writeImageWidth(view, wrap, curW);
      };
      cancelResize = stopResize;
      win.addEventListener('mousemove', onMove);
      win.addEventListener('mouseup', onUp);
      win.addEventListener('touchmove', onMove, { passive: false });
      win.addEventListener('touchend', onUp);
    };
    for (const side of (view.state.readOnly ? [] : ['left', 'right']) as ('left' | 'right')[]) {
      const h = document.createElement('span');
      h.className = `cm-image-resize cm-image-resize-${side}`;
      h.addEventListener('mousedown', (e) => startResize(e, side), { signal: lifetime.signal });
      h.addEventListener('touchstart', (e) => startResize(e, side), { passive: false, signal: lifetime.signal });
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

/** Presents the type token/separator; custom title text stays native and editable. */
class CalloutHeadWidget extends WidgetType {
  constructor(readonly slot: string, readonly defaultTitle: string, readonly quoteGap: string) { super(); }
  eq(o: CalloutHeadWidget) { return o.slot === this.slot && o.defaultTitle === this.defaultTitle && o.quoteGap === this.quoteGap; }
  toDOM() {
    const span = document.createElement('span');
    span.className = 'cm-callout-head';
    const icon = document.createElement('span');
    icon.className = 'cm-callout-icon';
    icon.dataset.quoteGap = this.quoteGap;
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
    control.setAttribute('aria-label', this.folded ? '展开 Callout' : '折叠 Callout');
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

/** The same formula source buttons, hosted in the containing Callout's first line. */
class CalloutMathSourcesWidget extends WidgetType {
  constructor(readonly formulas: readonly MathRegion[]) { super(); }
  eq(other: CalloutMathSourcesWidget) {
    return other.formulas.length === this.formulas.length && this.formulas.every((formula, i) => {
      const next = other.formulas[i];
      return formula.from === next.from && formula.to === next.to && formula.bodyFrom === next.bodyFrom && formula.bodyTo === next.bodyTo;
    });
  }
  toDOM(view: EditorView) {
    const controls = document.createElement('span'); controls.className = 'cm-callout-math-sources';
    this.formulas.forEach((formula, i) => controls.appendChild(sourceButton(view, formula,
      this.formulas.length > 1 ? `公式 ${i + 1}` : '公式', { selection: { from: formula.bodyFrom, to: formula.bodyTo } })));
    return controls;
  }
  ignoreEvent() { return true; }
}

/* ---------------- math (locally bundled MathJax, loaded on demand) ---------------- */

// CM can transfer equal widgets' DOM to a new WidgetType instance. Resources
// belong to that DOM mount, so destroy must not depend on the creator instance.
interface MathMount {
  controller?: AbortController; stop: () => void;
  measure(): MathMetrics | undefined;
  render(metrics: MathMetrics): void;
  update(widget: MathWidget): void;
}
const mathMounts = new WeakMap<HTMLElement, MathMount>();
const mathMeasureKey = {};
function scheduleMathMeasure(view: EditorView) {
  view.requestMeasure({ key: mathMeasureKey, read: () => {
    const changes: { dom: HTMLElement; mount: MathMount; metrics: MathMetrics }[] = [];
    for (const dom of view.contentDOM.querySelectorAll<HTMLElement>('.cm-math-rendered')) {
      if (dom.closest('.cm-content') !== view.contentDOM) continue;
      const mount = mathMounts.get(dom), metrics = mount?.measure();
      if (mount && metrics) changes.push({ dom, mount, metrics });
    }
    return changes;
  }, write: changes => {
    for (const { dom, mount, metrics } of changes) if (mathMounts.get(dom) === mount && dom.isConnected) mount.render(metrics);
  } });
}
class MathWidget extends WidgetType {
  destroy(dom: HTMLElement) {
    const mount = mathMounts.get(dom); mathMounts.delete(dom);
    mount?.controller?.abort(); mount?.stop();
  }
  constructor(readonly tex: string, readonly display: boolean, readonly range?: { from: number; to: number }, readonly number?: string, readonly anchor?: string, readonly definitions: readonly string[] = [], readonly preview = false, readonly sourceInTitle = false) {
    super();
  }
  eq(o: MathWidget) {
    return o.tex === this.tex && o.display === this.display && o.range?.from === this.range?.from && o.range?.to === this.range?.to && o.number === this.number && o.anchor === this.anchor && o.preview === this.preview && o.sourceInTitle === this.sourceInTitle && o.definitions.length === this.definitions.length && o.definitions.every((d,i) => d === this.definitions[i]);
  }
  updateDOM(dom: HTMLElement, _view: EditorView, previous: MathWidget) {
    const mount = mathMounts.get(dom);
    if (!mount || this.display !== previous.display || !this.range || this.range.from !== previous.range?.from) return false;
    mount.update(this);
    return true;
  }
  toDOM(view: EditorView) {
    const span = document.createElement('span');
    span.className = 'cm-math-rendered' + (this.display ? ' math-block' : ' math-inline');
    const body = document.createElement('span');
    body.className = 'cm-math-body';
    const status = document.createElement('span'); status.className = 'cm-math-status';
    status.setAttribute('role', 'status'); status.setAttribute('aria-label', '正在渲染公式');
    status.textContent = this.display ? '正在渲染公式…' : '…';
    body.appendChild(status); span.appendChild(body);
    span.dataset.renderPending = 'true';
    span.setAttribute('aria-busy', 'true');
    let widget: MathWidget = this, previous: MathMetrics | undefined, invalid = true;
    const present = () => {
      span.classList.toggle('cm-math-edit-preview', widget.preview);
      span.classList.toggle('cm-numbered-equation', Boolean(widget.number));
      if (widget.anchor) span.dataset.equationId = widget.anchor;
      else delete span.dataset.equationId;
      span.querySelector(':scope > .cm-equation-number')?.remove();
      if (widget.number) {
        const label = document.createElement('span'); label.className = 'cm-equation-number'; label.textContent = widget.number;
        span.appendChild(label);
      }
      span.querySelector(':scope > .cm-source-toggle')?.remove();
      if (widget.display && widget.range && !widget.preview && !widget.sourceInTitle && !view.state.readOnly) {
        const range = widget.range, formula = editorMathRegions(view.state).find(region => region.from === range.from && region.to === range.to);
        span.appendChild(sourceButton(view, range, '公式', {
          selection: formula ? { from: formula.bodyFrom, to: formula.bodyTo } : range }));
      }
    };
    const mount: MathMount = {
      stop: () => {},
      update: next => {
        const changed = widget.tex !== next.tex || widget.preview !== next.preview ||
          widget.definitions.length !== next.definitions.length || widget.definitions.some((definition, index) => definition !== next.definitions[index]);
        widget = next; present();
        if (changed) {
          mount.controller?.abort(); invalid = true;
          span.dataset.renderPending = 'true'; span.setAttribute('aria-busy', 'true');
          scheduleMathMeasure(view);
        }
      },
      measure: () => {
        const container = widget.display ? span.parentElement : view.contentDOM;
        if (!container) return;
        if (!span.isConnected || !container.clientWidth) return;
        const metrics = readMathMetrics(body, container);
        if (!invalid && previous?.em === metrics.em && previous.containerWidth === metrics.containerWidth && previous.family === metrics.family) return;
        return metrics;
      },
      render: metrics => {
        previous = metrics; invalid = false;
        mount.controller?.abort();
        const controller = new AbortController(); mount.controller = controller;
        span.dataset.renderPending = 'true';
        span.setAttribute('aria-busy', 'true');
        if (body.querySelector('[data-mathjax-version]')) status.remove();
        else {
          status.setAttribute('role', 'status'); status.setAttribute('aria-label', '正在渲染公式');
          status.textContent = widget.display ? '正在渲染公式…' : '…';
          body.replaceChildren(status);
        }
        const context = contextOf(view), source = context.mathSource;
        const model = source?.model ?? view.state.field(syntaxModel);
        const from = (widget.range?.from ?? 0) + (source?.from ?? 0);
        void renderMath(body, widget.tex, widget.display, controller.signal, { transient: widget.preview,
          sourcePath: context.sourcePath, definitions: mathDefinitionContext(model, from), metrics })
        .then(() => { if (!controller.signal.aborted) { span.classList.remove('mod-error'); span.removeAttribute('title'); } })
        .catch(error => {
          if (controller.signal.aborted) return;
          span.classList.add('mod-error');
          span.title = `Formula rendering failed: ${error instanceof Error ? error.message : String(error)}`;
          const retry = document.createElement('button'); retry.type = 'button'; retry.textContent = '重试';
          retry.addEventListener('mousedown', event => { event.preventDefault(); event.stopPropagation(); });
          retry.addEventListener('click', event => {
            event.preventDefault(); event.stopPropagation(); invalid = true; scheduleMathMeasure(view);
          });
          status.setAttribute('role', 'alert'); status.removeAttribute('aria-label');
          status.replaceChildren('公式渲染失败 ', retry); body.appendChild(status);
        })
        .finally(() => { if (!controller.signal.aborted) { delete span.dataset.renderPending; span.removeAttribute('aria-busy'); view.requestMeasure(); } });
      },
    };
    mathMounts.set(span, mount);
    mount.stop = subscribeMathConfiguration(() => { invalid = true; scheduleMathMeasure(view); });
    present();
    scheduleMathMeasure(view);
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

function embedNotFound(el: HTMLElement, target: string) {
  el.classList.add('cm-embed-missing');
  el.textContent = `"${target}" could not be found.`;
}

const noteEmbedMounts = new WeakMap<HTMLElement, RenderLifetime>();
class NoteEmbedWidget extends WidgetType {
  destroy(dom: HTMLElement) {
    const lifetime = noteEmbedMounts.get(dom); noteEmbedMounts.delete(dom); lifetime?.unload();
  }
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
    const document = view.dom.ownerDocument;
    const box = document.createElement('div');
    box.className = 'internal-embed markdown-embed cm-note-embed';
    const open = document.createElement('span');
    open.className = 'markdown-embed-link';
    open.title = '打开链接';
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
    const lifetime = new RenderLifetime(); void lifetime.load(); noteEmbedMounts.set(box, lifetime);
    const context = contextOf(view);
    const trail = context.embedTrail ?? [context.sourcePath];
    let active: RenderLifetime | undefined, pending: RenderLifetime | undefined;
    lifetime.register(() => { pending?.unload(); active?.unload(); delete box.dataset.renderPending; });
    if (trail.length > 4) { content.textContent = '嵌入层级已达上限'; return box; }
    box.dataset.renderPending = 'true';
    void context.renderEmbed(this.target, lifetime.signal).then(res => {
      if (lifetime.signal.aborted) return;
      if (!res) { embedNotFound(content, this.target); return; }
      if (trail.includes(res.path)) { content.textContent = '循环嵌入：' + res.path; return; }
      let previous: string | undefined, revision: string | undefined;
      const refresh = () => {
        if (lifetime.signal.aborted) return;
        const fragment = res.read();
        if (!fragment) {
          pending?.unload(); pending = undefined; active?.unload(); active = undefined;
          previous = undefined; revision = undefined; delete box.dataset.renderPending;
          content.textContent = '找不到嵌入的章节或块'; view.requestMeasure(); return;
        }
        if (fragment.source === previous && fragment.equations?.revision === revision) return;
        previous = fragment.source; revision = fragment.equations?.revision; pending?.unload();
        const render = new RenderLifetime(); void render.load(); pending = render;
        box.dataset.renderPending = 'true';
        const host = document.createElement('div'); host.className = 'cm-note-fragment';
        Object.assign(host.style, { height: '0', overflow: 'hidden', visibility: 'hidden', pointerEvents: 'none' });
        content.appendChild(host);
        render.register(() => host.remove());
        const failed = (error: unknown) => {
          if (render.signal.aborted || lifetime.signal.aborted || pending !== render) return;
          render.unload(); pending = undefined; previous = undefined; revision = undefined;
          delete box.dataset.renderPending;
          const status = document.createElement('span'); status.setAttribute('role', 'alert');
          status.textContent = '无法加载嵌入内容';
          if (!active) content.replaceChildren(status);
          else { content.querySelector(':scope > [role="alert"]')?.remove(); content.appendChild(status); }
          context.reportError?.(String(error)); view.requestMeasure();
        };
        const options = { id: res.path, sourceFrom: fragment.from, equations: fragment.equations, mathSource: fragment.mathSource,
          context: { ...res.context, embedTrail: [...trail, res.path] },
          onError: failed,
          onReady: () => {
            if (render.signal.aborted || lifetime.signal.aborted || pending !== render) return;
            active?.unload(); active = render; pending = undefined;
            host.removeAttribute('style'); content.replaceChildren(host);
            delete box.dataset.renderPending; view.requestMeasure();
          },
        };
        try {
          const stop = context.mountFragment?.(host, fragment.source, options);
          if (!stop) { failed(new Error('Markdown fragment renderer is unavailable')); return; }
          render.register(stop);
        } catch (error) { failed(error); }
      };
      lifetime.register(res.subscribe(refresh)); refresh();
    }).catch(error => {
      if (!lifetime.signal.aborted) { content.textContent = '无法加载嵌入内容'; context.reportError?.(String(error)); view.requestMeasure(); }
    }).finally(() => {
      if (!lifetime.signal.aborted && !pending) { delete box.dataset.renderPending; view.requestMeasure(); }
    });
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
const mermaidMounts = new WeakMap<HTMLElement, { update: (widget: MermaidWidget) => void; destroy: () => void }>();

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
  updateDOM(dom: HTMLElement) {
    const mount = mermaidMounts.get(dom);
    if (!mount) return false;
    mount.update(this); return true;
  }
  toDOM(view: EditorView) {
    const doc = view.dom.ownerDocument;
    const div = doc.createElement('div');
    div.className = 'mermaid cm-mermaid';
    const body = doc.createElement('div');
    div.appendChild(body);
    let widget: MermaidWidget = this, current: RenderLifetime | undefined;
    const status = doc.createElement('span');
    const render = () => {
      current?.unload();
      const lifetime = new RenderLifetime(), renderId = `cm-mmd-${++mermaidSeq}`;
      current = lifetime; void lifetime.load();
      const code = widget.code, stage = doc.createElement('div');
      Object.assign(stage.style, { position: 'absolute', visibility: 'hidden', pointerEvents: 'none' });
      lifetime.register(() => stage.remove());
      div.dataset.renderPending = 'true'; div.setAttribute('aria-busy', 'true');
      div.classList.remove('mod-error'); div.removeAttribute('title');
      if (body.querySelector('svg')) status.remove();
      else { status.setAttribute('role', 'status'); status.textContent = '正在渲染图表…'; body.replaceChildren(status); }
      void ensureMermaid()
        .then(async mermaid => {
          lifetime.assertActive();
          await Promise.all(['MathJax_Main', 'MathJax_Math', 'Noto Serif SC'].map(font => doc.fonts.load('16px "' + font + '"')));
          lifetime.assertActive(); doc.body.appendChild(stage);
          return mermaid.render(renderId, code, stage);
        })
        .then(({ svg }) => {
          if (!lifetime.signal.aborted) { body.innerHTML = svg; view.requestMeasure(); }
        })
        .catch((err) => {
          if (lifetime.signal.aborted) return;
          div.classList.add('mod-error');
          div.title = String(err?.message ?? err);
          status.setAttribute('role', 'alert'); status.textContent = '图表渲染失败';
          body.appendChild(status);
          view.requestMeasure();
        }).finally(() => {
          stage.remove();
          if (lifetime.signal.aborted || current !== lifetime) return;
          delete div.dataset.renderPending; div.removeAttribute('aria-busy'); view.requestMeasure();
        });
    };
    const present = () => {
      div.querySelector(':scope > .cm-source-toggle')?.remove();
      if (widget.range && !view.state.readOnly) div.appendChild(sourceButton(view, widget.range, '图表'));
    };
    mermaidMounts.set(div, {
      update: next => { const changed = widget.code !== next.code; widget = next; present(); if (changed) render(); },
      destroy: () => { current?.unload(); delete div.dataset.renderPending; div.removeAttribute('aria-busy'); },
    });
    present(); render();
    return div;
  }
  destroy(dom: HTMLElement) {
    const mount = mermaidMounts.get(dom); mermaidMounts.delete(dom); mount?.destroy();
  }
}

function buildMermaid(state: EditorState): DecorationSet {
  if (!state.field(livePreviewState, false)) return Decoration.none;
  const ro = state.field(livePreviewReadonly, false) ?? false;
  const ranges: Range<Decoration>[] = [];
  for (const block of state.field(blockModel).containers) {
    if (block.kind !== 'code' || block.language.toLowerCase() !== 'mermaid' || sourceIsOpen(state, block) || blockEffectOwns(state, block)) continue;
    if (!forceRendered(state, block) && caretTouches(block, state.field(compositionSelection).selection.ranges, ro)) continue;
    ranges.push(sourceBlockReplacement(state, block, new MermaidWidget(block.body, block)));
  }
  return Decoration.set(ranges, true);
}

function buildMathBlocks(state: EditorState): DecorationSet {
  const decorations: Range<Decoration>[] = [];
  if (state.field(livePreviewState, false)) for (const region of state.field(blockModel).mathRanges) {
    if (region.closed && region.kind === 'dollar' && (region.block || region.tex.includes('\n')) &&
      !blockEffectOwns(state, region) && !mathSourceVisible(state, region))
      decorations.push(sourceBlockReplacement(state, region, numberedMath(state, region.tex, true, region)));
  }
  const preview = mathPreview(state);
  if (preview?.placement === 'document' && !blockEffectOwns(state, preview.region)) {
    const widget = numberedMath(state, mathPreviewTex(state, preview.region), true, preview.region, true);
    const block = state.field(blockModel).math.some(formula => formula.from === preview.region.from);
    decorations.push(Decoration.widget({ widget: block ? sourceBlockPresentation(state, preview.region, widget).widget : widget,
      block: true, side: 1 }).range(preview.region.to));
  }
  return Decoration.set(decorations, true);
}
function numberedMath(state: EditorState, tex: string, display: boolean, range: { from: number; to: number }, preview = false) {
  const context = equationsOf(state);
  const equation = display ? equationAt(context, range.from) : undefined;
  const source = state.facet(renderContext).mathSource;
  const definitions = mathDefinitionContext(source?.model ?? state.field(syntaxModel), range.from + (source?.from ?? 0));
  return new MathWidget(tex, display, range, equation && !equation.tag ? equationLabel(equation) ?? undefined : undefined,
    preview || equation?.ambiguous ? undefined : equation?.id, definitions, preview, state.field(blockModel).mathCallout.has(range.from));
}
export const mathBlockField = StateField.define<DecorationSet>({
  create: buildMathBlocks, update: (value, transaction) => decorationInputsChanged(transaction) ? buildMathBlocks(transaction.state) : value,
  provide: (field) => EditorView.decorations.from(field),
});

export const mermaidField = StateField.define<DecorationSet>({
  create: (state) => buildMermaid(state),
  update(value, tr) {
    if (decorationInputsChanged(tr, { selection: true, context: ['allowBlockEffects', 'allowScriptExecution'], latex: false })) {
      return buildMermaid(tr.state);
    }
    return value.map(tr.changes);
  },
  provide: (f) => EditorView.decorations.from(f),
});

/* ---------------- ```html preview (Render HTML button) ---------------- */

/** Explicitly opt a fenced HTML block into sandbox execution, independently of editing. */
const requestHtmlRender = StateEffect.define<number>();

/** Positions (opening-fence line starts) whose ```html block is rendered. */
export const htmlRenderedState = StateField.define<readonly number[]>({
  create: () => [],
  update(value, tr) {
    let v = tr.docChanged ? value.map((p) => tr.changes.mapPos(p, 1)) : value;
    for (const e of tr.effects) {
      if (e.is(requestHtmlRender) && !v.includes(e.value)) v = [...v, e.value];
    }
    return v;
  },
});

/** Sandbox execution remains opt-in. Its source entry uses the shared temporary
 *  region, so editing never needs a second HTML-specific close control. */
const htmlPreviewMounts = new WeakMap<HTMLElement, () => void>();
class HtmlPreviewWidget extends WidgetType {
  constructor(readonly code: string, readonly range: { from: number; to: number }, readonly rendered: boolean) {
    super();
  }
  eq(o: HtmlPreviewWidget) {
    return o.range.from === this.range.from && o.range.to === this.range.to && o.rendered === this.rendered && o.code === this.code;
  }
  ignoreEvent() {
    return false;
  }
  toDOM(view: EditorView) {
    const wrap = document.createElement('div');
    wrap.className = 'cm-html-preview' + (this.rendered ? ' is-rendered' : '');
    if (this.rendered) {
      if (!view.state.readOnly) wrap.appendChild(sourceButton(view, this.range, 'HTML'));
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
      const win = wrap.ownerDocument.defaultView!;
      const frameRequest = win.requestAnimationFrame(sync);
      win.addEventListener('resize', sync);
      htmlPreviewMounts.set(wrap, () => { win.cancelAnimationFrame(frameRequest); win.removeEventListener('resize', sync); });
    } else {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'cm-html-render-btn';
      button.textContent = 'Render HTML';
      button.addEventListener('mousedown', event => {
        event.preventDefault(); event.stopPropagation();
        view.dispatch({ effects: requestHtmlRender.of(this.range.from) });
      });
      wrap.appendChild(button);
    }
    return wrap;
  }
  destroy(dom: HTMLElement) {
    const cleanup = htmlPreviewMounts.get(dom); htmlPreviewMounts.delete(dom); cleanup?.();
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
    const range = { from: line.from, to: doc.line(end).to };
    if (sourceIsOpen(state, range)) { n = end; continue; }
    const key = line.from;
    const rendered = renderedKeys.includes(key);
    if (rendered) {
      // Replace the whole block — hides the source code AND shows the iframe.
      const code = end > n + 1 ? doc.sliceString(doc.line(n + 1).from, doc.line(end - 1).to) : '';
      ranges.push(
        Decoration.replace({ widget: new HtmlPreviewWidget(code, range, true), block: true }).range(range.from, range.to),
      );
    } else {
      // Button ABOVE the fence (side:-1) — html blocks can be huge (a whole saved
      // page), so a button after the block would sit off-screen and be unreachable.
      ranges.push(
        Decoration.widget({ widget: new HtmlPreviewWidget('', range, false), block: true, side: -1 }).range(line.from),
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
      decorationInputsChanged(tr, false) || tr.effects.some((e) => e.is(requestHtmlRender))
    ) {
      return buildHtmlPreview(tr.state);
    }
    return value.map(tr.changes);
  },
  provide: (f) => EditorView.decorations.from(f),
});

/* ---------------- callout folding (only `-` defaults to folded) ---------------- */

export const toggleCalloutFold = StateEffect.define<number>();

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
      if (e.is(revealNavigation)) for (const block of tr.state.field(blockModel).containers) {
        if (block.kind !== 'callout' || e.value.to < block.bodyFrom || e.value.from > block.to) continue;
        const toggled = v.includes(block.from);
        if ((block.fold === '-') !== toggled) v = toggled ? v.filter(pos => pos !== block.from) : [...v, block.from];
      }
    }
    // A caret must never remain hidden in a collapsed body, including after a
    // separator deletion merges quotes. Closing via the button already moves
    // an interior selection to the title in this same transaction.
    if ((tr.docChanged || tr.selection) && tr.state.field(livePreviewState) && !tr.state.field(livePreviewReadonly)) {
      const containers = tr.state.field(blockModel).containers;
      for (const range of tr.newSelection.ranges) {
        if (!range.empty) continue;
        for (let node = tr.state.field(syntaxModel).tree.resolveInner(range.head, -1); node; node = node.parent!) {
          if (node.name !== 'Blockquote') continue;
          const from = tr.newDoc.lineAt(node.from).from;
          // Containers are source-ordered; inspect only this caret's ancestors.
          let lo = 0, hi = containers.length;
          while (lo < hi) { const mid = (lo + hi) >>> 1; if (containers[mid].from < from) lo = mid + 1; else hi = mid; }
          for (let i = lo; i < containers.length && containers[i].from === from; i++) {
            const block = containers[i];
            if (block.kind !== 'callout' || block.to !== node.to || range.head < block.bodyFrom || range.head > block.to) continue;
            const toggled = v.includes(block.from);
            if ((block.fold === '-') !== toggled) v = toggled ? v.filter(pos => pos !== block.from) : [...v, block.from];
          }
        }
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
    if (decorationInputsChanged(tr, { selection: false, context: ['allowBlockEffects', 'allowScriptExecution'], latex: false }) || tr.startState.field(calloutFoldState) !== tr.state.field(calloutFoldState)) {
      return buildCalloutFolds(tr.state);
    }
    return value.map(tr.changes);
  },
  provide: (f) => EditorView.decorations.from(f),
});

/* ---------------- tables ---------------- */

type TableBlock = TableModel;

const tableMounts = new WeakMap<HTMLElement, RenderLifetime>();
class TableWidget extends WidgetType {
  constructor(readonly block: TableBlock, readonly ro: boolean, readonly mathDependencies: string) { super(); }
  eq(o: TableWidget) { return o.block.key === this.block.key && o.block.from === this.block.from && o.ro === this.ro && o.mathDependencies === this.mathDependencies; }
  ignoreEvent() { return true; }
  destroy(dom: HTMLElement) { const lifetime = tableMounts.get(dom); tableMounts.delete(dom); lifetime?.unload(); }
  toDOM(view: EditorView) {
    const b = this.block, context = contextOf(view);
    const wrap = document.createElement('div'); wrap.className = 'cm-table-wrap'; wrap.dataset.tableFrom = String(b.from);
    const frame = document.createElement('div'); frame.className = 'cm-table-frame'; wrap.appendChild(frame);
    const lifetime = new RenderLifetime(); tableMounts.set(wrap, lifetime);
    if (!this.ro) frame.appendChild(sourceButton(view, b, '表格'));
    const table = document.createElement('table'); table.className = 'cm-table'; frame.appendChild(table);
    const apply = (changes: SourceChange[]) => {
      if (lifetime.signal.aborted || view.state.readOnly || view.state.sliceDoc(b.from, b.to) !== b.key) return;
      if (changes.length) view.dispatch({ changes, userEvent: 'input.table' });
    };
    const structural = (operation: TableOperation) => apply(changeTable(b, operation));
    b.rows.forEach((row, ri) => {
      const section = ri === 0 ? document.createElement('thead') : table.querySelector('tbody') ?? document.createElement('tbody');
      const tr = document.createElement('tr');
      for (let col = 0; col < b.align.length; col++) {
        const cell = document.createElement(ri === 0 ? 'th' : 'td');
        cell.className = 'cm-cell-edit'; cell.style.textAlign = b.align[col] ?? '';
        const content = document.createElement('div'); content.className = 'cm-table-cell-content'; cell.appendChild(content);
        const token = row.cells[col];
        const raw = token?.text ?? '';
        let fragment: RenderLifetime | undefined;
        let editing = false;
        const mount = (mode: 'live' | 'reading') => {
          fragment?.unload();
          if (lifetime.signal.aborted) return;
          const rendering = fragment = new RenderLifetime();
          content.replaceChildren();
          const host = document.createElement('div'); content.appendChild(host);
          const stop = context.mountFragment?.(host, raw, {
            id: context.sourcePath + ':cell:' + ri + ':' + col, sourceFrom: token?.from ?? row.to,
            equations: { ...equationsOf(view.state), from: equationsOf(view.state).from + (token?.from ?? row.to) },
            mathSource: { model: context.mathSource?.model ?? view.state.field(syntaxModel),
              from: (context.mathSource?.from ?? 0) + (token?.from ?? row.to) },
            mode, autoFocus: mode === 'live',
            onCommit: mode === 'live' ? (value) => {
              if (lifetime.signal.aborted || rendering.signal.aborted) return;
              rendering.unload(); editing = false;
              if (value !== raw) apply([editTableCell(b, ri, col, value)]); else mount('reading');
            } : undefined,
          });
          if (stop) rendering.register(stop);
          if (!stop) host.textContent = raw;
        };
        lifetime.register(() => fragment?.unload()); mount('reading');
        if (!this.ro && b.editable) {
          if (ri === 0 || col === 0) {
            const handle = document.createElement('button'); handle.type = 'button';
            handle.className = ri === 0 ? 'cm-col-handle' : 'cm-row-handle';
            handle.dataset.axis = ri === 0 ? 'column' : 'row';
            handle.dataset.index = String(ri === 0 ? col : ri - 1);
            handle.textContent = '⠿';
            handle.title = ri === 0 ? `Move column ${col + 1}` : `Move row ${ri}`;
            handle.setAttribute('aria-label', handle.title);
            handle.setAttribute('aria-keyshortcuts', ri === 0 ? 'ArrowLeft ArrowRight' : 'ArrowUp ArrowDown');
            handle.setAttribute('aria-pressed', 'false');
            cell.appendChild(handle);
          }
          cell.addEventListener('click', (e) => {
            if (editing || (e.target as HTMLElement).closest('a,button,input')) return;
            editing = true; mount('live');
          });
          cell.addEventListener('keydown', (e) => {
            if ((e.target as HTMLElement).closest('.cm-col-handle,.cm-row-handle')) return;
            if ((e.key === 'Enter' && !e.shiftKey || e.key === 'Escape') && !e.isComposing) {
              e.preventDefault(); e.stopPropagation();
              if (e.key === 'Escape') { editing = false; mount('reading'); } else (wrap.ownerDocument.activeElement as HTMLElement)?.blur();
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
      // A gesture only changes DOM feedback. The existing core operations supply
      // all source patches together on drop, preserving one shared undo step.
      let drag: { pointer: number; axis: 'row' | 'column'; from: number; to: number;
        handle: HTMLButtonElement; items: HTMLElement[]; bounds: DOMRect[];
        startX: number; startY: number; moved: boolean } | undefined;
      const feedback = () => {
        frame.querySelectorAll('.cm-cell-dragging,.cm-table-drop-before,.cm-table-drop-after').forEach(element =>
          element.classList.remove('cm-cell-dragging', 'cm-table-drop-before', 'cm-table-drop-after'));
        if (!drag) return;
        const { axis, from, to, items } = drag;
        const cells = axis === 'row' ? [...items[from].children] : [...table.rows].map(row => row.cells[from]);
        cells.forEach(cell => cell.classList.add('cm-cell-dragging'));
        if (to !== from && to >= 0) items[to].classList.add(to < from ? 'cm-table-drop-before' : 'cm-table-drop-after');
      };
      const finish = (commit: boolean) => {
        const current = drag; if (!current) return;
        drag = undefined; feedback(); frame.classList.remove('is-dragging-row', 'is-dragging-column');
        wrap.ownerDocument.defaultView!.removeEventListener('scroll', cancelDrag, true); wrap.ownerDocument.defaultView!.removeEventListener('keydown', cancelKey);
        current.handle.setAttribute('aria-pressed', 'false');
        if (frame.hasPointerCapture(current.pointer)) frame.releasePointerCapture(current.pointer);
        if (commit && current.moved && current.to >= 0 && current.from !== current.to) structural(current.axis === 'row'
          ? { kind: 'moveRow', row: current.from, to: current.to }
          : { kind: 'moveColumn', column: current.from, to: current.to });
      };
      frame.addEventListener('pointerdown', event => {
        const handle = (event.target as Element).closest<HTMLButtonElement>('.cm-col-handle,.cm-row-handle');
        if (!handle || event.button !== 0 || drag) return;
        event.preventDefault(); event.stopPropagation();
        // Do not reorder a stale table while a cell owns an uncommitted draft.
        if (wrap.querySelector('[contenteditable="true"]')) { (wrap.ownerDocument.activeElement as HTMLElement)?.blur(); return; }
        const axis = handle.dataset.axis as 'row' | 'column';
        const items = axis === 'row' ? [...(table.tBodies[0]?.rows ?? [])] : [...table.tHead!.rows[0].cells];
        const index = Number(handle.dataset.index);
        drag = { pointer: event.pointerId, axis, from: index, to: index, handle, items,
          bounds: items.map(item => item.getBoundingClientRect()), startX: event.clientX, startY: event.clientY, moved: false };
        handle.setAttribute('aria-pressed', 'true'); frame.classList.add('is-dragging-' + axis);
        frame.setPointerCapture(event.pointerId); feedback();
        wrap.ownerDocument.defaultView!.addEventListener('scroll', cancelDrag, true); wrap.ownerDocument.defaultView!.addEventListener('keydown', cancelKey);
      });
      frame.addEventListener('pointermove', event => {
        if (!drag || drag.pointer !== event.pointerId) return;
        event.preventDefault();
        drag.moved ||= Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) > 4;
        const box = table.getBoundingClientRect();
        const inside = event.clientX >= box.left - 24 && event.clientX <= box.right + 24 && event.clientY >= box.top - 24 && event.clientY <= box.bottom + 24;
        let to = inside ? drag.bounds.findIndex(rect => drag!.axis === 'row' ? event.clientY < rect.bottom : event.clientX < rect.right) : -1;
        if (inside && to < 0) to = drag.items.length - 1;
        if (to !== drag.to) { drag.to = to; feedback(); }
      });
      frame.addEventListener('pointerup', event => { if (drag?.pointer === event.pointerId) finish(true); });
      frame.addEventListener('pointercancel', () => finish(false));
      frame.addEventListener('lostpointercapture', () => finish(false));
      const cancelDrag = () => finish(false);
      const cancelKey = (event: KeyboardEvent) => { if (event.key === 'Escape' && drag) { event.preventDefault(); finish(false); } };
      lifetime.register(() => finish(false));
      frame.addEventListener('keydown', event => {
        const handle = (event.target as Element).closest<HTMLButtonElement>('.cm-col-handle,.cm-row-handle');
        if (!handle || wrap.querySelector('[contenteditable="true"]')) return;
        const axis = handle.dataset.axis, from = Number(handle.dataset.index);
        const step = axis === 'row' ? event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0
          : event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0;
        if (!step) return;
        event.preventDefault(); event.stopPropagation();
        const to = from + step;
        structural(axis === 'row' ? { kind: 'moveRow', row: from, to } : { kind: 'moveColumn', column: from, to });
        view.dom.querySelector<HTMLButtonElement>(`.cm-table-wrap[data-table-from="${b.from}"] button[data-axis="${axis}"][data-index="${to}"]`)?.focus();
      });
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
  destroy(dom: HTMLElement) { const lifetime = imageMounts.get(dom); imageMounts.delete(dom); lifetime?.unload(); }
  constructor(readonly html: string, readonly range?: { from: number; to: number }) {
    super();
  }
  eq(o: HtmlBlockWidget) {
    return o.html === this.html && o.range?.from === this.range?.from && o.range?.to === this.range?.to;
  }
  toDOM(view: EditorView) {
    const div = document.createElement('div');
    div.className = 'cm-html-block';
    const lifetime = new RenderLifetime(); imageMounts.set(div, lifetime);
    const imageTargets: string[] = [];
    const safe = sanitizeHtml(this.html);
    const parsed = document.createElement('template'); parsed.innerHTML = safe;
    parsed.content.querySelectorAll('img').forEach(img => imageTargets.push(img.getAttribute('src') ?? ''));
    div.innerHTML = sanitizeHtml(this.html, contextOf(view).rawUrl);
    presentHtmlImages(div, imageTargets, () => view.requestMeasure(), lifetime.signal);
    if (!view.state.readOnly && this.range) div.appendChild(sourceButton(view, this.range, 'HTML'));
    div.addEventListener('mousedown', (e) => {
      const a = (e.target as HTMLElement).closest('a');
      if (!a) return;
      e.preventDefault();
      const href = a.getAttribute('href') || '';
      followRenderedLink(view, href);
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

// Infer a property's type only when the Vault registry has no explicit type.
function propType(p: Prop): string {
  if (p.list || CORE_LIST_PROPS.has(p.key)) return 'list';
  const v = p.values[0] ?? '';
  if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(v)) return 'datetime';
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return 'date';
  if (v !== '' && /^-?\d+(\.\d+)?$/.test(v)) return 'number';
  if (/^(true|false)$/i.test(v)) return 'checkbox';
  return 'text';
}
const PROP_TYPES: Record<string, { label: string; icon: string }> = {
  auto: { label: '自动', icon: 'loader' },
  checkbox: { label: '复选框', icon: 'check-square' },
  date: { label: '日期', icon: 'calendar' },
  datetime: { label: '日期 & 时间', icon: 'clock' },
  list: { label: '列表', icon: 'list' },
  number: { label: '数字', icon: 'hash' },
  text: { label: '文本', icon: 'type' },
};
function setPropertyIcon(element: HTMLElement, type: string): void {
  const entry = PROP_TYPES[type] ?? PROP_TYPES.text;
  setIcon(element, entry.icon);
  element.title = entry.label;
}

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

class FrontmatterWidget extends WidgetType {
  /** `ro` = reading mode: display-only properties. */
  constructor(readonly yaml: string, readonly ro: boolean, readonly types: Record<string, string>) {
    super();
  }
  eq(o: FrontmatterWidget) {
    return o.yaml === this.yaml && o.ro === this.ro && o.types === this.types;
  }
  ignoreEvent() {
    return true;
  }
  toDOM(view: EditorView) {
    // CM measures this root's rectangle, not margins between block siblings.
    // A flow root contains the existing properties margins and divider intact.
    const block = document.createElement('div');
    block.className = 'cm-properties-block';
    const box = document.createElement('div');
    box.className = 'properties cm-properties';
    block.appendChild(box);
    const range = view.state.field(syntaxModel).frontmatter;
    if (!this.ro && range) box.appendChild(sourceButton(view, range, '属性'));

    // Commit source patches only, preserving every unrelated YAML token.
    const commit = (props: Prop[]) => {
      if (view.state.readOnly) return;
      const text = view.state.doc.toString();
      const fm = text.match(/^---\n([\s\S]*?)\n---[ \t]*(?:\n|$)/);
      try {
        if (!fm || fm[1] !== this.yaml) throw new Error('编辑期间属性已变化，草稿未写入');
        const offset = fm[0].indexOf('\n') + 1;
        const changes = patchPropertyRows(this.yaml, props).map((change) => ({ ...change, from: change.from + offset, to: change.to + offset }));
        if (changes.length) view.dispatch({ changes, userEvent: 'input.properties' });
        view.focus();
      } catch (error) { contextOf(view).reportError?.((error as Error).message); }
    };
    // Rows keep source order until this widget is replaced by the transaction.
    // A blank control for a null scalar must not turn it into a quoted string
    // when a different property is edited; explicit empty strings stay strings.
    const readProps = (): Prop[] =>
      ([...box.querySelectorAll('.prop-row:not(.prop-newrow)')] as HTMLElement[]).map((row, index) => ({
        key: (row.querySelector('.prop-key') as HTMLElement).innerText,
        list: row.dataset.list === '1',
        scalarType: (row.querySelector('.prop-val-field') as HTMLElement | null)?.dataset.propertyType,
        values:
          row.dataset.list === '1'
            ? ([...row.querySelectorAll('.prop-pill')] as HTMLElement[]).map((p) => p.dataset.val ?? '')
            : (props[index]?.values.length === 0 && !(row.querySelector('.prop-val-field') as HTMLElement)?.dataset.raw
              ? [] : [(row.querySelector('.prop-val-field') as HTMLElement)?.dataset.raw ?? '']),
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
        await contextOf(view).setPropertyType(key, dtToObs(dt, key));
      } catch (error) {
        contextOf(view).reportError?.(String(error));
        return;
      }
      const row = ([...box.querySelectorAll('.prop-row:not(.prop-newrow)')] as HTMLElement[]).find(
        (r) => (r.querySelector('.prop-key') as HTMLElement).innerText.trim() === key,
      );
      const curIsList = row?.dataset.list === '1';
      // The existing registry fallback infers from source. Selecting Auto must
      // not convert YAML values or turn an existing source list into text.
      const effectiveType = dt === 'auto' ? propType(props.find(prop => prop.key === key) ?? { key, values: [], list: false }) : dt;
      const newIsList = effectiveType === 'list';
      if (dt !== 'auto' && newIsList !== curIsList) {
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
          setPropertyIcon(ic, effectiveType);
        }
        const valCell = row.querySelector('.prop-val');
        const oldField = row.querySelector('.prop-val-field') as HTMLElement | null;
        if (valCell && oldField) valCell.replaceChild(makeScalarField(effectiveType, oldField.dataset.raw ?? ''), oldField);
      }
    };

    const propMenu = (key: string, idx: number): LpMenuItem[] => {
      const selectedType = OBS_TO_DT[contextOf(view).propertyTypes()[key]] ?? 'auto';
      return [
      {
        label: '属性类型',
        icon: PROP_TYPES[selectedType].icon,
        submenu: Object.entries(PROP_TYPES).map(([type, entry]) => ({
          label: entry.label, icon: entry.icon,
          checked: type === selectedType,
          onClick: () => void setType(key, type),
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
      { label: 'Remove', icon: 'trash', onClick: () => mutate((ps) => ps.splice(idx, 1)) },
    ]; };

    const props = parseFrontmatter(this.yaml);

    const header = document.createElement('div');
    header.className = 'cm-props-header';
    header.textContent = 'Properties';
    box.appendChild(header);
    if (!canEditProperties(this.yaml)) {
      const hint = document.createElement('div'); hint.className = 'prop-unsupported';
      hint.textContent = 'Complex or invalid YAML. Use the source entry to edit.'; box.appendChild(hint); return block;
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
          setIcon(ic, 'hash');
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
      setPropertyIcon(icon, renderAsList ? 'list' : dt);

      const k = document.createElement('span');
      k.className = 'prop-key';
      k.textContent = p.key;
      editable(k, () => mutate(() => {}));

      // Right-click the key or icon → Property type / Copy / Remove (like Obsidian).
      const openPropMenu = (e: MouseEvent) => {
        if (this.ro || p.editable === false) return;
        e.preventDefault();
        e.stopPropagation();
        contextOf(view).openMenu({ x: e.clientX, y: e.clientY, items: propMenu(p.key, idx) });
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
          setIcon(x, 'x');
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
        setIcon(add, 'plus');
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
      setIcon(del, 'x');
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
    setIcon(addBtn, 'plus');
    addBtn.append('添加属性');

    // Add a property with a name-suggester dropdown (existing vault keys), like Obsidian.
    const startAdd = async () => {
      addBtn.style.display = 'none';
      const editorRow = document.createElement('div');
      editorRow.className = 'prop-row prop-newrow';
      const icon = document.createElement('span');
      icon.className = 'prop-icon';
      setPropertyIcon(icon, 'auto');
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
          setPropertyIcon(ic, OBS_TO_DT[p.type] ?? p.type);
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
    return block;
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
  const links = view.state.field(documentMetadata).linkOccurrences;
  const equationInfo = equationsOf(view.state);
  for (const equation of equationInfo.equations) {
    if (!equation.anchor) continue;
    const from = equation.anchor.from - equationInfo.from, to = equation.anchor.to - equationInfo.from;
    if (from >= 0 && to <= doc.length && !lineActive(from)) pushReplace(from, to, Decoration.replace({}));
  }
  const lineExcludedRanges = [...model.html, ...model.entities];
  const codeRanges = [...model.literal, ...lineExcludedRanges, ...view.state.field(blockModel).math];
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

        // Only block code excludes whole lines before structural prefixes.
        // InlineCode is already in model.literal and can contain QuoteMark.
        if (name === 'FencedCode' || name === 'CodeBlock') {
          lineExcludedRanges.push({ from: node.from, to: node.to });
        }

        // Don't decorate inside a rendered table/HTML block — their fields own it.
        if (renderedTable(node.from, node.to) || renderedHtml(node.from, node.to)) return;

        // The grammar owns thematic breaks, including quoted/nested rules.
        // Replace only the rule node; structural > text keeps its own layout.
        if (name === 'HorizontalRule') {
          if (!inCode(node.from, node.to)) {
            const line = doc.lineAt(node.from);
            all.push(Decoration.line({ class: 'HyperMD-hr' }).range(line.from));
            if (!lineActive(line.from)) {
              pushReplace(node.from, node.to, Decoration.replace({ widget: new HrWidget() }));
            }
          }
          return false;
        }

        // Code block lines: HyperMD-codeblock(-begin/-end) like Obsidian.
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
          const blockTouched = !readonly && !forceRendered(view.state, node) &&
            sel.ranges.some(range => range.from <= node.to && range.to >= node.from);
          const fences: { from: number; to: number }[] = [];
          for (let child = node.node.firstChild; child; child = child.nextSibling) {
            if (child.name === 'CodeMark') fences.push(child);
          }
          const code = view.state.field(blockModel).containers.find((block) => block.kind === 'code' && block.from === doc.line(first).from);
          const lang = code?.language ?? '';
          for (let i = first; i <= last; i++) {
            const l = doc.line(i);
            const logical = stripQuotePrefix(l.text, code?.depth ?? 0);
            const prefixLength = l.text.length - logical.length;
            const fence = fences.find(mark => mark.from >= l.from && mark.from <= l.to);
            all.push(
              Decoration.line({
                class:
                  'HyperMD-codeblock HyperMD-codeblock-bg' +
                  (i === first ? ' HyperMD-codeblock-begin' : '') +
                  (i === last ? ' HyperMD-codeblock-end' : ''),
                attributes: !blockTouched && i === first && lang ? { 'data-lang': lang } : undefined,
              }).range(l.from, l.from),
            );
            if (readonly && fence) pushReplace(l.from, l.to, hidden);
            else {
              if (!blockTouched && prefixLength) pushReplace(l.from, l.from + prefixLength, hidden);
              if (fence) all.push(Decoration.mark({ class: 'cm-formatting cm-formatting-code-block',
                attributes: blockTouched ? undefined : { style: 'color: transparent' },
              }).range(fence.from, l.to));
            }
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
            Decoration.line({ class: `cm-h${lv} HyperMD-header HyperMD-header-${lv}${!doc.sliceString(fmEnd, line.from).trim() ? ' cm-leading-heading' : ''}` }).range(line.from, line.from),
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
          const marks: { from: number; to: number }[] = [];
          const markName = name === "InlineCode" ? "CodeMark" :
            name === "Strikethrough" ? "StrikethroughMark" : "EmphasisMark";
          for (let child = node.node.firstChild; child; child = child.nextSibling) {
            // Multiline inline nodes can also contain structural QuoteMark/ListMark.
            if (child.name === markName) marks.push(child);
          }
          // Markdown may pair TeX's ^* markers across two different formulas.
          // Their delimiter tokens belong to math even when this node spans both.
          // Skip this node's decoration, but still visit unrelated child syntax.
          if (marks.some(mark => mathRanges.some(formula => formula.kind === 'dollar' &&
            mark.from < formula.to && mark.to > formula.from))) return;
          all.push(Decoration.mark({ class: EMPHASIS_CLASS[name] }).range(node.from, node.to));
          const ownsCaret = touches(node.from, node.to) && !model.nodes.some((child) =>
            EMPHASIS_CLASS[child.name] && child.from >= node.from && child.to <= node.to &&
            (child.from !== node.from || child.to !== node.to) && touches(child.from, child.to));
          if (!ownsCaret) {
            for (const mark of marks) pushReplace(mark.from, mark.to, hidden);
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
      if (blockEffectOwns(view.state, line)) continue;
      const sourceLine = sourceOwns(view.state, line);
      if (sourceLine) {
        // Source entry owns the body, but an enclosing quote still owns its
        // structural prefix unless that whole quote was also opened as source.
        let quoted = false;
        for (let node: ReturnType<typeof tree.resolveInner> | null = tree.resolveInner(line.to, -1); node; node = node.parent) {
          if (node.name === 'Blockquote' && !sourceOwns(view.state, {
            from: doc.lineAt(node.from).from, to: node.to,
          })) { quoted = true; break; }
        }
        if (!quoted) continue;
      }

      // Skip lines covered by a rendered table / HTML block widget.
      if (renderedTable(line.from, line.to) || renderedHtml(line.from, line.to)) continue;
      // Skip the frontmatter block (rendered by frontmatterField).
      if (line.to <= fmEnd) continue;
      // Block code / HTML owns the whole line. Math source still has structural
      // quote prefixes; its literal body is excluded after prefix layout below.
      if (lineExcludedRanges.some((r) => r.from <= line.from && r.to >= line.to)) continue;
      // Whole-line %% block comment region → grey out, keep raw.
      if (commentLines.has(ln)) {
        all.push(Decoration.line({ class: 'cm-comment' }).range(line.from, line.from));
        continue;
      }

      // Inline-HTML paragraph line (e.g. `<u>…</u> và <mark>…`): Lezer only marks
      // block-level openers as HTMLBlock, so render whole-line inline HTML here.
      if (!sourceLine && /^<[a-zA-Z][^>]*>/.test(text) && !lineActive(line.from) && !inCode(line.from, line.to) && !view.state.field(syntaxModel).html.some((tag) => tag.from >= line.from && tag.to <= line.to)) {
        pushReplace(line.from, line.to, Decoration.replace({ widget: new HtmlBlockWidget(text, { from: line.from, to: line.to }) }));
        continue;
      }

      // Blockquote / callout (callout regex + colors/icons per §7/§21).
      // `bodyStart` = offset past the `>` markers so list/task handling below
      // also works INSIDE quotes and callouts.
      let bodyStart = 0;
      const quotePrefix = text.match(QUOTE_MARKERS_RE);
      const header = quotePrefix ? view.state.field(blockModel).containers.find((block) => block.kind === 'callout' && block.from === line.from) : undefined;
      if (quotePrefix) {
        const prefix = quotePrefix[0];
        bodyStart = prefix.length;
        // Every structural quote prefix, including a Callout title, retains its
        // own native width and reveal policy independently of the type marker.
        all.push(Decoration.line({ attributes: { 'data-prefix-layout': String(line.from) } }).range(line.from));
        all.push(Decoration.mark({ class: 'cm-quote-prefix' +
          (touches(line.from, line.from + bodyStart) ? ' is-revealed' : '') }).range(line.from, line.from + bodyStart));
        if (header && !sourceLine) {
          const slot = CALLOUT_SLOT[header.type] ?? 'default';
          const folded = isCalloutFolded(view.state, header.from, header.fold);
          if (!touches(header.markerFrom, header.titleFrom)) {
            const quoteGap = text.slice(0, header.markerFrom - line.from).split('>').at(-1)!;
            all.push(Decoration.mark({ class: 'cm-callout-heading', inclusive: true }).range(header.markerFrom, line.to));
            pushReplace(header.markerFrom, header.titleFrom, Decoration.replace({
              widget: new CalloutHeadWidget(slot, header.title ? '' : calloutDefaultTitle(header.type), quoteGap),
            }));
          }
          all.push(Decoration.widget({
            widget: new CalloutFoldWidget(folded, header.from), side: -1,
          }).range(line.to));
          const formulas = !readonly && !view.state.readOnly && !folded ? (view.state.field(blockModel).calloutMath.get(header.from) ?? []).filter(formula =>
            !blockEffectOwns(view.state, formula) && !mathSourceVisible(view.state, formula)) : [];
          if (formulas.length) {
            all.push(Decoration.line({ attributes: { style: `--callout-formula-controls:${formulas.length}` } }).range(line.from));
            all.push(Decoration.widget({ widget: new CalloutMathSourcesWidget(formulas), side: 1 }).range(line.to));
          }
          if (header.title && header.titleFrom < line.to) all.push(Decoration.mark({ class: 'cm-callout-title', inclusiveEnd: true }).range(header.titleFrom, line.to));
          bodyStart = header.titleFrom - line.from;
        }
      }

      if (sourceLine) continue;

      // Task checkbox + bullet — applied to the line body (works in quotes /
      // callouts too). Per §7 any single char is a valid status and any
      // non-space status counts as checked (no hard-coded custom-state list).
      const body = bodyStart ? text.slice(bodyStart) : text;
      const bodyFrom = line.from + bodyStart;
      // A Callout header isn't a list marker, even inside a parent ListItem.
      // Its quote prefix above still follows the shared native layout.
      const list = header ? null : markdownListLine(view.state, line);
      const prefix = list?.header ? body.match(/^[ \t]*(?:[-*+]|\d+[.)])[ \t]+(?:\[.\][ \t]+)?/) : null;
      if (list) {
        all.push(Decoration.line({ class: 'HyperMD-list-line', attributes: { 'data-prefix-layout': String(line.from) } }).range(line.from));
        const from = line.from + list.quoteTo;
        const to = prefix ? bodyFrom + prefix[0].length : line.from + list.indentTo;
        // Inclusive edges keep marker replacement widgets inside the measured
        // prefix box instead of leaving a bullet/checkbox outside its advance.
        if (to > from) all.push(Decoration.mark({ class: 'cm-list-prefix', inclusive: true }).range(from, to));
        if (list.header && list.item.parent?.name === 'OrderedList') {
          const marker = list.item.getChild('ListMark');
          if (marker) all.push(Decoration.mark({ class: 'cm-list-number' }).range(marker.from, marker.to));
        }
      }
      // Use the same indentation unit as contextual Tab, not a fixed four spaces.
      if (list) {
        const ws = text.slice(list.quoteTo, list.indentTo);
        let i = 0, column = 0;
        const unit = getIndentUnit(view.state);
        while (i < ws.length) {
          let end = i;
          const nextColumn = (Math.floor(column / unit) + 1) * unit;
          while (end < ws.length && column < nextColumn) {
            column += ws[end++] === '\t' ? view.state.tabSize - column % view.state.tabSize : 1;
          }
          all.push(Decoration.mark({ class: 'cm-indent' }).range(line.from + list.quoteTo + i, line.from + list.quoteTo + end));
          i = end;
        }
      }
      const task = prefix ? body.match(/^([ \t]*)([-*+])[ \t]+\[(.)\][ \t]/) : null;
      if (task) {
        all.push(
          Decoration.line({
            class: 'HyperMD-list-line HyperMD-task-line',
            attributes: { 'data-task': task[3] },
          }).range(line.from, line.from),
        );
        const boxPos = bodyFrom + task[0].length - 3;
        if (!touches(line.from, boxPos + 2)) {
          pushReplace(bodyFrom + task[1].length, boxPos + 2, Decoration.replace({ widget: new CheckboxWidget(task[3] !== ' ', boxPos) }));
        }
      } else {
        const bullet = prefix ? body.match(/^([ \t]*)([-*+])([ \t]+)/) : null;
        if (bullet) {
          // Replace only the marker. Source whitespace keeps the same column
          // widths in live and source mode, including tab-aligned list bodies.
          const start = bodyFrom + bullet[1].length;
          const markerEnd = start + 1;
          if (!touches(start, markerEnd)) {
            pushReplace(start, markerEnd, Decoration.replace({ widget: new BulletWidget() }));
          }
        }
      }

      // A multiline inline-code span can cover a whole continuation line.
      // Its quote/list prefixes still belong to the structural layout above;
      // only the remaining body passes must stay literal.
      if (codeRanges.some((r) => r.from <= line.from && r.to >= line.to)) continue;

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

      // ==Highlight== → <mark>-style; conceal the markers when the caret is outside.
      const hlRe = /==(?![\s=])(.+?)==/g;
      let m: RegExpExecArray | null;
      while ((m = hlRe.exec(text))) {
        const s = line.from + m.index;
        const e = s + m[0].length;
        // Only delimiters declare highlighting; a contained formula keeps its own renderer.
        if (inCode(s, s + 2, true) || inCode(e - 2, e, true)) continue;
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

      // Trailing block id ` ^abc-123` (charset [a-zA-Z0-9-] only, §7).
      const bid = text.match(/(^|\s)(\^[a-zA-Z0-9-]+)$/);
      if (bid) {
        const s = line.to - bid[2].length;
        all.push(Decoration.mark({ class: 'cm-blockid' }).range(s, line.to));
      }

      // Wikilinks / embeds — alias after the FIRST `|`; default display text
      // `href.split('#').filter(Boolean).join(' > ')`; nested `[[` rejected (§7).
      let hasRenderedImage = false;
      const wikiRe = /(!?)\[\[(.+?)\]\]/g;
      while ((m = wikiRe.exec(text))) {
        const s = line.from + m.index;
        const e = s + m[0].length;
        if (touches(s, e) || inCode(s, e)) continue;
        let low = 0, high = links.length;
        while (low < high) { const middle = (low + high) >>> 1; if (links[middle].from < s) low = middle + 1; else high = middle; }
        const semantic = links[low];
        if (semantic?.from !== s || semantic.to !== e || semantic.kind !== 'wiki') continue;
        const inner = m[2];
        if (inner.includes('[[')) continue;
        const isEmbed = m[1] === '!';
        const pi = inner.indexOf('|');
        const href = semantic.target
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
          const destination = parseLinkTarget(href), referenceName = equationReferenceName(destination.fragment);
          const equation = referenceName !== undefined && !destination.path ? equationTarget(equationsOf(view.state), destination.fragment) : undefined;
          const label = equation ? equationReferenceLabel(equation, alias) : alias || (alias === '' && referenceName !== undefined ? referenceName : href);
          pushReplace(
            s,
            e,
            Decoration.replace({ widget: new WikilinkWidget(href, label, isEmbed, defaultDisplay !== label ? defaultDisplay : undefined, alias, e - s, referenceName !== undefined ? contextOf(view).sourcePath : undefined) }),
          );
        }
      }

      // Markdown images ![alt](url) — URL may contain spaces (real-world vaults)
      const imgRe = /!\[([^\]]*)\]\(([^)]+)\)/g;
      const imageSpans: { from: number; to: number }[] = [];
      while ((m = imgRe.exec(text))) {
        const s = line.from + m.index;
        const parsed = markdownImageAt(model, s);
        const e = parsed?.to ?? s + m[0].length;
        if (e > line.to) continue;
        // Reuse parser-owned bounds; a data URL can contain balanced rgb(...).
        // The old match remains a fallback for Vault filenames containing spaces.
        imgRe.lastIndex = e - line.from;
        imageSpans.push({ from: m.index, to: e - line.from });
        if (touches(s, e) || inCode(s, e)) continue;
        // size param lives in the alt text: `![alt|300](url)` / `![|300x200](url)`
        let alt = parsed?.alt ?? m[1];
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
        const url = parsed?.target ?? m[2].replace(/\s+"[^"]*"$/, '').trim();
        // Browser-loadable URLs load directly; anything else (a relative path or
        // any custom scheme) is resolved by basename via the vault file index.
        const webLoadable = /^(https?|data|blob|file):/i.test(url);
        const src = webLoadable ? url : attachmentUrl(url, view);
        hasRenderedImage = true;
        pushReplace(s, e, Decoration.replace({ widget: new ImageWidget(src, alt, w, h, readonly, url) }));
      }

      let withoutImages = text;
      for (let i = imageSpans.length - 1; i >= 0; i--) {
        const span = imageSpans[i];
        withoutImages = withoutImages.slice(0, span.from) + withoutImages.slice(span.to);
      }
      const imageOnly = withoutImages.replace(/^(?: {0,3}> ?)*/, '')
        .replace(/!\[\[[^\]]+\]\]/g, '').trim() === '';
      if (imageOnly && hasRenderedImage && !lineActive(line.from)) all.push(Decoration.line({ class: 'cm-image-row' }).range(line.from));

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
    Decoration.replace({ widget: new FrontmatterWidget(fm[1], ro, state.facet(renderContext).propertyTypes()), block: true }).range(0, blockEnd),
  ]);
}

/* ---------------- inline title (note filename, Obsidian-style) ---------------- */

export const setNoteTitle = StateEffect.define<string>();

export const noteTitleField = StateField.define<string>({
  create: () => '',
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setNoteTitle)) return e.value;
    return value;
  },
});

function inlineTitleText(state: EditorState): string {
  if (!state.field(livePreviewState, false)) return '';
  const title = state.field(noteTitleField, false) ?? '';
  if (!title) return '';
  // Skip when the note already opens with an H1 equal to the title — the Trilium
  // export repeats the title as a heading, and Obsidian would otherwise show it twice.
  const head = state.doc.sliceString(0, Math.min(state.doc.length, 2000));
  const noFm = head.replace(/^---\r?\n[\s\S]*?\r?\n---[ \t]*\r?\n?/, '');
  const firstLine = noFm.split(/\r?\n/).find((l) => l.trim() !== '');
  const h1 = firstLine?.match(/^#\s+(.+?)\s*$/);
  return h1 && h1[1].trim().toLowerCase() === title.trim().toLowerCase() ? '' : title;
}

// A block decoration at source position 0 is inside any first-block wrapper,
// regardless of its side. The filename belongs to the scroll area, not the source.
export const inlineTitle = ViewPlugin.fromClass(class {
  readonly row: HTMLDivElement;
  readonly title: HTMLDivElement;
  constructor(readonly view: EditorView) {
    const doc = view.dom.ownerDocument;
    this.row = doc.createElement('div');
    this.row.className = 'cm-note-title-row';
    this.title = this.row.appendChild(doc.createElement('div'));
    this.title.className = 'cm-inline-title';
    this.sync();
  }
  update(update: ViewUpdate) {
    if (update.docChanged || update.transactions.some(tr =>
      tr.effects.some(e => e.is(setNoteTitle) || e.is(setLivePreviewEnabled)))) this.sync();
  }
  sync() {
    const title = inlineTitleText(this.view.state);
    if (this.title.textContent === title && !!this.row.parentNode === !!title) return;
    this.title.textContent = title;
    if (title) {
      if (!this.row.parentNode) this.view.scrollDOM.prepend(this.row);
    } else {
      this.row.remove();
    }
    this.view.scrollDOM.classList.toggle('cm-has-inline-title', !!title);
    this.view.requestMeasure();
  }
  destroy() {
    this.row.remove();
    this.view.scrollDOM.classList.remove('cm-has-inline-title');
  }
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
  const referenceKey = tables.some(t => t.key.includes('[[')) ? JSON.stringify(
    equations.equations.map(e => [e.id, e.number, e.ambiguous, e.tex])) : '';
  // Like Obsidian, tables are ALWAYS shown as the interactive widget (never as raw
  // pipes) — editing happens in-cell, so the selection no longer reveals raw.
  const ranges: Range<Decoration>[] = tables.map((t) =>
    sourceBlockReplacement(state, t, new TableWidget(t, ro, JSON.stringify([
      t.key.includes('[[') ? referenceKey : '', mathDefinitionContext(model, t.to + (source?.from ?? 0)),
    ]))),
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
    const depth = sourceLinePrefix(state.doc.lineAt(b.from).text).split('>').length - 1;
    const html = state.doc.sliceString(b.from, b.to).split('\n').map(line => stripQuotePrefix(line, depth)).join('\n');
    ranges.push(sourceBlockReplacement(state, b, new HtmlBlockWidget(html, b)));
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
      if (u.geometryChanged) scheduleMathMeasure(u.view);
      if (!u.state.field(livePreviewState)) {
        this.decorations = Decoration.none;
        return;
      }
      if (u.viewportChanged || u.transactions.some((tr) => decorationInputsChanged(tr) ||
        tr.effects.some(effect => effect.is(toggleCalloutFold) || effect.is(requestHtmlRender))) ||
        foldedRanges(u.startState) !== foldedRanges(u.state)) {
        this.decorations = buildDecorations(u.view);
      }
    }
    docViewUpdate(view: EditorView) { scheduleMathMeasure(view); }
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
  // Filename title is a separate scrolling row, outside source block wrappers.
  '.cm-scroller.cm-has-inline-title': { flexWrap: 'wrap', alignContent: 'flex-start' },
  '.cm-note-title-row': { flex: '0 0 100%', minWidth: '0' },
  '.cm-scroller.cm-has-inline-title > .cm-content': { paddingTop: '0', minHeight: '0' },
  '.cm-inline-title': {
    fontSize: 'var(--h1-size)',
    fontWeight: 'var(--h1-weight)',
    lineHeight: 'var(--line-height-tight)',
    letterSpacing: '-0.015em',
    color: 'var(--text-normal)',
    overflowWrap: 'anywhere',
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
  '.cm-bullet, .cm-list-number': { color: 'var(--text-faint)' },
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
  '.cm-cell-edit:focus-within': { boxShadow: 'inset 0 0 0 2px var(--interactive-accent)' },
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
