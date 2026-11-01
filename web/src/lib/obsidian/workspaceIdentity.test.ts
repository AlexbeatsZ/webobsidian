import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorState } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import type { SidebarTab } from '../sidebarTabs';
import { renderContext } from '../renderContext';

const host = vi.hoisted(() => ({
  active: null as EditorView | null,
  navigationId: 'main',
  entries: [] as { cm: EditorView; info: { file: { path: string } } }[],
  state: { activePath: 'same.md', splitPath: 'same.md' as string | null, rightTabs: [] as SidebarTab[] },
}));
vi.mock('../store', () => ({ useStore: { getState: () => ({ ...host.state, currentPath: () => host.state.activePath, currentViewId: () => host.navigationId }) } }));
vi.mock('../activeEditor', () => ({ getActiveEditor: () => host.active }));
vi.mock('./editor', () => ({
  Editor: class { constructor(public cm: EditorView) {} },
  editorEntries: () => host.entries,
  refreshPluginExtensions: vi.fn(),
}));
vi.mock('./dom', () => ({ createDiv: () => ({}), createEl: () => ({}) }));
vi.mock('./ui', () => ({ Modal: class {} }));

import { MarkdownView, Workspace } from './workspace';

beforeEach(() => {
  host.active = null;
  host.navigationId = 'main';
  host.entries = [];
  host.state.activePath = 'same.md';
  host.state.splitPath = 'same.md';
  host.state.rightTabs = [];
  vi.stubGlobal('document', { activeElement: null });
});
afterEach(() => vi.unstubAllGlobals());

function mounted(navigationId?: string, readOnly = false, path = 'same.md') {
  const defaults = EditorState.create().facet(renderContext);
  const state = EditorState.create({
    doc: path,
    extensions: [renderContext.of({ ...defaults, sourcePath: path, navigationId }), EditorState.readOnly.of(readOnly)],
  });
  const container = {} as HTMLElement;
  const cm = { state, dom: { closest: vi.fn((selector: string) => selector === '.cm-host' ? container : null) } } as unknown as EditorView;
  const entry = { cm, info: { file: { path } } };
  host.entries.push(entry);
  return entry;
}

function workspace() {
  return new Workspace({ vault: { getFileByPath: (path: string) => ({ path }) } });
}

describe('workspace Markdown host identity', () => {
  it('keeps the split leaf active while its editor is absent or showing Homepage', () => {
    mounted('main'); host.navigationId = 'split';
    const ws = workspace();
    expect(ws.activeLeaf.slot).toBe('split');
    expect(ws.getActiveViewOfType(MarkdownView)).toBeNull();
  });

  it('keeps a non-Markdown sidebar active while a palette owns DOM focus', () => {
    host.navigationId = 'sidebar:guest';
    host.state.rightTabs = [{ id: 'guest', type: 'empty', state: {}, title: 'Homepage', icon: 'home' }];
    expect(workspace().activeLeaf.id).toBe('guest');
  });

  it.each([false, true])('keeps same-document editable panes distinct with split-first=%s', splitFirst => {
    const first = mounted(splitFirst ? 'split' : 'main');
    const second = mounted(splitFirst ? 'main' : 'split');
    const main = splitFirst ? second : first, split = splitFirst ? first : second;
    const ws = workspace();
    expect(ws.markdown('main')?.editor.cm).toBe(main.cm);
    expect(ws.markdown('split')?.editor.cm).toBe(split.cm);
    expect(ws.getLeavesOfType('markdown').map(leaf => (leaf.view as MarkdownView).editor.cm)).toEqual([main.cm, split.cm]);
  });

  it.each([[false, false], [true, false], [false, true], [true, true]])(
    'routes active/plugin callers independently of main readOnly=%s and split readOnly=%s', (mainReadOnly, splitReadOnly) => {
      const main = mounted('main', mainReadOnly), split = mounted('split', splitReadOnly);
      const ws = workspace();
      for (const [slot, entry] of [['main', main], ['split', split]] as const) {
        host.active = entry.cm;
        expect(ws.activeLeaf.slot).toBe(slot);
        expect(ws.getMostRecentLeaf()).toBe(ws.activeLeaf);
        expect(ws.getLeaf()).toBe(ws.activeLeaf);
        expect(ws.getActiveViewOfType(MarkdownView)?.editor.cm).toBe(entry.cm);
      }
    }
  );

  it('does not fall back to the other pane or an unidentified editor when a binding is missing', () => {
    mounted('main');
    mounted(undefined, true);
    const ws = workspace();
    expect(ws.markdown('split')).toBeNull();
    host.entries = host.entries.filter(entry => entry.cm.state.facet(renderContext).navigationId !== 'main');
    expect(ws.markdown('main')).toBeNull();
    expect(ws.getLeavesOfType('markdown')).toEqual([]);
  });

  it('uses the current binding rather than duplicating the store path as host identity', () => {
    const main = mounted('main', true, 'renamed-main.md');
    const split = mounted('split', false, 'renamed-split.md');
    const ws = workspace();
    expect(ws.markdown('main')?.file).toBe(main.info.file);
    expect(ws.markdown('split')?.file).toBe(split.info.file);
  });

  it('uses sidebar navigation IDs for both docks even when all four editors share a document', () => {
    host.state.rightTabs = [
      { id: 'left-note', type: 'markdown', state: { file: 'same.md' }, title: 'Left', icon: 'file-text', side: 'left' },
      { id: 'right-note', type: 'markdown', state: { file: 'same.md' }, title: 'Right', icon: 'file-text', side: 'right' },
    ];
    const main = mounted('main'), split = mounted('split');
    const left = mounted('sidebar:left-note'), right = mounted('sidebar:right-note', true);
    const ws = workspace();
    for (const [id, entry] of [['left-note', left], ['right-note', right]] as const) {
      host.active = entry.cm;
      expect(ws.markdown('right', id)?.editor.cm).toBe(entry.cm);
      expect(ws.activeLeaf.id).toBe(id);
      expect(ws.getActiveViewOfType(MarkdownView)?.editor.cm).toBe(entry.cm);
    }
    expect(ws.markdown('main')?.editor.cm).toBe(main.cm);
    expect(ws.markdown('split')?.editor.cm).toBe(split.cm);
    expect(ws.getLeavesOfType('markdown')).toHaveLength(4);
    expect(ws.markdown('right', 'missing')).toBeNull();
    host.entries = host.entries.filter(entry => entry !== right);
    expect(ws.markdown('right', 'right-note')).toBeNull();
  });

  it('retains DOM focus routing for non-Markdown sidebar views without an editor binding', () => {
    host.state.rightTabs = [{ id: 'guest', type: 'webviewer', state: {}, title: 'Guest', icon: 'globe' }];
    const closest = vi.fn(() => ({ dataset: { sidebarTab: 'guest' } }));
    vi.stubGlobal('document', { activeElement: { closest } });
    const ws = workspace();
    expect(ws.activeLeaf.id).toBe('guest');
    expect(closest).toHaveBeenCalledWith('[data-sidebar-tab]');
  });
});
