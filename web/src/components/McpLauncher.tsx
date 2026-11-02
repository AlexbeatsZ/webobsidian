import { useEffect, useRef, useState } from 'react';
import type { McpLauncherState } from '../../../desktop/src/mcpLauncher';
import { NoteLinkSection as Section } from './NoteLinks';

/** Connection is secondary to context and proposals: collapsed once connected, open with the fix when not. */
export default function McpLauncher() {
  const desktop = window.webobsidianDesktop;
  const bridge = desktop?.mcp;
  const [state, setState] = useState<McpLauncherState>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [tunnelId, setTunnelId] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [open, setOpen] = useState<boolean>();
  const pending = useRef(false);
  useEffect(() => {
    if (!bridge) return;
    let mounted = true;
    void bridge.inspect().then(result => {
      if (mounted) { setState(result); setTunnelId(result.tunnelId); }
    }, reason => { if (mounted) setError(String(reason)); });
    return () => { mounted = false; };
  }, [bridge]);
  if (!bridge) return null;
  const failed = Boolean(error) || state?.ok === false || (state !== undefined && !state.available);
  const connected = Boolean(state?.connected || state?.ok);
  const status = busy ? '正在处理…' : !state && !error ? '检查中…' : failed ? '连接失败' : connected ? '已连接' : '未连接';
  const expanded = open ?? (failed || (state !== undefined && !connected));
  const perform = async (action: 'connect' | 'save' | 'copy') => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true); setError(''); setMessage('');
    try {
      if (action === 'copy') { await bridge.copyConfig(); setMessage('配置已复制'); return; }
      const result = action === 'save' ? await bridge.configure({ tunnelId, apiKey: apiKey || undefined }) : await bridge.connect();
      if (result) {
        setState(result);
        if (action === 'save') { setApiKey(''); setSettingsOpen(false); setMessage('设置已保存'); }
        if (action === 'connect') {
          setSettingsOpen(!result.tunnelId || !result.hasKey);
          // Success folds the section away; a failure keeps the output and settings in view.
          setOpen(result.ok ? false : true);
        }
      }
    } catch (reason) { setError(String(reason)); setOpen(true); }
    finally { pending.current = false; setBusy(false); }
  };
  return <div className="mcp-connection" role="group" aria-label="MCP 连接" aria-busy={busy} data-state={failed ? 'failed' : connected ? 'connected' : 'idle'}>
    <Section title="连接" count={status} open={expanded} onToggle={() => setOpen(!expanded)}><div className="mcp-launcher">
      {state && !state.available && <div className="editor-error" role="alert">安装包缺少内置 MCP 组件，请重新安装 WebObsidian。</div>}
      {error && <div className="editor-error" role="alert">{error}</div>}
      <div className="mcp-launcher-actions">
        <button type="button" className="btn" disabled={busy || !state?.available} onClick={() => void perform('connect')}>{connected ? '重新连接' : '连接'}</button>
        <button type="button" className="btn secondary" disabled={busy || !state?.available} title="复制本机 MCP 客户端配置" onClick={() => void perform('copy')}>复制配置</button>
        <button type="button" className="btn secondary" disabled={busy} aria-expanded={settingsOpen} onClick={() => setSettingsOpen(!settingsOpen)}>连接设置</button>
      </div>
      {message && <span className="mcp-launcher-message" role="status">{message}</span>}
      {settingsOpen && <form className="mcp-connection-settings" onSubmit={event => { event.preventDefault(); void perform('save'); }}>
        <label>Tunnel ID<input className="text-input" value={tunnelId} onChange={event => setTunnelId(event.target.value)} autoComplete="off" disabled={busy} /></label>
        <label>运行密钥<input className="text-input" type="password" value={apiKey} onChange={event => setApiKey(event.target.value)} placeholder={state?.hasKey ? '已保存；留空保留' : ''} autoComplete="new-password" disabled={busy} /></label>
        <button type="submit" className="btn" disabled={busy}>保存</button>
      </form>}
      {state?.output && <details open={state.ok === false}><summary>运行结果</summary><pre>{state.output}</pre></details>}
    </div></Section>
  </div>;
}
