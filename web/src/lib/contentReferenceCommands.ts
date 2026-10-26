import { createContentTarget, type ContentTarget } from '@webobsidian/markdown-core';
import { getActiveEditor } from './activeEditor';
import { contextOf } from './renderContext';
import { syntaxModel } from './syntaxModel';
import { useStore } from './store';
import type { NativeCommand } from './commands';

async function copyReference(embed: boolean, kind?: ContentTarget['kind']) {
  const view = getActiveEditor();
  if (!view || view.state.readOnly || view.composing || contextOf(view).sourceFragment) return;
  try {
    const selection = view.state.selection.main;
    const prepared = createContentTarget(view.state.field(syntaxModel), { from: selection.from, to: selection.to }, kind);
    if (prepared.changes.length) view.dispatch({ changes: prepared.changes, userEvent: 'input.content-reference' });
    const link = `${embed ? '!' : ''}[[^${prepared.id}]]`;
    await navigator.clipboard.writeText(link);
    useStore.getState().notify(embed ? '已复制内容嵌入' : '已复制内容引用');
  } catch (error) { useStore.getState().notify('创建内容引用失败：' + String(error)); }
}

export const contentReferenceCommands: NativeCommand[] = [
  { id: 'content-reference:copy', title: '复制稳定内容引用', run: () => copyReference(false) },
  { id: 'content-reference:copy-embed', title: '复制可编辑内容嵌入', run: () => copyReference(true) },
  { id: 'content-reference:range', title: '将选中完整块创建为范围引用', run: () => copyReference(false, 'range') },
].map(command => ({ ...command, available: context => !!context.view && !context.view.state.readOnly && !contextOf(context.view).sourceFragment }));
