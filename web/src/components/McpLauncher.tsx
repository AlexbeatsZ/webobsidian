import { useEffect, useRef, useState } from 'react';
import type { McpLauncherAction, McpLauncherState } from '../../../desktop/src/mcpLauncher';

export default function McpLauncher() {
  const desktop = window.webobsidianDesktop;
  const bridge = desktop?.platform === 'win32' ? desktop.mcp : undefined;
  const [state, setState] = useState<McpLauncherState>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('未检查连接');
  const pending = useRef(false);
  useEffect(() => {
    if (!bridge) return;
    let mounted = true;
    void bridge.inspect().then(result => { if (mounted) setState(result); }, reason => { if (mounted) setError(String(reason)); });
    return () => { mounted = false; };
  }, [bridge]);
  if (!bridge) return null;
  const perform = async (action?: McpLauncherAction) => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true); setError('');
    try {
      const result = action ? await bridge.run(action) : await bridge.selectProject();
      if (result) {
        setState(result);
        setMessage(action ? result.ok ? action === 'Status' ? '状态检查完成' : action === 'Restart' ? '重新连接完成' : '启动完成' : '操作失败' : '未检查连接');
      }
    } catch (reason) { setError(String(reason)); setMessage('操作失败'); }
    finally { pending.current = false; setBusy(false); }
  };
  return <div className="mcp-launcher" aria-label="MCP 连接" aria-busy={busy}>
    <div className="mcp-context-head"><strong>连接</strong><span role="status">{busy ? '正在处理…' : message}</span></div>
    <div className="mcp-launcher-actions">
      <button type="button" className="btn" disabled={busy || !state?.configured} onClick={() => void perform('Start')}>启动 MCP</button>
      <button type="button" className="btn secondary" disabled={busy || !state?.configured} onClick={() => void perform('Restart')}>重新连接</button>
      <button type="button" className="btn secondary" disabled={busy || !state?.configured} onClick={() => void perform('Status')}>检查状态</button>
      <button type="button" className="btn secondary" disabled={busy} title={state?.projectPath} onClick={() => void perform()}>选择项目</button>
    </div>
    {state && !state.configured && <div role="alert">未找到 MCP 项目，请选择项目目录。</div>}
    {error && <div role="alert">{error}</div>}
    {state?.output && <details open={state.ok === false}><summary>运行结果</summary><pre>{state.output}</pre></details>}
  </div>;
}
