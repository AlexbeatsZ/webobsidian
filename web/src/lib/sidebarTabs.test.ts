import { describe, expect, it } from 'vitest';
import { restoreSidebarTabs, sidebarTab } from './sidebarTabs';

describe('sidebar view state persistence', () => {
  it('keeps independent identities for two views of the same note without serializing note text', () => {
    const tabs = [sidebarTab('markdown', { file: 'note.md' }, 'first'), sidebarTab('markdown', { file: 'note.md' }, 'second')];
    const restored = restoreSidebarTabs(JSON.parse(JSON.stringify(tabs)));
    expect(restored.map(tab => tab.id)).toEqual(['first', 'second']);
    expect(restored.map(tab => tab.state)).toEqual([{ file: 'note.md' }, { file: 'note.md' }]);
  });
  it('rejects duplicate ids, executable browser URLs and malformed file states while retaining unknown plugin views', () => {
    expect(restoreSidebarTabs([
      sidebarTab('webviewer', { url: 'javascript:alert(1)' }, 'unsafe'),
      sidebarTab('markdown', { file: null }, 'invalid'),
      sidebarTab('plugin-view', { custom: { value: 1 } }, 'plugin'),
      sidebarTab('empty', {}, 'plugin'),
    ])).toEqual([sidebarTab('plugin-view', { custom: { value: 1 } }, 'plugin')]);
  });
});
