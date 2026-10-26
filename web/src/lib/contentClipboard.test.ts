import { expect, it, vi } from 'vitest';
import { EditorState, EditorSelection, Annotation } from '@codemirror/state';
import { analyzeMarkdown, contentTargets } from '@webobsidian/markdown-core';

vi.mock('./writing/editing', () => ({ writingOperation: Annotation.define<string>() }));
import { ContentClipboardPolicy, contentClipboard, CONTENT_CLIPBOARD_MIME } from './contentClipboard';
import { syntaxModel } from './syntaxModel';
import { EditorView } from '@codemirror/view';

const empty = () => analyzeMarkdown('');
const heading = '# Title ^heading-one\n\n[[^heading-one|label]] [local](#^heading-one)\n';
function copied(text = heading, mode: 'copy' | 'cut' = 'copy', getSource = empty) {
  const policy = new ContentClipboardPolicy(), model = analyzeMarkdown(text);
  return { policy, content: policy.capture(model, { from: 0, to: text.length }, 'source.md', mode, getSource) };
}

it('clones complete definitions on every paste and remaps only semantic internal references', () => {
  const literal = '\n`[[^heading-one]]`\n\n```md\n[[^heading-one]]\n^heading-one\n```\n\n[[^heading-outside]]\n';
  const { policy, content } = copied(heading + literal);
  const first = policy.prepare(content, empty()).text;
  const second = policy.prepare(content, empty()).text;
  const id = contentTargets(analyzeMarkdown(first)).targets[0].id;
  expect(id).not.toBe('heading-one');
  expect(first).toContain(`[[^${id}|label]] [local](#^${id})`);
  expect(first).toContain(literal);
  expect(contentTargets(analyzeMarkdown(second)).targets[0].id).not.toBe(id);
});

it('rewrites reference definitions and embeds while preserving labels, titles and external targets', () => {
  const source = '# Title ^heading-one\n\n![[^heading-one]] [[other#^heading-one]] [[source#^heading-one|own]]\n\n[Label][ref]\n\n[ref]: <#^heading-one> "Title"\n';
  const { policy, content } = copied(source);
  const result = policy.prepare(content, empty()).text;
  const id = contentTargets(analyzeMarkdown(result)).targets[0].id;
  expect(result).toContain(`![[^${id}]] [[other#^heading-one]]`);
  expect(result).toContain(`[[^${id}|own]]`);
  expect(result).toContain(`[ref]: <#^${id}> "Title"`);
});

it('moves a cut identity only once after source removal and clones subsequent pastes', () => {
  let source = analyzeMarkdown(heading);
  const { policy, content } = copied(heading, 'cut', () => source);
  source = empty();
  const move = policy.prepare(content, empty());
  expect(move.text).toBe(heading);
  move.commit();
  expect(policy.prepare(content, empty()).text).not.toBe(heading);
});

it('clones when cut source still owns an ID, source is unavailable, or destination already owns it', () => {
  for (const current of [() => analyzeMarkdown(heading), () => undefined]) {
    const model = analyzeMarkdown(heading), policy = new ContentClipboardPolicy();
    const content = policy.capture(model, { from: 0, to: heading.length }, 'source.md', 'cut', current);
    expect(policy.prepare(content, empty()).text).not.toBe(heading);
  }
  const { policy, content } = copied(heading, 'cut');
  const first = policy.prepare(content, analyzeMarkdown(heading));
  expect(first.text).not.toBe(heading);
  first.commit();
  expect(policy.prepare(content, empty()).text).not.toBe(heading);
});

it('does not consume a cut token until insertion commits', () => {
  const { policy, content } = copied(heading, 'cut');
  expect(policy.prepare(content, empty()).text).toBe(heading);
  expect(policy.prepare(content, empty()).text).toBe(heading);
});

it('leaves external text, invalid MIME, changed text and partial block selections unchanged', () => {
  const { policy, content } = copied();
  for (const metadata of [undefined, '{}', '{', JSON.stringify({ ...JSON.parse(content.metadata!), text: 'other' })])
    expect(policy.prepare({ text: heading, metadata }, empty()).text).toBe(heading);
  const source = analyzeMarkdown(heading + '\n# Next\n');
  const partial = policy.capture(source, { from: 2, to: heading.indexOf('\n') }, 'source.md', 'copy', () => source);
  expect(policy.prepare(partial, empty()).text).toBe(partial.text);
  const incomplete = policy.capture(source, { from: 0, to: heading.indexOf('\n') }, 'source.md', 'copy', () => source);
  expect(policy.prepare(incomplete, empty()).text).toBe(incomplete.text);
});

it.each([
  '```js\nconst text = "^code-one";\n```\n^code-one\n',
  '> [!note] Title\n> body ^callout-one\n',
  '$$x$$ ^eq-one\n',
  '^range-one:start\n\nparagraph\n\n^range-one:end\n',
])('clones structural definitions and both range boundaries: %s', source => {
  const { policy, content } = copied(source);
  const old = contentTargets(analyzeMarkdown(source)).targets[0];
  expect(old).toBeDefined();
  const result = policy.prepare(content, empty()).text;
  const target = contentTargets(analyzeMarkdown(result)).targets[0];
  expect(target.kind).toBe(old.kind);
  expect(target.id).not.toBe(old.id);
  if (target.kind === 'range') {
    expect(result).toContain(`^${target.id}:start`);
    expect(result).toContain(`^${target.id}:end`);
  }
  if (target.kind === 'code') expect(result).toContain('const text = "^code-one";');
});

function editor(text = '', writable = true, projection = false) {
  let state = EditorState.create({ doc: text, extensions: [syntaxModel, EditorState.allowMultipleSelections.of(true)] });
  const view = { get state() { return state; }, composing: false, focus: vi.fn(),
    dispatch: (spec: Parameters<EditorState['update']>[0]) => { state = state.update(spec).state; } } as unknown as EditorView;
  const controller = contentClipboard({ source: () => ({ identity: 'source.md', model: state.field(syntaxModel), offset: 0, read: () => state.field(syntaxModel) }),
    writable: () => writable, projection: () => projection,
    format: text => text, reportError: error => { throw error; } });
  return { view, controller, setWritable: (value: boolean) => { writable = value; } };
}

it('context-menu copy and paste share the MIME policy and clone each multi-selection insertion', async () => {
  let items: { types: string[]; getType: (type: string) => Promise<Blob> }[] = [];
  class Item {
    types: string[];
    constructor(private data: Record<string, Blob>) { this.types = Object.keys(data); }
    async getType(type: string) { return this.data[type]; }
  }
  vi.stubGlobal('ClipboardItem', Item);
  vi.stubGlobal('navigator', { clipboard: { write: async (value: typeof items) => { items = value; }, read: async () => items } });
  try {
    const source = editor(heading);
    source.view.dispatch({ selection: { anchor: 0, head: heading.length } });
    await source.controller.copy(source.view);
    expect(items[0].types).toContain(`web ${CONTENT_CLIPBOARD_MIME}`);
    const target = editor('\n\n');
    target.view.dispatch({ selection: EditorSelection.create([EditorSelection.cursor(0), EditorSelection.cursor(2)]) });
    await target.controller.paste(target.view);
    const targets = contentTargets(target.view.state.field(syntaxModel)).targets;
    expect(targets).toHaveLength(2);
    expect(new Set(targets.map(target => target.id)).size).toBe(2);
  } finally { vi.unstubAllGlobals(); }
});

it('context-menu guards read-only, projection cut moves, and clipboard write failure', async () => {
  let value = '';
  vi.stubGlobal('navigator', { clipboard: { writeText: async () => { throw new Error('denied'); }, readText: async () => heading } });
  try {
    const readonly = editor('unchanged', false);
    await readonly.controller.paste(readonly.view);
    expect(readonly.view.state.doc.toString()).toBe('unchanged');
    const source = editor('plain');
    source.view.dispatch({ selection: { anchor: 0, head: 5 } });
    await expect(source.controller.copy(source.view, true)).rejects.toThrow('denied');
    expect(source.view.state.doc.toString()).toBe('plain');
    vi.stubGlobal('navigator', { clipboard: { write: async (items: { getType: (type: string) => Promise<Blob> }[]) => {
      value = await (await items[0].getType(`web ${CONTENT_CLIPBOARD_MIME}`)).text();
    } } });
    vi.stubGlobal('ClipboardItem', class { constructor(private data: Record<string, Blob>) {} async getType(type: string) { return this.data[type]; } });
    const projection = editor(heading, true, true);
    projection.view.dispatch({ selection: { anchor: 0, head: heading.length } });
    await projection.controller.copy(projection.view, true);
    expect(JSON.parse(value).mode).toBe('copy');
  } finally { vi.unstubAllGlobals(); }
});

it.each([false, true])('fails anchored async copy/cut explicitly when custom formats cannot persist (write present: %s)', async available => {
  const plain = vi.fn(async () => {});
  vi.stubGlobal('ClipboardItem', class { constructor(_data: unknown) {} });
  vi.stubGlobal('navigator', { clipboard: { writeText: plain,
    ...(available ? { write: async () => { throw new Error('Unsupported custom format'); } } : {}) } });
  try {
    const source = editor(heading);
    source.view.dispatch({ selection: { anchor: 0, head: heading.length } });
    await expect(source.controller.copy(source.view)).rejects.toThrow('不支持内容标识格式');
    await expect(source.controller.copy(source.view, true)).rejects.toThrow('不支持内容标识格式');
    expect(plain).not.toHaveBeenCalled();
    expect(source.view.state.doc.toString()).toBe(heading);
  } finally { vi.unstubAllGlobals(); }
});

function nativeEditor(text = '', writable = true) {
  const spy = vi.spyOn(EditorView, 'domEventHandlers');
  const current = editor(text, writable);
  const handlers = spy.mock.calls.at(-1)![0];
  spy.mockRestore();
  return { ...current, handlers };
}

function clipboardEvent(files: unknown[] = []) {
  const data = new Map<string, string>();
  return { clipboardData: { files, getData: (type: string) => data.get(type) ?? '', setData: (type: string, value: string) => data.set(type, value) },
    preventDefault: vi.fn(), stopPropagation: vi.fn() } as unknown as ClipboardEvent;
}

it('native copy/cut/paste use the same policy with single-use cut movement', () => {
  const source = nativeEditor(heading), target = nativeEditor();
  source.view.dispatch({ selection: { anchor: 0, head: heading.length } });
  const event = clipboardEvent();
  expect(source.handlers.cut!(event, source.view)).toBe(true);
  expect(event.clipboardData!.getData(CONTENT_CLIPBOARD_MIME)).toBeTruthy();
  expect(source.view.state.doc.toString()).toBe('');
  expect(target.handlers.paste!(event, target.view)).toBe(true);
  expect(target.view.state.doc.toString()).toBe(heading);
  target.view.dispatch({ selection: { anchor: target.view.state.doc.length } });
  target.handlers.paste!(event, target.view);
  const targets = contentTargets(target.view.state.field(syntaxModel)).targets;
  expect(targets).toHaveLength(2);
  expect(new Set(targets.map(target => target.id)).size).toBe(2);
  const copiedEvent = clipboardEvent();
  target.view.dispatch({ selection: { anchor: 0, head: target.view.state.doc.length } });
  expect(target.handlers.copy!(copiedEvent, target.view)).toBe(true);
  const next = nativeEditor();
  next.handlers.paste!(copiedEvent, next.view);
  expect(contentTargets(next.view.state.field(syntaxModel)).targets.every(target => target.id !== 'heading-one')).toBe(true);
});

it('native passthrough retains external text formatting and file paste handlers; read-only blocks mutations', () => {
  const target = nativeEditor();
  const external = clipboardEvent();
  external.clipboardData!.setData('text/plain', heading);
  expect(target.handlers.paste!(external, target.view)).toBe(false);
  expect(external.preventDefault).not.toHaveBeenCalled();
  const attachment = clipboardEvent([{ type: 'image/png' }]);
  attachment.clipboardData!.setData(CONTENT_CLIPBOARD_MIME, '{}');
  expect(target.handlers.paste!(attachment, target.view)).toBe(true);
  expect(attachment.preventDefault).toHaveBeenCalled();
  expect(attachment.stopPropagation).not.toHaveBeenCalled();
  const readonly = nativeEditor(heading, false);
  expect(readonly.handlers.cut!(external, readonly.view)).toBe(true);
  expect(readonly.handlers.paste!(attachment, readonly.view)).toBe(true);
  expect(attachment.stopPropagation).toHaveBeenCalled();
  expect(readonly.view.state.doc.toString()).toBe(heading);
});

it('async menu operations do not edit a changed selection or a newly locked view', async () => {
  let finish: (text: string) => void = () => {};
  vi.stubGlobal('navigator', { clipboard: { readText: () => new Promise<string>(resolve => { finish = resolve; }) } });
  try {
    const target = editor('before');
    const pending = target.controller.paste(target.view);
    target.view.dispatch({ selection: { anchor: 2 } });
    finish(heading);
    await pending;
    expect(target.view.state.doc.toString()).toBe('before');
    const locked = target.controller.paste(target.view);
    target.setWritable(false);
    finish(heading);
    await locked;
    expect(target.view.state.doc.toString()).toBe('before');
  } finally { vi.unstubAllGlobals(); }
});
