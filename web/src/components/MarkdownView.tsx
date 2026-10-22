import { useEffect, useId, useMemo, useRef } from 'react';
import { pluginCodeBlocks, pluginPostProcessing } from '../lib/obsidian/markdown';
import { mountMarkdownFragment } from './MarkdownFragment';
import { Annotation, Compartment, EditorState, Prec } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { editorSelection } from '../lib/editorSelection';
import { nativeWritingExtensions } from '../lib/writing/extensions';
import { captureWritingState, restoreWritingState, snippetChangeEffects, writingOperation, snippetGroup, type WritingViewState } from '../lib/writing/editing';
import { formatPaste } from '../lib/writing/format';
import { defaultKeymap, indentWithTab } from '@codemirror/commands';
import { search, searchKeymap } from '@codemirror/search';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { syntaxHighlighting } from '@codemirror/language';
import { analyzeMarkdown, changesBetween, type DocumentSnapshot, type SourceChange, type MarkdownModel, type EditHistoryState } from '@webobsidian/markdown-core';
import { obsidianHighlightStyle } from '../lib/highlight';
import { obsidianKeymap } from '../lib/editorCommands';
import { suggesterPlugin } from '../lib/suggest';
import { syntaxModel, adoptSyntaxModel, documentMetadata, blockModel } from '../lib/syntaxModel';
import { inlineHtml } from '../lib/inlineHtml';
import { sourceControls } from '../lib/sourceControls';
import { semanticDecorations } from '../lib/semanticDecorations';
import { listLayout } from '../lib/listLayout';
import { blockLayout } from '../lib/blockLayout';
import { renderContext, type RenderContext } from '../lib/renderContext';
import { menuModifiers } from '../lib/configuredMenus/transform';
import { attachMenuContext } from '../lib/configuredMenus/transform';
import type { RenderMenuItem } from '../lib/renderContext';
import { livePreviewPlugin, livePreviewState, livePreviewTheme, frontmatterField,
  tableField, htmlBlockField, mermaidField, htmlRenderedState, htmlPreviewField,
  calloutFoldState, calloutFoldDeco, mathBlockField, noteTitleField, inlineTitleField,
  livePreviewReadonly, setLivePreviewReadonly, setLivePreviewEnabled, setNoteTitle } from '../lib/livePreview';

export type MarkdownMode = 'live' | 'reading' | 'source';
export interface MarkdownViewProps {
  snapshot: DocumentSnapshot;
  analysis?: MarkdownModel;
  mode: MarkdownMode;
  context: RenderContext;
  onChange?: (changes: SourceChange[], baseVersion: number, origin: string, model: MarkdownModel, history?: EditHistoryState) => DocumentSnapshot;
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
    const model = latest.current.analysis;
    const restored=next.historyState?.owner===instanceId?restoreWritingState(next.historyState.value as WritingViewState):undefined;
    const changes=changesBetween(before,next.text);
    v.dispatch({ changes, ...restored,
      effects: [...(model?.text === next.text ? [adoptSyntaxModel.of(model)] : []),...(restored?.effects??snippetChangeEffects(v.state,changes))], annotations: externalUpdate.of(true) });
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
    const v=view.current;if(!t||!v||v.state.readOnly)return;
    try{const s=v.state.selection.main;const result=formatPaste(t,latest.current.context.sourcePath,v.state.doc.lineAt(s.from).text,v.state.sliceDoc(s.from,s.to));
      v.dispatch({...v.state.replaceSelection(result),annotations:writingOperation.of('paste'),userEvent:'input.paste'});}
    catch(error){latest.current.context.reportError?.(String(error));}
  };
  const selectAll = () => {
    const v = view.current;
    if (v) v.dispatch({ selection: { anchor: 0, head: v.state.doc.length } });
  };

  const onContextMenu = (e: React.MouseEvent) => {
    if (e.defaultPrevented) return;
    e.preventDefault();
    const v = view.current;
    const tag = (e.target as Element).closest<HTMLElement>('[data-native-tag]');
    if (tag && context.tagMenu) {
      e.stopPropagation();
      context.tagMenu(tag.dataset.nativeTag!, e.nativeEvent, mode === 'reading' ? 'reading' : tag.closest('.cm-props') ? 'property' : 'editor');
      return;
    }
    const captured = v?.state;
    const selection = captured?.selection.main;
    const linkElement = (e.target as Element).closest<HTMLElement>('[data-menu-link], a[href]');
    const link = linkElement?.dataset.menuLink ?? linkElement?.getAttribute('href') ?? undefined;
    const menuContext = { kind: link ? 'link' : 'editor', source: mode === 'reading' ? 'reading' : 'editor',
      paths: [context.sourcePath], fileTypes: [context.sourcePath.split('.').at(-1) ?? ''],
      activePath: context.sourcePath, documentVersion: latest.current.snapshot.version,
      selection: selection && { from: selection.from, to: selection.to, text: captured!.sliceDoc(selection.from, selection.to) },
      link,
      modifiers: menuModifiers(e.nativeEvent) };
    const protect = (items: RenderMenuItem[]): RenderMenuItem[] => items.map(item => ({ ...item,
      submenu: item.submenu && protect(item.submenu),
      onClick: item.onClick && (() => {
        if (view.current?.state !== captured) { context.reportError?.('文档或选区已改变，请重新打开菜单'); return; }
        item.onClick?.();
      }),
    }));
    const showMenu = (menu: { x: number; y: number; items: RenderMenuItem[] }) => openContextMenu({ ...menu,
      context: menuContext, items: attachMenuContext(protect(menu.items), menuContext) });
    if (latest.current.mode === 'reading') {
      showMenu({ x: e.clientX, y: e.clientY, items: [
        ...(link ? [{ id: 'link:open', label: 'Open link', onClick: () => context.openLink(link) },
          { id: 'link:copy', label: 'Copy link', onClick: () => { void navigator.clipboard.writeText(link); } }] : []),
        { id: 'editor:copy', label: 'Copy', onClick: copy }, { id: 'editor:select-all', label: 'Select all', onClick: selectAll },
      ] });
      return;
    }
    const sel = v ? v.state.sliceDoc(v.state.selection.main.from, v.state.selection.main.to) : '';
    showMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        ...(link ? [{ id: 'link:open', label: 'Open link', onClick: () => context.openLink(link) },
          { id: 'link:copy', label: 'Copy link', onClick: () => { void navigator.clipboard.writeText(link); } }] : []),
        {
          id: 'editor:format', label: 'Format', icon: 'pencil', submenu: [
            { id: 'editor:format:bold', label: 'Bold', onClick: () => wrap('**') },
            { id: 'editor:format:italic', label: 'Italic', onClick: () => wrap('*') },
            { id: 'editor:format:strike', label: 'Strikethrough', onClick: () => wrap('~~') },
            { id: 'editor:format:highlight', label: 'Highlight', onClick: () => wrap('==') },
            { id: 'editor:format:code', label: 'Inline code', onClick: () => wrap('`') },
          ],
        },
        {
          id: 'editor:paragraph', label: 'Paragraph', icon: 'file-text', submenu: [
            { id: 'editor:heading:1', label: 'Heading 1', onClick: () => prefixLines('# ') },
            { id: 'editor:heading:2', label: 'Heading 2', onClick: () => prefixLines('## ') },
            { id: 'editor:heading:3', label: 'Heading 3', onClick: () => prefixLines('### ') },
            { id: 'editor:list:bullet', label: 'Bullet list', onClick: () => prefixLines('- ') },
            { id: 'editor:list:ordered', label: 'Numbered list', onClick: () => prefixLines('1. ') },
            { id: 'editor:list:task', label: 'Task list', onClick: () => prefixLines('- [ ] ') },
            { id: 'editor:quote', label: 'Quote', onClick: () => prefixLines('> ') },
            { id: 'editor:code-block', label: 'Code block', onClick: () => wrap('```\n', '\n```') },
          ],
        },
        {
          id: 'editor:insert', label: 'Insert', icon: 'plus', submenu: [
            { id: 'editor:insert:wiki', label: 'Internal link', onClick: () => insert('[[]]', 2) },
            { id: 'editor:insert:link', label: 'External link', onClick: () => wrap('[', '](url)') },
            { id: 'editor:insert:embed', label: 'Embed file', onClick: () => insert('![[]]', 3) },
            { id: 'editor:insert:callout', label: 'Callout', onClick: () => insert('> [!note] Title\n> ', 18) },
            { id: 'editor:insert:table', label: 'Table', onClick: () => insert('\n| Column 1 | Column 2 |\n| --- | --- |\n|  |  |\n') },
            { id: 'editor:insert:rule', label: 'Horizontal rule', onClick: () => insert('\n---\n') },
            { id: 'editor:insert:tag', label: 'Tag', onClick: () => insert('#') },
          ],
        },
        { label: '', separator: true },
        { id: 'editor:cut', label: 'Cut', onClick: cut },
        { id: 'editor:copy', label: 'Copy', onClick: copy },
        { id: 'editor:paste', label: 'Paste', onClick: paste },
        { id: 'editor:select-all', label: 'Select all', onClick: selectAll },
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
        editorSelection, syntaxModel.init(() => p.analysis ?? analyzeMarkdown(p.snapshot.text, p.context.sourcePath, p.snapshot.version)), documentMetadata, blockModel,
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
        ...(p.context.allowPlugins ? [nativeWritingExtensions()] : []),
        syntaxHighlighting(obsidianHighlightStyle),
        EditorView.lineWrapping,
        livePreviewState.init(() => isMd && p.mode !== 'source'),
        livePreviewReadonly.init(() => p.mode === 'reading'),
        noteTitleField.init(() => p.showTitle === false ? '' : titleOf(p.snapshot.id)),
        sourceControls, inlineTitleField, frontmatterField, tableField, htmlBlockField, mermaidField,
        ...(p.context.allowPlugins ? [pluginCodeBlocks, pluginPostProcessing] : []),
        htmlRenderedState, htmlPreviewField, calloutFoldState, calloutFoldDeco,
        inlineHtml, semanticDecorations, mathBlockField, blockLayout, livePreviewPlugin, livePreviewTheme, listLayout,
        EditorView.updateListener.of((u) => {
          if (!u.docChanged || u.transactions.every((tr) => tr.annotation(externalUpdate))) return;
          const changes: SourceChange[] = [];
          u.changes.iterChanges((from, to, _a, _b, inserted) => changes.push({ from, to, insert: inserted.toString() }));
          const typing = u.transactions.some((tr) => tr.isUserEvent('input.type'));
          const operation=u.transactions.map(tr=>tr.annotation(writingOperation)).find(Boolean);
          const snippet=u.transactions.map(tr=>tr.annotation(snippetGroup)).find(Boolean);
          const history={owner:instanceId,before:captureWritingState(u.startState),after:captureWritingState(u.state)};
          const next = latest.current.onChange?.(changes, version.current,
            operation??snippet??(typing ? 'input.type:' + instanceId : 'edit'), u.state.field(syntaxModel),history);
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
  return <div className={cls} data-document-id={snapshot.id} ref={host} onContextMenu={onContextMenu}
    onMouseOver={event => {
      const tag = (event.target as Element).closest<HTMLElement>('[data-native-tag]');
      if (tag && !tag.contains(event.relatedTarget as Node | null)) context.tagHover?.(tag.dataset.nativeTag!, event.nativeEvent);
    }}
    onMouseOut={event => {
      const tag = (event.target as Element).closest<HTMLElement>('[data-native-tag]');
      if (tag && !tag.contains(event.relatedTarget as Node | null)) context.tagLeave?.();
    }}
    onClick={event => {
      const tag = (event.target as Element).closest<HTMLElement>('[data-native-tag]');
      if (tag && event.altKey && context.openTag) {
        event.preventDefault(); event.stopPropagation();
        context.openTag(tag.dataset.nativeTag!, event.ctrlKey || event.metaKey);
      }
    }} />;
}
