import { RangeSet, StateField, type Range, type EditorState, type Transaction } from '@codemirror/state';
import { BlockWrapper, Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet } from '@codemirror/view';
import { blockEffectList, tableModels, type SourceSpan, type MarkdownModel } from '@webobsidian/markdown-core';
import { syntaxModel } from '../syntaxModel';
import { contextOf, renderContext, nonExecutingContext } from '../renderContext';
import { livePreviewState, livePreviewReadonly } from '../renderState';
import { sourceIsOpen, sourceButton } from '../sourceControls';
import { compositionSelection } from '../inlineHtml';
import { decorationInputsChanged } from '../decorationDependencies';
import { boundBlocks, activeBlockReplacements, blockEffectViews, type BoundBlock } from './model';
import { attachBlockStyles, createEffectRun } from './runtime';
import type { JavascriptRun } from '../javascript/lifetime';

type Identity = { range: SourceSpan; target: BoundBlock; model: MarkdownModel };
const mounts = new WeakMap<HTMLElement, { stop(): void }>();
class EffectWidget extends WidgetType {
  constructor(readonly identity: Identity, readonly source: string, readonly block: BoundBlock, readonly path: string) { super(); }
  eq(other: EffectWidget) { return this.identity === other.identity && this.source === other.source && this.block.script?.execute === other.block.script?.execute && this.path === other.path && this.block.classes.join(' ') === other.block.classes.join(' '); }
  toDOM(view: EditorView) {
    const doc = view.dom.ownerDocument, host = doc.createElement('div');
    host.className = ['native-block-effect', ...this.block.classes].join(' ');
    let stopped = false, run: JavascriptRun | undefined, queued = false, errorOutput: HTMLElement | undefined;
    const measure = () => { if (!stopped) view.requestMeasure(); };
    const render = async () => {
      if (stopped) return;
      run?.unload();
      errorOutput?.remove(); errorOutput = undefined;
      const output = doc.createElement('div'); host.prepend(output);
      const current = createEffectRun(output, contextOf(view), () => {
        if (stopped || queued) return; queued = true;
        queueMicrotask(() => { queued = false; if (!stopped) void render(); });
      }, measure); run = current; host.dataset.renderPending = 'true';
      try {
        const model = this.identity.model, target = this.identity.target;
        const raw = model.text.slice(target.target.from, target.to);
        const quoteDepth = (target.prefix.match(/>/g) ?? []).length;
        const source = quoteDepth ? raw.split('\n').map(line => { for (let n = 0; n < quoteDepth; n++) line = line.replace(/^\s*> ?/, ''); return line; }).join('\n') : raw;
        const result = await this.block.script!.execute!({
          app: current.app, container: output, source, sourcePath: current.sourcePath,
          model, range: target.target, node: target.node,
          list: () => { current.assertActive(); return blockEffectList(model, target.node); },
          table: () => { current.assertActive(); return tableModels(model).find(t => t.from === target.target.from && t.to === target.to); },
          signal: current.signal, onCleanup: current.onCleanup, component: current,
          watch: current.watch, renderMarkdown: current.renderMarkdown.bind(current),
          renderSource: (target = output) => current.renderMarkdown(source, target, nonExecutingContext(current.context)),
        });
        current.assertActive();
        if (typeof result === 'string') await current.renderMarkdown(result);
        else if (typeof result === 'function') current.onCleanup(result as () => void);
      } catch (error) {
        if (!current.signal.aborted) {
          current.unload();
          const message = doc.createElement('pre'); message.className = 'mod-error'; message.textContent = String(error);
          // Keep source accessible even when user code fails.
          output.replaceChildren(message); host.prepend(output); errorOutput = output;
        }
      } finally { if (!stopped && run === current) { delete host.dataset.renderPending; measure(); } }
    };
    mounts.set(host, { stop() { stopped = true; run?.unload(); } });
    if (!view.state.readOnly) host.append(sourceButton(view, () => this.identity.range, 'block effect'));
    void render(); return host;
  }
  destroy(dom: HTMLElement) { mounts.get(dom)?.stop(); mounts.delete(dom); }
  ignoreEvent() { return true; }
}

function build(state: EditorState, previous?: DecorationSet, tr?: Transaction): DecorationSet {
  if (!state.field(livePreviewState) || !state.facet(renderContext).allowBlockEffects) return Decoration.none;
  const model = state.field(syntaxModel), replacements = activeBlockReplacements(state);
  const prior = new Map<string, EffectWidget>();
  previous?.between(0, tr?.startState.doc.length ?? state.doc.length, (from, to, d) => {
    if (d.spec.widget instanceof EffectWidget) prior.set(`${tr?.changes.mapPos(from, 1) ?? from}:${tr?.changes.mapPos(to, -1) ?? to}`, d.spec.widget);
  });
  const ranges: Range<Decoration>[] = [];
  for (const block of boundBlocks(model)) {
    if (sourceIsOpen(state, block) || replacements.some(r => r !== block && block.from >= r.from && block.to <= r.to)) continue;
    if (block.script && !replacements.includes(block)) continue;
    const readonly = state.field(livePreviewReadonly);
    if (readonly || !state.field(compositionSelection).selection.ranges.some(s => s.from <= block.marker.to && s.to >= block.marker.from)) {
      // Include its newline to avoid leaving a blank display line.
      ranges.push(Decoration.replace({ block: true }).range(block.marker.from, Math.min(model.text.length, block.marker.to + 1)));
    }
    if (block.script) {
      const source = model.text.slice(block.target.from, block.to), old = prior.get(`${block.target.from}:${block.to}`);
      const identity = old?.source === source && old.block.script?.execute === block.script.execute && old.path === state.facet(renderContext).sourcePath ? old.identity : { range: block, target: block, model };
      identity.range = block; identity.target = block; identity.model = model;
      ranges.push(Decoration.replace({ block: true, widget: new EffectWidget(identity, source, block, state.facet(renderContext).sourcePath) }).range(block.target.from, block.to));
    }
  }
  return Decoration.set(ranges, true);
}
const presentation = StateField.define<DecorationSet>({
  create: build,
  update: (value, tr) => decorationInputsChanged(tr) || tr.startState.facet(renderContext) !== tr.state.facet(renderContext) ? build(tr.state, value, tr) : value,
  provide: field => EditorView.decorations.from(field),
});
function wrappers(state: EditorState) {
  if (!state.field(livePreviewState) || !state.facet(renderContext).allowBlockEffects) return RangeSet.empty;
  const replacements = activeBlockReplacements(state);
  const ranges: Range<BlockWrapper>[] = [];
  for (const block of boundBlocks(state.field(syntaxModel))) {
    if (!block.classes.length || sourceIsOpen(state, block) || replacements.some(r => block.from >= r.from && block.to <= r.to)) continue;
    if (block.script && !state.facet(renderContext).allowScriptExecution) continue;
    ranges.push(BlockWrapper.create({ tagName: 'div', rank: 200, attributes: {
      class: ['native-block-effect', ...block.classes].join(' '),
      'data-source-from': String(block.target.from), 'data-source-to': String(block.to),
    } }).range(block.target.from, block.to));
  }
  return BlockWrapper.set(ranges, true);
}
const layout = StateField.define<RangeSet<BlockWrapper>>({ create: wrappers,
  update: (value, tr) => decorationInputsChanged(tr) || tr.startState.facet(renderContext) !== tr.state.facet(renderContext) ? wrappers(tr.state) : value,
  provide: field => EditorView.blockWrappers.from(field),
});
export const blockEffects = [presentation, layout, EditorView.baseTheme({ '.native-block-effect': { position: 'relative' } }), ViewPlugin.fromClass(class {
  stop?: () => void;
  constructor(readonly view: EditorView) { blockEffectViews.add(view); if (contextOf(view).allowBlockEffects) this.stop = attachBlockStyles(view.dom.ownerDocument); }
  destroy() { blockEffectViews.delete(this.view); this.stop?.(); }
})];
