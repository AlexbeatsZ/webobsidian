import MatchLabel from './MatchLabel';
import { matchName, useSearch } from '../lib/search';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../lib/store';
import { api, type TreeNode } from '../lib/api';
import { pruneDescendants } from '../lib/tree';

/**
 * Obsidian's "Move file to…" folder suggester: type to filter folders, ↑↓ to
 * navigate, ↵ to move into the highlighted folder, shift+↵ to create the typed
 * folder and move there, esc to dismiss. Driven by store.movePath.
 */
export default function FolderPicker() {
  const movePath = useStore((s) => s.movePath);
  const setMovePath = useStore((s) => s.setMovePath);
  const { entries, settings: searchConfig } = useSearch();
  const loadTree = useStore((s) => s.loadTree);
  const openFile = useStore((s) => s.openFile);
  const closeTab = useStore((s) => s.closeTab);
  const notify = useStore((s) => s.notify);

  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  // movePath is a single path (string) or several (array, bulk move).
  const froms = useMemo(
    () => (movePath == null ? [] : pruneDescendants(Array.isArray(movePath) ? movePath : [movePath])),
    [movePath],
  );
  const single = froms.length === 1 ? froms[0] : null;
  const currentDir = single && single.includes('/') ? single.slice(0, single.lastIndexOf('/')) : '';

  // Root + every folder, minus targets that would move a folder into itself or a
  // descendant of any source (and, for a single item, its own folder — a no-op).
  const folders = useMemo(() => {
    const all = ['', ...entries.filter((e) => e.kind === 'folder').map((e) => e.path)];
    return all.filter((f) => {
      if (single !== null && f === currentDir) return false;
      if (froms.some((src) => f === src || f.startsWith(`${src}/`))) return false;
      return true;
    });
  }, [entries, froms, single, currentDir]);

  const lc = q.trim().toLowerCase();
  const matches = useMemo(
    () =>
      folders
        .flatMap((f) => {
          const match = matchName(lc, f || '/');
          return match ? [{ f, score: match.score }] : [];
        })
        .sort((a, b) => b.score - a.score)
        .map((x) => x.f),
    [folders, lc, searchConfig],
  );

  // shift+↵ creates a new folder — offer it when the typed name isn't an exact match.
  const typed = q.trim().replace(/^\/+|\/+$/g, '');
  const canCreate = typed.length > 0 && !folders.some((f) => f.toLowerCase() === typed.toLowerCase());

  useEffect(() => {
    setQ('');
    setSel(0);
  }, [movePath]);
  useEffect(() => setSel(0), [q]);
  useEffect(() => {
    listRef.current?.querySelector('.sel')?.scrollIntoView({ block: 'nearest' });
  }, [sel]);

  if (!movePath || !froms.length) return null;

  const move = async (folder: string) => {
    const targetDir = folder.replace(/\/+$/, '');
    const activePath = useStore.getState().activePath;
    setMovePath(null);
    let moved = 0;
    let reopen: string | null = null;
    for (const src of froms) {
      const b = src.split('/').pop()!;
      const to = targetDir ? `${targetDir}/${b}` : b;
      if (to === src) continue; // already in the chosen folder
      if (targetDir === src || targetDir.startsWith(`${src}/`)) continue; // into self/descendant
      try {
        await api.rename(src, to);
        closeTab(src);
        if (activePath === src) reopen = to;
        moved++;
      } catch (e: any) {
        notify(e?.message ?? "移动失败");
      }
    }
    await loadTree();
    useStore.getState().setSelected([]);
    if (reopen) await openFile(reopen);
    if (moved) {
      const dest = folder || '仓库根目录';
      notify(moved > 1 ? `已移动 ${moved} 项至 ${dest}` : `已移动至 ${dest}`);
    }
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === 'Tab' && matches[sel] !== undefined) {
      e.preventDefault();
      setQ(matches[sel]);
      return;
    }
    if (e.key === 'Escape') setMovePath(null);
    else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSel((s) => Math.min(s + 1, matches.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSel((s) => Math.max(s - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (e.shiftKey && canCreate) move(typed);
      else if (matches[sel] !== undefined) move(matches[sel]);
      else if (canCreate) move(typed);
    }
  };

  return (
    <div className="modal-bg" onClick={() => setMovePath(null)}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <input
          className="palette-input"
          placeholder={froms.length > 1 ? `移动 ${froms.length} 项至哪个文件夹？` : "输入文件夹名称"}
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={onKey}
        />
        <div className="palette-list" ref={listRef}>
          {matches.map((f, i) => (
            <div
              key={f || '/'}
              className={`palette-item ${i === sel ? 'sel' : ''}`}
              onMouseEnter={() => setSel(i)}
              onClick={() => move(f)}
            >
              <span>
                <MatchLabel text={f || '/'} ranges={matchName(q, f || '/')?.matches} />
              </span>
            </div>
          ))}
          {canCreate && (
            <div className="palette-item" onMouseEnter={() => setSel(-1)} onClick={() => move(typed)}>
              <span>创建 “{typed}”</span>
              <span className="kbd">⇧↵</span>
            </div>
          )}
          {matches.length === 0 && !canCreate && <div className="palette-item">无文件夹</div>}
        </div>
        <div className="palette-footer">
          <span>
            <span className="kbd">↑↓</span> 导航
          </span>
          <span>
            <span className="kbd">↵</span> 移动
          </span>
          <span>
            <span className="kbd">⇧↵</span> 创建
          </span>
          <span>
            <span className="kbd">esc</span> 关闭
          </span>
        </div>
      </div>
    </div>
  );
}
