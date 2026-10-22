import { useStore } from './store';
import { api } from './api';
import { writingCommands } from './writing/commands';

/** Native command definitions shared by the palette and configurable shortcuts. */
export const nativeCommands = [
  ...writingCommands,
  { id: 'files', title: '打开文件', run: () => useStore.getState().setPalette(true, 'files') },
  { id: 'commands', title: '执行命令', run: () => useStore.getState().setPalette(true, 'commands') },
  { id: 'headings', title: '搜索当前文档标题', run: () => useStore.getState().setPalette(true, 'headings') },
  { id: 'templates', title: '插入模板', run: () => useStore.getState().setPalette(true, 'templates') },
  {
    id: 'move',
    title: '移动文件',
    run: () => {
      const s = useStore.getState();
      if (s.activePath) s.setMovePath(s.activePath);
    },
  },
  { id: 'new', title: 'New note', run: () => useStore.getState().newNote() },
  { id: 'new-canvas', title: 'New canvas', run: () => useStore.getState().newCanvas() },
  { id: 'daily', title: 'Open today’s daily note', run: () => useStore.getState().openDailyNote() },
  { id: 'save', title: 'Save current file', run: () => useStore.getState().save() },
  {
    id: 'bookmark',
    title: 'Bookmark current file',
    run: () => {
      const s = useStore.getState();
      if (s.activePath) s.toggleBookmark(s.activePath);
    },
  },
  {
    id: 'split',
    title: 'Open current file to the right',
    run: () => {
      const s = useStore.getState();
      if (s.activePath) void s.openToSide(s.activePath);
    },
  },
  { id: 'search', title: 'Open search', run: () => useStore.getState().setLeftPanel('search') },
  {
    id: 'bookmarks',
    title: 'Open bookmarks & recent',
    run: () => useStore.getState().setLeftPanel('bookmarks'),
  },
  { id: 'graph', title: 'Open graph view', run: () => useStore.getState().setGraph(true) },
  { id: 'settings', title: 'Open settings', run: () => useStore.getState().setSettings(true) },
  { id: 'trash', title: 'Open trash', run: () => useStore.getState().setTrash(true) },
  { id: 'reading', title: 'View: Reading mode', run: () => useStore.getState().setViewMode('reading') },
  { id: 'live', title: 'View: Live edit', run: () => useStore.getState().setViewMode('live') },
  { id: 'source', title: 'View: Source', run: () => useStore.getState().setViewMode('source') },
  {
    id: 'reindex',
    title: 'Rebuild search index',
    run: async () => {
      const notify = useStore.getState().notify;
      notify('Rebuilding search index…', 0);
      try {
        await api.reindex();
        notify('Search index rebuilt');
      } catch (error) {
        notify(String(error));
      }
    },
  },
];
export function runNativeCommand(id: string): boolean {
  const command = nativeCommands.find((c) => c.id === id);
  if (!command) return false;
  Promise.resolve(command.run()).catch((error) => useStore.getState().notify(String(error)));
  return true;
}
