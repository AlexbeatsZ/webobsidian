import { useEffect, useMemo, useState } from 'react';
import { request, type VaultConfigurationSource } from '../lib/api';
import { useSearch } from '../lib/search';
import { useStore } from '../lib/store';
import { SettingGroup } from './SettingRow';
import ConfigurationFile from './ConfigurationFile';

const CONFIGURATION_PATH = '.obsidian/webobsidian/mcp.jsonc';
const LIMIT = 20;
interface McpPreferencesState { source: VaultConfigurationSource; preferences: { instructionNotes: string[] } }

/** Settings › MCP: Vault notes every MCP client receives as standing instructions. */
export default function McpSettings() {
  const [state, setState] = useState<McpPreferencesState>();
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const { entries } = useSearch();
  const markdown = useMemo(() => entries.filter(entry => entry.kind === 'file' && /\.md$/i.test(entry.path)
    && !entry.path.split('/').some(part => part.startsWith('.'))).map(entry => entry.path).sort(), [entries]);
  const known = useMemo(() => new Set(markdown), [markdown]);

  useEffect(() => {
    let live = true;
    const load = () => request<McpPreferencesState>('/api/settings/mcp')
      .then(value => { if (live) { setState(value); setError(''); } })
      .catch(cause => { if (live) setError(String(cause)); });
    const changed = (event: Event) => { if ((event as CustomEvent<{ path?: string }>).detail?.path === CONFIGURATION_PATH) void load(); };
    void load();
    window.addEventListener('vault-configuration-changed', changed);
    return () => { live = false; window.removeEventListener('vault-configuration-changed', changed); };
  }, []);

  const notes = state?.preferences.instructionNotes ?? [];
  async function save(next: string[]) {
    if (!state) return;
    setBusy(true); setError('');
    try {
      setState(await request<McpPreferencesState>('/api/settings/mcp', { method: 'PUT',
        body: JSON.stringify({ source: state.source, preferences: { instructionNotes: next } }) }));
    } catch (cause) { setError(String(cause)); } finally { setBusy(false); }
  }
  function add() {
    const path = draft.trim();
    if (!known.has(path)) { setError('请从列表中选择 Vault 里已有的 Markdown 笔记'); return; }
    if (notes.includes(path)) { setError('这篇笔记已经在列表中'); return; }
    setDraft(''); void save([...notes, path]);
  }
  const open = (path: string) => { useStore.getState().setSettings(false); void useStore.getState().openFile(path); };

  return <section>
    <h2>MCP</h2>
    <SettingGroup title="说明笔记" desc={<>
      选中的笔记会作为固定说明交给通过 MCP 连接的 AI：连接时服务器说明里列出它们的链接，
      每次读取上下文（<code>obsidian_get_context</code>）时附上当前全文，并要求 AI 在写入、修改或提议修改笔记时遵守。
      修改列表后需要重新连接 MCP，连接时的链接才会更新；全文总是读取最新保存的版本。
    </>}>
      {state && !notes.length && <p className="setting-description">还没有选择说明笔记。</p>}
      {notes.length > 0 && <ul className="mcp-instruction-notes">
        {notes.map(path => <li key={path} className="setting-folder-rule">
          <span className={known.has(path) ? undefined : 'mod-warning'} title={path}>
            {path}{known.has(path) ? '' : '（找不到这篇笔记）'}
          </span>
          <button type="button" className="btn secondary" disabled={!known.has(path)} onClick={() => open(path)}>打开</button>
          <button type="button" className="btn secondary" disabled={busy} onClick={() => { void save(notes.filter(note => note !== path)); }}>移除</button>
        </li>)}
      </ul>}
      <datalist id="mcp-instruction-note-options">{markdown.map(path => <option key={path} value={path} />)}</datalist>
      <form className="setting-folder-rule" onSubmit={event => { event.preventDefault(); add(); }}>
        <input className="text-input" aria-label="添加说明笔记" list="mcp-instruction-note-options" value={draft}
          placeholder="输入笔记名或路径，从列表中选择" disabled={busy || !state || notes.length >= LIMIT}
          onChange={event => { setDraft(event.target.value); setError(''); }} />
        <button type="submit" className="btn" disabled={busy || !state || !draft.trim() || notes.length >= LIMIT}>添加</button>
      </form>
      {notes.length >= LIMIT && <p className="setting-description">最多 {LIMIT} 篇。</p>}
      <ConfigurationFile path={CONFIGURATION_PATH} desc="列表随 Vault 保存，其他设备同步后共用。" />
    </SettingGroup>
    {error && <p role="alert">{error}</p>}
  </section>;
}
