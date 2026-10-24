import type { NativeCommand } from './commands';
import { getActiveEditor, fmtInsert, fmtIndent, fmtOutdent, fmtUndo, fmtRedo, editorFind } from './activeEditor';
import { toggleInline, toggleChecklist, insertLink, followLink, deleteParagraph, toggleLineStyle, surroundSelection } from './editorCommands';
import { contextOf } from './renderContext';
import type { EditorView } from '@codemirror/view';

const edit = (id: string, title: string, run: (view: EditorView) => unknown, key?: string): NativeCommand => ({
  id, title, hotkeyScope: 'editor', hotkeys: key ? [{ modifiers: ['Mod'], key }] : [],
  available: context => !!context.view && !context.view.state.readOnly,
  run: () => { const view = getActiveEditor(); if (view && !view.state.readOnly) return run(view); return false; },
});
export const nativeEditorCommands: NativeCommand[] = [
  ...([['bold', '粗体', '**', 'B'], ['italic', '斜体', '*', 'I'], ['strikethrough', '删除线', '~~'], ['highlight', '高亮', '=='], ['code', '行内代码', '`'], ['comment', '注释', '%%', '/']] as const)
    .map(([id, title, mark, key]) => edit(`editor:toggle-${id}`, title, view => toggleInline(view, mark), key)),
  edit('editor:toggle-checklist-status', '切换任务复选框', toggleChecklist, 'L'),
  edit('editor:delete-paragraph', '删除当前段落', deleteParagraph, 'D'),
  edit('editor:insert-link', '插入链接', insertLink, 'K'),
  { ...edit('editor:follow-link', '打开光标处链接', view => followLink(view, target => contextOf(view).openLink(target))), hotkeys: [{ modifiers: ['Alt'], key: 'Enter' }] },
  edit('editor:toggle-bullet-list', '切换无序列表', view => toggleLineStyle(view, 'bullet')),
  edit('editor:toggle-numbered-list', '切换有序列表', view => toggleLineStyle(view, 'ordered')),
  edit('editor:toggle-blockquote', '切换引用', view => toggleLineStyle(view, 'quote')),
  ...Array.from({ length: 7 }, (_, level) => edit(`editor:set-heading-${level}`, level ? `设为 ${level} 级标题` : '取消标题', view => toggleLineStyle(view, level))),
  edit('editor:insert-table', '插入表格', () => fmtInsert('\n| 标题 | 标题 |\n| --- | --- |\n| 内容 | 内容 |\n')),
  edit('editor:insert-horizontal-rule', '插入水平分隔线', () => fmtInsert('\n\n---\n\n')),
  edit('editor:insert-codeblock', '插入代码块', view => surroundSelection(view, '\n```\n', '\n```\n')),
  edit('editor:insert-footnote', '插入脚注', view => {
    // A unique ordinary Markdown footnote, committed as one editor transaction.
    let number = 1; const source = view.state.doc.toString();
    while (source.includes(`[^${number}]`)) number++;
    const at = view.state.selection.main.to, id = `[^${number}]`, tail = `\n\n${id}: `;
    if (at === source.length) { fmtInsert(id + tail); return; }
    const changes = view.state.changes([{ from: at, insert: id }, { from: source.length, insert: tail }]);
    view.dispatch({ changes, selection: { anchor: source.length + id.length + tail.length }, userEvent: 'input' }); view.focus();
  }),
  edit('editor:indent-list', '增加缩进', fmtIndent), edit('editor:unindent-list', '减少缩进', fmtOutdent),
  edit('editor:undo', '撤销', fmtUndo, 'Z'),
  { ...edit('editor:redo', '重做', fmtRedo), hotkeys: [{ modifiers: ['Mod', 'Shift'], key: 'Z' }, { modifiers: ['Mod'], key: 'Y' }] },
  { id: 'editor:open-search', title: '查找当前文档', hotkeyScope: 'editor', hotkeys: [{ modifiers: ['Mod'], key: 'F' }], available: context => !!context.view, run: editorFind },
  { id: 'editor:open-search-replace', title: '查找与替换', hotkeyScope: 'editor', hotkeys: [{ modifiers: ['Mod'], key: 'H' }], available: context => !!context.view, run: editorFind },
];
