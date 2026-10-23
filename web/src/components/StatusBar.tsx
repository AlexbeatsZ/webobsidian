import { useEffect, useState } from 'react';
import { useStore } from '../lib/store';
import { api } from '../lib/api';
import Icon from './Icon';
import PluginElements from './PluginElements';
import ViewModeMenu from './ViewModeMenu';
import { pluginStatusItems } from '../lib/plugins';

export default function StatusBar() {
  const content = useStore((s) => s.content);
  const activePath = useStore((s) => s.activePath);
  const dirty = useStore((s) => s.dirty);
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

  const isText = activePath && /\.(md|markdown|txt)$/i.test(activePath);
  const words = isText ? content.trim().split(/\s+/).filter(Boolean).length : 0;

  const gitLabel = !git?.isRepo
    ? '未同步仓库'
    : git.clean
      ? `git ${git.branch}${git.ahead ? ` ↑${git.ahead}` : ''}${git.behind ? ` ↓${git.behind}` : ''}`
      : `${git.modified + git.notAdded} 未保存更改`;

  return (
    <div className="status-bar">
      <PluginElements items={pluginStatusItems} />
      <ViewModeMenu />
      {dirty && <span>保存中…</span>}
      {isText && <span>{words} 词</span>}
      {isText && <span>{content.length} 字符</span>}
      <span className="clickable" title="Git 同步" onClick={sync}>
        <Icon name="refresh-cw" size={13} style={syncing ? { animation: 'spin 1s linear infinite' } : undefined} />
        {gitLabel}
      </span>
    </div>
  );
}
