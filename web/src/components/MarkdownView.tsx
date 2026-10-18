import { useEffect, useId, useMemo, useRef } from 'react';
import { mountMarkdownFragment } from './MarkdownFragment';
import { Annotation, Compartment, EditorState, Prec } from '@codemirror/state';
import { EditorView, keymap, drawSelection } from '@codemirror/view';
import { defaultKeymap, indentWithTab } from '@codemirror/commands';
import { search, searchKeymap } from '@codemirror/search';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { syntaxHighlighting } from '@codemirror/language';
import type { DocumentSnapshot, SourceChange } from '@webobsidian/markdown-core';
import { obsidianHighlightStyle } from '../lib/highlight';
import { obsidianKeymap } from '../lib/editorCommands';
import { suggesterPlugin } from '../lib/suggest';
import { syntaxModel, documentMetadata, blockModel } from '../lib/syntaxModel';
import { inlineHtml } from '../lib/inlineHtml';
import { sourceControls } from '../lib/sourceControls';
import { semanticDecorations } from '../lib/semanticDecorations';
import { listLayout } from '../lib/listLayout';
import { blockLayout } from '../lib/blockLayout';
import { renderContext, type RenderContext } from '../lib/renderContext';
import { livePreviewPlugin, livePreviewState, livePreviewTheme, frontmatterField,
  tableField, htmlBlockField, mermaidField, htmlRenderedState, htmlPreviewField,
  calloutFoldState, calloutFoldDeco, mathBlockField, noteTitleField, inlineTitleField, editorClickFix,
  livePreviewReadonly, setLivePreviewReadonly, setLivePreviewEnabled, setNoteTitle } from '../lib/livePreview';

export type MarkdownMode = 'live' | 'reading' | 'source';
export interface MarkdownViewProps {
  snapshot: DocumentSnapshot;
  mode: MarkdownMode;
  context: RenderContext;
  onChange?: (changes: SourceChange[], baseVersion: number, origin: string) => DocumentSnapshot;
  onUndo?: () => DocumentSnapshot;
  onRedo?: () => DocumentSnapshot;
  onSave?: () => void;
  onModeChange?: (mode: MarkdownMode) => void;
  onSearch?: () => void;
  onReady?: (view: EditorView | null) => void;
  autoFocus?: boolean;
  showTitle?: boolean;
  layout?: 'page' | 'embedded';
}
const externalUpdate = Annotation.define<boolean>();
const readonlyExt = (reading: boolean) => reading
  ? [EditorView.editable.of(false), EditorState.readOnly.of(true)] : [];
const titleOf = (path: string) => (path.split('/').pop() ?? path).replace(/\.(md|markdown)$/i, '');

export default function MarkdownView(props: MarkdownViewProps) {
  const { snapshot, mode, context, showTitle = true, layout = 'page' } = props;
  const scopedContext = useMemo<RenderContext>(() => ({ ...context,
    mountFragment: (host, source, options) => mountMarkdownFragment(host, source, { ...options, context: options.context ?? context }),
  }), [context]);
  const instanceId = useId();
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const latest = useRef(props);
  latest.current = props;
  const version = useRef(snapshot.version);
  const readonlyComp = useRef(new Compartment()).current;
  const contextComp = useRef(new Compartment()).current;
  const openContextMenu = context.openMenu;
  const setLeftPanel = (_panel: string) => props.onSearch?.();

  const sync = (next: DocumentSnapshot) => {
    const v = view.current;
    if (!v || version.current === next.version) return;
    version.current = next.version;
    const before = v.state.doc.toString();
    if (before === next.text) return;
    let from = 0, to = before.length, insertTo = next.text.length;
    while (from < to && from < insertTo && before[from] === next.text[from]) from++;
    while (to > from && insertTo > from && before[to - 1] === next.text[insertTo - 1]) { to--; insertTo--; }
    v.dispatch({ changes: { from, to, insert: next.text.slice(from, insertTo) }, annotations: externalUpdate.of(true) });
  };
  // --- editor formatting actions (used by the right-click menu) ---
  const wrap = (before: string, after = before) => {
    const v = view.current;
    if (!v) return;
    const { from, to } = v.state.selection.main;
    const sel = v.state.sliceDoc(from, to);
    v.dispatch({
      changes: { from, to, insert: before + sel + after },
      selection: { anchor: from + before.length, head: from + before.length + sel.length },
    });
    v.focus();
  };
  const prefixLines = (prefix: string) => {
    const v = view.current;
    if (!v) return;
    const { from, to } = v.state.selection.main;
    const a = v.state.doc.lineAt(from).number;
    const b = v.state.doc.lineAt(to).number;
    const changes = [];
    for (let n = a; n <= b; n++) changes.push({ from: v.state.doc.line(n).from, insert: prefix });
    v.dispatch({ changes });
    v.focus();
  };
  const insert = (text: string, caretOffset = text.length) => {
    const v = view.current;
    if (!v) return;
    const { from, to } = v.state.selection.main;
    v.dispatch({ changes: { from, to, insert: text }, selection: { anchor: from + caretOffset } });
    v.focus();
  };
  const copy = async () => {
    const v = view.current;
    if (!v) return;
    const { from, to } = v.state.selection.main;
    await navigator.clipboard.writeText(v.state.sliceDoc(from, to)).catch(() => {});
  };
  const cut = async () => {
    const v = view.current;
    if (!v) return;
    const { from, to } = v.state.selection.main;
    await navigator.clipboard.writeText(v.state.sliceDoc(from, to)).catch(() => {});
    v.dispatch({ changes: { from, to, insert: '' } });
    v.focus();
  };
  const paste = async () => {
    const t = await navigator.clipboard.readText().catch(() => '');
    if (t) insert(t);
  };
  const selectAll = () => {
    const v = view.current;
    if (v) v.dispatch({ selection: { anchor: 0, head: v.state.doc.length } });
  };

  const onContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    const v = view.current;
    if (latest.current.mode === 'reading') {
      openContextMenu({ x: e.clientX, y: e.clientY, items: [
        { label: 'Copy', onClick: copy }, { label: 'Select all', onClick: selectAll },
      ] });
      return;
    }
    const sel = v ? v.state.sliceDoc(v.state.selection.main.from, v.state.selection.main.to) : '';
    openContextMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        {
          label: 'Format', icon: 'pencil', submenu: [
            { label: 'Bold', onClick: () => wrap('**') },
            { label: 'Italic', onClick: () => wrap('*') },
            { label: 'Strikethrough', onClick: () => wrap('~~') },
            { label: 'Highlight', onClick: () => wrap('==') },
            { label: 'Inline code', onClick: () => wrap('`') },
          ],
        },
        {
          label: 'Paragraph', icon: 'file-text', submenu: [
            { label: 'Heading 1', onClick: () => prefixLines('# ') },
            { label: 'Heading 2', onClick: () => prefixLines('## ') },
            { label: 'Heading 3', onClick: () => prefixLines('### ') },
            { label: 'Bullet list', onClick: () => prefixLines('- ') },
            { label: 'Numbered list', onClick: () => prefixLines('1. ') },
            { label: 'Task list', onClick: () => prefixLines('- [ ] ') },
            { label: 'Quote', onClick: () => prefixLines('> ') },
            { label: 'Code block', onClick: () => wrap('```\n', '\n```') },
          ],
        },
        {
          label: 'Insert', icon: 'plus', submenu: [
            { label: 'Internal link', onClick: () => insert('[[]]', 2) },
            { label: 'External link', onClick: () => wrap('[', '](url)') },
            { label: 'Embed file', onClick: () => insert('![[]]', 3) },
            { label: 'Callout', onClick: () => insert('> [!note] Title\n> ', 18) },
            { label: 'Table', onClick: () => insert('\n| Column 1 | Column 2 |\n| --- | --- |\n|  |  |\n') },
            { label: 'Horizontal rule', onClick: () => insert('\n---\n') },
            { label: 'Tag', onClick: () => insert('#') },
          ],
        },
        { label: '', separator: true },
        { label: 'Cut', onClick: cut },
        { label: 'Copy', onClick: copy },
        { label: 'Paste', onClick: paste },
        { label: 'Select all', onClick: selectAll },
        ...(sel
          ? [
              { label: '', separator: true },
              { label: `Search for “${sel.slice(0, 24)}”`, icon: 'search', onClick: () => setLeftPanel('search') },
            ]
          : []),
      ],
    });
  };


  useEffect(() => {
    if (!host.current) return;
    const p = latest.current;
    version.current = p.snapshot.version;
    const isMd = /\.(md|markdown)$/i.test(p.snapshot.id) || layout === 'embedded';
    const fm = p.snapshot.text.match(/^---\n[\s\S]*?\n---[ \t]*\n?/);
    const initPos = Math.min(fm?.[0].length ?? 0, p.snapshot.text.length);
    const historyAction = (redo: boolean) => {
      if (view.current?.state.readOnly) return false;
      const next = redo ? latest.current.onRedo?.() : latest.current.onUndo?.();
      if (!next) return false;
      sync(next);
      return true;
    };
    const state = EditorState.create({
      doc: p.snapshot.text,
      selection: { anchor: initPos },
      extensions: [
        drawSelection(), syntaxModel, documentMetadata, blockModel,
        contextComp.of(renderContext.of(scopedContext)),
        readonlyComp.of(readonlyExt(p.mode === 'reading')),
        EditorState.transactionFilter.of((tr) =>
          tr.docChanged && tr.startState.readOnly && !tr.annotation(externalUpdate) ? [] : tr),
        Prec.high(keymap.of([
          { key: 'Mod-z', run: () => historyAction(false) },
          { key: 'Mod-Shift-z', run: () => historyAction(true) },
          { key: 'Mod-y', run: () => historyAction(true) },
          ...obsidianKeymap({
            openLink: (target) => latest.current.context.openLink(target),
            save: () => latest.current.onSave?.(),
            togglePreview: () => latest.current.onModeChange?.(latest.current.mode === 'reading' ? 'live' : 'reading'),
          }),
        ])),
        search({ top: true }),
        keymap.of([...defaultKeymap, ...searchKeymap, indentWithTab]),
        markdown({ base: markdownLanguage, codeLanguages: languages }),
        suggesterPlugin,
        syntaxHighlighting(obsidianHighlightStyle),
        EditorView.lineWrapping,
        livePreviewState.init(() => isMd && p.mode !== 'source'),
        livePreviewReadonly.init(() => p.mode === 'reading'),
        noteTitleField.init(() => p.showTitle === false ? '' : titleOf(p.snapshot.id)),
        sourceControls, inlineTitleField, frontmatterField, tableField, htmlBlockField, mermaidField,
        htmlRenderedState, htmlPreviewField, calloutFoldState, calloutFoldDeco,
        inlineHtml, semanticDecorations, mathBlockField, blockLayout, livePreviewPlugin, livePreviewTheme, editorClickFix, listLayout,
        EditorView.updateListener.of((u) => {
          if (!u.docChanged || u.transactions.every((tr) => tr.annotation(externalUpdate))) return;
          const changes: SourceChange[] = [];
          u.changes.iterChanges((from, to, _a, _b, inserted) => changes.push({ from, to, insert: inserted.toString() }));
          const typing = u.transactions.some((tr) => tr.isUserEvent('input.type'));
          const next = latest.current.onChange?.(changes, version.current,
            typing ? 'input.type:' + instanceId : 'edit');
          if (next) version.current = next.version;
        }),
      ],
    });
    const v = new EditorView({ state, parent: host.current });
    view.current = v;
    p.onReady?.(v);
    if (p.autoFocus) v.focus();
    return () => { p.onReady?.(null); view.current = null; v.destroy(); };
  }, [snapshot.id]);

  useEffect(() => { sync(snapshot); }, [snapshot]);
  useEffect(() => {
    const isMd = /\.(md|markdown)$/i.test(snapshot.id) || layout === 'embedded';
    view.current?.dispatch({ effects: [
      contextComp.reconfigure(renderContext.of(scopedContext)),
      setLivePreviewEnabled.of(isMd && mode !== 'source'),
      setLivePreviewReadonly.of(mode === 'reading'),
      readonlyComp.reconfigure(readonlyExt(mode === 'reading')),
      setNoteTitle.of(showTitle ? titleOf(snapshot.id) : ''),
    ] });
  }, [mode, context, showTitle, snapshot.id]);

  const cls = ['cm-host markdown-source-view cm-s-obsidian mod-cm6',
    layout === 'page' ? 'is-readable-line-width' : 'markdown-embedded-view',
    mode !== 'source' ? 'is-live-preview live-preview' : '',
    mode === 'reading' ? 'is-reading-mode' : ''].join(' ');
  return <div className={cls} data-document-id={snapshot.id} ref={host} onContextMenu={onContextMenu} />;
}
