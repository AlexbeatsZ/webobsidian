import { useEffect, useRef, useState } from 'react';
import { OPEN_ATTACHMENT_CLEANUP } from '../lib/attachments/commands';
import type { CleanupDialogHost, CleanupOptions, CleanupPreview, CleanupResult } from '../lib/attachments/types';
import './AttachmentCleanupDialog.css';

const bytes = (n: number) => n < 1024 ? `${n} B` : n < 1024 ** 2 ? `${(n / 1024).toFixed(1)} KiB` : n < 1024 ** 3 ? `${(n / 1024 ** 2).toFixed(1)} MiB` : `${(n / 1024 ** 3).toFixed(2)} GiB`;

/** Mount once beneath the workspace. Safety state stays in the existing session host. */
export default function AttachmentCleanupDialog({ host }: { host: CleanupDialogHost }) {
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false);
  const [optionsReady, setOptionsReady] = useState(!host.loadOptions), [optionsSaved, setOptionsSaved] = useState(false);
  const [error, setError] = useState(''), [blockers, setBlockers] = useState<string[]>([]);
  const [preview, setPreview] = useState<CleanupPreview | null>(null);
  const [result, setResult] = useState<CleanupResult | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState(false), [stale, setStale] = useState(false);
  const [directories, setDirectories] = useState((host.initialOptions?.excludeDirectories ?? []).join('\n'));
  const [extensions, setExtensions] = useState((host.initialOptions?.excludeExtensions ?? []).join(', '));
  const sequence = useRef(0), active = useRef(true), panel = useRef<HTMLDivElement>(null);
  const busyRef = useRef(false), abort = useRef<AbortController | null>(null);
  const priorFocus = useRef<HTMLElement | null>(null);
  useEffect(() => {
    active.current = true;
    const show = async () => {
      if (busyRef.current) return;
      priorFocus.current = document.activeElement as HTMLElement | null; setOpen(true);
      setPreview(null); setResult(null); setSelected(new Set()); setError(''); setConfirming(false); setOptionsSaved(false);
      const readOptions = host.loadOptions;
      if (readOptions) {
        busyRef.current = true; setBusy(true); setOptionsReady(false);
        try {
          const current = await readOptions();
          if (!active.current) return;
          setDirectories(current.excludeDirectories.join('\n')); setExtensions(current.excludeExtensions.join(', '));
          setOptionsReady(true);
        } catch (error) { if (active.current) setError('无法读取已有排除设置，暂不能扫描：' + String(error)); }
        finally { busyRef.current = false; if (active.current) setBusy(false); }
      } else if (host.initialOptions) {
        setDirectories(host.initialOptions.excludeDirectories.join('\n')); setExtensions(host.initialOptions.excludeExtensions.join(', '));
      }
    };
    window.addEventListener(OPEN_ATTACHMENT_CLEANUP, show);
    return () => {
      active.current = false; sequence.current++; abort.current?.abort();
      window.removeEventListener(OPEN_ATTACHMENT_CLEANUP, show);
    };
  }, [host]);
  useEffect(() => {
    if (!open) return;
    setBlockers(host.getBlockers());
    panel.current?.focus();
    const unsubscribe = host.subscribeSafety(() => {
      setBlockers(host.getBlockers());
      // Once editing/writing begins, require an explicit fresh preview, even if it autosaves.
      setStale(true); setConfirming(false);
    });
    return unsubscribe;
  }, [open, host]);
  useEffect(() => {
    if (!preview || !open) return;
    const expire = () => { setStale(true); setConfirming(false); };
    const timer = window.setTimeout(expire, Math.max(0, preview.expiresAt - Date.now()));
    return () => window.clearTimeout(timer);
  }, [preview, open]);
  const close = () => {
    if (busyRef.current) return;
    sequence.current++; abort.current?.abort(); setOpen(false); setConfirming(false);
    priorFocus.current?.focus();
  };
  const options = (): CleanupOptions => ({
    excludeDirectories: directories.split(/\r?\n/).map((v) => v.trim()).filter(Boolean),
    excludeExtensions: extensions.split(/[,，\s]+/).map((v) => v.trim()).filter(Boolean),
  });
  const scan = async () => {
    const localBlockers = host.getBlockers(); setBlockers(localBlockers);
    if (localBlockers.length || busyRef.current || !optionsReady) return;
    const id = ++sequence.current;
    busyRef.current = true; setBusy(true); setPreview(null); setResult(null); setError(''); setConfirming(false);
    setSelected(new Set()); setStale(false);
    const controller = new AbortController(); abort.current = controller;
    try {
      const exclusions = options();
      const value = await host.request<CleanupPreview>('/api/attachments/scan', {
        method: 'POST', body: JSON.stringify(exclusions), signal: controller.signal,
      });
      if (!active.current || id !== sequence.current) return;
      setPreview(value); setDirectories(value.options.excludeDirectories.join('\n'));
      setExtensions(value.options.excludeExtensions.join(', '));
    } catch (e) { if (active.current && id === sequence.current) setError(String(e)); }
    finally { busyRef.current = false; if (active.current && id === sequence.current) setBusy(false); }
  };
  const persistOptions = async () => {
    if (!host.saveOptions || busyRef.current || !optionsReady) return;
    busyRef.current = true; setBusy(true); setError(''); setOptionsSaved(false); setStale(true); setConfirming(false);
    try { await host.saveOptions(options()); if (active.current) setOptionsSaved(true); }
    catch (error) { if (active.current) setError('保存排除设置失败：' + String(error)); }
    finally { busyRef.current = false; if (active.current) setBusy(false); }
  };
  const execute = async () => {
    if (!preview || !confirming || busyRef.current || stale || !preview.canExecute || !selected.size) return;
    const localBlockers = host.getBlockers(); setBlockers(localBlockers);
    if (localBlockers.length || Date.now() >= preview.expiresAt) { setStale(true); setConfirming(false); return; }
    const id = ++sequence.current;
    busyRef.current = true; setBusy(true); setError('');
    try {
      const value = await host.request<CleanupResult>('/api/attachments/execute', {
        method: 'POST', body: JSON.stringify({ token: preview.token, paths: [...selected], confirm: true }),
      });
      if (!active.current || id !== sequence.current) return;
      setResult(value); setPreview(null); setSelected(new Set()); setConfirming(false);
      try { await host.refreshFiles(); }
      catch { setError('清理结果已返回，但文件列表刷新失败；请重新打开文件列表。'); }
    } catch (e) {
      if (active.current && id === sequence.current) {
        setError(String(e) + '。若网络中断，请先查看回收站与文件列表确认结果，再重新扫描。');
        setStale(true); setConfirming(false);
      }
    } finally { busyRef.current = false; if (active.current && id === sequence.current) setBusy(false); }
  };
  if (!open) return null;
  const selectedBytes = preview?.candidates.reduce((n, item) => n + (selected.has(item.path) ? item.size : 0), 0) ?? 0;
  const editable = !busy && !confirming;
  const canChoose = !!preview?.canExecute && !busy && !stale && !blockers.length;
  const invalidate = () => { setStale(true); setConfirming(false); setOptionsSaved(false); };
  return (
    <div className="modal-bg attachment-cleanup-bg" onClick={close}>
      <div ref={panel} tabIndex={-1} className="modal attachment-cleanup" role="dialog" aria-modal="true" aria-labelledby="attachment-cleanup-title"
        onClick={(e) => e.stopPropagation()} onKeyDown={(e) => {
          if (e.key === 'Escape') { e.stopPropagation(); close(); }
          if (e.key === 'Tab') {
            const items = panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), [tabindex="0"]');
            if (!items?.length) { e.preventDefault(); return; }
            const first = items[0], last = items[items.length - 1];
            if (e.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) { e.preventDefault(); last.focus(); }
            else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
          }
        }}>
        <h2 id="attachment-cleanup-title">清理没有被引用的附件</h2>
        <p>先扫描并选择附件，再确认移入 Vault 回收站。扫描会检查当前文档、Canvas 和配置中的引用。</p>
        <div className="attachment-cleanup-options">
          <label>排除目录（Vault 相对路径，每行一个）
            <textarea className="text-input" rows={3} value={directories} disabled={!editable} onChange={(e) => { setDirectories(e.target.value); invalidate(); }} />
          </label>
          <label>排除类型（扩展名，以逗号或空格分隔）
            <input className="text-input" value={extensions} disabled={!editable} onChange={(e) => { setExtensions(e.target.value); invalidate(); }} />
          </label>
        </div>
        {host.saveOptions && <button className="btn secondary" disabled={busy || !optionsReady} onClick={persistOptions}>保存排除设置</button>}
        {optionsSaved && <p role="status">排除设置已保存。</p>}
        <p className="attachment-cleanup-hint">排除只影响候选附件；被排除目录中的文档仍参与引用检查。未知格式和插件数据始终受保护。</p>
        {!!blockers.length && <div role="alert" className="attachment-cleanup-warning">请先处理所有未保存文档、冲突和待写入任务：<ul>{blockers.map((b, i) => <li key={i}>{b}</li>)}</ul></div>}
        {error && <p role="alert" className="attachment-cleanup-warning">{error}</p>}
        {stale && preview && <p role="status">预览状态已变化或已过期，请重新扫描。</p>}
        {preview && <>
          <p role="status">检查了 {preview.scannedSources} 个引用源；候选 {preview.candidates.length} 个，共 {bytes(preview.totalBytes)}；受保护 {preview.protected.length} 项。</p>
          {!preview.canExecute && <p className="attachment-cleanup-warning">引用检查不完整。本轮所有候选均受保护，不能执行清理。</p>}
          <div className="attachment-cleanup-selection">
            <label><input type="checkbox" disabled={!canChoose} checked={preview.candidates.length > 0 && selected.size === preview.candidates.length}
              onChange={(e) => setSelected(e.target.checked ? new Set(preview.candidates.map((c) => c.path)) : new Set())} /> 全选</label>
            <span>已选 {selected.size} 个，{bytes(selectedBytes)}</span>
          </div>
          <ul className="attachment-cleanup-list">{preview.candidates.map((item) => <li key={item.path}>
            <label><input type="checkbox" disabled={!canChoose} checked={selected.has(item.path)} onChange={(e) => {
              setSelected((previous) => { const next = new Set(previous); if (e.target.checked) next.add(item.path); else next.delete(item.path); return next; });
            }} /><span>{item.path}</span><small>{bytes(item.size)}</small></label>
          </li>)}</ul>
          {!!preview.issues.length && <details><summary>引用检查信息（{preview.issues.length}）</summary><ul className="attachment-cleanup-list">
            {preview.issues.map((issue, i) => <li key={i}><b>{issue.blocking ? '阻止执行' : '提示'}</b> {issue.path}：{issue.message}</li>)}
          </ul></details>}
          {!!preview.protected.length && <details><summary>受保护项（{preview.protected.length}）</summary><ul className="attachment-cleanup-list">
            {preview.protected.map((item, i) => <li key={i}>{item.path}：{item.reason}</li>)}
          </ul></details>}
        </>}
        {confirming && <div className="attachment-cleanup-warning" role="alert">
          确认将已选 {selected.size} 个附件（{bytes(selectedBytes)}）移入回收站？执行前会重新检查全部引用；文件或文档状态变化时停止。
          <div className="attachment-cleanup-actions"><button className="btn danger" disabled={busy || !canChoose} onClick={execute}>确认移入回收站</button>
            <button className="btn secondary" disabled={busy} onClick={() => setConfirming(false)}>返回选择</button></div>
        </div>}
        {result && <div role="status"><p>已移动 {result.moved.length} 个；失败 {result.failed.length} 个。{result.stopped}</p>
          <ul className="attachment-cleanup-list">{result.moved.map((item) => <li key={item.path}>{item.path} → {item.trashPath}</li>)}
            {result.failed.map((item) => <li key={item.path}>{item.path}：{item.message}</li>)}</ul>
          <p>打开回收站，找到上方路径并选择 Restore / 恢复；同名文件由现有恢复流程处理。</p>
        </div>}
        <div className="attachment-cleanup-actions">
          <button className="btn secondary" disabled={busy || !!blockers.length || !optionsReady} onClick={scan}>{busy ? '正在处理…' : '扫描附件'}</button>
          {!confirming && <button className="btn danger" disabled={!canChoose || !selected.size} onClick={() => setConfirming(true)}>移入回收站…</button>}
          <button className="btn secondary" disabled={busy} onClick={() => { close(); host.openTrash(); }}>查看回收站</button>
          <button className="btn secondary" disabled={busy} onClick={close}>关闭</button>
        </div>
      </div>
    </div>
  );
}
