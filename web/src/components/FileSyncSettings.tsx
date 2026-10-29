import { useEffect, useState } from 'react';
import { request } from '../lib/api';
import { SettingGroup, SettingRow } from './SettingRow';
import type { FileSyncPreferences, FileSyncStatus } from '../../../server/src/contracts/fileSync';
import { defaultPort } from '../../../sync-server/protocol.mjs';

type Connection = { preferences: FileSyncPreferences; status: FileSyncStatus };
const phases: Record<FileSyncStatus['phase'], string> = {
  disabled: '未启用', idle: '就绪', syncing: '同步中', error: '连接失败', conflict: '等待处理冲突', recovery: '等待恢复',
};

export default function FileSyncSettings() {
  const [connection, setConnection] = useState<Connection | null>(null);
  const [addresses, setAddresses] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    void request<Connection>('/api/file-sync').then(value => {
      if (active) { setConnection(value); setAddresses(value.preferences.endpoints.join('\n')); }
    }).catch(failure => { if (active) setError(failure.message); });
    return () => { active = false; };
  }, []);
  const update = (patch: Partial<FileSyncPreferences>) => setConnection(value => value && ({ ...value, preferences: { ...value.preferences, ...patch } }));
  const action = async (kind: 'save' | 'run' | 'refresh' | 'local' | 'remote' | 'recheck') => {
    if (!connection) return;
    setBusy(true); setError('');
    try {
      if (kind === 'save') await request('/api/file-sync', { method: 'PUT', body: JSON.stringify({ ...connection.preferences,
        endpoints: addresses.split(/\r?\n/).map(value => value.trim()).filter(Boolean) }) });
      else if (kind !== 'refresh') await request(`/api/file-sync/${kind === 'run' ? 'run' : 'resolve'}`, {
        method: 'POST', body: JSON.stringify(kind === 'run' ? {} : { choice: kind }),
      });
      const value = await request<Connection>('/api/file-sync');
      setConnection(value);
      if (kind === 'save') setAddresses(value.preferences.endpoints.join('\n'));
    } catch (failure) { setError((failure as Error).message); }
    finally { setBusy(false); }
  };
  const status = connection?.status;
  return <div>
    <h2>文件同步</h2>
    {error && <p role="alert">{error}</p>}
    {!connection ? <p role="status">{error ? '无法读取同步设置' : '正在读取…'}</p> : <>
      <fieldset disabled={busy} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
        <SettingGroup title="连接">
          <SettingRow name="启用文件同步"><input type="checkbox" checked={connection.preferences.enabled} onChange={event => update({ enabled: event.target.checked })} /></SettingRow>
          <SettingRow name="同步地址" desc="每行一个，严格按填写顺序尝试">
            <textarea className="text-input" rows={5} style={{ width: 300, maxWidth: '100%', resize: 'vertical' }} value={addresses}
              placeholder={`192.168.1.10:${defaultPort}\nhttps://example.com/webobsidian-sync/v1/`} onChange={event => setAddresses(event.target.value)} />
          </SettingRow>
          <SettingRow name="访问令牌"><input className="text-input" type="password" autoComplete="new-password" value={connection.preferences.token} onChange={event => update({ token: event.target.value })} /></SettingRow>
          <SettingRow name="检查间隔（秒）"><input className="text-input" type="number" min={5} max={3600} value={connection.preferences.intervalSec} onChange={event => update({ intervalSec: Number(event.target.value) })} /></SettingRow>
        </SettingGroup>
        <div className="setting-actions">
          <button className="btn" onClick={() => void action('save')}>保存</button>
          <button className="btn secondary" disabled={!status?.enabled} onClick={() => void action('run')}>立即同步</button>
          <button className="btn secondary" onClick={() => void action('refresh')}>刷新状态</button>
        </div>
        <SettingGroup title="状态">
          <SettingRow name="同步状态"><span role="status">{status && phases[status.phase]}{status?.message && ` · ${status.message}`}</span></SettingRow>
          {status?.activeEndpoint && <SettingRow name="当前地址"><span style={{ overflowWrap: 'anywhere' }}>{status.activeEndpoint}</span></SettingRow>}
          {status?.lastSuccess && <SettingRow name="上次完成"><time>{new Date(status.lastSuccess).toLocaleString()}</time></SettingRow>}
          {status?.conflictDirectory && <SettingRow name="保留的冲突文件"><span style={{ overflowWrap: 'anywhere' }}>{status.conflictDirectory}</span></SettingRow>}
          {!!status?.conflictBranches.length && <SettingRow name="冲突分支"><span style={{ overflowWrap: 'anywhere' }}>{status.conflictBranches.join('\n')}</span></SettingRow>}
        </SettingGroup>
        {status?.phase === 'conflict' && <div className="setting-actions">
          <button className="btn secondary" onClick={() => void action('local')}>采用本机版本</button>
          <button className="btn secondary" onClick={() => void action('remote')}>采用远端版本</button>
          <button className="btn secondary" onClick={() => void action('recheck')}>重新比较</button>
        </div>}
      </fieldset>
    </>}
  </div>;
}
