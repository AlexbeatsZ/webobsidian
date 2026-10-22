import { useEffect, useState } from 'react';
import { useStore } from '../lib/store';
import { api } from '../lib/api';
import Icon from './Icon';
import PluginElements from './PluginElements';
import { pluginRibbon } from '../lib/plugins';

export default function Ribbon() {
  const setLeftPanel = useStore((s) => s.setLeftPanel);
  const leftPanel = useStore((s) => s.leftPanel);
  return <nav className="ribbon ribbon-left" aria-label="左侧固定功能">
    <button className={leftPanel === 'files' ? 'active' : ''} title="文件" aria-label="文件" onClick={() => setLeftPanel('files')}>
      <Icon name="file-text" size={18} />
    </button>
    <button className={leftPanel === 'search' ? 'active' : ''} title="搜索 (Ctrl/⌘⇧F)" aria-label="搜索" onClick={() => setLeftPanel('search')}>
      <Icon name="search" size={18} />
    </button>
  </nav>;
}

export function RibbonUtilities({ onTheme }: { onTheme: () => void }) {
  const setSettings = useStore((s) => s.setSettings);
  const setPalette = useStore((s) => s.setPalette);
  const notify = useStore((s) => s.notify);
  const loadTree = useStore((s) => s.loadTree);

  // Show the Sync-now button only when git sync is enabled in settings.
  const [gitEnabled, setGitEnabled] = useState(false);
  const [syncing, setSyncing] = useState(false);
  useEffect(() => {
    const refresh = () => api.gitStatus().then((g) => setGitEnabled(!!g?.enabled)).catch(() => setGitEnabled(false));
    refresh();
    const id = setInterval(refresh, 15000);
    return () => clearInterval(id);
  }, []);

  const sync = async () => {
    if (syncing) return;
    setSyncing(true);
    notify('Syncing…');
    try {
      const r = await api.gitSync();
      notify(r.ok ? 'Synced ✓' : `Sync: ${r.log.at(-1)}`);
      await loadTree();
    } catch (e: any) {
      notify(`Sync failed: ${e.message}`);
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="ribbon-utilities">
      <button title="Command palette (⌘P)" onClick={() => setPalette(true, 'commands')}>
        <Icon name="command" size={18} />
      </button>
      <PluginElements items={pluginRibbon} />
      {gitEnabled && (
        <button title={syncing ? 'Syncing…' : 'Sync now'} onClick={sync} disabled={syncing}>
          <Icon name="refresh-cw" size={18} style={syncing ? { animation: 'spin 1s linear infinite' } : undefined} />
        </button>
      )}
      <button title="Toggle theme" onClick={onTheme}>
        <Icon name="moon" size={18} />
      </button>
      <button title="Settings" onClick={() => setSettings(true)}>
        <Icon name="settings" size={18} />
      </button>
    </div>
  );
}
