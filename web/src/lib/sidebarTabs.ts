/** Persist only view identity/state. Document text and guest processes have other owners. */
export interface SidebarTab {
  id: string;
  type: string;
  state: Record<string, any>;
  title: string;
  icon: string;
  side?: 'left' | 'right';
}

export function sidebarTab(type: string, state: Record<string, any> = {}, id: string = crypto.randomUUID()): SidebarTab {
  const path = typeof state.file === 'string' ? state.file : '';
  const url = typeof state.url === 'string' ? state.url : '';
  return { id, type, state,
    title: type === 'markdown' ? path.split('/').pop()?.replace(/\.(md|markdown)$/i, '') || '笔记'
      : type === 'webviewer' ? url || '浏览器' : type === 'bookmarks' ? '书签与最近文件' : type === 'empty' ? 'Homepage' : type,
    icon: type === 'webviewer' ? 'globe' : type === 'bookmarks' ? 'bookmark' : type === 'empty' ? 'home' : 'file-text' };
}

export function restoreSidebarTabs(value: unknown): SidebarTab[] {
  const seen = new Set<string>();
  return (Array.isArray(value) ? value : []).flatMap(item => {
    if (!item || typeof item.id !== 'string' || !item.id || seen.has(item.id) || typeof item.type !== 'string'
      || !/^[\w:-]{1,160}$/.test(item.type) || !item.state || typeof item.state !== 'object' || Array.isArray(item.state)) return [];
    if (item.type === 'markdown' && (typeof item.state.file !== 'string' || !/\.(md|markdown)$/i.test(item.state.file))) return [];
    if (item.type === 'webviewer') {
      try { if (!['http:', 'https:'].includes(new URL(item.state.url).protocol)) return []; } catch { return []; }
    }
    seen.add(item.id);
    const tab = sidebarTab(item.type, item.state, item.id);
    return [{ ...tab, ...(item.side === 'left' || item.side === 'right' ? { side: item.side as 'left' | 'right' } : {}),
      title: item.type === 'empty' ? tab.title : typeof item.title === 'string' ? item.title.slice(0, 512) : tab.title,
      icon: item.type === 'empty' ? tab.icon : typeof item.icon === 'string' ? item.icon.slice(0, 100) : tab.icon }];
  });
}
