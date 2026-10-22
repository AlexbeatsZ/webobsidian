import { afterEach, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import { analyzeMarkdown } from '@webobsidian/markdown-core';
import { syntaxModel } from '../syntaxModel';
import { renderContext, type RenderContext } from '../renderContext';
import { livePreviewState } from '../renderState';
import { sourceRegion, toggleSourceRegion } from '../sourceControls';
import { activeBlockReplacements, blockEffectOwns, boundBlocks, setBlockDefinitions } from './model';

afterEach(() => setBlockDefinitions([]));
const source = '[merge|nowrap]\n\n| A | B |\n| --- | --- |\n| 1 | 2 |';
function state(execute = true) {
  return EditorState.create({ doc: source, extensions: [syntaxModel, livePreviewState, sourceRegion,
    renderContext.of({ sourcePath: 'A.md', allowBlockEffects: true, allowScriptExecution: execute } as RenderContext)] });
}
it('empty and unknown definitions never activate', () => {
  expect(boundBlocks(analyzeMarkdown(source))).toEqual([]);
  setBlockDefinitions([{ names: ['nowrap'], classes: ['nowrap'] }]);
  expect(boundBlocks(analyzeMarkdown(source))).toEqual([]);
});
it('one script owns its native table while CSS alone preserves the table renderer', () => {
  setBlockDefinitions([{ names: ['merge'], classes: [], execute: async () => {} }, { names: ['nowrap'], classes: ['nowrap'] }]);
  const s = state(), [block] = activeBlockReplacements(s);
  expect(blockEffectOwns(s, block.target)).toBe(true);
  expect(activeBlockReplacements(state(false))).toEqual([]);
  const open = s.update({ effects: toggleSourceRegion.of(block) }).state;
  expect(activeBlockReplacements(open)).toEqual([]);
});
it('rejects two script owners without silently choosing an order', () => {
  setBlockDefinitions([{ names: ['merge'], classes: [], execute: async () => {} }, { names: ['nowrap'], classes: [], execute: async () => {} }]);
  expect(boundBlocks(analyzeMarkdown(source))).toEqual([]);
});
