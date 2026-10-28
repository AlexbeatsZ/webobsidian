import type { EditorView } from '@codemirror/view';
import type { ReviewProposal } from '@webobsidian/markdown-core';
import { request } from '../api';
import { documents } from '../documents';
import { getActiveEditor } from '../activeEditor';
import { contextOf } from '../renderContext';
import { useStore } from '../store';
import type { McpSelection, McpContextItem } from '../../../../server/src/contracts';
export type { McpSelection, McpContextItem } from '../../../../server/src/contracts';

export type ReviewSummary = { id: string; path: string; title: string; pending: boolean; createdAt: string };
export type CapturedMcpTarget = { path: string; version?: number; selections: McpSelection[]; error?: string };
type ReviewState = { proposals: ReviewSummary[]; selected: ReviewProposal | null; panel: boolean; busy: boolean; error: string };
type McpContextState = { items: McpContextItem[]; busy: boolean; error: string };
let state: ReviewState = { proposals: [], selected: null, panel: false, busy: false, error: '' };
let contextState: McpContextState = { items: [], busy: false, error: '' };
let clientId = '', generation = 0, contextGeneration = 0, contextEpoch = 0;
let lastReading: { path: string; version: number; text: string } | null = null;
const listeners = new Set<() => void>();
const contextListeners = new Set<() => void>();
export const reviewSnapshot = () => state;
export const subscribeReview = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };
export const mcpContextSnapshot = () => contextState;
export const subscribeMcpContext = (fn: () => void) => { contextListeners.add(fn); return () => { contextListeners.delete(fn); }; };
function update(patch: Partial<ReviewState>) { state = { ...state, ...patch }; for (const fn of listeners) fn(); }
function updateContext(patch: Partial<McpContextState>) { contextState = { ...contextState, ...patch }; for (const fn of contextListeners) fn(); }
export function showReviews() { update({ panel: true }); void reloadReviews().catch(report); }
export function hideReviews() { update({ panel: false }); }
function report(error: unknown) { update({ error: String(error) }); }
function reportContext(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  updateContext({ error: message });
  useStore.getState().notify(message);
}

export async function reloadReviews(): Promise<void> {
  const captured = ++generation;
  const result = await request<{ proposals: ReviewSummary[] }>('/api/operations/reviews');
  const selected = state.selected ? await request<ReviewProposal>('/api/operations/reviews/' + state.selected.id) : null;
  if (captured === generation && !useStore.getState().vaultSessionStale) update({ proposals: result.proposals, selected });
}
export async function reloadMcpContext(): Promise<void> {
  const captured = ++contextGeneration;
  const result = await request<{ items: McpContextItem[] }>('/api/operations/context');
  if (captured === contextGeneration && !useStore.getState().vaultSessionStale) updateContext({ items: result.items, error: '' });
}
export function captureMcpContextTarget(explicitView?: EditorView | null, explicitPath?: string): CapturedMcpTarget {
  const workspace = useStore.getState(), view = explicitView ?? getActiveEditor();
  const path = explicitPath ?? (view ? contextOf(view).sourcePath : workspace.activePath) ?? '';
  const session = path ? documents.get(path) : undefined;
  const fullView = view && session && contextOf(view).sourcePath === path && !contextOf(view).sourceFragment
    && view.state.doc.toString() === session.snapshot.text ? view : null;
  const position = (offset: number) => {
    const line = fullView!.state.doc.lineAt(offset);
    return { line: line.number, ch: offset - line.from };
  };
  let readingText = lastReading?.path === path && lastReading.version === session?.snapshot.version ? lastReading.text : '';
  if (!readingText && view?.state.readOnly) {
    const domSelection = document.getSelection();
    if (domSelection && !domSelection.isCollapsed && (!domSelection.anchorNode || view.dom.contains(domSelection.anchorNode))) {
      readingText = domSelection.toString();
    }
  }
  const selections: McpSelection[] = fullView && !fullView.state.readOnly
    ? fullView.state.selection.ranges.filter(r => !r.empty).map(r => ({
        kind: 'source' as const,
        text: fullView.state.sliceDoc(r.from, r.to),
        from: position(r.from),
        to: position(r.to),
      }))
    : readingText
      ? [{ kind: 'rendered' as const, text: readingText }]
      : [];
  const error = view && contextOf(view).sourceFragment && !view.state.selection.main.empty
    ? '请在原笔记中添加选区，嵌入片段没有整篇源码坐标'
    : selections.length > 20 || selections.some(selection => selection.text.length > 16384)
      ? '选区过大，请减少到 20 处以内，每处不超过 16384 字符' : undefined;
  return { path, version: session?.snapshot.version, selections, error };
}
async function mutateContext(work: () => Promise<unknown>) {
  if (contextState.busy || useStore.getState().vaultSessionStale) return;
  const epoch = contextEpoch;
  ++contextGeneration;
  updateContext({ busy: true, error: '' });
  try { await work(); if (epoch === contextEpoch && !useStore.getState().vaultSessionStale) await reloadMcpContext(); }
  catch (error) { if (epoch === contextEpoch && !useStore.getState().vaultSessionStale) reportContext(error); }
  finally { if (epoch === contextEpoch && !useStore.getState().vaultSessionStale) updateContext({ busy: false }); }
}
export async function queueMcpContext(target = captureMcpContextTarget()): Promise<void> {
  if (target.error) { reportContext(target.error); return; }
  if (!target.path || target.path === '__graph__') { reportContext('当前没有可添加的聚焦页面'); return; }
  if (!clientId) { reportContext('工作区连接尚未就绪，请稍后重试'); return; }
  await mutateContext(async () => {
    await request('/api/operations/context', {
      method: 'POST',
      body: JSON.stringify({ clientId, path: target.path, version: target.version, selections: target.selections }),
    });
    useStore.getState().notify(target.selections.length ? '已添加选中内容到 MCP 上下文' : '已添加当前页面到 MCP 上下文');
  });
}
export async function addCurrentMcpContext(): Promise<void> {
  try { await queueMcpContext(captureMcpContextTarget()); } catch (error) { reportContext(error); }
}
export async function pinMcpContext(id: string, pinned: boolean): Promise<void> {
  await mutateContext(async () => {
    await request('/api/operations/context/' + id, {
      method: 'PATCH',
      body: JSON.stringify({ pinned }),
    });
  });
}
export async function removeMcpContext(id: string): Promise<void> {
  await mutateContext(() => request('/api/operations/context/' + id, { method: 'DELETE' }));
}
export async function selectReview(id: string): Promise<void> {
  if (state.busy) return;
  const captured = ++generation;
  const selected = await request<ReviewProposal>('/api/operations/reviews/' + id);
  if (captured !== generation || useStore.getState().vaultSessionStale) return;
  await useStore.getState().openFile(selected.path);
  if (captured === generation) update({ selected, panel: false, error: '' });
}
export async function decideReview(decision: 'accepted' | 'rejected', hunkId?: string, recover = false): Promise<void> {
  const p = state.selected;
  if (!p || state.busy || !clientId) return;
  update({ busy: true, error: '' });
  try {
    await request('/api/operations/reviews/' + p.id + '/decide', { method: 'POST',
      body: JSON.stringify({ clientId, decision, hunkId, recover }) });
  } catch (error) { report(error); }
  finally { update({ busy: false }); await reloadReviews().catch(report); }
}

/** Context is serialized only when requested. Focus/selection remain view-local. */
export function bindOperationWorkspace(socket: WebSocket): () => void {
  let interactedAt = Date.now();
  const interact = () => { if (document.hasFocus()) interactedAt = Date.now(); };
  const readingSelection = () => {
    if (!document.hasFocus()) return;
    const view = getActiveEditor();
    if (!view?.state.readOnly) { lastReading = null; return; }
    const path = contextOf(view).sourcePath, selection = document.getSelection();
    if (!selection || selection.isCollapsed) { lastReading = null; return; }
    if (selection.anchorNode && !view.dom.contains(selection.anchorNode)) return;
    lastReading = { path, version: documents.get(path)?.snapshot.version ?? -1,
      text: selection.toString() };
  };
  const receive = async (event: MessageEvent) => {
    let msg: any;
    try { msg = JSON.parse(String(event.data)); } catch { return; }
    if (msg.type === 'operations-client') {
      clientId = msg.clientId;
      void reloadReviews().catch(report);
      void reloadMcpContext().catch(reportContext);
      return;
    }
    if (msg.type === 'review-changed') { void reloadReviews().catch(report); return; }
    if (msg.type === 'mcp-context-changed') {
      if (!useStore.getState().vaultSessionStale) void reloadMcpContext().catch(reportContext);
      return;
    }
    if (msg.type !== 'operations-request' || typeof msg.id !== 'string') return;
    try {
      const workspace = useStore.getState();
      if (workspace.vaultSessionStale) throw new Error('Vault 已切换，请重新加载工作区');
      let result: unknown;
      if (msg.kind === 'capture') {
        const active = getActiveEditor(), activePath = active ? contextOf(active).sourcePath : workspace.activePath;
        const view = active && !contextOf(active).sourceFragment && active.state.doc.toString() === documents.get(activePath!)?.snapshot.text ? active : null;
        const target = msg.args?.path ?? activePath, session = target ? documents.get(target) : undefined;
        const snapshot = session?.snapshot;
        const position = (offset: number) => { const line = view!.state.doc.lineAt(offset); return { line: line.number, ch: offset - line.from }; };
        const captured = captureMcpContextTarget(view, activePath ?? undefined);
        result = { stale: false, activePath, interactedAt, mode: view?.state.readOnly ? 'reading' : 'source',
          cursor: view && !view.state.readOnly ? position(view.state.selection.main.head) : null, selections: captured.selections,
          open: workspace.tabs.map(t => t.path).slice(0, 100), recent: workspace.recent.slice(0, 30),
          document: snapshot ? { path: snapshot.id, raw: snapshot.raw, revision: snapshot.revision, version: snapshot.version,
            dirty: snapshot.dirty, saving: snapshot.saving || !!snapshot.locked, conflict: snapshot.conflict } : null };
        if (snapshot && snapshot.raw.length > 1024 * 1024) throw new Error('工作区文档超过 1 Mi 字符上限');
      } else if (msg.kind === 'apply') {
        const expected = msg.args?.expected, raw = msg.args?.raw;
        if (!expected || typeof raw !== 'string' || raw.length > 1024 * 1024) throw new Error('无效审阅写入');
        const { readNativeFeatures } = await import('../nativeFeaturePreferences');
        await readNativeFeatures();
        if (useStore.getState().vaultSessionStale) throw new Error('Vault 已切换');
        const session = documents.get(expected.path);
        const snapshot = session?.snapshot;
        if (!session || !snapshot || snapshot.raw !== expected.raw || snapshot.version !== expected.version ||
            snapshot.revision !== expected.revision || snapshot.saving || snapshot.conflict || snapshot.locked) throw new Error('文档已改变，保留当前草稿并停止接受');
        // No view reset: setRawText uses the original changesBetween/SourceDocument.
        session.setRawText(raw, 'review.accept');
        await session.save(raw);
        result = { saved: true };
      } else throw new Error('不支持的工作区操作');
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'operations-response', id: msg.id, result }));
    } catch (error) {
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'operations-response', id: msg.id, error: String(error) }));
    }
  };
  const reset = () => {
    ++contextEpoch;
    clientId = '';
    lastReading = null;
    ++generation;
    ++contextGeneration;
    update({ selected: null, proposals: [], panel: false });
    updateContext({ items: [], busy: false, error: '' });
  };
  socket.addEventListener('message', receive);
  socket.addEventListener('close', reset);
  window.addEventListener('pointerdown', interact, true);
  window.addEventListener('keydown', interact, true);
  document.addEventListener('selectionchange', readingSelection);
  window.addEventListener('vault-changed', reset);
  return () => {
    socket.removeEventListener('message', receive); socket.removeEventListener('close', reset);
    window.removeEventListener('pointerdown', interact, true); window.removeEventListener('keydown', interact, true);
    document.removeEventListener('selectionchange', readingSelection); window.removeEventListener('vault-changed', reset); reset();
  };
}
