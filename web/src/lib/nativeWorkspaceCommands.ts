import type { NativeCommand } from './commands';
import { useStore } from './store';
import { getActiveEditor } from './activeEditor';
import { contextOf } from './renderContext';
import { documents } from './documents';
import { printDocument } from './printDocument';
import { createVaultRenderContext } from './vaultRenderContext';
import { requestHotkeySettings } from './search';
import { getMainPdfSession } from './pdf/react';
import { contentReferenceCommands } from './contentReferenceCommands';
import { addCurrentMcpContext } from './review/client';

const activePath = () => { const view = getActiveEditor(); return view ? contextOf(view).sourcePath : useStore.getState().activePath; };
const selectTab = (index: number) => { const state = useStore.getState(), tab = state.tabs.at(index); if (tab) return state.openFile(tab.path); };
function moveTab(direction: number) { const state = useStore.getState(), index = state.tabs.findIndex(tab => tab.path === state.activePath); return selectTab((index + direction + state.tabs.length) % state.tabs.length); }
async function focusPane(direction: number) {
  const { sharedApp } = await import('./plugins');
  const leaves = sharedApp.workspace.getLeavesOfType('markdown').filter(leaf => {
    const element = leaf.view.containerEl; return element.isConnected && !element.closest('[hidden], [aria-hidden="true"]');
  }).sort((a, b) => a.view.containerEl.getBoundingClientRect().left - b.view.containerEl.getBoundingClientRect().left || a.view.containerEl.getBoundingClientRect().top - b.view.containerEl.getBoundingClientRect().top);
  const current = leaves.indexOf(sharedApp.workspace.activeLeaf), target = leaves[(current + direction + leaves.length) % leaves.length];
  if (target) { const view = target.view as import('./obsidian/workspace').MarkdownView; view.editor?.focus(); }
}
export const nativeWorkspaceCommands: NativeCommand[] = [
  ...contentReferenceCommands,
  { id: 'vault-switch', title: '切换仓库', run: () => {
    useStore.getState().setSettings(true);
    window.dispatchEvent(new Event('vault-settings-open'));
  } },
  { id: 'new-tab', title: '新建标签页', hotkeys: [{ modifiers: ['Mod', 'Shift'], key: 'N' }], run: () => useStore.getState().openHomepage() },
  { id: 'workspace:close', title: '关闭当前标签页', hotkeys: [{ modifiers: ['Mod'], key: 'W' }], run: async () => {
    const { sharedApp } = await import('./plugins');
    const leaf = sharedApp.workspace.activeLeaf, state = useStore.getState();
    if (leaf.slot === 'right' || leaf.slot === 'custom') leaf.detach();
    else if (leaf.slot === 'split') state.closeSplit();
    else if (state.activePath) state.closeTab(state.activePath);
  } },
  { id: 'workspace:next-tab', title: '转到下一个标签页', run: () => moveTab(1) },
  { id: 'workspace:previous-tab', title: '转到上一个标签页', run: () => moveTab(-1) },
  { id: 'workspace:goto-last-tab', title: '转到最后一个标签页', run: () => selectTab(-1) },
  ...Array.from({ length: 8 }, (_, index) => ({ id: `workspace:goto-tab-${index + 1}`, title: `转到标签页 #${index + 1}`, run: () => selectTab(index) })),
  { id: 'split-down', title: '在下方拆分当前文件', run: () => { const path = activePath(); if (path) return useStore.getState().openToSide(path, 'down'); } },
  { id: 'app:go-back', title: '返回', run: () => useStore.getState().goBack() },
  { id: 'app:go-forward', title: '前进', run: () => useStore.getState().goForward() },
  { id: 'app:toggle-left-sidebar', title: '显示或隐藏左侧栏', hotkeys: [{ modifiers: ['Mod'], key: '\\' }], run: () => useStore.getState().toggleLeft() },
  { id: 'app:toggle-right-sidebar', title: '显示或隐藏右侧栏', run: () => useStore.getState().toggleRight() },
  { id: 'pdf:toggle-toolbar', title: '显示或隐藏 PDF 工具栏', available: () => !!getMainPdfSession(useStore.getState().activePath), run: () => useStore.getState().togglePdfToolbar() },
  { id: 'file-explorer', title: '打开文件列表', run: () => useStore.getState().setLeftPanel('files') },
  { id: 'tags', title: '打开标签面板', run: () => useStore.getState().setRightPanel('tags') },
  { id: 'outline', title: '打开大纲', run: () => useStore.getState().setRightPanel('outline') },
  { id: 'backlinks', title: '打开反向链接', run: () => useStore.getState().setRightPanel('backlinks') },
  { id: 'outgoing', title: '打开出链面板', run: () => useStore.getState().setRightPanel('outgoing') },
  { id: 'mcp:open-panel', title: '打开 MCP 面板', run: () => useStore.getState().setRightPanel('mcp') },
  { id: 'mcp:add-context', title: '添加选中内容或当前页面到 MCP 上下文', hotkeys: [{ modifiers: ['Mod', 'Shift'], key: 'M' }], run: () => addCurrentMcpContext() },
  { id: 'editor:focus-right', title: '聚焦右侧窗格', run: () => focusPane(1) },
  { id: 'editor:focus-left', title: '聚焦左侧窗格', run: () => focusPane(-1) },
  { id: 'workspace:edit-file-title', title: '重命名当前文件', run: () => { const path = activePath(); if (path) { useStore.getState().revealInTree(path); useStore.getState().setRenamingPath(path); } } },
  { id: 'workspace:export-pdf', title: '导出当前文档为 PDF…', available: context => /\.(?:md|markdown)$/i.test(context.path), run: async () => {
    const path = activePath(); if (!path) return;
    const snapshot = documents.get(path)?.snapshot; if (!snapshot) return;
    const context = createVaultRenderContext(path, { openLink: () => {}, openMenu: () => {}, files: () => [], reportError: useStore.getState().notify });
    await printDocument(snapshot, context);
  } },
  { id: 'hotkeys', title: '打开快捷键设置', run: () => { useStore.getState().setSettings(true); requestHotkeySettings(); } },
];
