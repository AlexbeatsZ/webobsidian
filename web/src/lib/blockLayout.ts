import { RangeSet, StateField, type Range, type EditorState } from '@codemirror/state';
import { BlockWrapper, EditorView } from '@codemirror/view';
import { caretTouches } from '@webobsidian/markdown-core';
import { blockModel } from './syntaxModel';
import { livePreviewState, livePreviewReadonly } from './renderState';
import { compositionSelection } from './inlineHtml';
import { sourceOwns } from './sourceControls';
import { CALLOUT_SLOT } from './callouts';

export const blockLayout = StateField.define<RangeSet<BlockWrapper>>({
  create: build,
  update: (_value, transaction) => build(transaction.state),
  provide: (field) => EditorView.blockWrappers.from(field),
});
function build(state: EditorState): RangeSet<BlockWrapper> {
  if (!state.field(livePreviewState)) return RangeSet.empty;
  const readonly = state.field(livePreviewReadonly);
  const ranges: Range<BlockWrapper>[] = [];
  for (const block of state.field(blockModel).containers) {
    if (block.to <= block.from || sourceOwns(state, block)) continue;
    if (block.kind === 'code' && block.language.toLowerCase() === 'mermaid' &&
      !caretTouches(block, state.field(compositionSelection).selection.ranges, readonly)) continue;
    const attributes: Record<string, string> = {
      class: 'md-container md-' + block.kind,
      'data-source-from': String(block.from), 'data-source-to': String(block.to),
    };
    if (block.kind === 'callout') {
      attributes['data-callout'] = block.type;
      attributes.style = `--callout-color: var(--callout-${CALLOUT_SLOT[block.type] ?? 'default'})`;
    }
    if (block.kind === 'code') attributes['data-lang'] = block.language;
    ranges.push(BlockWrapper.create({ tagName: 'div', attributes,
      rank: Math.max(0, (block.kind === 'code' ? 80 : 100) - block.depth),
    }).range(block.from, block.to));
  }
  return BlockWrapper.set(ranges, true);
}
