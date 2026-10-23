import { useState, useSyncExternalStore } from 'react';
import { getMenuConfigurationController, getMenuConfigurationRevision, subscribeMenuConfiguration } from '../lib/configuredMenus/controller';
import { MENU_CONFIG_DIRECTORY, MENU_CONFIG_ROOT } from '../lib/configuredMenus/config';
import { MENU_CONFIG_EXAMPLE } from '../lib/configuredMenus/example';
import { downloadMenuConfiguration } from '../lib/configuredMenus/commands';
import type { MenuConfigurationController } from '../lib/configuredMenus/controller';
import type { MenuSource } from '../lib/configuredMenus/types';
import { SettingGroup } from './SettingRow';

/** Editor owns its draft until explicitly saved/reloaded. External events never replace typing. */
function MenuConfigEditor({ controller }: { controller: MenuConfigurationController }) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const [path, setPath] = useState(MENU_CONFIG_ROOT);
  const [drafts, setDrafts] = useState<Record<string, { source: MenuSource; content: string }>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const source = state.sources.find((s) => s.path === path);
  const draft = drafts[path];
  const content = draft?.content ?? source?.content ?? '';
  const dirty = Boolean(draft && draft.content !== draft.source.content);
  const edit = (value: string) => {
    if (!source) return;
    setDrafts((previous) => ({ ...previous, [path]: { source: previous[path]?.source ?? source, content: value } }));
  };
  const save = async () => {
    if (!source || busy) return;
    setBusy(true); setError('');
    try {
      const ok = await controller.save(draft?.source ?? source, content);
      setDrafts((previous) => { const next = { ...previous }; delete next[path]; return next; });
      if (!ok) setError('文件已保存，但配置无效；菜单继续使用上一个有效配置。');
    } catch (e) { setError(String((e as Error).message ?? e)); }
    finally { setBusy(false); }
  };
  const reload = async () => {
    setBusy(true); setError('');
    try { await controller.reload(); } catch (e) { setError(String(e)); }
    finally { setBusy(false); }
  };
  const paths = [...new Set([MENU_CONFIG_ROOT, ...state.sources.map((s) => s.path), ...Object.keys(drafts)])];
  return <section className="configured-menu-settings">
    <h2>右键菜单</h2>
    <p>配置只作用于当前 Vault。支持 JSONC 注释、导入文件、条件、稳定 ID、排序、分组和子菜单。保存或重新加载后立即生效。</p>
    <p><code>{MENU_CONFIG_DIRECTORY}{path}</code></p>
    <SettingGroup title="配置文件">
    <div className="setting-actions">
      <label>文件 <select value={path} disabled={busy} onChange={(e) => setPath(e.target.value)}>{paths.map((p) => <option key={p}>{p}</option>)}</select></label>
      <button type="button" disabled={busy || !source} onClick={() => void save()}>保存并应用</button>
      <button type="button" disabled={busy || state.loading} onClick={() => void reload()}>重新加载磁盘配置</button>
      <button type="button" disabled={busy || !source} onClick={() => edit(MENU_CONFIG_EXAMPLE)}>将范例放入草稿</button>
      <button type="button" disabled={busy || !state.sources.length} onClick={() => downloadMenuConfiguration()}>导出配置与导入文件</button>
      {draft && <button type="button" disabled={busy} onClick={() => setDrafts((previous) => { const next = { ...previous }; delete next[path]; return next; })}>放弃此文件草稿</button>}
    </div>
    <p>{!source ? '正在读取配置，或读取失败。' : !source.exists ? '配置尚未创建；保存时新建该文件。' : dirty ? '有未保存草稿；磁盘重载会保留草稿。' : '磁盘内容已载入。'}</p>
    {draft && source?.revision !== draft.source.revision && <p role="alert">磁盘文件已改变。当前草稿仍保留；请先复制草稿并合并，或放弃草稿后重新编辑。</p>}
    <textarea aria-label="右键菜单 JSONC 配置" spellCheck={false} disabled={!source || busy} value={content} onChange={(e) => edit(e.target.value)} style={{ width: '100%', minHeight: 320, fontFamily: 'var(--font-monospace, monospace)', tabSize: 2 }} />
    {error && <p role="alert">{error}</p>}
    {state.diagnostics.length > 0 && <div role="alert"><p>配置未应用。保留上一个有效配置；首次配置出错时使用默认菜单。</p><ul>{state.diagnostics.map((d, i) => <li key={i}><code>{d.file}:{d.line}:{d.column}</code> — {d.message}</li>)}</ul></div>}
    <p>新增动作使用应用已有命令 ID。插件无 ID 的菜单项只能显式弱匹配；语言或标题改变后需要调整。导出包含磁盘已加载文件，不包含未保存草稿。</p>
    </SettingGroup>
  </section>;
}

export default function ConfiguredMenuSettings() {
  useSyncExternalStore(subscribeMenuConfiguration, getMenuConfigurationRevision);
  const controller = getMenuConfigurationController();
  return controller ? <MenuConfigEditor key={controller.sessionId} controller={controller} /> : <p>当前 Vault 的菜单配置尚未初始化。</p>;
}
