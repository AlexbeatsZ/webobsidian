import { useEffect, useState } from 'react';
import { useStore } from '../lib/store';
import { api, type GitCommit } from '../lib/api';
import Icon from './Icon';
import { useDialogEscape } from '../lib/useDialogEscape';

/** Git-backed version history for a single note (PRD FR-4 / FR-7). Lists the
 *  commits that touched the file and lets you preview/restore an older version. */
export default function VersionHistory() {
  const path = useStore((s) => s.versionHistoryPath);
  const close = useStore((s) => s.setVersionHistory);
  const notify = useStore((s) => s.notify);
  const openFile = useStore((s) => s.openFile);
  const activePath = useStore((s) => s.activePath);

  const [commits, setCommits] = useState<GitCommit[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [preview, setPreview] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!path) return;
    setLoading(true);
    setError('');
    setSelected(null);
    setPreview('');
    api
      .gitLog(path)
      .then((r) => {
        setCommits(r.commits);
        if (r.commits[0]) setSelected(r.commits[0].hash);
      })
      .catch((e) => setError(e.message || '加载历史失败'))
      .finally(() => setLoading(false));
  }, [path]);

  useEffect(() => {
    if (!path || !selected) return;
    api
      .gitShow(selected, path)
      .then((r) => setPreview(r.content))
      .catch(() => setPreview('（无法加载此版本）'));
  }, [path, selected]);

  useDialogEscape(!!path, () => close(null));
  if (!path) return null;

  const restore = async () => {
    if (!selected) return;
    if (!confirm("还原此版本？当前内容将被覆盖。")) return;
    try {
      await api.write(path, preview);
      if (path === activePath) await openFile(path);
      notify("已还原早期版本");
      close(null);
    } catch (e: any) {
      notify(e.message || "恢复失败");
    }
  };

  const fmtDate = (iso: string) => {
    const d = new Date(iso);
    return isNaN(d.getTime()) ? iso : d.toLocaleString();
  };

  return (
    <div className="modal-bg" onClick={() => close(null)}>
      <div className="modal version-history" role="dialog" aria-modal="true" aria-labelledby="version-history-title" onClick={(e) => e.stopPropagation()}>
        <div className="vh-head">
          <Icon name="clock" size={16} />
          <div className="vh-title" id="version-history-title">版本历史</div>
          <div className="vh-path">{path}</div>
          <button type="button" className="tool-btn" title="关闭" aria-label="关闭" onClick={() => close(null)}>
            <Icon name="x" size={16} />
          </button>
        </div>
        <div className="vh-body">
          <div className="vh-list">
            {loading && <div className="vh-empty" role="status">加载中…</div>}
            {error && <div className="vh-empty editor-error" role="alert">{error}</div>}
            {!loading && !error && commits.length === 0 && (
              <div className="vh-empty">暂无历史记录。启用 Git 备份后可跟踪版本。</div>
            )}
            {commits.map((c, i) => (
              <div
                key={c.hash}
                className={`vh-item ${selected === c.hash ? 'active' : ''}`}
                onClick={() => setSelected(c.hash)}
              >
                <div className="vh-item-msg">
                  {i === 0 && <span className="vh-latest">最新</span>}{c.message || "(无说明)"}
                </div>
                <div className="vh-item-meta">
                  {fmtDate(c.date)} · {c.author}
                </div>
              </div>
            ))}
          </div>
          <div className="vh-preview">
            <pre>{preview}</pre>
          </div>
        </div>
        <div className="vh-foot">
          <button className="btn secondary" onClick={() => close(null)}>
            关闭
          </button>
          <button className="btn" onClick={restore} disabled={!selected || commits.length === 0}>
            还原此版本
          </button>
        </div>
      </div>
    </div>
  );
}
