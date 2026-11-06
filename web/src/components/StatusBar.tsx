import { useEffect, useState, useSyncExternalStore } from 'react';
import { useStore } from '../lib/store';
import { useActivePage } from '../lib/useActivePage';
import { useDocumentSession, useExistingDocumentSnapshot } from '../lib/useDocumentSession';
import { useVirtualReading } from '../lib/virtualReading';
import { api } from '../lib/api';
import Icon from './Icon';
import PluginElements from './PluginElements';
import ViewModeMenu from './ViewModeMenu';
import VirtualGroupMenu from './VirtualGroupMenu';
import { pluginStatusItems } from '../lib/plugins';

// CJK characters count individually, as Obsidian does; other scripts count by whitespace runs.
const CJK = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uac00-\ud7af]/gu;
const noSubscribe = () => () => {};
function countWords(text: string): number {
  const cjk = text.match(CJK)?.length ?? 0;
  return cjk + text.replace(CJK, ' ').split(/\s+/).filter(word => /[\p{L}\p{N}]/u.test(word)).length;
}

export default function StatusBar() {
  const { path: activePath, viewId } = useActivePage();
  const reader = useVirtualReading(activePath, viewId);
  const reading = useSyncExternalStore(reader?.subscribe ?? noSubscribe, () => reader?.getSnapshot());
  const sourcePath = reading?.configuration ? activePath + '/.virtual-document.json' : reading?.activeSource;
  const ordinary = useDocumentSession(activePath && /\.(md|markdown|txt)$/i.test(activePath) ? activePath : null);
  const virtual = useExistingDocumentSnapshot(sourcePath ?? null);
  const snapshot = reader ? virtual : ordinary.snapshot;
  const content = snapshot.raw;
  const dirty = snapshot.dirty;
  const loadTree = useStore((s) => s.loadTree);
  const notify = useStore((s) => s.notify);
  const [git, setGit] = useState<any>(null);
  const [syncing, setSyncing] = useState(false);

  const refresh = () => api.gitStatus().then(setGit).catch(() => setGit(null));
  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 15000);
    return () => clearInterval(id);
  }, []);

  const sync = async () => {
    if (syncing) return;
    setSyncing(true);
    notify("同步中…");
    try {
      const r = await api.gitSync();
      notify(r.ok ? "已同步 ✓" : `同步：${r.log.at(-1)}`);
      await loadTree();
      await refresh();
    } catch (e: any) {
      notify(`同步失败：${e.message}`);
    } finally {
      setSyncing(false);
    }
  };

  const currentPath = reader ? sourcePath : activePath;
  const isText = currentPath && /\.(md|markdown|txt)$/i.test(currentPath);
  const words = isText ? countWords(content) : 0;

  const gitLabel = !git?.isRepo
    ? '未启用 Git'
    : git.clean
      ? `git ${git.branch}${git.ahead ? ` ↑${git.ahead}` : ''}${git.behind ? ` ↓${git.behind}` : ''}`
      : `${git.modified + git.notAdded} 项未提交`;

  return (
    <div className="status-bar">
      <PluginElements items={pluginStatusItems} />
      <VirtualGroupMenu />
      <ViewModeMenu />
      {dirty && <span>保存中…</span>}
      {isText && <span>{words} 词</span>}
      {isText && <span>{content.length} 字符</span>}
      <button type="button" className="clickable" title="Git 同步" disabled={syncing} onClick={sync}>
        <Icon name="refresh-cw" size={13} className={syncing ? 'icon-spin' : undefined} />
        {gitLabel}
      </button>
    </div>
  );
}
