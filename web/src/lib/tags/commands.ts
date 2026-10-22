import { useStore } from '../store';
import { deleteNativeTag, openTagOperation } from './actions';

export const tagCommands = [
  { id: 'tags-folder-rules', title: '按文件夹规则补标签（预览）', run: () =>
    openTagOperation({ scope: { kind: 'vault' }, operation: { kind: 'folder-rules' }, title: '按文件夹规则补标签' }) },
  { id: 'tags', title: '显示标签层级', run: () => {
    const state = useStore.getState(); state.setLeftPanel('tags'); if (!state.leftOpen) state.toggleLeft();
  } },
  { id: 'tags-batch-selected', title: '批量修改所选文件的标签', run: () => {
    const s = useStore.getState(), paths = s.selected.length ? s.selected : s.activePath ? [s.activePath] : [];
    if (!paths.length) { s.notify('请先选择文件或文件夹'); return; }
    // Expand selected folders against saved file membership, not file contents.
    const targets = s.filePaths.filter((path) => paths.some((selected) => path === selected || path.startsWith(selected + '/')));
    openTagOperation({ scope: { kind: 'files', paths: targets }, title: '修改所选文件的标签' });
  } },
  { id: 'tags-batch-folder', title: '批量修改当前文件夹的标签', run: () => {
    const path = useStore.getState().activePath;
    openTagOperation({ scope: { kind: 'folder', path: path?.split('/').slice(0, -1).join('/') ?? '' } });
  } },
  { id: 'tags-rename', title: '重命名 / 合并 Vault 标签层级', run: () =>
    openTagOperation({ scope: { kind: 'vault' }, operation: { kind: 'rename', from: '', to: '' } }) },
  { id: 'tags-delete', title: '删除 Vault 标签（预览）', run: () => deleteNativeTag() },
];
