import { useState, useSyncExternalStore } from 'react';
import { api } from '../lib/api';
import { debugStatus, subscribeDebug, updateDebug, captureDebug, flushDebug, exportDebug } from '../lib/debug';
import { SettingGroup, SettingRow } from './SettingRow';

export default function DebugSettings() {
  const status = useSyncExternalStore(subscribeDebug, debugStatus);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const run = async (work: () => Promise<unknown>) => { setBusy(true); setError(''); try { await work(); } catch (error) { setError(String(error)); } finally { setBusy(false); } };
  return <div><h2>调试</h2>
    <SettingGroup title="编辑器记录">
      <SettingRow name="开启调试记录" desc="在本地记录输入、选区、公式源码切换和渲染异常。切换页面后保留，重新启动时继续记录。">
        <input type="checkbox" checked={status.enabled} disabled={busy} onChange={event => void run(() => updateDebug(event.target.checked, status.source))} />
      </SettingRow>
      <SettingRow name="包含笔记源码" desc="在新记录中包含笔记正文和输入文本，用于还原问题；导出文件也会包含这些内容。">
        <input type="checkbox" checked={status.source} disabled={busy} onChange={event => void run(() => updateDebug(status.enabled, event.target.checked))} />
      </SettingRow>
      <SettingRow name="记录当前现场" desc="出现异常时点击；记录各编辑器的源码、光标、渲染状态及可见元素位置。">
        <button className="btn secondary" disabled={busy || !status.enabled} onClick={() => void run(async () => { captureDebug(); await flushDebug(); })}>记录现场</button>
      </SettingRow>
    </SettingGroup>
    <SettingGroup title="日志">
      <SettingRow name="导出调试日志" desc="导出 JSONL 文件。日志自动轮换，最多占用 32 MiB；未写入的记录会随导出保留。">
        <button className="btn" disabled={busy} onClick={() => void run(exportDebug)}>导出日志</button>
      </SettingRow>
      <SettingRow name="清空调试日志" desc="删除本地已保存的调试记录。">
        <button className="btn secondary" disabled={busy || status.enabled} onClick={() => void run(() => api.clearDebug())}>清空日志</button>
      </SettingRow>
      <p role="status">{status.enabled ? '正在记录' : '记录已关闭'} · 本页已记录 {status.recorded} 条 · 待保存 {status.queued} 条{status.dropped ? ` · 缓冲区已丢弃 ${status.dropped} 条` : ''}</p>
    </SettingGroup>
    {(error || status.error) && <p role="alert">{error || status.error}</p>}
  </div>;
}
