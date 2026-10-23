import { useSearch, fileCandidates, matchName, remember, updateSearch, requestHotkeySettings } from '../lib/search';
import MatchLabel from './MatchLabel';
import { documents } from '../lib/documents';
import { extractMetadata } from '@webobsidian/markdown-core';
import { getEditorForPath } from '../lib/activeEditor';
import { EditorView } from '@codemirror/view';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { fileTitleError, parseSearchQuery, hotkeyLabel, type Hotkey } from '@webobsidian/search-core';
import Icon from './Icon';
import { sharedApp, pluginRevision, subscribePlugins } from '../lib/plugins';
import { useStore } from '../lib/store';

interface Cmd {
  id: string;
  title: string;
  hint?: string;
  run: () => void;
  ranges?: [number, number][];
  path?: string;
  level?: number;
  tags?: string[];
  shortcuts?: Hotkey[];
}

export default function CommandPalette() {
  const open = useStore((s) => s.paletteOpen);
  const mode = useStore((s) => s.paletteMode);
  const setOpen = useStore((s) => s.setPalette);
  const activePath = useStore((s) => s.activePath);
  const openFile = useStore((s) => s.openFile);
  const rightTabId = useStore((s) => s.paletteRightTab);
  const openToSide = useStore((s) => s.openToSide);
  const setSettings = useStore((s) => s.setSettings);
  const notify = useStore((s) => s.notify);
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const pluginVersion = useSyncExternalStore(subscribePlugins, pluginRevision);

  const { entries, settings, hotkeys } = useSearch();
  const content = useStore((s) => s.content);
  const recent = useStore((s) => s.recent);

  const items = useMemo<Cmd[]>(() => {
    // A closed palette must not rank the whole catalog on every editor keystroke.
    if (!open) return [];
    const query = q.replace(/^>/, '').trim();
    if (mode === 'headings') {
      const session = activePath ? documents.get(activePath) : undefined;
      return extractMetadata(session?.analysis ?? content).headings.flatMap((heading, i) => {
        const match = matchName(query, heading.text);
        if (!match || (!settings.showFirstHeading && heading.level === 1)) return [];
        return [
          {
            id: `h:${i}`,
            title: heading.text,
            ranges: match.matches,
            level: heading.level,
            run: () => {
              const view = activePath ? getEditorForPath(activePath) : null;
              if (view) {
                const at = Math.min(heading.from, view.state.doc.length);
                view.dispatch({
                  selection: { anchor: at },
                  effects: EditorView.scrollIntoView(at, { y: 'start' }),
                });
                view.focus();
              }
            },
          },
        ];
      });
    }
    const templateFolder = sharedApp.automation.templateFolder;
    if (mode === 'templates' && !templateFolder)
      return [
        {
          id: 'configure-templates',
          title: '设置模板目录…',
          run: () => {
            setSettings(true);
            window.dispatchEvent(new Event('automation:open-settings'));
          },
        },
      ];
    const source =
      mode === 'templates'
        ? entries.filter(
            (e) =>
              e.path.startsWith(templateFolder.replace(/\/$/, '') + '/') &&
              /\.(md|markdown)$/i.test(e.path),
          )
        : entries;
    const fileItems: Cmd[] = (mode === 'commands' || q.startsWith('>') ? [] : fileCandidates(query, source, recent))
      .slice(0, 60)
      .map(({ entry, label, match }) => ({
        id: `f:${entry.path}`,
        path: entry.path,
        title: label,
        ranges: match.matches,
        hint: entry.path,
        tags: settings.showTags ? entry.tags : [],
        run: () => {
          if (mode === 'templates') {
            void sharedApp.automation.templates.insert(entry.path).catch(error => {
              if (!(error instanceof DOMException && error.name === 'AbortError')) notify(String(error));
            });
          } else {
            if (rightTabId && /\.(md|markdown)$/i.test(entry.path)) useStore.getState().openRightTab('markdown', { file: entry.path }, rightTabId);
            else void openFile(entry.path);
          }
        },
      }));
    if ((mode === 'files' && !q.startsWith('>')) || mode === 'templates') return fileItems;
    const commands: Cmd[] = sharedApp.commands.listCommands().map((c) => ({
      id: c.id,
      title: c.name,
      shortcuts: sharedApp.commands.getHotkeys(c.id),
      run: () => {
        sharedApp.commands.executeCommandById(c.id);
      },
    }));
    const commandItems = commands
      .flatMap((c) => {
        const match = matchName(query, c.title);
        return match ? [{ ...c, ranges: match.matches, score: match.score }] : [];
      })
      .sort((a, b) => {
        const pin = (id: string) => (settings.pinnedCommands.includes(id) ? 0 : 1);
        const recent = (id: string) => {
          const i = settings.recentCommands.indexOf(id);
          return i < 0 ? 1e9 : i;
        };
        return pin(a.id) - pin(b.id) || (query ? b.score - a.score : recent(a.id) - recent(b.id));
      });
    return mode === 'commands' || q.startsWith('>')
      ? commandItems
      : [...commandItems.slice(0, 3), ...fileItems];
  }, [open, q, mode, entries, settings, hotkeys, pluginVersion, activePath, content, recent, rightTabId]);
  const choose = (item: Cmd | undefined, event?: { ctrlKey: boolean; metaKey: boolean; altKey: boolean }) => {
    if (!item) return;
    setOpen(false);
    if (item.path && !rightTabId && mode !== 'templates' && event?.altKey) {
      void openToSide(item.path);
      return;
    }
    if (!item.path && !item.id.startsWith('h:')) remember('recentCommands', item.id);
    item.run();
  };

  useEffect(() => setSel(0), [q, open, mode]);
  useEffect(() => setQ(''), [mode]);
  useEffect(() => {
    if (!open) setQ('');
  }, [open]);
  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [sel, open]);
  useEffect(() => setSel(value => Math.max(0, Math.min(value, items.length - 1))), [items.length]);

  const commandsMode = mode === 'commands' || q.startsWith('>');
  const filters = parseSearchQuery(q);
  const canCreate = mode === 'files' && !rightTabId && !!q.trim() &&
    !filters.include.length && !filters.exclude.length && !filters.fields.length &&
    !fileTitleError(q) && !/[<>:"\\|?*\u0000-\u001f]/.test(q) &&
    !q.split('/').some(part => !part.trim() || part === '.' || part === '..');
  const create = async () => {
    if (!canCreate) return;
    const path = /\.md$/i.test(q.trim()) ? q.trim() : q.trim() + '.md';
    try { await useStore.getState().createNote(path); setOpen(false); }
    catch (error) { notify(String(error)); }
  };

  if (!open) return null;

  const onKey = (e: React.KeyboardEvent) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === 'Enter' && e.shiftKey && mode === 'files') {
      e.preventDefault(); void create(); return;
    }
    if ((mode === 'commands' || q.startsWith('>')) && e.altKey && ['i', 'n'].includes(e.key.toLowerCase())) {
      e.preventDefault();
      const item = items[sel];
      if (item) void navigator.clipboard.writeText(e.key.toLowerCase() === 'i' ? item.id : item.title);
      return;
    }
    if (
      (mode === 'commands' || q.startsWith('>')) &&
      (e.ctrlKey || e.metaKey) &&
      e.key.toLowerCase() === 'o'
    ) {
      e.preventDefault();
      setOpen(false);
      setSettings(true);
      requestHotkeySettings(items[sel]?.id);
      return;
    }
    if (
      !q &&
      mode === 'files' &&
      !e.ctrlKey &&
      !e.metaKey &&
      !e.altKey &&
      settings.historyKeys.includes(e.key)
    ) {
      const at = settings.historyKeys.indexOf(e.key);
      if (items[at]?.path && recent.includes(items[at].path!)) {
        e.preventDefault();
        choose(items[at]);
        return;
      }
    }
    if (e.key === 'Escape') setOpen(false);
    else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSel((s) => Math.max(0, Math.min(s + 1, items.length - 1)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSel((s) => Math.max(s - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      choose(items[sel], e);
    }
  };

  return (
    <div className="modal-bg palette-backdrop" onClick={() => setOpen(false)}>
      <div className={`modal palette-modal ${commandsMode ? 'palette-commands' : 'palette-files'}`} role="dialog" aria-modal="true"
        aria-label={commandsMode ? '命令面板' : mode === 'headings' ? '搜索标题' : mode === 'templates' ? '选择模板' : '快速打开'}
        onClick={(e) => e.stopPropagation()}>
        <div className="palette-search-row">
        <input
          ref={inputRef}
          className="palette-input"
          role="combobox" aria-expanded="true" aria-autocomplete="list" aria-controls="palette-results"
          aria-activedescendant={items[sel] ? `palette-result-${sel}` : undefined}
          aria-label={commandsMode ? '搜索命令' : '搜索文件或标签'}
          placeholder={
            mode === 'headings'
              ? '搜索标题…'
              : mode === 'templates'
                ? '选择模板…'
                : mode === 'commands'
                  ? '输入命令…'
                  : '输入以切换或创建文件…（#标签）'
          }
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={onKey}
        />
        <button className="palette-clear" title={q ? '清空搜索' : '关闭'} aria-label={q ? '清空搜索' : '关闭'}
          onClick={() => { if (q) { setQ(''); inputRef.current?.focus(); } else setOpen(false); }}><Icon name="x" size={15} /></button>
        </div>
        <div className="palette-list" id="palette-results" role="listbox" ref={listRef}>
          {items.map((it, i) => (
            <div
              key={it.id}
              id={`palette-result-${i}`} role="option" aria-selected={i === sel}
              className={`palette-item ${it.path ? 'palette-file-item' : 'palette-command-item'} ${i === sel ? 'sel' : ''}`}
              onMouseEnter={() => setSel(i)}
              onClick={(e) => choose(it, e)}
            >
              <div className="palette-result-content">
              <div className="palette-result-line">
              <span className="palette-result-title"
                style={settings.headingIndent && it.level ? { paddingLeft: (it.level - 1) * 12 } : undefined}
              >
                <MatchLabel text={it.title} ranges={it.ranges} />
              </span>
              {it.tags && it.tags.length > 0 && <span className="palette-result-tags">{it.tags.map(tag =>
                <span key={tag} className="palette-tag" title={`#${tag.replace(/^#/, '')}`}>{tag.replace(/^#/, '')}</span>)}</span>}
              </div>
              {it.hint && <div className="palette-result-path" title={it.hint}>{it.hint}</div>}
              </div>
              {commandsMode && (
                <button
                  className={`palette-pin ${settings.pinnedCommands.includes(it.id) ? 'is-pinned' : ''}`}
                  title="置顶命令"
                  aria-label={settings.pinnedCommands.includes(it.id) ? `取消置顶 ${it.title}` : `置顶 ${it.title}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    void updateSearch({
                      pinnedCommands: settings.pinnedCommands.includes(it.id)
                        ? settings.pinnedCommands.filter((id) => id !== it.id)
                        : [...settings.pinnedCommands, it.id],
                    });
                  }}
                >
                  {settings.pinnedCommands.includes(it.id) ? '★' : '☆'}
                </button>
              )}
              {it.shortcuts?.map((binding, index) => <kbd className="palette-shortcut" key={index}>{hotkeyLabel(binding, /Mac|iPhone|iPad/.test(navigator.platform))}</kbd>)}
              {it.path && !q && recent.includes(it.path) && settings.historyKeys[i] &&
                <kbd className="palette-history-key">{settings.historyKeys[i]}</kbd>}
            </div>
          ))}
          {items.length === 0 && <div className="palette-empty">
            {filters.fields.includes('body') ? '正文内容请在左侧搜索中查找' : '没有匹配的结果'}
            {canCreate && <button onClick={() => void create()}>创建「{q.trim()}」<kbd>Shift + Enter</kbd></button>}
          </div>}
        </div>
        <div className="palette-footer">
          {commandsMode ? <><span><kbd>Alt N</kbd>复制名称</span><span><kbd>Alt I</kbd>复制 ID</span><span><kbd>Ctrl O</kbd>快捷键设置</span></>
            : mode === 'files' ? <><span><kbd>↵</kbd>打开文件</span><span><kbd>Alt ↵</kbd>在右侧打开</span>
              {!rightTabId && <span><kbd>Shift ↵</kbd>创建新文件</span>}<span className="palette-query-help">#标签 · -#排除 · 空格组合</span></>
            : <><span><kbd>↑ ↓</kbd>选择</span><span><kbd>↵</kbd>{mode === 'templates' ? '插入模板' : '跳转标题'}</span><span><kbd>Esc</kbd>关闭</span></>}
        </div>
      </div>
    </div>
  );
}
