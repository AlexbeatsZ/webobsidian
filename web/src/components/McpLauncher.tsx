import { useEffect, useRef, useState } from 'react';
import type { McpLauncherState } from '../../../desktop/src/mcpLauncher';

export default function McpLauncher() {
  const desktop = window.webobsidianDesktop;
  const bridge = desktop?.mcp;
  const [state, setState] = useState<McpLauncherState>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('未检查连接');
  const [tunnelId, setTunnelId] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const pending = useRef(false);
  useEffect(() => {
    if (!bridge) return;
    let mounted = true;
    void bridge.inspect().then(result => {
      if (mounted) { setState(result); setTunnelId(result.tunnelId); setMessage(result.connected ? '已连接' : '未连接'); }
    }, reason => { if (mounted) setError(String(reason)); });
    return () => { mounted = false; };
  }, [bridge]);
  if (!bridge) return null;
  const perform = async (action: 'connect' | 'save' | 'copy') => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true); setError('');
    try {
      if (action === 'copy') { await bridge.copyConfig(); setMessage('配置已复制'); return; }
      const result = action === 'save' ? await bridge.configure({ tunnelId, apiKey: apiKey || undefined }) : await bridge.connect();
      if (result) {
        setState(result);
        setMessage(action === 'save' ? '设置已保存' : result.ok ? '连接完成' : '连接失败');
        if (action === 'save') { setApiKey(''); setSettingsOpen(false); }
        if (action === 'connect' && (!result.tunnelId || !result.hasKey)) setSettingsOpen(true);
      }
    } catch (reason) { setError(String(reason)); setMessage('操作失败'); }
    finally { pending.current = false; setBusy(false); }
  };
  return <div className="mcp-launcher" aria-label="MCP 连接" aria-busy={busy}>
    <div className="mcp-context-head"><strong>连接</strong><span role="status">{busy ? '正在处理…' : message}</span></div>
    <div className="mcp-launcher-actions">
      <button type="button" className="btn" disabled={busy || !state?.available} onClick={() => void perform('connect')}>连接</button>
      <button type="button" className="btn" disabled={busy || !state?.available} title="复制本机 MCP 客户端配置" onClick={() => void perform('copy')}>复制配置</button>
      <button type="button" className="btn" disabled={busy} aria-expanded={settingsOpen} onClick={() => setSettingsOpen(!settingsOpen)}>连接设置</button>
    </div>
    {settingsOpen && <form className="mcp-connection-settings" onSubmit={event => { event.preventDefault(); void perform('save'); }}>
      <label>Tunnel ID<input value={tunnelId} onChange={event => setTunnelId(event.target.value)} autoComplete="off" disabled={busy} /></label>
      <label>运行密钥<input type="password" value={apiKey} onChange={event => setApiKey(event.target.value)} placeholder={state?.hasKey ? '已保存；留空保留' : ''} autoComplete="new-password" disabled={busy} /></label>
      <button type="submit" className="btn" disabled={busy}>保存</button>
    </form>}
    {state && !state.available && <div role="alert">安装包缺少内置 MCP 组件，请重新安装 WebObsidian。</div>}
    {error && <div role="alert">{error}</div>}
    {state?.output && <details open={state.ok === false}><summary>运行结果</summary><pre>{state.output}</pre></details>}
  </div>;
}
