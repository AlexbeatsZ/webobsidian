import { useCallback, useEffect, useId, useMemo, useRef } from 'react';
import '../styles/equations.css';
import { codeBlocks, pluginPostProcessing } from '../lib/obsidian/markdown';
import { mountMarkdownFragment } from './MarkdownFragment';
import { Annotation, Compartment, EditorState, Prec } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { editorSelection } from '../lib/editorSelection';
import { editorDebugging } from '../lib/editorDebug';
import { bindEditorMode } from '../lib/activeEditor';
import { editorPhrases } from '../lib/editorPhrases';
import { bindFragmentNavigation, navigationExtensions, followRenderedLink } from '../lib/fragmentNavigation';
import { linkPreview } from '../lib/linkPreview';
import { nativeWritingExtensions } from '../lib/writing/extensions';
import { mathEditingExtensions } from '../lib/writing/latex/editor_extensions/math_tooltip';
import { captureWritingState, restoreWritingState, snippetChangeEffects, writingOperation, snippetGroup, type WritingViewState } from '../lib/writing/editing';
import { formatPaste } from '../lib/writing/format';
import { contentClipboard } from '../lib/contentClipboard';
import { documents } from '../lib/documents';
import { defaultKeymap, indentWithTab } from '@codemirror/commands';
import { search, searchKeymap } from '@codemirror/search';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { indentUnit, syntaxHighlighting } from '@codemirror/language';
import { analyzeMarkdown, bodyHeadingSyntax, changesBetween, type DocumentSession, type DocumentSnapshot, type SourceChange, type MarkdownModel, type EditHistoryState } from '@webobsidian/markdown-core';
import { obsidianHighlightStyle } from '../lib/highlight';
import { obsidianKeymap, markdownListKeymap, toggleInline, toggleLineStyle, toggleChecklist, surroundSelection } from '../lib/editorCommands';
import { suggesterPlugin } from '../lib/suggest';
import { syntaxModel, adoptSyntaxModel, documentMetadata, blockModel, sourceOf } from '../lib/syntaxModel';
import { inlineHtml } from '../lib/inlineHtml';
import { sourceControls } from '../lib/sourceControls';
import { semanticDecorations } from '../lib/semanticDecorations';
import { listLayout, prefixWidths } from '../lib/listLayout';
import { listFolding } from '../lib/listFolding';
import { blockLayout } from '../lib/blockLayout';
import { blockEffects } from '../lib/blocks/view';
import { blockEffectSyntax, footnoteSyntax } from '@webobsidian/markdown-core';
import { renderContext, type FragmentOptions, type RenderContext } from '../lib/renderContext';
import { menuModifiers } from '../lib/configuredMenus/transform';
import { attachMenuContext } from '../lib/configuredMenus/transform';
import type { RenderMenuItem } from '../lib/renderContext';
import { captureMcpContextTarget, queueMcpContext } from '../lib/review/client';
import { livePreviewPlugin, livePreviewState, livePreviewTheme, frontmatterField,
  tableField, htmlBlockField, mermaidField, htmlRenderedState, htmlPreviewField,
  calloutFoldState, calloutFoldDeco, mathBlockField, noteTitleField, inlineTitle,
  livePreviewReadonly, setLivePreviewReadonly, setLivePreviewEnabled, setNoteTitle } from '../lib/livePreview';

export type MarkdownMode = 'live' | 'reading' | 'source';
export interface MarkdownViewProps {
  snapshot: DocumentSnapshot;
  documentSession?: DocumentSession;
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
  extensions?: import('@codemirror/state').Extension;
}
const externalUpdate = Annotation.define<boolean>();
const readonlyExt = (reading: boolean) => reading
  ? [EditorView.editable.of(false), EditorState.readOnly.of(true)] : [];
const titleOf = (path: string) => (path.split('/').pop() ?? path).replace(/\.(md|markdown)$/i, '');

export default function MarkdownView(props: MarkdownViewProps) {
  const { snapshot, mode, context, showTitle = true, layout = 'page' } = props;
  const latest = useRef(props);
  latest.current = props;
  const mountFragment = useCallback((host: HTMLElement, source: string, options: FragmentOptions) =>
    mountMarkdownFragment(host, source, { ...options, context: options.context ?? latest.current.context }), []);
  const scopedContext = useMemo<RenderContext>(() => ({ ...context,
    mountFragment,
  }), [context, mountFragment]);
  const instanceId = useId();
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const version = useRef(snapshot.version);
  const readonlyComp = useRef(new Compartment()).current;
  const contextComp = useRef(new Compartment()).current;
  const extraComp = useRef(new Compartment()).current;
  const openContextMenu = context.openMenu;
  const setLeftPanel = (_panel: string) => props.onSearch?.();
  const clipboard = useMemo(() => contentClipboard({
    source: () => {
      const current = view.current;
      const session = latest.current.documentSession;
      const path = latest.current.context.sourcePath;
      const registered = !!session && documents.get(path) === session;
      const source = current ? sourceOf(current.state) : { model: latest.current.analysis ?? analyzeMarkdown(latest.current.snapshot.text), from: 0 };
      return { identity: path, model: source.model, offset: source.from,
        read: () => current && current === view.current && latest.current.documentSession === session &&
          latest.current.context.sourcePath === path && (!registered || documents.get(path) === session)
          ? session?.analysis ?? sourceOf(current.state).model : undefined };
    },
    writable: () => latest.current.mode !== 'reading' && !latest.current.snapshot.locked && !latest.current.documentSession?.snapshot.locked,
    projection: () => !!latest.current.context.sourceFragment,
    format: (text, current) => {
      const selection = current.state.selection.main;
      return formatPaste(text, latest.current.context.sourcePath, current.state.doc.lineAt(selection.from).text, current.state.sliceDoc(selection.from, selection.to));
    },
    reportError: error => latest.current.context.reportError?.(String(error)),
  }), []);

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
  const insert = (text: string, caretOffset = text.length) => {
    const v = view.current;
    if (!v) return;
    const { from, to } = v.state.selection.main;
    v.dispatch({ changes: { from, to, insert: text }, selection: { anchor: from + caretOffset } });
    v.focus();
  };
  const copy = async () => {
    const v = view.current;
    if (v) await clipboard.copy(v);
  };
  const cut = async () => {
    const v = view.current;
    if (v) await clipboard.copy(v, true);
  };
  const paste = async () => {
    const v = view.current;
    if (v) await clipboard.paste(v);
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
    const linkItems: RenderMenuItem[] = link && v ? [
      { id: 'link:open', label: '打开链接', onClick: () => followRenderedLink(v, link) },
      { id: 'link:tab', label: '在新侧栏标签页打开', onClick: () => followRenderedLink(v, link, { disposition: 'tab' }) },
      { id: 'link:side', label: '在分栏打开', onClick: () => followRenderedLink(v, link, { disposition: 'side' }) },
      { id: 'link:copy', label: '复制链接', onClick: () => { void navigator.clipboard.writeText(link); } },
    ] : [];
    const mcpTarget = captureMcpContextTarget(v, context.sourcePath);
    const mcpItem: RenderMenuItem = {
      id: 'editor:add-mcp-context',
      label: mcpTarget.selections.length ? '添加选中内容到 MCP 上下文' : '添加当前页面到 MCP 上下文',
      icon: 'cpu',
      onClick: () => { void queueMcpContext(mcpTarget); },
    };
    if (latest.current.mode === 'reading') {
      showMenu({ x: e.clientX, y: e.clientY, items: [
        ...linkItems,
        { id: 'editor:copy', label: "复制", onClick: copy }, { id: 'editor:select-all', label: "全选", onClick: selectAll },
        { label: '', separator: true },
        mcpItem,
      ] });
      return;
    }
    const sel = v ? v.state.sliceDoc(v.state.selection.main.from, v.state.selection.main.to) : '';
    showMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        ...linkItems,
        {
          id: 'editor:format', label: "格式", icon: 'pencil', submenu: [
            { id: 'editor:format:bold', label: "粗体", onClick: () => { if (v) toggleInline(v, '**'); } },
            { id: 'editor:format:italic', label: "斜体", onClick: () => { if (v) toggleInline(v, '*'); } },
            { id: 'editor:format:strike', label: "删除线", onClick: () => { if (v) toggleInline(v, '~~'); } },
            { id: 'editor:format:highlight', label: "高亮", onClick: () => { if (v) toggleInline(v, '=='); } },
            { id: 'editor:format:code', label: "行内代码", onClick: () => { if (v) toggleInline(v, '`'); } },
          ],
        },
        {
          id: 'editor:paragraph', label: "段落", icon: 'file-text', submenu: [
            { id: 'editor:heading:1', label: "标题 1", onClick: () => { if (v) toggleLineStyle(v, 1); } },
            { id: 'editor:heading:2', label: "标题 2", onClick: () => { if (v) toggleLineStyle(v, 2); } },
            { id: 'editor:heading:3', label: "标题 3", onClick: () => { if (v) toggleLineStyle(v, 3); } },
            { id: 'editor:body-heading', label: '正文内小标题', onClick: () => { if (v) toggleLineStyle(v, 7); } },
            { id: 'editor:list:bullet', label: "无序列表", onClick: () => { if (v) toggleLineStyle(v, 'bullet'); } },
            { id: 'editor:list:ordered', label: "有序列表", onClick: () => { if (v) toggleLineStyle(v, 'ordered'); } },
            { id: 'editor:list:task', label: "切换任务复选框", onClick: () => { if (v) toggleChecklist(v); } },
            { id: 'editor:quote', label: "引用", onClick: () => { if (v) toggleLineStyle(v, 'quote'); } },
            { id: 'editor:code-block', label: "代码块", onClick: () => { if (v) surroundSelection(v, '```\n', '\n```'); } },
          ],
        },
        {
          id: 'editor:insert', label: "插入", icon: 'plus', submenu: [
            { id: 'editor:insert:wiki', label: "内部链接", onClick: () => insert('[[]]', 2) },
            { id: 'editor:insert:link', label: "外部链接", onClick: () => { if (v) surroundSelection(v, '[', '](url)'); } },
            { id: 'editor:insert:embed', label: "嵌入文件", onClick: () => insert('![[]]', 3) },
            { id: 'editor:insert:callout', label: "标注", onClick: () => insert('> [!note] Title\n> ', 18) },
            { id: 'editor:insert:table', label: "表格", onClick: () => insert('\n| Column 1 | Column 2 |\n| --- | --- |\n|  |  |\n') },
            { id: 'editor:insert:rule', label: "水平分割线", onClick: () => insert('\n---\n') },
            { id: 'editor:insert:tag', label: "标签", onClick: () => insert('#') },
          ],
        },
        { label: '', separator: true },
        { id: 'editor:cut', label: "剪切", onClick: cut },
        { id: 'editor:copy', label: "复制", onClick: copy },
        { id: 'editor:paste', label: "粘贴", onClick: paste },
        { id: 'editor:select-all', label: "全选", onClick: selectAll },
        { label: '', separator: true },
        mcpItem,
        ...(sel
          ? [
              { label: '', separator: true },
              { label: `搜索 “${sel.slice(0, 24)}”`, icon: 'search', onClick: () => setLeftPanel('search') },
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
        indentUnit.of('    '), EditorState.tabSize.of(4), editorPhrases, navigationExtensions, linkPreview,
        editorSelection, editorDebugging, syntaxModel.init(() => p.analysis ?? analyzeMarkdown(p.snapshot.text, p.context.sourcePath, p.snapshot.version)), documentMetadata, blockModel,
        contextComp.of(renderContext.of(scopedContext)),
        clipboard.extension,
        extraComp.of(p.extensions ?? []),
        readonlyComp.of(readonlyExt(p.mode === 'reading' || !!p.snapshot.locked)),
        EditorState.transactionFilter.of((tr) =>
          tr.docChanged && (tr.startState.readOnly || latest.current.documentSession?.snapshot.locked) && !tr.annotation(externalUpdate) ? [] : tr),
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
        keymap.of([...defaultKeymap, ...searchKeymap, ...markdownListKeymap, indentWithTab]),
        markdown({ base: markdownLanguage, codeLanguages: languages, extensions: [bodyHeadingSyntax, blockEffectSyntax, footnoteSyntax] }),
        suggesterPlugin,
        mathEditingExtensions,
        ...(p.context.allowPlugins ? [nativeWritingExtensions()] : []),
        syntaxHighlighting(obsidianHighlightStyle),
        EditorView.lineWrapping,
        livePreviewState.init(() => isMd && p.mode !== 'source'),
        livePreviewReadonly.init(() => p.mode === 'reading'),
        noteTitleField.init(() => p.showTitle === false ? '' : titleOf(p.snapshot.id)),
        sourceControls, blockEffects, inlineTitle, frontmatterField, tableField, htmlBlockField, mermaidField,
        codeBlocks,
        ...(p.context.allowPlugins ? [pluginPostProcessing] : []),
        htmlRenderedState, htmlPreviewField, calloutFoldState, calloutFoldDeco,
        inlineHtml, semanticDecorations, mathBlockField, blockLayout, listFolding, livePreviewPlugin, livePreviewTheme, prefixWidths, listLayout,
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
    const stopMode = bindEditorMode(v, request => {
      const current = latest.current;
      const mode = request === 'toggle-preview' ? (current.mode === 'reading' ? 'live' : 'reading')
        : request === 'toggle-source' ? (current.mode === 'source' ? 'live' : 'source') : request;
      current.onModeChange?.(mode);
    });
    view.current = v;
    p.onReady?.(v);
    if (p.autoFocus) v.focus();
    return () => { stopMode(); p.onReady?.(null); view.current = null; v.destroy(); };
  }, [props.documentSession ?? snapshot.id]);

  useEffect(() => {
    const v = view.current;
    if (v) return bindFragmentNavigation(v, snapshot.id, !context.sourceFragment && !context.embedTrail?.length && !context.equations?.from);
  }, [props.documentSession, snapshot.id, context.embedTrail?.length, context.equations?.from, context.navigationId, context.sourceFragment]);

  useEffect(() => { sync(snapshot); }, [snapshot]);
  useEffect(() => { view.current?.dispatch({ effects: extraComp.reconfigure(props.extensions ?? []) }); }, [props.extensions]);
  useEffect(() => {
    const isMd = /\.(md|markdown)$/i.test(snapshot.id) || layout === 'embedded';
    view.current?.dispatch({ effects: [
      contextComp.reconfigure(renderContext.of(scopedContext)),
      setLivePreviewEnabled.of(isMd && mode !== 'source'),
      setLivePreviewReadonly.of(mode === 'reading'),
      readonlyComp.reconfigure(readonlyExt(mode === 'reading' || !!snapshot.locked)),
      setNoteTitle.of(showTitle ? titleOf(snapshot.id) : ''),
      ...(props.analysis && view.current?.state.field(syntaxModel).id !== props.analysis.id ? [adoptSyntaxModel.of(props.analysis)] : []),
    ] });
  }, [mode, context, showTitle, snapshot.id, snapshot.locked]);

  const cls = ['cm-host markdown-source-view cm-s-obsidian mod-cm6',
    layout === 'page' ? 'is-readable-line-width' : 'markdown-embedded-view',
    mode !== 'source' ? 'is-live-preview live-preview' : '',
    mode === 'reading' ? 'is-reading-mode' : ''].join(' ');
  return <div className={cls} data-document-id={snapshot.id} data-mode={mode} ref={host} onContextMenu={onContextMenu}
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
