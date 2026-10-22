import { useEffect, useMemo, useState, type DragEvent } from 'react';
import { useIndexVersion } from '../lib/indexEvents';
import { tagsApi } from '../lib/tags/api';
import { openNativeTagMenu, searchNativeTag, openNativeTagPage, renameNativeTag, dropTagDestination, openTagOperation } from '../lib/tags/actions';
import { tagKey } from '../../../server/src/services/tags/query';
import type { TagSummary, TagPreferences } from '../../../server/src/services/tags/types';
import TagPageHover from './TagPageHover';
import Icon from './Icon';
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
  useEffect(() => {
    const abort = new AbortController();
    void tagsApi.summary(abort.signal).then((result) => {
      if (abort.signal.aborted) return;
      setTags(result.tags); setPreferences(result.preferences); setError('');
    }).catch((error) => { if (!abort.signal.aborted) setError(String(error)); });
    return () => abort.abort();
  }, [version]);
  const tree = useMemo(() => buildTree(tags), [tags]);
  const visible = (node: TreeTag): boolean => !filter || tagKey(node.value.tag).includes(tagKey(filter)) || node.children.some(visible);
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
  function onDrop(event: DragEvent, target: string) {
    event.preventDefault(); event.stopPropagation();
    const source = dragged ?? event.dataTransfer.getData('application/x-webobsidian-tag');
    setDragged(null); setDrop(null);
    if (!source) return;
    const destination = dropTagDestination(source, target);
    if (destination) renameNativeTag(source, destination);
  }
  function rows(nodes: TreeTag[]): React.ReactNode {
    return nodes.filter(visible).map((node) => {
      const { tag, pages, count, directCount } = node.value, closed = !filter && collapsed.has(tagKey(tag));
      return <li key={tagKey(tag)}>
        <div className={'native-tags-row' + (drop === tagKey(tag) ? ' is-drop-target' : '')}
          draggable={preferences.wranglerEnabled}
          onDragStart={(e) => { setHover(null); setDragged(tag); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', '#' + tag); e.dataTransfer.setData('application/x-webobsidian-tag', tag); }}
          onDragEnd={() => { setDragged(null); setDrop(null); }}
          onDragOver={(e) => { if (preferences.wranglerEnabled && dragged && dropTagDestination(dragged, tag)) { e.preventDefault(); e.stopPropagation(); setDrop(tagKey(tag)); e.dataTransfer.dropEffect = 'move'; } }}
          onDragLeave={() => setDrop(null)} onDrop={(e) => { if (preferences.wranglerEnabled) onDrop(e, tag); }}
          onContextMenu={(e) => { setHover(null); openNativeTagMenu(e, { tag, hasPage: pages.length > 0, ...preferences,
            collapseSiblings: () => foldSiblings(nodes, true), expandSiblings: () => foldSiblings(nodes, false) }); }}>
          <button className="native-tags-fold" disabled={!node.children.length} aria-label={`${closed ? '展开' : '折叠'} #${tag}`} aria-expanded={node.children.length ? !closed : undefined} onClick={() => fold(tag)}>
            {node.children.length > 0 && <Icon name={closed ? 'chevron-right' : 'chevron-down'} size={13} />}
          </button>
          <button className="native-tags-label" title={`#${tag} · 直接 ${directCount} · 含子标签 ${count}${pages.length ? ` · 标签页 ${pages.length}` : ''}`}
            data-native-tag={tag}
            onClick={(e) => { if (e.altKey && preferences.wranglerEnabled) { void openNativeTagPage(tag, e.ctrlKey || e.metaKey); } else searchNativeTag(tag); }}
            onMouseEnter={(e) => { if (preferences.wranglerEnabled && pages.length === 1) setHover({ path: pages[0], x: e.clientX, y: e.clientY }); }}
            onMouseLeave={() => setHover(null)}>{tag.split('/').at(-1)}</button>
          {pages.length > 0 && preferences.wranglerEnabled && <button aria-label={`打开 #${tag} 标签页`} onClick={(e) => { void openNativeTagPage(tag, e.ctrlKey || e.metaKey); }}><Icon name="file" size={12} /></button>}
          <span className="native-tags-count">{count}</span>
        </div>
        {!closed && node.children.length > 0 && <ul>{rows(node.children)}</ul>}
      </li>;
    });
  }
  return <div className="native-tags-panel">
    <div className="native-tags-toolbar"><input aria-label="筛选标签" placeholder="筛选标签…" value={filter} onChange={(e) => setFilter(e.target.value)} />
      {preferences.batchEnabled && <button title="批量修改标签" aria-label="批量修改标签" onClick={() => openTagOperation({ scope: { kind: 'vault' } })}><Icon name="pencil" size={15} /></button>}
    </div>
    {error && <p role="alert" className="native-tags-error">{error}</p>}
    {!tags.length && !error && <div style={{ color: 'var(--text-faint)', padding: 8 }}>没有标签</div>}
    <ul className="native-tags-tree" aria-label="标签层级">{rows(tree)}</ul>
    {hover && <TagPageHover {...hover} />}
  </div>;
}
