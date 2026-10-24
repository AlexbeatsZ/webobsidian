import { useEffect, useRef, useState } from 'react';
import { SourceDocument } from '@webobsidian/markdown-core';
import { documents } from '../lib/documents';
import { useStore } from '../lib/store';
import { tagsApi, assertTagVaultCurrent } from '../lib/tags/api';
import { closeTagDialog, useTagDialogRequest, useNativeTagHover, type TagOperationRequest, type TagDialogRequest } from '../lib/tags/actions';
import { inTagScope, validateCapturedTagChanges, validateTagOperation } from '@webobsidian/markdown-core';
import type { TagFilePreview, TagOperation, TagPreview } from '@webobsidian/markdown-core';
import './nativeTags.css';
import TagPageHover from './TagPageHover';

export default function TagOperationsHost() {
  const request = useTagDialogRequest();
  const hover = useNativeTagHover();
  return <>{request && (request.kind === 'operation' ? <TagOperationDialog key={JSON.stringify(request)} request={request.value} /> :
    <TagPageDialog key={JSON.stringify(request)} request={request} />)}{hover && <TagPageHover {...hover} />}</>;
}

function TagOperationDialog({ request }: { request: TagOperationRequest }) {
  const [kind, setKind] = useState<TagOperation['kind']>(request.operation?.kind ?? 'add');
  const [tags, setTags] = useState(request.operation && 'tags' in request.operation ? request.operation.tags.join(', ') : '');
  const [from, setFrom] = useState(request.operation?.kind === 'rename' ? request.operation.from : '');
  const [to, setTo] = useState(request.operation?.kind === 'rename' ? request.operation.to : '');
  const [descendants, setDescendants] = useState(request.operation && 'descendants' in request.operation ? request.operation.descendants !== false : true);
  const [preview, setPreview] = useState<TagPreview | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const [results, setResults] = useState<string[]>([]);
  const controller = useRef<AbortController | null>(null);
  const cancelled = useRef(false);
  const alive = useRef(true);
  const token = useRef<string | null>(null);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false; cancelled.current = true; controller.current?.abort();
      if (token.current) void tagsApi.cancel(token.current).catch(() => {});
    };
  }, []);
  const invalidate = () => {
    if (preview) void tagsApi.cancel(preview.id).catch(() => {});
    token.current = null; setPreview(null); setConfirmed(false); setResults([]); setProgress(''); setError('');
  };
  async function prepare() {
    invalidate(); setBusy(true); cancelled.current = false;
    const abort = new AbortController(); controller.current = abort;
    try {
      const inputTags = tags.split(/[,，\s]+/u).filter(Boolean);
      const operation = validateTagOperation(kind === 'folder-rules' ? { kind } : kind === 'rename' ? { kind, from, to, descendants } :
        kind === 'remove' ? { kind, tags: inputTags, descendants } : { kind, tags: inputTags });
      const snapshots = documents.snapshots().filter((s) => /\.(md|markdown)$/i.test(s.id));
      const state = useStore.getState();
      const visible = new Set([...state.tabs.map((tab) => tab.path), state.activePath, state.splitPath]);
      const blocked = snapshots.filter((s) => inTagScope(s.id, request.scope) && (s.conflict || s.saving));
      if (blocked.length) throw new Error('请先解决冲突或等待保存完成：' + blocked.map((s) => s.id).join(', '));
      const result = await tagsApi.preview({ operation, scope: request.scope,
        overlays: snapshots.filter((s) => s.dirty || visible.has(s.id)).map((s) => ({ path: s.id, raw: s.raw, revision: s.revision, version: s.version })) }, abort.signal);
      if (alive.current && !abort.signal.aborted) { token.current = result.id; setPreview(result); }
      else void tagsApi.cancel(result.id).catch(() => {});
    } catch (error) { if (!abort.signal.aborted && alive.current) setError(String(error)); }
    finally { if (alive.current) setBusy(false); }
  }
  async function applyLocal(file: TagFilePreview, id: string, merge: boolean) {
    const session = documents.get(file.path);
    if (!session) throw new Error('文档会话已关闭，请重新预览');
    const captured = session.snapshot;
    if ((file.local ? captured.version !== file.version : captured.dirty) || captured.revision !== file.revision || captured.saving || captured.conflict)
      throw new Error('文档在预览后已改变或正在保存，请重新预览');
    validateCapturedTagChanges(captured.text, file.changes, file.expected);
    await tagsApi.apply(id, file.path, merge, true);
    if (cancelled.current) return false;
    assertTagVaultCurrent();
    if (session.snapshot !== captured) throw new Error('等待确认时文档状态已改变，请重新预览');
    // Validate the complete captured source again before one shared-history edit.
    validateCapturedTagChanges(new SourceDocument(captured.raw).text, file.changes, file.expected);
    session.edit(captured.version, file.changes, 'tags.' + preview!.operation.kind);
    await session.save();
    return true;
  }
  async function apply() {
    if (!preview || (preview.collisions.length && !confirmed)) return;
    setBusy(true); setRunning(true); setError(''); cancelled.current = false;
    const report: string[] = [];
    let written = 0;
    try {
      const ready = preview.files.filter((file) => file.status === 'ready');
      for (let i = 0; i < ready.length; i++) {
        if (cancelled.current) break;
        const file = ready[i];
        if (alive.current) setProgress(`${i + 1} / ${ready.length} · ${file.path}`);
        try {
          if (file.local || documents.get(file.path)) {
            if (!await applyLocal(file, preview.id, confirmed)) break;
          } else {
            await tagsApi.apply(preview.id, file.path, confirmed);
          }
          written++; report.push(`已保存：${file.path}`);
        } catch (error) {
          const local = documents.get(file.path);
          report.push(`跳过：${file.path} — ${String(error)}${local?.snapshot.dirty ? '；未保存内容保留在编辑器，可撤销标签改动。' : ''}`);
        }
        if (alive.current) setResults([...report]);
      }
      if (alive.current) setProgress(`${cancelled.current ? '已停止' : '已完成'}：保存 ${written} 个文件。已保存的文件不会自动撤销。`);
    } finally {
      await tagsApi.cancel(preview.id).catch(() => {});
      token.current = null;
      if (alive.current) { setBusy(false); setRunning(false); setPreview(null); }
    }
  }
  function cancel() {
    cancelled.current = true; controller.current?.abort();
    if (token.current) void tagsApi.cancel(token.current).catch((error) => { if (alive.current) setError(String(error)); });
    if (!running) closeTagDialog();
    else setProgress('正在停止；当前已提交的文件保留，下一个文件不会开始。');
  }
  const ready = preview?.files.filter((file) => file.status === 'ready') ?? [];
  return <div className="modal-backdrop native-tags-backdrop" onKeyDown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); cancel(); } }}>
    <section className="native-tags-dialog" role="dialog" aria-modal="true" aria-label={request.title ?? '批量修改标签'}>
      <h2>{request.title ?? '批量修改标签'}</h2>
      <p className="native-tags-hint">范围：{request.scope.kind === 'vault' ? '整个 Vault' : request.scope.kind === 'folder' ? request.scope.path || '根目录及子目录' : `${request.scope.paths.length} 个所选文件`}。先预览，再逐个保存；打开文档包含当前未保存内容并保留撤销历史。</p>
      <fieldset disabled={busy} className="native-tags-fields">
        <label>操作<select value={kind} onChange={(e) => { invalidate(); setKind(e.target.value as TagOperation['kind']); }}>
          <option value="add">添加至 YAML 标签</option><option value="remove">删除标签</option><option value="rename">替换 / 重命名标签</option>
          <option value="folder-rules">按已保存的文件夹规则补标签</option>
        </select></label>
        {kind === 'folder-rules' ? <p>使用“设置 → 标签”中已保存的规则，叠加匹配路径的固定标签。预览会显示逐文件改动。</p> : kind === 'rename' ? <><label>原标签<input autoFocus value={from} onChange={(e) => { invalidate(); setFrom(e.target.value); }} placeholder="原标签" /></label>
          <label>新标签<input value={to} onChange={(e) => { invalidate(); setTo(e.target.value); }} placeholder="新标签 / 子标签" /></label></> :
          <label>标签<input autoFocus value={tags} onChange={(e) => { invalidate(); setTags(e.target.value); }} placeholder="物理, 化学/主题" /></label>}
        {(kind === 'remove' || kind === 'rename') && <label className="native-tags-check"><input type="checkbox" checked={descendants} onChange={(e) => { invalidate(); setDescendants(e.target.checked); }} />包含所有子标签（忽略大小写）</label>}
        {kind === 'remove' && <p className="native-tags-hint">删除匹配的 YAML 标签和正文标签。标签页笔记及其 aliases 声明会保留；通过 aliases 声明的标签仍会显示，可在对应标签页中编辑。</p>}
      </fieldset>
      {error && <p role="alert" className="native-tags-error">{error}</p>}
      {preview && <div className="native-tags-preview">
        <p>将修改 {ready.length} 个文件；不变 {preview.files.filter((f) => f.status === 'unchanged').length} 个；跳过 {preview.files.filter((f) => f.status === 'skipped').length} 个。</p>
        {preview.collisions.length > 0 && <div className="native-tags-merge"><strong>标签会合并</strong>
          <ul>{preview.collisions.map((c) => <li key={c.from + c.to}>#{c.from} → #{c.to}</li>)}</ul>
          <label className="native-tags-check"><input type="checkbox" checked={confirmed} disabled={busy} onChange={(e) => setConfirmed(e.target.checked)} />我已检查预览，确认合并这些标签。</label>
        </div>}
        <ul>{preview.files.map((file) => <li key={file.path}><strong>{file.path}</strong> · {file.status === 'ready' ? `${file.changes.length} 处${file.local ? ' · 文档会话' : ''}` : file.status === 'unchanged' ? '不变' : file.reason}
          {file.status === 'ready' && <details><summary>查看源文改动</summary>{file.changes.map((change, i) => <div key={i} className="native-tags-change"><del>{file.expected[i] || '∅'}</del><ins>{change.insert || '∅'}</ins></div>)}</details>}
        </li>)}</ul>
      </div>}
      {progress && <p role="status">{progress}</p>}
      {results.length > 0 && <ul className="native-tags-results">{results.map((result, i) => <li key={i}>{result}</li>)}</ul>}
      <div className="native-tags-actions"><button onClick={cancel}>{running ? '停止后续文件' : '关闭'}</button>
        <button disabled={busy} onClick={() => { void prepare(); }}>预览改动</button>
        {preview && <button className="mod-cta" disabled={busy || !ready.length || Boolean(preview.collisions.length && !confirmed)} onClick={() => { void apply(); }}>应用并保存 {ready.length} 个文件</button>}
      </div>
    </section>
  </div>;
}

function TagPageDialog({ request }: { request: Extract<TagDialogRequest, { kind: 'page' }> }) {
  const [path, setPath] = useState(request.suggestedPath);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function open(path: string) {
    assertTagVaultCurrent();
    const s = useStore.getState(); await (request.toSide ? s.openToSide(path) : s.openFile(path)); closeTagDialog();
  }
  async function create() {
    setBusy(true); setError('');
    try {
      if (!/\.(?:md|markdown)$/i.test(path) || path.startsWith('/') || path.includes('\\') || path.split('/').some((p) => !p || p === '.' || p === '..' || p.startsWith('.')))
        throw new Error('请输入 Vault 内的 Markdown 文件路径');
      await tagsApi.createPage(request.tag, path);
      await useStore.getState().loadTree();
      await open(path);
    } catch (error) { setError(String(error)); } finally { setBusy(false); }
  }
  return <div className="modal-backdrop native-tags-backdrop"><section role="dialog" aria-modal="true" aria-label="标签页" className="native-tags-dialog">
    <h2>#{request.tag} 的标签页</h2>
    {request.pages.length > 1 ? <><p>多个文件声明此标签别名，请选择：</p><ul>{request.pages.map((page) => <li key={page}><button disabled={busy} onClick={() => { void open(page).catch((e) => setError(String(e))); }}>{page}</button></li>)}</ul></> :
      <><p>创建一个带有此标签 alias 的笔记：</p><input aria-label="标签页文件路径" value={path} disabled={busy} onChange={(e) => setPath(e.target.value)} /><button disabled={busy} onClick={() => { void create(); }}>创建并打开</button></>}
    {error && <p role="alert" className="native-tags-error">{error}</p>}
    <div className="native-tags-actions"><button disabled={busy} onClick={closeTagDialog}>关闭</button></div>
  </section></div>;
}
