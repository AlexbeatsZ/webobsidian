import { RangeSet, StateField, type Range, type EditorState } from '@codemirror/state';
import { BlockWrapper, Decoration, EditorView, WidgetType } from '@codemirror/view';
import { caretTouches, stripQuotePrefix, sourceLinePrefix, type SourceSpan } from '@webobsidian/markdown-core';
import { blockModel } from './syntaxModel';
import { livePreviewState, livePreviewReadonly } from './renderState';
import { compositionSelection } from './inlineHtml';
import { sourceOwns } from './sourceControls';
import { CALLOUT_SLOT } from './callouts';
import { decorationInputsChanged } from './decorationDependencies';
import { blockEffectOwns } from './blocks/model';

/** All whole-line replacements preserve the same source prefix as native lines. */
export function sourceBlockReplacement(state: EditorState, range: SourceSpan, widget: WidgetType) {
  const line = state.doc.lineAt(range.from), prefix = sourceLinePrefix(line.text);
  const wholeLine = range.from <= line.from + prefix.length;
  return Decoration.replace({ widget: prefix && wholeLine ? new PrefixedBlock(widget, prefix) : widget, block: true })
    .range(wholeLine ? line.from : range.from, range.to);
}

class PrefixedBlock extends WidgetType {
  constructor(readonly content: WidgetType, readonly prefix: string) { super(); }
  eq(other: PrefixedBlock) {
    return this.prefix === other.prefix && this.content.constructor === other.content.constructor && this.content.eq(other.content);
  }
  toDOM(view: EditorView) {
    const shell = document.createElement('div'); shell.className = 'cm-prefixed-block';
    const prefix = document.createElement('span'); prefix.className = 'cm-block-prefix';
    prefix.textContent = this.prefix; prefix.setAttribute('aria-hidden', 'true');
    shell.append(prefix, this.content.toDOM(view));
    return shell;
  }
  ignoreEvent(event: Event) { return this.content.ignoreEvent(event); }
  destroy(dom: HTMLElement) { this.content.destroy(dom.lastElementChild as HTMLElement); }
}

export const blockLayout = StateField.define<RangeSet<BlockWrapper>>({
  create: build,
  update: (value, transaction) => decorationInputsChanged(transaction) ? build(transaction.state) : value,
  provide: (field) => EditorView.blockWrappers.from(field),
});
function build(state: EditorState): RangeSet<BlockWrapper> {
  if (!state.field(livePreviewState)) return RangeSet.empty;
  const readonly = state.field(livePreviewReadonly);
  const ranges: Range<BlockWrapper>[] = [];
  for (const block of state.field(blockModel).containers) {
    if (block.to <= block.from || sourceOwns(state, block) || blockEffectOwns(state, block)) continue;
    if (block.kind === 'code' && block.language.toLowerCase() === 'mermaid' &&
      !caretTouches(block, state.field(compositionSelection).selection.ranges, readonly)) continue;
    const attributes: Record<string, string> = {
      class: 'md-container md-' + block.kind,
      'data-source-from': String(block.from), 'data-source-to': String(block.to),
    };
    const rank = Math.max(1, (block.kind === 'code' ? 80 : 100) - block.depth);
    if (block.kind !== 'code') {
      const first = state.doc.lineAt(block.from).text;
      const body = stripQuotePrefix(first, block.depth);
      const prefix = first.slice(0, first.length - body.length);
      // Ordinary rules precede their own >; colored Callout title rules follow it.
      // Both struts use only native source text and add no in-flow width.
      attributes['data-quote-prefix'] = block.kind === 'quote'
        ? prefix.slice(0, prefix.lastIndexOf('>')) : prefix.replace(/ $/, '');
    }
    if (block.kind === 'callout') {
      attributes['data-callout'] = block.type;
      const prefix = sourceLinePrefix(state.doc.lineAt(block.from).text);
      attributes['data-callout-inset'] = prefix.slice(prefix.lastIndexOf('>'));
      // BlockWrapper measurement includes padding, but not collapsed margins or
      // gaps between sibling lines. Keep every pixel in a measured wrapper.
      // All body lines remain CodeMirror text; these wrappers only draw frames.
      ranges.push(BlockWrapper.create({ tagName: 'div',
        attributes: { class: 'md-callout-spacing' }, rank: rank + 0.25,
      }).range(block.from, block.to));
      if (block.bodyFrom < block.to) ranges.push(BlockWrapper.create({ tagName: 'div',
        attributes: { class: 'md-callout-body' }, rank: rank - 0.25,
      }).range(block.bodyFrom, block.to));
      // Give the title its own box. Its rule must track the complete title,
      // including wrapped text, independently of the gap before the body.
      ranges.push(BlockWrapper.create({ tagName: 'div',
        attributes: { class: 'md-callout-title',
          'data-quote-prefix': attributes['data-quote-prefix'],
          style: `--callout-color: var(--callout-${CALLOUT_SLOT[block.type] ?? 'default'})`,
        }, rank: 0,
      }).range(block.from, state.doc.lineAt(block.from).to));
    }
    if (block.kind === 'code') attributes['data-lang'] = block.language;
    ranges.push(BlockWrapper.create({ tagName: 'div', attributes,
      rank,
    }).range(block.from, block.to));
  }
  return BlockWrapper.set(ranges, true);
}
