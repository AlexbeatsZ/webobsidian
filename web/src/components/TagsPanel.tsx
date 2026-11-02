import { useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent, type MouseEvent } from 'react';
import { useIndexVersion } from '../lib/indexEvents';
import { tagsApi } from '../lib/tags/api';
import { openNativeTagMenu, searchNativeTag, openNativeTagPage, renameNativeTag, dropTagDestination, mergeNativeTags, deleteNativeTag } from '../lib/tags/actions';
import { tagKey } from '@webobsidian/search-core';
import type { TagSummary, TagPreferences } from '@webobsidian/markdown-core';
import TagPageHover from './TagPageHover';
import Icon from './Icon';
import SelectionBar from './SelectionBar';
import './nativeTags.css';

interface TreeTag { value: TagSummary; children: TreeTag[] }
function buildTree(tags: TagSummary[]): TreeTag[] {
  const nodes = new Map<string, TreeTag>();
  const ensure = (tag: string): TreeTag => {
    const key = tagKey(tag);
    let node = nodes.get(key);
    if (!node) { node = { value: { tag, count: 0, directCount: 0, pages: [] }, children: [] }; nodes.set(key, node); }
    return node;
  };
  for (const value of tags) {
    ensure(value.tag).value = value;
    const segments = value.tag.split('/');
    for (let i = 1; i < segments.length; i++) ensure(segments.slice(0, i).join('/'));
  }
  const roots: TreeTag[] = [];
  for (const node of nodes.values()) {
    const segments = node.value.tag.split('/');
    if (segments.length > 1) ensure(segments.slice(0, -1).join('/')).children.push(node);
    else roots.push(node);
  }
  const sort = (items: TreeTag[]) => { items.sort((a, b) => a.value.tag.localeCompare(b.value.tag)); for (const item of items) sort(item.children); };
  sort(roots); return roots;
}

/** Edits the leaf segment in place; the rename preview dialog confirms the change. */
function RenameInput({ tag, onDone }: { tag: string; onDone: () => void }) {
  const ref = useRef<HTMLInputElement>(null), done = useRef(false);
  const leaf = tag.split('/').at(-1)!, parent = tag.split('/').slice(0, -1).join('/');
  useEffect(() => { ref.current?.focus(); ref.current?.select(); }, []);
  const finish = (commit: boolean) => {
    if (done.current) return;
    done.current = true; onDone();
    const name = (ref.current?.value ?? '').trim().replace(/^#+/, '');
    if (commit && name && name !== leaf) renameNativeTag(tag, parent ? parent + '/' + name : name);
  };
  return <input ref={ref} className="native-tags-rename" aria-label={`重命名 #${tag}`} defaultValue={leaf}
    onClick={(e) => e.stopPropagation()}
    onKeyDown={(e) => {
      e.stopPropagation();
      if (e.key === 'Enter') { e.preventDefault(); finish(true); } else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
    }}
    onBlur={() => finish(true)} />;
}

export default function TagsPanel() {
  const version = useIndexVersion();
  const [tags, setTags] = useState<TagSummary[]>([]);
  const [preferences, setPreferences] = useState<TagPreferences>({ batchEnabled: true, wranglerEnabled: true });
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [filter, setFilter] = useState('');
  const [error, setError] = useState('');
  const [hover, setHover] = useState<{ path: string; x: number; y: number } | null>(null);
  const [dragged, setDragged] = useState<string | null>(null);
  const [drop, setDrop] = useState<string | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [anchor, setAnchor] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  useEffect(() => {
    const abort = new AbortController();
    void tagsApi.summary(abort.signal).then((result) => {
      if (abort.signal.aborted) return;
      setTags(result.tags); setPreferences(result.preferences); setError('');
      // Merged or deleted tags leave the selection with the catalog update.
      const present = new Set(result.tags.map((value) => tagKey(value.tag)));
      setSelected((current) => current.filter((tag) => present.has(tagKey(tag))));
    }).catch((error) => { if (!abort.signal.aborted) setError(String(error)); });
    return () => abort.abort();
  }, [version]);
  const tree = useMemo(() => buildTree(tags), [tags]);
  const visible = (node: TreeTag): boolean => !filter || tagKey(node.value.tag).includes(tagKey(filter)) || node.children.some(visible);
  const isClosed = (tag: string) => !filter && collapsed.has(tagKey(tag));
  const order = useMemo(() => {
    const result: string[] = [];
    const walk = (nodes: TreeTag[]) => { for (const node of nodes) if (visible(node)) { result.push(node.value.tag); if (!isClosed(node.value.tag)) walk(node.children); } };
    walk(tree); return result;
  }, [tree, filter, collapsed]);
  const selectedKeys = useMemo(() => new Set(selected.map(tagKey)), [selected]);
  const canMerge = preferences.wranglerEnabled || preferences.batchEnabled;
  // The most used selected tag is the default merge target.
  const byUse = (values: string[]) => { const counts = new Map(tags.map((value) => [tagKey(value.tag), value.count])); return [...values].sort((a, b) => (counts.get(tagKey(b)) ?? 0) - (counts.get(tagKey(a)) ?? 0)); };
  const fold = (tag: string) => setCollapsed((current) => {
    const next = new Set(current), key = tagKey(tag); if (next.has(key)) next.delete(key); else next.add(key); return next;
  });
  const foldSiblings = (siblings: TreeTag[], collapse: boolean) => setCollapsed((current) => {
    const next = new Set(current);
    for (const sibling of siblings) if (sibling.children.length) {
      if (collapse) next.add(tagKey(sibling.value.tag)); else next.delete(tagKey(sibling.value.tag));
    }
    return next;
  });
  const endSelection = () => { setSelecting(false); setSelected([]); setAnchor(null); };
  const toggle = (tag: string) => {
    setSelected((current) => selectedKeys.has(tagKey(tag)) ? current.filter((value) => tagKey(value) !== tagKey(tag)) : [...current, tag]);
    setAnchor(tag);
  };
  const extend = (tag: string) => {
    const from = anchor ? order.findIndex((value) => tagKey(value) === tagKey(anchor)) : -1, to = order.findIndex((value) => tagKey(value) === tagKey(tag));
    if (from < 0 || to < 0) { toggle(tag); return; }
    const range = order.slice(Math.min(from, to), Math.max(from, to) + 1);
    setSelected((current) => [...current, ...range.filter((value) => !current.some((item) => tagKey(item) === tagKey(value)))]);
  };
  function onLabelClick(event: MouseEvent, tag: string) {
    if (event.altKey && preferences.wranglerEnabled) { void openNativeTagPage(tag, event.ctrlKey || event.metaKey); return; }
    if (event.shiftKey) { extend(tag); return; }
    if (event.ctrlKey || event.metaKey || selecting) { toggle(tag); return; }
    searchNativeTag(tag);
  }
  function onPanelKey(event: KeyboardEvent) {
    if (renaming || (event.target as HTMLElement).tagName === 'INPUT') return;
    const focused = (event.target as HTMLElement).closest<HTMLElement>('[data-native-tag]')?.dataset.nativeTag;
    if (event.key === 'Escape' && (selecting || selected.length)) { event.preventDefault(); event.stopPropagation(); endSelection(); }
    else if (event.key === 'F2' && focused && preferences.wranglerEnabled) { event.preventDefault(); setRenaming(tagKey(focused)); }
    else if (event.key === 'Delete' && preferences.batchEnabled && (selected.length || focused)) {
      event.preventDefault(); deleteNativeTag(selected.length ? selected : focused!);
    }
  }
  function onDrop(event: DragEvent, target: string) {
    event.preventDefault(); event.stopPropagation();
    const source = dragged ?? event.dataTransfer.getData('application/x-webobsidian-tag');
    setDragged(null); setDrop(null);
    if (!source) return;
    const destination = dropTagDestination(source, target);
    if (destination) renameNativeTag(source, destination);
  }
  const showSelection = selecting || selected.length > 0;
  function rows(nodes: TreeTag[]): React.ReactNode {
    return nodes.filter(visible).map((node) => {
      const { tag, pages, count, directCount } = node.value, closed = isClosed(tag), isSelected = selectedKeys.has(tagKey(tag));
      return <li key={tagKey(tag)}>
        <div className={'native-tags-row' + (drop === tagKey(tag) ? ' is-drop-target' : '') + (isSelected ? ' is-selected' : '')}
          draggable={preferences.wranglerEnabled && renaming !== tagKey(tag)}
          onDragStart={(e) => { setHover(null); setDragged(tag); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', '#' + tag); e.dataTransfer.setData('application/x-webobsidian-tag', tag); }}
          onDragEnd={() => { setDragged(null); setDrop(null); }}
          onDragOver={(e) => { if (preferences.wranglerEnabled && dragged && dropTagDestination(dragged, tag)) { e.preventDefault(); e.stopPropagation(); setDrop(tagKey(tag)); e.dataTransfer.dropEffect = 'move'; } }}
          onDragLeave={() => setDrop(null)} onDrop={(e) => { if (preferences.wranglerEnabled) onDrop(e, tag); }}
          onContextMenu={(e) => {
            setHover(null);
            // Right-clicking outside the selection acts on that tag alone, as in the file tree.
            if (!isSelected && selected.length && !selecting) setSelected([]);
            openNativeTagMenu(e, { tag, hasPage: pages.length > 0, ...preferences,
              selection: isSelected && selected.length > 1 ? byUse(selected) : undefined, clearSelection: endSelection,
              startRename: () => setRenaming(tagKey(tag)),
              collapseSiblings: () => foldSiblings(nodes, true), expandSiblings: () => foldSiblings(nodes, false) });
          }}>
          <button className="native-tags-fold" disabled={!node.children.length} aria-label={`${closed ? '展开' : '折叠'} #${tag}`} aria-expanded={node.children.length ? !closed : undefined} onClick={() => fold(tag)}>
            {node.children.length > 0 && <Icon name={closed ? 'chevron-right' : 'chevron-down'} size={13} />}
          </button>
          {showSelection && <input type="checkbox" className="native-tags-check-row" aria-label={`选择 #${tag}`} checked={isSelected} onChange={() => toggle(tag)} />}
          {renaming === tagKey(tag) ? <RenameInput tag={tag} onDone={() => setRenaming(null)} /> :
          <button className="native-tags-label" title={`#${tag} · 直接 ${directCount} · 含子标签 ${count}${pages.length ? ` · 标签页 ${pages.length}` : ''}`}
            data-native-tag={tag}
            onClick={(e) => onLabelClick(e, tag)}
            onDoubleClick={() => { if (preferences.wranglerEnabled && !selecting) setRenaming(tagKey(tag)); }}
            onMouseEnter={(e) => { if (preferences.wranglerEnabled && pages.length === 1) setHover({ path: pages[0], x: e.clientX, y: e.clientY }); }}
            onMouseLeave={() => setHover(null)}>{tag.split('/').at(-1)}</button>}
          {pages.length > 0 && preferences.wranglerEnabled && <button aria-label={`打开 #${tag} 标签页`} onClick={(e) => { void openNativeTagPage(tag, e.ctrlKey || e.metaKey); }}><Icon name="file" size={12} /></button>}
          <span className="native-tags-count">{count}</span>
        </div>
        {!closed && node.children.length > 0 && <ul>{rows(node.children)}</ul>}
      </li>;
    });
  }
  return <div className="native-tags-panel" onKeyDown={onPanelKey}>
    <div className="native-tags-toolbar"><input className="text-input" aria-label="筛选标签" placeholder="筛选标签…" value={filter} onChange={(e) => setFilter(e.target.value)} />
      {(canMerge || preferences.batchEnabled) && tags.length > 0 && <button type="button" className={'nav-action' + (selecting ? ' active' : '')} title="多选" aria-label="多选"
        aria-pressed={selecting} onClick={() => { if (selecting) endSelection(); else setSelecting(true); }}><Icon name="list-checks" size={15} /></button>}
    </div>
    {showSelection && <SelectionBar label="所选标签操作" count={selected.length} closeLabel="退出多选" onClose={endSelection}>
      {canMerge && <button type="button" disabled={selected.length < 2} onClick={() => mergeNativeTags(byUse(selected))}><Icon name="merge" size={13} />合并</button>}
      {preferences.batchEnabled && <button type="button" className="mod-warning" disabled={!selected.length} onClick={() => deleteNativeTag(selected)}><Icon name="trash" size={13} />删除</button>}
    </SelectionBar>}
    {error && <p role="alert" className="native-tags-error">{error}</p>}
    {!tags.length && !error && <div className="panel-empty">没有标签</div>}
    <ul className="native-tags-tree" aria-label="标签层级">{rows(tree)}</ul>
    {hover && <TagPageHover {...hover} />}
  </div>;
}
