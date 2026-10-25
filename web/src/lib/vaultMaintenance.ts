import { documents } from './documents';
import { useStore } from './store';
import { pendingMutations } from './api';

export function workspaceMaintenanceBlockers(): string[] {
  const blockers: string[] = [];
  if (useStore.getState().vaultSessionStale) blockers.push('Vault 已切换，请重新加载应用后扫描');
  if (documents.snapshots().some(snapshot => snapshot.dirty || snapshot.conflict || snapshot.saving || snapshot.locked))
    blockers.push('有未保存或冲突的文档，请先保存');
  if (useStore.getState().dirty) blockers.push('当前文件有未保存内容');
  if (useStore.getState().pendingCanvasEdits) blockers.push('Canvas 卡片或连线仍在编辑');
  if (pendingMutations()) blockers.push('仍有写入请求未完成');
  if ((window as any).webobsidianDesktop?.nativePlugins)
    blockers.push('可信原生插件可直接写入文件，请关闭该模式并在下次启动后清理');
  return blockers;
}

/** Coordinate the existing document registry over the existing application socket. */
export function bindVaultMaintenance(socket: WebSocket): () => void {
  const stale = () => useStore.setState({ vaultSessionStale: true });
  window.addEventListener('vault-identity-invalidated', stale);
  let token: string | undefined;
  let originalInert = false;
  let banner: HTMLDivElement | undefined;
  const blockInput = (event: Event) => {
    if (token) { event.preventDefault(); event.stopImmediatePropagation(); }
  };
  const release = () => {
    if (!token) return;
    document.body.inert = originalInert;
    token = undefined;
    banner?.remove();
    banner = undefined;
  };
  const receive = async (event: MessageEvent) => {
    let msg: { type?: string; phase?: string; token?: string; check?: string };
    try { msg = JSON.parse(String(event.data)); } catch { return; }
    if (msg.type !== 'maintenance' || typeof msg.token !== 'string') return;
    if (msg.phase === 'release') { if (token === msg.token) release(); return; }
    if (!['prepare', 'inspect'].includes(msg.phase ?? '') || typeof msg.check !== 'string') return;
    if (msg.phase === 'inspect') {
      if (socket.readyState === WebSocket.OPEN)
        socket.send(JSON.stringify({ type: 'maintenance-ack', token: msg.token, check: msg.check,
          blockers: workspaceMaintenanceBlockers() }));
      return;
    }
    if (!token) {
      originalInert = document.body.inert;
      document.body.inert = true;
      token = msg.token;
      banner = document.createElement('div');
      banner.setAttribute('role', 'status');
      banner.textContent = '正在维护仓库，编辑已暂时暂停…';
      Object.assign(banner.style, { position: 'fixed', top: '42px', left: '50%', transform: 'translateX(-50%)',
        zIndex: '100000', padding: '12px 20px', background: 'var(--background-primary, white)',
        color: 'var(--text-normal, black)', border: '1px solid var(--background-modifier-border, #bbb)', borderRadius: '8px' });
      document.body.append(banner);
    }
    // Let the current React event and queued document transactions settle first.
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    if (token !== msg.token || socket.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify({ type: 'maintenance-ack', token, check: msg.check,
      blockers: workspaceMaintenanceBlockers() }));
  };
  socket.addEventListener('message', receive);
  socket.addEventListener('close', release);
  window.addEventListener('keydown', blockInput, true);
  window.addEventListener('beforeinput', blockInput, true);
  return () => {
    window.removeEventListener('vault-identity-invalidated', stale);
    socket.removeEventListener('message', receive); socket.removeEventListener('close', release);
    window.removeEventListener('keydown', blockInput, true); window.removeEventListener('beforeinput', blockInput, true);
    release();
  };
}
