import { afterEach, describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import { Component } from '../obsidian/events';
import { codeBlocks, registerCodeProcessor } from '../obsidian/markdown';
import { syntaxModel, blockModel } from '../syntaxModel';
import { compositionSelection } from '../inlineHtml';
import { livePreviewState, livePreviewReadonly } from '../renderState';
import { sourceControls, toggleSourceRegion } from '../sourceControls';
import { renderContext, type RenderContext } from '../renderContext';
import { executableSource } from './directive';

const owners: Component[] = [];
afterEach(() => owners.splice(0).forEach(owner => owner.unload()));
function register(language = 'js-widget', directive = false) {
  const owner = new Component(); void owner.load(); owners.push(owner);
  registerCodeProcessor(owner, language, () => {}, 0, { scope: 'script', accepts: source => executableSource(source, !directive) !== null });
}
function state(source: string, allowed = true) {
  const context: RenderContext = { sourcePath: 'A.md', allowScriptExecution: allowed,
    openLink() {}, openMenu() {}, rawUrl: target => target, files: () => [], tags: async () => [],
    properties: async () => [], propertyTypes: () => ({}), setPropertyType: async () => ({}), renderEmbed: async () => null };
  return EditorState.create({ doc: source, selection: { anchor: source.length }, extensions: [
    renderContext.of(context), syntaxModel, blockModel, livePreviewState.init(() => true),
    livePreviewReadonly.init(() => true), compositionSelection, sourceControls, codeBlocks,
  ] });
}
function widgets(value: EditorState) {
  const result: any[] = [];
  value.field(codeBlocks).between(0, value.doc.length, (_from, _to, decoration) => { result.push(decoration.spec.widget); });
  return result;
}
const block = '```js-widget\ncontainer.textContent="hi";\n```\n\nafter';
describe('shared block lifetime', () => {
  it('preserves identity and updates the source range after prefix edits', () => {
    register(); const before = state(block), old = widgets(before)[0];
    const next = before.update({ changes: { from: 0, insert: 'prefix\n\n' } }).state;
    const current = widgets(next)[0];
    expect(current.eq(old)).toBe(true);
    expect(current.identity.range.from).toBe(8);
  });
  it('keeps equal-source siblings independent and replaces only an edited block', () => {
    register(); const before = state(block + '\n\n' + block), old = widgets(before);
    expect(old[0].identity).not.toBe(old[1].identity);
    const at = before.doc.toString().indexOf('hi');
    const next = widgets(before.update({ changes: { from: at, to: at + 2, insert: 'bye' } }).state);
    expect(next[0].eq(old[0])).toBe(false); expect(next[1].eq(old[1])).toBe(true);
  });
  it('denies execution in restricted contexts and while showing source', () => {
    register(); expect(widgets(state(block, false))).toHaveLength(0);
    const before = state(block);
    const opened = before.update({ effects: toggleSourceRegion.of({ from: 0, to: block.indexOf('\n\nafter') }) }).state;
    expect(widgets(opened)).toHaveLength(0);
  });
  it('never replaces unmarked ordinary JavaScript', () => {
    register('js', true);
    expect(widgets(state('```js\nchart({});\n```\n\nafter'))).toHaveLength(0);
    expect(widgets(state('```js\n// @obsidian-js\nchart({});\n```\n\nafter'))).toHaveLength(1);
  });
  it('keeps unfinished executable fences as source', () => {
    register(); expect(widgets(state('```js-widget\ncontainer.textContent="unfinished"'))).toHaveLength(0);
  });
});
