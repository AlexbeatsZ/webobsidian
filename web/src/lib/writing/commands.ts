import { getActiveEditor } from '../activeEditor';
import { useStore } from '../store';
import { documents } from '../documents';
import { ensureWriting, writingSettings, writingCMSettings, updateWriting } from './config';
import { getContextPlugin } from './latex/editor_context/context';
import { writingOperation } from './editing';

async function formatCurrent() {
  const view = getActiveEditor();
  if (view?.state.readOnly) return;
  const path = useStore.getState().activePath;
  if (!path) return;
  await ensureWriting();
  const { formatPath, runAfterCommands } = await import('./format');
  await formatPath(path, true);
  await runAfterCommands();
}
async function formatBatch(folder: boolean) {
  await ensureWriting();
  const s = useStore.getState();
  const parent = folder ? (s.activePath?.split('/').slice(0, -1).join('/') ?? '') : '';
  const { formatPath, ignoresFormatting } = await import('./format');
  let count = 0;
  const errors: string[] = [];
  for (const path of s.filePaths) {
    if ((parent && !path.startsWith(parent + '/')) || ignoresFormatting(path)) continue;
    try {
      if (await formatPath(path, true)) count++;
    } catch (error) {
      errors.push(`${path}: ${String(error)}`);
    }
  }
  s.notify(
    `格式化完成：${count} 个文件发生变化${errors.length ? '；' + errors.join('\n') : ''}`,
    errors.length ? 0 : 5000,
  );
}
function equation(box: boolean) {
  const view = getActiveEditor();
  if (!view || view.state.readOnly) return;
  const bounds = getContextPlugin(view).getBounds();
  if (!bounds) return;
  let from = bounds.inner_start,
    to = bounds.inner_end;
  if ('overlay' in bounds) {
    const segments = bounds.overlay.filter((s) => view.state.sliceDoc(s.from, s.to).trim());
    if (segments.length) {
      from = segments[0].from;
      to = segments.at(-1)!.to;
    }
  }
  if (view.state.sliceDoc(from, from + 1) === '\n') from++;
  if (view.state.sliceDoc(to - 1, to) === '\n') to--;
  if (box)
    view.dispatch({
      changes:
        from === to
          ? { from, insert: '\\boxed{}' }
          : [
              { from, insert: '\\boxed{' },
              { from: to, insert: '}' },
            ],
      selection: { anchor: Math.max(from, Math.min(to, view.state.selection.main.head)) + 7 },
      userEvent: 'input',
    });
  else view.dispatch({ selection: { anchor: from, head: to } });
  view.focus();
}
async function inputFeatures(value?: boolean) {
  await ensureWriting();
  const c = writingCMSettings();
  const next =
    value ??
    ![c.snippetsEnabled, c.autofractionEnabled, c.taboutEnabled, c.autoEnlargeBrackets].some(Boolean);
  await updateWriting({
    latex: {
      snippetsEnabled: next,
      autofractionEnabled: next,
      taboutEnabled: next,
      autoEnlargeBrackets: next,
    },
  });
}
export const writingCommands = [
  { id: 'math:reload-config', title: '重新加载数学宏包与导言区', run: async () => {
    const { refreshWriting } = await import('./config');
    await refreshWriting();
    useStore.getState().notify('数学配置已重新加载');
  } },
  { id: 'format', title: '格式化当前文档', run: formatCurrent },
  { id: 'format-folder', title: '格式化当前文件夹', run: () => formatBatch(true) },
  { id: 'format-vault', title: '格式化整个 Vault', run: () => formatBatch(false) },
  {
    id: 'format-ignore-file',
    title: '格式化：忽略当前文件',
    run: async () => {
      const path = useStore.getState().activePath;
      if (!path) return;
      await ensureWriting();
      const escaped = path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      await updateWriting({
        linter: {
          filesToIgnore: [
            ...(writingSettings().linter.filesToIgnore ?? []),
            { match: '^' + escaped + '$', flags: '' },
          ],
        },
      });
    },
  },
  {
    id: 'format-ignore-folder',
    title: '格式化：忽略当前文件夹',
    run: async () => {
      const path = useStore.getState().activePath?.split('/').slice(0, -1).join('/');
      if (!path) return;
      await ensureWriting();
      await updateWriting({
        linter: {
          foldersToIgnore: [...new Set([...(writingSettings().linter.foldersToIgnore ?? []), path])],
        },
      });
    },
  },
  {
    id: 'paste-plain',
    title: '粘贴为纯文本并整理',
    run: async () => {
      const view = getActiveEditor();
      if (!view || view.state.readOnly) return;
      const state = view.state;
      const text = await navigator.clipboard.readText();
      if (view.state !== state) throw new Error('粘贴前选区已变化');
      const { formatPaste } = await import('./format');
      const s = state.selection.main;
      const result = formatPaste(
        text,
        useStore.getState().activePath ?? '',
        state.doc.lineAt(s.from).text,
        state.sliceDoc(s.from, s.to),
      );
      view.dispatch({
        ...state.replaceSelection(result),
        annotations: writingOperation.of('paste'),
        userEvent: 'input.paste',
      });
    },
  },
  { id: 'formula-select', title: '选择当前公式', run: () => equation(false) },
  { id: 'formula-box', title: '为当前公式加方框', run: () => equation(true) },
  { id: 'formula-input-enable', title: '开启公式输入辅助', run: () => inputFeatures(true) },
  { id: 'formula-input-disable', title: '关闭公式输入辅助', run: () => inputFeatures(false) },
  { id: 'formula-input-toggle', title: '切换公式输入辅助', run: () => inputFeatures() },
  {
    id: 'formula-conceal',
    title: '切换公式 Unicode 显示',
    run: async () => {
      await ensureWriting();
      await updateWriting({ latex: { concealEnabled: !writingCMSettings().concealEnabled } });
    },
  },
];

export function bindWritingNavigation() {
  let queue: Promise<unknown> = Promise.resolve();
  return useStore.subscribe((next, previous) => {
    if (
      next.activePath === previous.activePath ||
      !previous.activePath ||
      !writingSettings().linter.lintOnFileChange
    )
      return;
    const path = previous.activePath;
    queue = queue
      .catch(() => {})
      .then(async () => {
        const { formatPath } = await import('./format');
        await formatPath(path, true);
      })
      .catch((error) => useStore.getState().notify(String(error)));
  });
}
