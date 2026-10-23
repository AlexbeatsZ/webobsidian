import type { ReviewProposal } from '@webobsidian/markdown-core';
import { request } from '../api';
import { documents } from '../documents';
import { getActiveEditor } from '../activeEditor';
import { contextOf } from '../renderContext';
import { useStore } from '../store';

export type ReviewSummary = { id: string; path: string; title: string; pending: boolean; createdAt: string };
type ReviewState = { proposals: ReviewSummary[]; selected: ReviewProposal | null; panel: boolean; busy: boolean; error: string };
let state: ReviewState = { proposals: [], selected: null, panel: false, busy: false, error: '' };
let clientId = '', generation = 0;
const listeners = new Set<() => void>();
export const reviewSnapshot = () => state;
export const subscribeReview = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };
function update(patch: Partial<ReviewState>) { state = { ...state, ...patch }; for (const fn of listeners) fn(); }
export function showReviews() { update({ panel: true }); void reloadReviews().catch(report); }
export function hideReviews() { update({ panel: false }); }
function report(error: unknown) { update({ error: String(error) }); }

export async function reloadReviews(): Promise<void> {
  const captured = ++generation;
  const result = await request<{ proposals: ReviewSummary[] }>('/api/operations/reviews');
  const selected = state.selected ? await request<ReviewProposal>('/api/operations/reviews/' + state.selected.id) : null;
  if (captured === generation && !useStore.getState().vaultSessionStale) update({ proposals: result.proposals, selected });
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
  let reading: { path: string; version: number; text: string } | null = null;
  const interact = () => { if (document.hasFocus()) interactedAt = Date.now(); };
  const readingSelection = () => {
    if (!document.hasFocus()) return;
    const view = getActiveEditor();
    if (!view?.state.readOnly) { reading = null; return; }
    const path = contextOf(view).sourcePath, selection = document.getSelection();
    if (selection?.anchorNode && !view.dom.contains(selection.anchorNode)) return;
    reading = { path, version: documents.get(path)?.snapshot.version ?? -1,
      text: selection && !selection.isCollapsed ? selection.toString().slice(0, 16384) : '' };
  };
  const receive = async (event: MessageEvent) => {
    let msg: any;
    try { msg = JSON.parse(String(event.data)); } catch { return; }
    if (msg.type === 'operations-client') { clientId = msg.clientId; void reloadReviews().catch(report); return; }
    if (msg.type === 'review-changed') { void reloadReviews().catch(report); return; }
    if (msg.type !== 'operations-request' || typeof msg.id !== 'string') return;
    try {
      const workspace = useStore.getState();
      if (workspace.vaultSessionStale) throw new Error('Vault 已切换，请重新加载工作区');
      let result: unknown;
      if (msg.kind === 'capture') {
        const active = getActiveEditor(), activePath = active ? contextOf(active).sourcePath : workspace.activePath;
        // Embedded cells/fragments have view-local coordinates, not full-note offsets.
        const view = active && active.state.doc.toString() === documents.get(activePath!)?.snapshot.text ? active : null;
        const target = msg.args?.path ?? activePath, session = target ? documents.get(target) : undefined;
        const snapshot = session?.snapshot;
        const position = (offset: number) => { const line = view!.state.doc.lineAt(offset); return { line: line.number, ch: offset - line.from }; };
        const selections = view && !view.state.readOnly ? view.state.selection.ranges.filter(r => !r.empty).slice(0, 20).map(r => ({
          kind: 'source', text: view.state.sliceDoc(r.from, r.to).slice(0, 16384), from: position(r.from), to: position(r.to),
        })) : reading?.path === activePath && reading.version === documents.get(activePath!)?.snapshot.version && reading.text
          ? [{ kind: 'rendered', text: reading.text }] : [];
        result = { stale: false, activePath, interactedAt, mode: view?.state.readOnly ? 'reading' : 'source',
          cursor: view && !view.state.readOnly ? position(view.state.selection.main.head) : null, selections,
          open: workspace.tabs.map(t => t.path).slice(0, 100), recent: workspace.recent.slice(0, 30),
          document: snapshot ? { path: snapshot.id, raw: snapshot.raw, revision: snapshot.revision, version: snapshot.version,
            dirty: snapshot.dirty, saving: snapshot.saving, conflict: snapshot.conflict } : null };
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
            snapshot.revision !== expected.revision || snapshot.saving || snapshot.conflict) throw new Error('文档已改变，保留当前草稿并停止接受');
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
  const reset = () => { clientId = ''; ++generation; update({ selected: null, proposals: [], panel: false }); };
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
