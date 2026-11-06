import { useStore } from './store';
import { showReviews } from './review/client';
import { api } from './api';
import { writingCommands } from './writing/commands';
import { hotkeyCommandId } from '@webobsidian/search-core';
import { setActiveEditorMode } from './activeEditor';
import type { NativeCommand } from './commands';
import { nativeEditorCommands } from './nativeEditorCommands';
import { nativeWorkspaceCommands } from './nativeWorkspaceCommands';
import { configuredMenuCommands } from './configuredMenus/commands';
import { attachmentCleanupCommands, attachmentCleanupLegacyCommandIds } from './attachments/commands';
import { tagCommands } from './tags/commands';
import { headingLevelCommands } from './headingLevelCommands';
import { debugStatus, updateDebug, captureDebug, flushDebug, exportDebug } from './debug';

/** Native command definitions shared by the palette and configurable shortcuts. */
function setMode(mode: 'live' | 'reading' | 'source' | 'toggle-preview' | 'toggle-source') {
  if (setActiveEditorMode(mode)) return;
  const state = useStore.getState();
  state.setViewMode(mode === 'toggle-preview' ? (state.viewMode === 'reading' ? 'live' : 'reading')
    : mode === 'toggle-source' ? (state.viewMode === 'source' ? 'live' : 'source') : mode);
}
export const nativeCommands: NativeCommand[] = [
  { id: 'debug:toggle', title: '调试：开启或关闭记录', run: () => { const state = debugStatus(); return updateDebug(!state.enabled, state.source); } },
  { id: 'debug:capture', title: '调试：记录当前现场', run: async () => {
    if (!debugStatus().enabled) throw new Error('请先开启调试记录');
    captureDebug('command'); await flushDebug();
  } },
  { id: 'debug:export', title: '调试：导出日志', run: exportDebug },
  { id: 'review-changes', title: '审阅候选修改', run: showReviews },
  ...nativeEditorCommands,
  ...nativeWorkspaceCommands,
  ...writingCommands,
  ...configuredMenuCommands,
  ...attachmentCleanupCommands,
  ...tagCommands,
  ...headingLevelCommands,
  { id: 'files', title: '打开文件', hotkeys: [{ modifiers: ['Ctrl'], key: 'O' }], run: () => useStore.getState().setPalette(true, 'files') },
  { id: 'commands', title: '执行命令', hotkeys: [{ modifiers: ['Ctrl'], key: 'P' }, { modifiers: ['Ctrl', 'Shift'], key: 'P' }], run: () => useStore.getState().setPalette(true, 'commands') },
  { id: 'headings', title: '搜索当前文档标题', run: () => useStore.getState().setPalette(true, 'headings') },
  { id: 'templates', title: '插入模板', run: () => useStore.getState().setPalette(true, 'templates') },
  {
    id: 'move',
    title: '移动文件',
    run: () => {
      const s = useStore.getState();
      const path = s.currentPath(); if (path) s.setMovePath(path);
    },
  },
  { id: 'new', title: '新建笔记', hotkeys: [{ modifiers: ['Ctrl'], key: 'N' }], run: () => useStore.getState().newNote() },
  { id: 'save', title: '保存当前文件', hotkeys: [{ modifiers: ['Ctrl'], key: 'S' }], run: () => useStore.getState().save() },
  {
    id: 'bookmark',
    title: '收藏当前文件',
    run: () => {
      const s = useStore.getState();
      const path = s.currentPath(); if (path) s.toggleBookmark(path);
    },
  },
  {
    id: 'split',
    title: '向右分屏',
    run: () => { void useStore.getState().splitWithHomepage(null, 'right'); },
  },
  { id: 'search', title: '搜索整个仓库', hotkeys: [{ modifiers: ['Ctrl', 'Shift'], key: 'F' }], run: () => useStore.getState().setLeftPanel('search') },
  {
    id: 'bookmarks',
    title: '打开收藏与最近文件',
    run: () => {
      const s = useStore.getState();
      const tab = s.rightTabs.find(tab => tab.type === 'bookmarks');
      if (tab) s.selectRightTab(tab.id); else s.openRightTab('bookmarks');
    },
  },
  { id: 'graph', title: '打开关系图谱', run: () => useStore.getState().setGraph(true) },
  { id: 'settings', title: '打开设置', run: () => useStore.getState().setSettings(true) },
  { id: 'trash', title: '打开回收站', run: () => useStore.getState().setTrash(true) },
  { id: 'reading', title: '切换到阅读模式', run: () => setMode('reading') },
  { id: 'live', title: '切换到实时预览', run: () => setMode('live') },
  { id: 'source', title: '切换到源码模式', run: () => setMode('source') },
  { id: 'toggle-preview', title: '切换阅读与编辑模式', hotkeys: [{ modifiers: ['Ctrl'], key: 'E' }], run: () => setMode('toggle-preview') },
  { id: 'toggle-source', title: '切换源码与实时预览', run: () => setMode('toggle-source') },
  {
    id: 'reindex',
    title: '重建搜索索引',
    run: async () => {
      const notify = useStore.getState().notify;
      notify('正在重建搜索索引…', 0);
      try {
        await api.reindex();
        notify('搜索索引已重建');
      } catch (error) {
        notify(String(error));
      }
    },
  },
];
export function resolveNativeCommandId(id: string): string {
  if ((attachmentCleanupLegacyCommandIds as readonly string[]).includes(id)) id = attachmentCleanupCommands[0].id;
  return hotkeyCommandId(id);
}
