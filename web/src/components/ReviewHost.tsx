import { useSyncExternalStore } from 'react';
import { reviewSnapshot, subscribeReview, hideReviews, selectReview, showReviews, showReviewList, decideReview } from '../lib/review/client';
import { useDialogEscape } from '../lib/useDialogEscape';
import '../styles/review.css';

export function ReviewToolbar({ path }: { path: string }) {
  const state = useSyncExternalStore(subscribeReview, reviewSnapshot), p = state.selected;
  if (!p || p.path !== path) return null;
  const pending = !p.restored && p.hunks.filter(h => h.decision === 'pending').length;
  return <div className="native-review-bar" role="region" aria-label="候选修改审阅">
    <button className="btn secondary" onClick={showReviews} disabled={state.busy}>{p.title}</button>
    <span>{p.restored ? '已撤销接受的修改' : `剩余 ${pending || 0} 块`}</span>
    {!!pending && <><button className="btn" disabled={state.busy} onClick={() => { void decideReview('accepted'); }}>接受剩余</button>
      <button className="btn secondary" disabled={state.busy} onClick={() => { void decideReview('rejected'); }}>拒绝剩余</button></>}
    {!!p.applied.length && !p.restored && <button className="btn secondary" disabled={state.busy} onClick={() => {
      if (confirm('撤销这个提案已接受的修改？后续改动到相同行时会停止恢复。')) void decideReview('accepted', undefined, true);
    }}>撤销已接受</button>}
    {(state.error || p.error) && <span role="alert">{state.error || p.error}</span>}
  </div>;
}

export default function ReviewHost() {
  const state = useSyncExternalStore(subscribeReview, reviewSnapshot);
  useDialogEscape(state.panel, () => { if (!state.busy) hideReviews(); });
  if (!state.panel) {
    const pending = state.proposals.filter(p => p.pending).length;
    return pending ? <button className="btn secondary native-review-inbox" onClick={showReviews}>待审阅修改 {pending}</button> : null;
  }
  const selected = state.selected, op = selected?.fileOperation;
  if (selected && op) return <div className="modal-bg" onClick={() => { if (!state.busy) hideReviews(); }}>
    <div className="modal native-review-list native-review-file" role="dialog" aria-modal="true" aria-label="笔记操作审阅" onClick={e => e.stopPropagation()}>
      <h2>{selected.title}</h2>
      <p>{op.kind === 'create' ? '新建笔记' : '重命名笔记'}</p>
      <p className="native-review-path">{selected.path}{op.kind === 'rename' && <> → {op.to}</>}</p>
      {op.kind === 'create' && <pre className="native-review-file-content">{op.content || '（空笔记）'}</pre>}
      {(state.error || selected.error) && <p role="alert">{state.error || selected.error}</p>}
      {op.applying ? <p role="status">操作结果待核对</p> : op.decision === 'pending' ? <div className="native-review-actions">
        <button className="btn" disabled={state.busy} onClick={() => { void decideReview('accepted'); }}>接受</button>
        <button className="btn secondary" disabled={state.busy} onClick={() => { void decideReview('rejected'); }}>拒绝</button>
      </div> : <p role="status">{op.decision === 'accepted' ? '已接受' : '已拒绝'}</p>}
      <div className="native-review-actions">
        <button className="btn secondary" disabled={state.busy} onClick={showReviewList}>返回列表</button>
        <button className="btn secondary" disabled={state.busy} onClick={hideReviews}>关闭</button>
      </div>
    </div>
  </div>;
  return <div className="modal-bg" onClick={hideReviews}><div className="modal native-review-list" role="dialog" aria-modal="true" aria-label="候选修改" onClick={e => e.stopPropagation()}>
    <h2>候选修改</h2>
    {state.error && <p role="alert">{state.error}</p>}
    {!state.proposals.length && <p>没有候选修改</p>}
    {state.proposals.map(p => <button className="btn secondary native-review-choice" key={p.id} onClick={() => {
      void selectReview(p.id).catch(error => alert(String(error)));
    }}><strong>{p.title}</strong><span>{p.kind === 'create' ? '新建 · ' : p.kind === 'rename' ? '重命名 · ' : ''}{p.path}{p.to ? ` → ${p.to}` : ''} · {p.pending ? '待审阅' : '已处理'}</span></button>)}
    <button className="btn secondary" onClick={hideReviews}>关闭</button>
  </div></div>;
}
