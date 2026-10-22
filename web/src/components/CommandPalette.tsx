import { nativeCommands } from '../lib/nativeCommands';
import { useSearch, fileCandidates, matchName, remember, updateSearch } from '../lib/search';
import MatchLabel from './MatchLabel';
import { documents } from '../lib/documents';
import { extractMetadata } from '@webobsidian/markdown-core';
import { getEditorForPath } from '../lib/activeEditor';
import { EditorView } from '@codemirror/view';
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { pluginCommands, pluginRevision, subscribePlugins, runPluginCommand } from '../lib/plugins';
import { useStore } from '../lib/store';
import { api } from '../lib/api';

interface Cmd {
  id: string;
  title: string;
  hint?: string;
  run: () => void;
  ranges?: [number, number][];
  path?: string;
  level?: number;
}

export default function CommandPalette() {
  const open = useStore((s) => s.paletteOpen);
  const mode = useStore((s) => s.paletteMode);
  const setOpen = useStore((s) => s.setPalette);
  const activePath = useStore((s) => s.activePath);
  const openFile = useStore((s) => s.openFile);
  const openToSide = useStore((s) => s.openToSide);
  const setSettings = useStore((s) => s.setSettings);
  const notify = useStore((s) => s.notify);
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const pluginVersion = useSyncExternalStore(subscribePlugins, pluginRevision);

  const { entries, settings } = useSearch();
  const content = useStore((s) => s.content);
  const recent = useStore((s) => s.recent);

  const commands: Cmd[] = nativeCommands;

  const items = useMemo<Cmd[]>(() => {
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
    if (mode === 'templates' && !settings.templateFolder)
      return [
        {
          id: 'configure-templates',
          title: '设置模板目录…',
          run: () => {
            setSettings(true);
            window.dispatchEvent(new CustomEvent('search-settings-open'));
          },
        },
      ];
    const source =
      mode === 'templates'
        ? entries.filter(
            (e) =>
              e.path.startsWith(settings.templateFolder.replace(/\/$/, '') + '/') &&
              /\.(md|markdown)$/i.test(e.path),
          )
        : entries;
    const fileItems: Cmd[] = fileCandidates(query, source, recent)
      .slice(0, 60)
      .map(({ entry, label, match }) => ({
        id: `f:${entry.path}`,
        path: entry.path,
        title: label,
        ranges: match.matches,
        hint: entry.path + (settings.showTags && entry.tags.length ? '  #' + entry.tags.join(' #') : ''),
        run: () => {
          if (mode === 'templates') {
            const view = activePath ? getEditorForPath(activePath) : null;
            if (!view || view.state.readOnly) return;
            const state = view.state;
            void api
              .read(entry.path)
              .then((f) => {
                if (view.state !== state) {
                  notify('编辑位置已变化，请重新插入模板');
                  return;
                }
                view.dispatch({
                  changes: {
                    from: state.selection.main.from,
                    to: state.selection.main.to,
                    insert: f.content,
                  },
                  userEvent: 'input',
                });
                view.focus();
              })
              .catch((e) => notify(e.message));
          } else {
            void openFile(entry.path);
          }
        },
      }));
    if (mode === 'files' || mode === 'templates') return fileItems;
    const extras: Cmd[] = [...pluginCommands.values()].map((c) => ({
      id: c.id,
      title: c.name,
      run: () => {
        runPluginCommand(c.id);
      },
    }));
    const commandItems = [...commands, ...extras]
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
  }, [q, mode, entries, settings, commands, pluginVersion, activePath, content, recent]);
  const choose = (item: Cmd | undefined, event?: { ctrlKey: boolean; metaKey: boolean; altKey: boolean }) => {
    if (!item) return;
    setOpen(false);
    if (item.path && mode !== 'templates' && event?.altKey) {
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

  if (!open) return null;

  const onKey = (e: React.KeyboardEvent) => {
    if (e.nativeEvent.isComposing) return;
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
      window.dispatchEvent(new CustomEvent('search-settings-open', { detail: items[sel]?.id }));
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
      setSel((s) => Math.min(s + 1, items.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSel((s) => Math.max(s - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      choose(items[sel], e);
    }
  };

  return (
    <div className="modal-bg" onClick={() => setOpen(false)}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <input
          className="palette-input"
          placeholder={
            mode === 'headings'
              ? '搜索标题…'
              : mode === 'templates'
                ? '选择模板…'
                : mode === 'commands'
                  ? '搜索命令…'
                  : '搜索文件…（支持拼音）'
          }
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={onKey}
        />
        <div className="palette-list">
          {items.map((it, i) => (
            <div
              key={it.id}
              className={`palette-item ${i === sel ? 'sel' : ''}`}
              onMouseEnter={() => setSel(i)}
              onClick={(e) => choose(it, e)}
            >
              <span
                style={settings.headingIndent && it.level ? { paddingLeft: (it.level - 1) * 12 } : undefined}
              >
                <MatchLabel text={it.title} ranges={it.ranges} />
              </span>
              {(mode === 'commands' || q.startsWith('>')) && (
                <button
                  title="置顶命令"
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
              {it.hint && <span className="kbd">{it.hint}</span>}
            </div>
          ))}
          {items.length === 0 && <div className="palette-item">No matches</div>}
        </div>
      </div>
    </div>
  );
}
