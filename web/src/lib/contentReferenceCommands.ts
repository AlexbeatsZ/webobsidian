import { createContentTarget, type ContentTarget, type SourceSpan } from '@webobsidian/markdown-core';
import type { EditorView } from '@codemirror/view';
import { getActiveEditor } from './activeEditor';
import { contextOf } from './renderContext';
import { syntaxModel } from './syntaxModel';
import { useStore } from './store';
import type { NativeCommand } from './commands';

/** The one copy path for typed references: reuse or create the ID, then copy `[[^id]]` or `![[^id]]`. */
export async function copyContentReference(view: EditorView, range: SourceSpan, embed: boolean, kind?: ContentTarget['kind']) {
  if (view.composing || contextOf(view).sourceFragment) return;
  try {
    const prepared = createContentTarget(view.state.field(syntaxModel), range, kind);
    if (prepared.changes.length) {
      if (view.state.readOnly) throw new Error('只读视图不能新建引用，请在编辑视图中复制');
      view.dispatch({ changes: prepared.changes, userEvent: 'input.content-reference' });
    }
    await navigator.clipboard.writeText(`${embed ? '!' : ''}[[^${prepared.id}]]`);
    useStore.getState().notify(embed ? '已复制显式引用' : '已复制隐式引用');
  } catch (error) { useStore.getState().notify('创建内容引用失败：' + (error instanceof Error ? error.message : String(error))); }
}

/** Copies references to an existing identity without touching any note. */
export async function copyKnownReference(id: string, embed: boolean) {
  try {
    await navigator.clipboard.writeText(`${embed ? '!' : ''}[[^${id}]]`);
    useStore.getState().notify(embed ? '已复制显式引用' : '已复制隐式引用');
  } catch (error) { useStore.getState().notify('复制内容引用失败：' + (error instanceof Error ? error.message : String(error))); }
}

function copySelection(embed: boolean, kind?: ContentTarget['kind']) {
  const view = getActiveEditor();
  if (!view || view.state.readOnly) return;
  const selection = view.state.selection.main;
  return copyContentReference(view, { from: selection.from, to: selection.to }, embed, kind);
}

export const contentReferenceCommands: NativeCommand[] = [
  { id: 'content-reference:copy', title: '复制稳定内容引用', run: () => copySelection(false) },
  { id: 'content-reference:copy-embed', title: '复制可编辑内容嵌入', run: () => copySelection(true) },
  { id: 'content-reference:range', title: '将选中完整块创建为范围引用', run: () => copySelection(false, 'range') },
].map(command => ({ ...command, available: context => !!context.view && !context.view.state.readOnly && !contextOf(context.view).sourceFragment }));
