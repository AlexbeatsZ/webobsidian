import { afterEach, expect, it, vi } from 'vitest';
import { EditorState } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { analyzeMarkdown } from '@webobsidian/markdown-core';
import { paintMarkdownMinimap } from './markdownMinimapCanvas';

afterEach(() => vi.unstubAllGlobals());

it('leaves unsupported formula/image/code/table regions blank while retaining their space and search markers', () => {
  const source = 'Before\n\n$$\nx^2\n$$\n\n![image](picture.png)\n\n```js\ncode\n```\n\nAfter';
  const state = EditorState.create({ doc: source });
  const fillRect = vi.fn(), fillText = vi.fn();
  const context = { clearRect: vi.fn(), fillRect, fillText, save: vi.fn(), restore: vi.fn(), beginPath: vi.fn(), rect: vi.fn(), clip: vi.fn() };
  const image = { width: 0, height: 0, getContext: () => context, dataset: {} } as unknown as HTMLCanvasElement;
  const host = { clientWidth: 200, clientHeight: 400 } as HTMLElement;
  vi.stubGlobal('getComputedStyle', () => ({ getPropertyValue: () => '', paddingLeft: '0', paddingRight: '0', fontSize: '18' }));
  paintMarkdownMinimap(image, host, { state, contentDOM: {} } as EditorView, analyzeMarkdown(source), { column: 700, source: 700 }, [], []);
  expect(fillRect).not.toHaveBeenCalled();
  const before = fillText.mock.calls.find(call => call[0] === 'Before')!;
  const after = fillText.mock.calls.find(call => call[0] === 'After')!;
  expect(after[2] - before[2]).toBeGreaterThan(300);
  expect(fillText.mock.calls.some(call => /x\^2|picture|^code$/.test(call[0]))).toBe(false);
  paintMarkdownMinimap(image, host, { state, contentDOM: {} } as EditorView, analyzeMarkdown(source), { column: 700, source: 700 }, [{ from: 0, to: 6 }], [13]);
  expect(fillRect).toHaveBeenCalledTimes(2);
});
