import { useEffect, useState } from 'react';
import type { TagPreferences } from '../../../server/src/services/tags/types';
import { emptyFolderTags, normalizeFolderTags } from '../../../server/src/services/tags/folderRules';
import { importLegacyFolderRules } from '../lib/tags/importFolderRules';
import { importFolderTagNote } from '../lib/nativeFeaturePreferences';
import { openTagOperation } from '../lib/tags/actions';
import { useStore } from '../lib/store';
import { useSearch } from '../lib/search';
import { SettingGroup, SettingRow } from './SettingRow';

export interface TagSettingsProps { value: TagPreferences; vault: string; onChange: (patch: Partial<TagPreferences>) => Promise<unknown> }
export default function TagSettings({ value, vault, onChange }: TagSettingsProps) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [enabled, setEnabled] = useState(value.folderTags?.enabled ?? false);
  const [pruneAncestors, setPruneAncestors] = useState(value.folderTags?.pruneAncestors ?? true);
  const [rules, setRules] = useState(() => (value.folderTags?.rules ?? []).map(rule => ({ ...rule, text: rule.tags.join(', ') })));
  const [message, setMessage] = useState('');
  const { entries } = useSearch();
  const savedRules = JSON.stringify(value.folderTags ?? emptyFolderTags());
  useEffect(() => {
    const settings = value.folderTags ?? emptyFolderTags();
    setEnabled(settings.enabled); setPruneAncestors(settings.pruneAncestors);
    setRules(settings.rules.map(rule => ({ ...rule, text: rule.tags.join(', ') })));
  }, [savedRules, vault]);
  const updateRule = (index: number, patch: Partial<(typeof rules)[number]>) => {
    setMessage(''); setRules(current => current.map((rule, i) => i === index ? { ...rule, ...patch } : rule));
  };
  async function saveRules() {
    setBusy(true); setError(''); setMessage('');
    try {
      const folderTags = normalizeFolderTags({ enabled, pruneAncestors,
        rules: rules.map(({ folder, text, recursive }) => ({ folder, recursive, tags: text.split(/[,，\s]+/u).filter(Boolean) })) });
      await onChange({ folderTags }); setMessage('文件夹规则已保存。自动补齐在之后的新建和保存时生效。');
    } catch (error) { setError(String(error)); } finally { setBusy(false); }
  }
  async function importRules() {
    setBusy(true); setError(''); setMessage('');
    try {
      const settings = importLegacyFolderRules((await importFolderTagNote(vault)).content);
      setEnabled(false); setPruneAncestors(settings.pruneAncestors);
      setRules(settings.rules.map(rule => ({ ...rule, text: rule.tags.join(', ') })));
      setMessage('旧规则已读入草稿，尚未保存；请检查目录、标签和自动补齐开关。原笔记未修改。');
    } catch (error) { setError(String(error)); } finally { setBusy(false); }
  }
  async function change(patch: Partial<TagPreferences>) {
    setBusy(true); setError('');
    try { await onChange(patch); } catch (error) { setError(String(error)); } finally { setBusy(false); }
  }
  return <section>
    <h2>标签</h2>
    <SettingGroup title="标签操作">
    <p>标签层级、计数和搜索复用 Vault 目录。批操作先预览，忽略大小写，保留非目标源文；合并需要明确确认。</p>
    <SettingRow name="批量标签操作"><input type="checkbox" aria-label="批量标签操作" checked={value.batchEnabled} disabled={busy} onChange={(e) => { void change({ batchEnabled: e.target.checked }); }} /></SettingRow>
    <SettingRow name="重命名、标签页和拖放"><input type="checkbox" aria-label="重命名、标签页和拖放" checked={value.wranglerEnabled} disabled={busy} onChange={(e) => { void change({ wranglerEnabled: e.target.checked }); }} /></SettingRow>
    </SettingGroup>
    <SettingGroup title="按文件夹自动补标签">
    <p>为指定目录配置固定标签。匹配的父目录和子目录规则会叠加；目录按完整路径段匹配。</p>
    <fieldset disabled={busy} style={{ border: 0, padding: 0 }}>
      <SettingRow name="自动补齐" desc="新建和保存 Markdown 笔记时补齐固定标签"><input type="checkbox" aria-label="自动补齐" checked={enabled} onChange={event => { setEnabled(event.target.checked); setMessage(''); }} /></SettingRow>
      <SettingRow name="移除重复的父标签" desc="例如保留 _资料/AI，移除 _资料"><input type="checkbox" aria-label="移除重复的父标签" checked={pruneAncestors} onChange={event => { setPruneAncestors(event.target.checked); setMessage(''); }} /></SettingRow>
      <datalist id="folder-tag-directories">{entries.filter(entry => entry.kind === 'folder').map(entry => <option key={entry.path} value={entry.path} />)}</datalist>
      {rules.map((rule, index) => <div key={index} className="setting-folder-rule">
        <input className="text-input" aria-label={`规则 ${index + 1} 文件夹`} list="folder-tag-directories" value={rule.folder} placeholder="Vault 相对目录；留空为根目录" onChange={event => updateRule(index, { folder: event.target.value })} />
        <input className="text-input" aria-label={`规则 ${index + 1} 固定标签`} value={rule.text} placeholder="标签，逗号分隔" onChange={event => updateRule(index, { text: event.target.value })} />
        <label><input type="checkbox" checked={rule.recursive} onChange={event => updateRule(index, { recursive: event.target.checked })} />含子目录</label>
        <button className="btn secondary" onClick={() => { setRules(current => current.filter((_, i) => i !== index)); setMessage(''); }}>删除</button>
      </div>)}
      <div className="setting-actions">
        <button className="btn secondary" onClick={() => { setRules(current => [...current, { folder: '', tags: [], text: '', recursive: true }]); setMessage(''); }}>添加规则</button>
        <button className="btn secondary" onClick={() => { void importRules(); }}>从旧配置笔记读入草稿</button>
        <button className="btn" onClick={() => { void saveRules(); }}>保存文件夹规则</button>
        <button className="btn secondary" disabled={!value.folderTags?.rules.length} onClick={() => {
          useStore.getState().setSettings(false);
          openTagOperation({ scope: { kind: 'vault' }, operation: { kind: 'folder-rules' }, title: '按文件夹规则补标签' });
        }}>预览补齐已有笔记</button>
      </div>
    </fieldset>
    </SettingGroup>
    <p style={{ color: 'var(--text-muted)' }}>预览使用已保存规则。保存规则本身不批量改笔记；移出目录不删除旧标签。自动处理不覆盖其他属性或正文，复杂 YAML 会保留源文并提示。</p>
    {message && <p role="status">{message}</p>}
    {value.migration && <p style={{ color: 'var(--text-muted)' }}>{value.migration}</p>}
    {error && <p role="alert">{error}</p>}
    <p>原 Obsidian Plus 配置保留；只由原生模块接管 multiTag / tagWrangler，其他 Plus 模块继续独立运行。</p>
  </section>;
}
