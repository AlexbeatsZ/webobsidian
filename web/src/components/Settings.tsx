import { useSearch, updateSearch } from '../lib/search';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import {
  pluginRevision,
  subscribePlugins,
  pluginTabs,
  pluginStatuses,
  nativePluginReplacements,
  setPluginEnabled,
  sharedApp,
} from '../lib/plugins';
import { useStore } from '../lib/store';
import { api } from '../lib/api';
import Icon from './Icon';
import WritingSettings from './WritingSettings';
import { UserscriptSettings } from './UserscriptSettings';
import ConfiguredMenuSettings from './ConfiguredMenuSettings';
import TagSettings from './TagSettings';
import AutomationSettings from './AutomationSettings';
import HotkeySettings from './HotkeySettings';
import ConfigurationFile from './ConfigurationFile';
import { readCssSnippets, setCssSnippetEnabled, type CssSnippets } from '../lib/cssSnippets';
import { readNativeFeatures, saveNativeFeatures, type NativeFeaturePreferences } from '../lib/nativeFeatures';
import { notifyIndexChanged } from '../lib/indexEvents';
import { documents } from '../lib/documents';
import { workspaceMaintenanceBlockers } from '../lib/vaultMaintenance';
import { SettingRow as Row, SettingGroup } from './SettingRow';

type Section =
  'search' | 'hotkeys' | 'automation' | 'writing' | 'formatting' | 'userscripts' | 'menus' | 'tags' | 'vault' | 'git' | 'plugins' | 'appearance' | 'interface' | 'editor' | 'about';

export default function Settings() {
  const open = useStore((s) => s.settingsOpen);
  const setOpen = useStore((s) => s.setSettings);
  const [section, setSection] = useState<Section>('vault');
  const [settings, setSettings] = useState<any>(null);
  const [pluginTab, setPluginTab] = useState<string | null>(null);
  const [features, setFeatures] = useState<NativeFeaturePreferences | null>(null);
  const [featureError, setFeatureError] = useState('');
  const [navQuery, setNavQuery] = useState('');
  const modal = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: number; x: number; y: number; left: number; top: number }>();
  useEffect(() => {
    if (!open) return;
    const center = () => { modal.current?.style.removeProperty('transform'); drag.current = undefined; };
    center();
    window.addEventListener('resize', center);
    return () => window.removeEventListener('resize', center);
  }, [open]);
  const vaultName = useStore(s => s.tree?.name ?? 'Vault');
  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape' && !event.defaultPrevented) setOpen(false); };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [open, setOpen]);
  useEffect(() => {
    if (!open) return;
    let live = true;
    setFeatures(null); setFeatureError('');
    void readNativeFeatures().then(value => { if (live) setFeatures(value); }).catch(error => { if (live) setFeatureError(String(error)); });
    return () => { live = false; };
  }, [open]);
  useEffect(() => {
    const scripts = () => { setPluginTab(null); setSection('userscripts'); };
    const menus = () => { setPluginTab(null); setSection('menus'); };
    const automation = () => { setPluginTab(null); setSection('automation'); };
    const vault = () => { setPluginTab(null); setSection('vault'); };
    window.addEventListener('userscripts:open-settings', scripts);
    window.addEventListener('menus:open-settings', menus);
    window.addEventListener('automation:open-settings', automation);
    window.addEventListener('vault-settings-open', vault);
    return () => { window.removeEventListener('userscripts:open-settings', scripts); window.removeEventListener('menus:open-settings', menus); window.removeEventListener('automation:open-settings', automation); window.removeEventListener('vault-settings-open', vault); };
  }, []);
  useSyncExternalStore(subscribePlugins, pluginRevision);
  useEffect(() => {
    const listener = (e: Event) => setPluginTab((e as CustomEvent<string>).detail);
    window.addEventListener('plugin-settings-open', listener);
    return () => window.removeEventListener('plugin-settings-open', listener);
  }, []);

  useEffect(() => {
    if (open)
      api
        .getSettings()
        .then(setSettings)
        .catch(() => {});
  }, [open]);

  useEffect(() => {
    const show = (event: Event) => {
      setPluginTab(null);
      setSection(event.type === 'hotkeys-settings-open' || (event as CustomEvent<string>).detail ? 'hotkeys' : 'search');
    };
    window.addEventListener('search-settings-open', show);
    window.addEventListener('hotkeys-settings-open', show);
    return () => { window.removeEventListener('search-settings-open', show); window.removeEventListener('hotkeys-settings-open', show); };
  }, []);
  if (!open) return null;

  return (
    <div className="modal-bg settings-backdrop" onClick={() => setOpen(false)}>
      <div ref={modal} className="modal settings-modal" role="dialog" aria-modal="true" aria-labelledby="settings-title" onClick={(e) => e.stopPropagation()}>
        <div className="settings-header" onPointerDown={event => {
          if (event.button !== 0 || (event.target as HTMLElement).closest('button') || !modal.current || window.innerWidth <= 768) return;
          const box = modal.current.getBoundingClientRect();
          drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, left: box.left, top: box.top };
          event.currentTarget.setPointerCapture(event.pointerId);
          event.preventDefault();
        }} onPointerMove={event => {
          const start = drag.current, element = modal.current;
          if (!start || start.id !== event.pointerId || !element) return;
          const left = Math.max(8, Math.min(window.innerWidth - element.offsetWidth - 8, start.left + event.clientX - start.x));
          const top = Math.max(8, Math.min(window.innerHeight - element.offsetHeight - 8, start.top + event.clientY - start.y));
          const centeredLeft = (window.innerWidth - element.offsetWidth) / 2;
          const centeredTop = (window.innerHeight - element.offsetHeight) / 2;
          element.style.transform = `translate(${left - centeredLeft}px, ${top - centeredTop}px)`;
        }} onPointerUp={() => { drag.current = undefined; }} onPointerCancel={() => { drag.current = undefined; }} onLostPointerCapture={() => { drag.current = undefined; }}>
          <span id="settings-title">设置 — {vaultName}</span>
          <button type="button" title="关闭设置" aria-label="关闭设置" onClick={() => setOpen(false)}><Icon name="x" size={16} /></button></div>
        <div className="settings-layout">
          <div className="settings-nav">
            <label className="settings-search"><Icon name="search" size={15} /><input aria-label="搜索设置" placeholder="搜索设置…" value={navQuery} onChange={event => setNavQuery(event.target.value)} /></label>
            {NAV_GROUPS.map(group => {
              const entries = group.sections.filter(s => labels[s].toLowerCase().includes(navQuery.toLowerCase()));
              return entries.length ? <div className="settings-nav-group" key={group.title}>
                <div className="settings-nav-label">{group.title}</div>
                {entries.map((s) => (
              <button
                key={s}
                type="button" aria-current={!pluginTab && section === s ? 'page' : undefined}
                className={!pluginTab && section === s ? 'active' : ''}
                onClick={() => {
                  setSection(s);
                  setPluginTab(null);
                }}
              >
                <Icon name={sectionIcons[s]} size={16} /><span>{labels[s]}</span>
              </button>
            ))}</div> : null; })}
            {pluginTabs.size > 0 && <div className="settings-nav-label">第三方插件</div>}
            {[...pluginTabs].filter(([, tab]) => tab.name.toLowerCase().includes(navQuery.toLowerCase())).map(([id, tab]) => (
              <button key={id} type="button" aria-current={pluginTab === id ? 'page' : undefined} className={pluginTab === id ? 'active' : ''} onClick={() => setPluginTab(id)}>
                <Icon name="puzzle" size={16} /><span>{tab.name}</span>
              </button>
            ))}
          </div>
          <div className="settings-content" style={pluginTab ? { display: 'none' } : undefined}>
            {section === 'search' && <SearchSettingsPanel />}
            {section === 'hotkeys' && <HotkeySettings />}
            {section === 'automation' && <AutomationSettings />}
            {section === 'writing' && <WritingSettings />}
            {section === 'formatting' && <WritingSettings formatting />}
            {section === 'userscripts' && <UserscriptSettings />}
            {section === 'menus' && <ConfiguredMenuSettings />}
            {section === 'tags' && (features ? <TagSettings value={features.tags} vault={features.vault} onChange={async patch => {
              setFeatures(await saveNativeFeatures({ vault: features.vault, tags: patch }));
              notifyIndexChanged();
            }} /> : <p role="status">{featureError || '正在读取标签设置…'}</p>)}
            {settings && section === 'vault' && (
              <VaultSettings s={settings} reload={() => api.getSettings().then(setSettings)} />
            )}
            {settings && section === 'git' && (
              <GitSettings s={settings} reload={() => api.getSettings().then(setSettings)} />
            )}
            {section === 'plugins' && <Plugins />}
            {settings && section === 'appearance' && <Appearance s={settings} />}
            {section === 'interface' && <InterfaceSettings />}
            {section === 'editor' && <EditorSettings />}
            {section === 'about' && <About />}
          </div>
          {pluginTab && <PluginSettingsTab id={pluginTab} />}
        </div>
      </div>
    </div>
  );
}

function PluginSettingsTab({ id }: { id: string }) {
  const host = useRef<HTMLDivElement>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    const tab = pluginTabs.get(id);
    if (!tab) return;
    setError('');
    sharedApp.setting.activeTab = tab;
    host.current!.append(tab.containerEl);
    try {
      tab.display();
    } catch (e) {
      setError(String(e));
    }
    return () => {
      tab.hide();
      tab.containerEl.remove();
      if (sharedApp.setting.activeTab === tab) sharedApp.setting.activeTab = null;
    };
  }, [id]);
  return (
    <div className="settings-content">
      <div ref={host} />
      {error && <p role="alert">{error}</p>}
    </div>
  );
}

const labels: Record<Section, string> = {
  automation: '用户指令与模板',
  userscripts: '内置浏览器脚本',
  menus: '右键菜单',
  tags: '标签',
  writing: '公式与片段',
  formatting: '文档格式化',
  search: '搜索',
  hotkeys: '快捷键',
  vault: '文件与链接',
  git: 'GitHub 同步',
  plugins: '第三方插件',
  appearance: '外观',
  interface: '界面',
  editor: '编辑器',
  about: '关于',
};
const sectionIcons: Record<Section, string> = {
  search: 'search', hotkeys: 'command', automation: 'command', writing: 'code', formatting: 'pencil', userscripts: 'globe', menus: 'list',
  tags: 'hash', vault: 'folder', git: 'refresh-cw', plugins: 'puzzle', appearance: 'palette', interface: 'layout-dashboard', editor: 'pencil', about: 'info',
};
const NAV_GROUPS: { title: string; sections: Section[] }[] = [
  { title: '选项', sections: ['about', 'appearance', 'interface', 'editor', 'vault', 'hotkeys', 'plugins'] },
  { title: '核心功能', sections: ['search', 'writing', 'formatting', 'tags', 'automation', 'userscripts', 'menus', 'git'] },
];

function VaultSettings({ s, reload }: { s: any; reload: () => void }) {
  const [path, setPath] = useState(s.vault.path);
  const [deleteMode, setDeleteMode] = useState(s.vault.deleteMode ?? 'trash');
  const [browser, setBrowser] = useState<any>(null);
  const [switching, setSwitching] = useState(false);
  const [switchError, setSwitchError] = useState('');
  const save = async () => {
    if (switching) return;
    setSwitching(true); setSwitchError('');
    try {
      for (const snapshot of documents.snapshots()) if (snapshot.dirty) await documents.get(snapshot.id)?.save();
      const blockers = workspaceMaintenanceBlockers();
      if (blockers.length) throw new Error(blockers.join('；'));
      await api.putSettings({ vault: { path } });
      // The server has switched its watcher/index and saved each Vault's layout.
      // Only clean sessions passed the lease; a fresh page opens the new layout.
      window.location.reload();
    } catch (error) { setSwitchError(String(error)); setSwitching(false); }
  };
  const saveDeleteMode = async (mode: string) => {
    setDeleteMode(mode);
    await api.putSettings({ vault: { deleteMode: mode } });
    await reload();
  };
  const browse = async (dir?: string) =>
    setBrowser(await api.browse(dir).catch((e) => ({ error: e.message })));
  return (
    <div>
      <h2>文件与链接</h2>
      <SettingGroup title="仓库位置">
      <Row name="仓库路径" desc="服务器上存放笔记的文件夹">
        <input
          className="text-input"
          style={{ width: 260 }}
          value={path}
          onChange={(e) => setPath(e.target.value)}
        />
      </Row>
      <div className="setting-actions">
        <button className="btn secondary" onClick={() => browse()}>
          浏览…
        </button>
        <button className="btn" onClick={save} disabled={switching}>
          {switching ? '正在切换…' : '切换仓库'}
        </button>
      </div>
      {switchError && <p className="editor-error" role="alert">{switchError}</p>}
      {browser && !browser.error && (
        <div
          style={{ border: '1px solid var(--bg-modifier-border)', borderRadius: 6, padding: 8, marginTop: 8 }}
        >
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>{browser.dir}</div>
          <div
            className="result"
            onClick={() => browse(browser.parent)}
            style={{ display: 'flex', alignItems: 'center', gap: 8 }}
          >
            <Icon name="folder" size={15} /> ..
          </div>
          {browser.folders.map((f: any) => (
            <div
              className="result"
              key={f.path}
              onClick={() => browse(f.path)}
              onDoubleClick={() => setPath(f.path)}
              style={{ display: 'flex', alignItems: 'center', gap: 8 }}
            >
              <Icon name="folder" size={15} /> {f.name}
              <button
                className="btn secondary"
                style={{ float: 'right', padding: '2px 8px' }}
                onClick={(e) => {
                  e.stopPropagation();
                  setPath(f.path);
                }}
              >
                选择
              </button>
            </div>
          ))}
        </div>
      )}
      {browser?.error && <div style={{ color: '#e5534b' }}>{browser.error}</div>}
      </SettingGroup>
      <SettingGroup title="文件删除">
      <Row
        name="删除文件时"
        desc="移入回收站可恢复；永久删除会立即移除文件。"
      >
        <select
          className="text-input"
          style={{ width: 220 }}
          value={deleteMode}
          onChange={(e) => saveDeleteMode(e.target.value)}
        >
          <option value="trash">移入 .trash 回收站（可恢复）</option>
          <option value="permanent">永久删除</option>
        </select>
      </Row>
      </SettingGroup>
    </div>
  );
}

function GitSettings({ s, reload }: { s: any; reload: () => void }) {
  const [g, setG] = useState({ ...s.git });
  const [log, setLog] = useState<string[]>([]);
  const logRef = useRef<HTMLTextAreaElement>(null);
  const set = (k: string, v: any) => setG((p: any) => ({ ...p, [k]: v }));
  // Append timestamped lines to the running log instead of replacing it, so the
  // textarea keeps a history of every git action across clicks.
  const append = (lines: string[]) => {
    const ts = new Date().toLocaleTimeString();
    setLog((prev) => [...prev, ...lines.map((l, i) => (i === 0 ? `[${ts}] ${l}` : `         ${l}`))]);
  };
  // Auto-scroll to the newest line whenever the log grows.
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [log]);
  const save = async () => {
    await api.putSettings({ git: g });
    await reload();
    append(['已保存 Git 设置']);
  };
  const run = async (fn: () => Promise<any>, label: string) => {
    append([`${label}…`]);
    try {
      const r = await fn();
      // sync returns { ok, log: string[] }; others return { message }. Split any
      // embedded newlines so multi-line git output renders one line per row.
      const lines: string[] = Array.isArray(r?.log)
        ? [`${label} ${r.ok ? 'ok' : 'NOT ok'}`, ...r.log]
        : [String(r?.message ?? JSON.stringify(r))];
      append(lines.flatMap((l) => String(l).split('\n')));
    } catch (e: any) {
      append([`错误: ${e.message}`]);
    }
  };
  return (
    <div>
      <h2>GitHub 同步</h2>
      <SettingGroup title="连接与身份">
      <Row name="启用 Git 同步">
        <input type="checkbox" checked={g.enabled} onChange={(e) => set('enabled', e.target.checked)} />
      </Row>
      <Row name="远程 URL" desc="https://github.com/owner/repo.git">
        <input
          className="text-input"
          style={{ width: 260 }}
          value={g.remote}
          onChange={(e) => set('remote', e.target.value)}
        />
      </Row>
      <Row name="分支">
        <input
          className="text-input"
          style={{ width: 120 }}
          value={g.branch}
          onChange={(e) => set('branch', e.target.value)}
        />
      </Row>
      <Row name="访问令牌 (PAT)" desc="存储在服务端；保持掩码以保留当前值">
        <input
          className="text-input"
          type="password"
          style={{ width: 260 }}
          value={g.token}
          onChange={(e) => set('token', e.target.value)}
        />
      </Row>
      <Row name="作者名称">
        <input
          className="text-input"
          value={g.authorName}
          onChange={(e) => set('authorName', e.target.value)}
        />
      </Row>
      <Row name="作者邮箱">
        <input
          className="text-input"
          value={g.authorEmail}
          onChange={(e) => set('authorEmail', e.target.value)}
        />
      </Row>
      </SettingGroup>
      <SettingGroup title="同步方式">
      <Row name="自动同步" desc="按下方间隔定期执行 pull+commit+push">
        <input type="checkbox" checked={g.autoSync} onChange={(e) => set('autoSync', e.target.checked)} />
      </Row>
      <Row name="保存时自动提交" desc="每次编辑约 5 秒后提交 (+push)">
        <input
          type="checkbox"
          checked={g.autoCommitOnSave}
          onChange={(e) => set('autoCommitOnSave', e.target.checked)}
        />
      </Row>
      <Row name="间隔（秒）">
        <input
          className="text-input"
          type="number"
          style={{ width: 90 }}
          value={g.intervalSec}
          onChange={(e) => set('intervalSec', Number(e.target.value))}
        />
      </Row>
      <Row name="Git LFS 规则" desc="通过 LFS 跟踪的空格分隔 glob 规则">
        <input
          className="text-input"
          style={{ width: 260 }}
          value={(g.lfsPatterns || []).join(' ')}
          onChange={(e) => set('lfsPatterns', e.target.value.split(/\s+/).filter(Boolean))}
        />
      </Row>
      </SettingGroup>
      <div className="setting-actions">
        <button className="btn" onClick={save}>
          保存
        </button>
        <button className="btn secondary" onClick={() => run(api.gitInit, '初始化仓库')}>
          初始化仓库
        </button>
        <button className="btn secondary" onClick={() => run(api.gitClone, '克隆')}>
          克隆
        </button>
        <button className="btn secondary" onClick={() => run(api.gitPull, '拉取')}>
          拉取
        </button>
        <button className="btn secondary" onClick={() => run(() => api.gitCommit(), '提交')}>
          提交
        </button>
        <button className="btn secondary" onClick={() => run(api.gitPush, '推送')}>
          推送
        </button>
        <button className="btn" onClick={() => run(() => api.gitSync(), '立即同步')}>
          立即同步
        </button>
      </div>
      <div style={{ marginTop: 12 }}>
        <div
          style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}
        >
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>同步日志</span>
          {log.length > 0 && (
            <button className="btn secondary" style={{ padding: '2px 8px' }} onClick={() => setLog([])}>
              清空
            </button>
          )}
        </div>
        <textarea
          ref={logRef}
          readOnly
          value={
            log.length
              ? log.join('\n')
              : '暂无 Git 活动。点击上方操作（立即同步、拉取、推送…）在此查看日志。'
          }
          style={{
            width: '100%',
            height: 200,
            boxSizing: 'border-box',
            resize: 'vertical',
            background: 'var(--bg-primary)',
            color: 'var(--text-normal)',
            border: '1px solid var(--bg-modifier-border, #444)',
            borderRadius: 6,
            padding: 10,
            fontFamily: 'var(--font-monospace, monospace)',
            fontSize: 12,
            lineHeight: 1.5,
            whiteSpace: 'pre',
          }}
        />
      </div>
    </div>
  );
}

function Plugins() {
  useSyncExternalStore(subscribePlugins, pluginRevision);
  const [plugins, setPlugins] = useState<any[]>([]);
  const [msg, setMsg] = useState('');
  const load = () =>
    api
      .listPlugins()
      .then((r) => setPlugins(r.plugins))
      .catch(() => {});
  useEffect(() => {
    load();
  }, []);
  return (
    <div>
      <h2>第三方插件</h2>
      {msg && <div style={{ color: 'var(--text-muted)', margin: '6px 0' }}>{msg}</div>}
      <SettingGroup title="已安装插件">
        {plugins.length === 0 && (
          <div style={{ color: 'var(--text-faint)' }}>尚未在 .obsidian/plugins 安装插件</div>
        )}
        {plugins.map((p) => (
          <div className="setting-row" key={p.id}>
            <div className="info">
              <div className="name">
                {p.name} <span style={{ color: 'var(--text-faint)' }}>v{p.version}</span>
              </div>
              <div className="desc">{p.description}</div>
              <div className="desc" role="status">
                {pluginStatuses.get(p.id)?.state ?? 'disabled'}
                {pluginStatuses.get(p.id)?.error ? `: ${pluginStatuses.get(p.id)!.error}` : ''}
              </div>
            </div>
            <div className="control">
              <input
                type="checkbox"
                disabled={Boolean(nativePluginReplacements[p.id])}
                checked={nativePluginReplacements[p.id] ? false : p.enabled}
                onChange={async (e) => {
                  try {
                    await setPluginEnabled(p.id, e.target.checked);
                    await load();
                  } catch (error) {
                    setMsg(String(error));
                  }
                }}
                aria-label={`启用 ${p.name}`}
              />
            </div>
          </div>
        ))}
      </SettingGroup>
      <p style={{ color: 'var(--text-faint)', fontSize: 12, marginTop: 14 }}>
        原生 Node/Electron 模块需要桌面插件宿主。加载状态与具体工作流兼容性分别显示。
      </p>
    </div>
  );
}

function Appearance({ s }: { s: any }) {
  const [theme, setTheme] = useState(s.ui.theme);
  const [snippets, setSnippets] = useState<CssSnippets>();
  const [query, setQuery] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const reloadSnippets = () => {
    setError(''); void readCssSnippets().then(value => {
      setSnippets(value);
      window.dispatchEvent(new CustomEvent('vault-configuration-changed', { detail: { path: '.obsidian/snippets' } }));
    }).catch(cause => setError(String(cause)));
  };
  useEffect(() => {
    let active = true;
    void readCssSnippets().then(value => { if (active) setSnippets(value); }).catch(cause => { if (active) setError(String(cause)); });
    return () => { active = false; };
  }, []);
  const save = async (t: string) => {
    setTheme(t);
    await api.putSettings({ ui: { theme: t } });
    location.reload();
  };
  return (
    <div>
      <h2>外观</h2>
      <SettingGroup title="主题">
      <Row name="基础颜色" desc="设置应用界面、编辑和阅读视图的配色">
        <select className="text-input" value={theme} onChange={(e) => save(e.target.value)}>
          <option value="obsidian-dark">深色</option>
          <option value="obsidian-light">浅色</option>
        </select>
      </Row>
      </SettingGroup>
      <SettingGroup title="CSS 样式片段">
        <ConfigurationFile name="片段文件夹" path=".obsidian/snippets">
          <button type="button" disabled={busy} onClick={reloadSnippets}>刷新</button>
        </ConfigurationFile>
        <Row name="搜索片段"><input type="search" placeholder="搜索片段…" value={query} onChange={event => setQuery(event.target.value)} /></Row>
        {!snippets?.snippets.length && <p>暂无 CSS 片段。将 .css 文件放入此文件夹后刷新。</p>}
        {snippets?.snippets.filter(snippet => snippet.name.toLowerCase().includes(query.toLowerCase())).map(snippet => <Row key={snippet.name} name={snippet.name}>
          <input type="checkbox" disabled={busy} checked={snippet.enabled} onChange={event => {
            setBusy(true); setError('');
            void setCssSnippetEnabled(snippets.source, snippet.name, event.target.checked).then(setSnippets)
              .catch(cause => setError(String(cause))).finally(() => setBusy(false));
          }} />
        </Row>)}
      </SettingGroup>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}

function InterfaceSettings() {
  const leftOpen = useStore(state => state.leftOpen), rightOpen = useStore(state => state.rightOpen);
  const autoReveal = useStore(state => state.autoReveal);
  return <div>
    <h2>界面</h2>
    <SettingGroup title="侧栏">
      <Row name="显示左侧栏"><input type="checkbox" checked={leftOpen} onChange={() => useStore.getState().toggleLeft()} /></Row>
      <Row name="显示右侧栏"><input type="checkbox" checked={rightOpen} onChange={() => useStore.getState().toggleRight()} /></Row>
      <Row name="自动定位当前文件" desc="在文件列表中展开并显示当前笔记。"><input type="checkbox" checked={autoReveal} onChange={() => useStore.getState().toggleAutoReveal()} /></Row>
    </SettingGroup>
  </div>;
}

function EditorSettings() {
  const viewMode = useStore(state => state.viewMode);
  return <div>
    <h2>编辑器</h2>
    <SettingGroup title="文档视图">
      <Row name="当前编辑视图" desc="工作区使用的视图模式，也可在文档右下角切换。"><select value={viewMode} onChange={event => useStore.getState().setViewMode(event.target.value as typeof viewMode)}>
        <option value="live">实时预览</option><option value="source">源码模式</option><option value="reading">阅读视图</option>
      </select></Row>
    </SettingGroup>
  </div>;
}

function About() {
  return <div>
    <h2>关于 WebObsidian</h2>
    <p>面向个人知识管理与写作的笔记应用，提供 Markdown 编辑、公式与片段、文档格式化、搜索、白板和可配置工作流。</p>
    <SettingGroup title="项目">
      <Row name="项目仓库" desc="个人维护与定制版本"><a href="https://github.com/AlexbeatsZ/webobsidian" target="_blank" rel="noreferrer">AlexbeatsZ/webobsidian</a></Row>
      <Row name="GitHub"><a href="https://github.com/AlexbeatsZ" target="_blank" rel="noreferrer">AlexbeatsZ</a></Row>
      <Row name="Fork 来源" desc="基于 xnohat/webobsidian 继续开发"><a href="https://github.com/xnohat/webobsidian" target="_blank" rel="noreferrer">xnohat/webobsidian</a></Row>
    </SettingGroup>
  </div>;
}
function SearchSettingsPanel() {
  const { settings } = useSearch();
  const [rules, setRules] = useState(settings.fuzzyRules.map((r) => r.join('=')).join(', '));
  const [error, setError] = useState('');
  const save = (patch: Parameters<typeof updateSearch>[0]) => {
    setError('');
    void updateSearch(patch).catch((e) => setError(String(e)));
  };
  const toggles = [
    ['enabled', '中文拼音搜索'],
    ['traditional', '繁体字拼音'],
    ['usePath', '文件路径参与搜索'],
    ['attachments', '搜索附件'],
    ['showTags', '显示文件标签'],
    ['showFirstHeading', '显示一级标题'],
    ['headingIndent', '标题层级缩进'],
  ] as const;
  return (
    <div>
      <h2>搜索</h2>
      <SettingGroup title="搜索" desc="文件与正文搜索共用 #标签、-#排除；多个标签以空格分隔。#父标签 同时包含子标签。">
      {toggles.map(([key, label]) => (
        <Row key={key} name={label}>
          <input
            type="checkbox"
            checked={settings[key]}
            onChange={(e) => save({ [key]: e.target.checked })}
          />
        </Row>
      ))}
      <Row name="模糊音规则" desc="例如 zh=z, n=l；留空表示不启用模糊音">
        <input
          className="text-input"
          value={rules}
          onChange={(e) => setRules(e.target.value)}
          onBlur={() => {
            const pairs = rules.trim() ? rules.split(',').map((s) => s.trim().split('=')) : [];
            if (
              pairs.length > 16 ||
              pairs.some((p) => p.length !== 2 || p.some((v) => !/^[a-z]{1,6}$/.test(v)))
            )
              setError('请输入最多 16 组 a=b 规则');
            else save({ fuzzyRules: pairs as [string, string][] });
          }}
        />
      </Row>
      <Row name="历史文件选择键">
        <input
          className="text-input"
          value={settings.historyKeys}
          onChange={(e) => save({ historyKeys: e.target.value })}
        />
      </Row>
      </SettingGroup>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
