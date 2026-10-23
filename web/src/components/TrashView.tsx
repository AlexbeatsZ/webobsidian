import { useCallback, useEffect, useState } from 'react';
import { useStore } from '../lib/store';
import { api, type TrashItem } from '../lib/api';
import Icon from './Icon';

/** Trash browser (FR-1): list items moved to `.trash`, restore them, or delete
 *  them permanently. Items land here when delete mode is "Move to trash". */
export default function TrashView() {
  const open = useStore((s) => s.trashOpen);
  const close = useStore((s) => s.setTrash);
  const notify = useStore((s) => s.notify);
  const loadTree = useStore((s) => s.loadTree);

  const [items, setItems] = useState<TrashItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => {
    setLoading(true);
    api
      .listTrash()
      .then((r) => setItems(r.items))
      .catch((e) => notify(e.message || "加载回收站失败"))
      .finally(() => setLoading(false));
  }, [notify]);

  useEffect(() => {
    if (open) refresh();
  }, [open, refresh]);

  if (!open) return null;

  const restore = async (it: TrashItem) => {
    if (busy) return;
    setBusy(true);
    try {
      const r = await api.restoreTrash(it.path);
      notify(`已恢复 ${r.restored}`);
      await loadTree();
      refresh();
    } catch (e: any) {
      notify(e.message || "恢复失败");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (it: TrashItem) => {
    if (busy) return;
    if (!confirm(`永久删除 "${it.name}"？此操作无法撤销。`)) return;
    setBusy(true);
    try {
      await api.deleteTrashItem(it.path);
      notify("已永久删除");
      refresh();
    } catch (e: any) {
      notify(e.message || "删除失败");
    } finally {
      setBusy(false);
    }
  };

  const empty = async () => {
    if (busy || items.length === 0) return;
    if (!confirm(`清空回收站？将永久删除 ${items.length} 项。`)) return;
    setBusy(true);
    try {
      await api.emptyTrash();
      notify("回收站已清空");
      refresh();
    } catch (e: any) {
      notify(e.message || "清空回收站失败");
    } finally {
      setBusy(false);
    }
  };

  const fmtSize = (n: number) => {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / 1024 / 1024).toFixed(1)} MB`;
  };
  const fmtDate = (ms: number) => {
    if (!ms) return '';
    const d = new Date(ms);
    return isNaN(d.getTime()) ? '' : d.toLocaleString();
  };

  return (
    <div className="modal-bg" onClick={() => close(false)}>
      <div className="modal trash-view" onClick={(e) => e.stopPropagation()}>
        <div className="vh-head">
          <Icon name="trash" size={16} />
          <div className="vh-title">回收站</div>
          <div className="vh-path">{items.length} 项</div>
          <button className="tool-btn" title="刷新" onClick={refresh}>
            <Icon name="refresh-cw" size={16} />
          </button>
          <button className="tool-btn" title="关闭" onClick={() => close(false)}>
            <Icon name="x" size={16} />
          </button>
        </div>
        <div className="trash-body">
          {loading && <div className="vh-empty">加载中…</div>}
          {!loading && items.length === 0 && (
            <div className="vh-empty">回收站为空。</div>
          )}
          {!loading &&
            items.map((it) => (
              <div className="trash-item" key={it.path} title={it.original}>
                <Icon name="file-text" size={14} />
                <div className="trash-item-info">
                  <div className="trash-item-name">{it.name}</div>
                  <div className="trash-item-meta">
                    {it.original}
                    {it.mtime ? ` · ${fmtDate(it.mtime)}` : ''}
                    {it.size ? ` · ${fmtSize(it.size)}` : ''}
                  </div>
                </div>
                <button
                  className="btn secondary trash-act"
                  title="恢复至原始位置"
                  disabled={busy}
                  onClick={() => restore(it)}
                >
                  恢复
                </button>
                <button
                  className="tool-btn trash-del"
                  title="永久删除"
                  disabled={busy}
                  onClick={() => remove(it)}
                >
                  <Icon name="trash" size={14} />
                </button>
              </div>
            ))}
        </div>
        <div className="vh-foot">
          <button className="btn secondary" onClick={() => close(false)}>
            关闭
          </button>
          <button className="btn danger" onClick={empty} disabled={busy || items.length === 0}>
            清空回收站
          </button>
        </div>
      </div>
    </div>
  );
}
