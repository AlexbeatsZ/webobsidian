import { getActiveEditor } from './activeEditor';
import { contextOf } from './renderContext';
import { documents } from './documents';
import { syntaxModel } from './syntaxModel';
import { useStore } from './store';
import { planHeadingLevels, type HeadingDirection } from './headingLevels';

function shiftActiveHeadings(direction: HeadingDirection) {
  const state = useStore.getState(), view = getActiveEditor();
  if (state.vaultSessionStale) { state.notify('Vault 已切换，请重新加载应用；旧文档会话保留'); return; }
  if (!view || view.state.readOnly) { state.notify('请先打开可编辑的 Markdown 文档'); return; }
  const path = contextOf(view).sourcePath;
  if (!/\.(?:md|markdown)$/i.test(path)) { state.notify('此命令只处理 Markdown 标题'); return; }
  if (documents.get(path)?.snapshot.conflict) { state.notify('请先解决文档的磁盘冲突'); return; }
  const current = view.state, selection = current.selection.main;
  const result = planHeadingLevels(current.field(syntaxModel), selection, direction);
  if (result.status === 'at-limit') {
    state.notify(direction === 'promote' ? '已包含一级标题，无法整体提升' : '已包含六级标题，无法整体降低');
    return;
  }
  if (result.status === 'no-heading') {
    state.notify(selection.empty ? '光标所在行不是可调整的普通标题' : '选区中没有可调整的普通标题');
    return;
  }
  const changes = current.changes(result.changes);
  view.dispatch({ changes, selection: current.selection.map(changes), userEvent: 'input.heading-level' });
  view.focus();
  state.notify(`${result.count} 个标题层级已${direction === 'promote' ? '提升 ↑' : '降低 ↓'} 1 级`);
}

export const headingLevelCommands = [
  { id: 'editor:promote-headings', title: '提升标题层次', run: () => shiftActiveHeadings('promote') },
  { id: 'editor:demote-headings', title: '降低标题层次', run: () => shiftActiveHeadings('demote') },
];
