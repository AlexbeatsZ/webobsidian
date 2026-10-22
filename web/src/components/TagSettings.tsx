import { useState } from 'react';
import type { TagPreferences } from '../../../server/src/services/tags/types';

export interface TagSettingsProps { value: TagPreferences; onChange: (patch: Partial<TagPreferences>) => Promise<unknown> }
export default function TagSettings({ value, onChange }: TagSettingsProps) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function change(patch: Partial<TagPreferences>) {
    setBusy(true); setError('');
    try { await onChange(patch); } catch (error) { setError(String(error)); } finally { setBusy(false); }
  }
  return <section>
    <h3>原生标签</h3>
    <p>标签层级、计数和搜索复用 Vault 目录。批操作先预览，忽略大小写，保留非目标源文；合并需要明确确认。</p>
    <p><label><input type="checkbox" checked={value.batchEnabled} disabled={busy} onChange={(e) => { void change({ batchEnabled: e.target.checked }); }} />启用批量添加、移除和替换标签</label></p>
    <p><label><input type="checkbox" checked={value.wranglerEnabled} disabled={busy} onChange={(e) => { void change({ wranglerEnabled: e.target.checked }); }} />启用标签重命名、标签页和拖放</label></p>
    {value.migration && <p style={{ color: 'var(--text-muted)' }}>{value.migration}</p>}
    {error && <p role="alert">{error}</p>}
    <p>原 Obsidian Plus 配置保留；只由原生模块接管 multiTag / tagWrangler，其他 Plus 模块继续独立运行。</p>
  </section>;
}
