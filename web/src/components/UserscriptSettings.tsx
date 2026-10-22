import { useEffect, useState } from 'react';
import { bootstrapUserscripts, refreshUserscripts, useUserscripts, userscriptRequest } from '../lib/userscripts/client';
import type { ScriptRecord, ScriptMenu } from '../lib/userscripts/types';

const editorStyle = { width: '100%', fontFamily: 'monospace', minHeight: 180 };
function permissions(script: ScriptRecord) {
  return `${script.metadata.grants.join(', ') || '(无 GM 权限，页面 world)'}\n@connect: ${script.metadata.connects.join(', ') || '(仅同源)'}\nURL: ${[...script.metadata.matches, ...script.metadata.includes].join(', ') || '(无匹配)'}\n排除: ${[...script.metadata.excludes, ...script.metadata.excludeMatches].join(', ') || '(无)'}`;
}
function ScriptCard({ script, run }: { script: ScriptRecord; run: (work: () => Promise<unknown>) => void }) {
  const [editing, setEditing] = useState(false), [source, setSource] = useState(script.source);
  const [values, setValues] = useState<string>(), [valuesChanged, setValuesChanged] = useState(false);
  const [keepValues, setKeepValues] = useState(true), [removing, setRemoving] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  const pending = script.update.pending;
  useEffect(() => { if (!editing) setSource(script.source); setReviewed(false); }, [script.revision]);
  const action = (name: string, extra: Record<string, unknown> = {}) => userscriptRequest(name, { id: script.id, revision: script.revision, ...extra });
  return <article style={{ borderTop: '1px solid var(--background-modifier-border)', paddingBlock: 16 }}>
    <h3>{script.metadata.name} <small>{script.metadata.version || '无版本号'}</small></h3>
    <p>{script.metadata.description}</p>
    <label><input type="checkbox" checked={script.enabled} onChange={e => run(() => action('configure', { enabled: e.target.checked }))} />启用（下次页面加载生效）</label>{' '}
    <label><input type="checkbox" checked={script.autoUpdate} onChange={e => run(() => action('configure', { autoUpdate: e.target.checked }))} />允许自动更新</label>
    <p role="status">更新：{script.update.state}{script.update.availableVersion && ` → ${script.update.availableVersion}`}{script.update.checkedAt && ` · ${new Date(script.update.checkedAt).toLocaleString()}`}</p>
    {script.update.error && <p role="alert">{script.update.error}；已保留原版本。</p>}
    <details><summary>匹配、权限与兼容提示</summary><pre style={{ whiteSpace: 'pre-wrap' }}>{permissions(script)}</pre>
      <p>执行时机：{script.metadata.runAt}；仅主文档。{script.sourceUrl && `导入来源：${script.sourceUrl}`}</p>
      {script.warnings.map(w => <p key={w}>{w}</p>)}
      <p>此脚本的 GM 存储由本机应用独立保存；使用页面 world 时，匹配网站也可访问该脚本的存储和授权能力。</p>
      <label><input type="checkbox" checked={reviewed} onChange={e => setReviewed(e.target.checked)} />我已检查当前源码、匹配范围及权限</label>{' '}
      <button disabled={!reviewed} onClick={() => run(async () => { await action('approve'); setReviewed(false); })}>批准当前版本权限</button>
    </details>
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
      <button onClick={() => { setSource(script.source); setEditing(!editing); }}>查看 / 编辑源码</button>
      <button onClick={() => run(() => action('check'))}>检查更新</button>
      <button onClick={() => run(() => action('update'))}>安装可用更新</button>
      <button onClick={() => run(async () => { setValues(JSON.stringify(await action('values'), null, 2)); setValuesChanged(false); })}>脚本存储 / 设置</button>
      <button onClick={() => setRemoving(!removing)}>卸载…</button>
    </div>
    {editing && <div><p>保存前会解析源码并准备全部 @require / @resource。脚本启用状态、授权和存储会保留；新增权限需重新批准。</p>
      <textarea aria-label={`${script.metadata.name} 源码`} spellCheck={false} value={source} onChange={e => setSource(e.target.value)} rows={18} style={editorStyle} />
      <button disabled={source === script.source} onClick={() => run(async () => { await action('save', { source }); setEditing(false); })}>保存源码</button>{' '}
      <button onClick={() => setEditing(false)}>取消</button>
    </div>}
    {pending && <details><summary>待更新版本 {pending.metadata.version}：检查源码与权限</summary>
      <pre style={{ whiteSpace: 'pre-wrap' }}>{permissions({ ...script, metadata: pending.metadata })}</pre>
      {pending.warnings.map(w => <p key={w}>{w}</p>)}
      <textarea aria-label="待更新源码" readOnly value={pending.source} rows={12} style={editorStyle} />
      <p>更新保留启用状态、GM 存储及自动更新选项。匹配范围或授权扩展需要批准。</p>
      <button onClick={() => run(() => action('approve', { pending: true, candidateId: script.update.candidateId }))}>批准并安装以上更新</button>
    </details>}
    {values !== undefined && <div><p>GM 持久存储（JSON 对象）；脚本自带界面也通过同一存储保存设置。</p>
      <textarea aria-label="GM 持久存储" spellCheck={false} value={values} onChange={e => { setValues(e.target.value); setValuesChanged(true); }} rows={10} style={editorStyle} />
      <button disabled={!valuesChanged} onClick={() => run(async () => { await action('set-values', { values: JSON.parse(values) }); setValuesChanged(false); })}>保存存储</button>{' '}
      <button onClick={() => setValues(undefined)}>关闭</button>
    </div>}
    {removing && <div><p>卸载后请重新加载已打开的匹配页面；脚本对页面的已有修改要在重新加载后清除。</p>
      <label><input type="checkbox" checked={keepValues} onChange={e => setKeepValues(e.target.checked)} />保留此脚本存储</label>{' '}
      <button onClick={() => run(() => action('remove', { keepValues }))}>确认卸载</button>{' '}<button onClick={() => setRemoving(false)}>取消</button>
    </div>}
  </article>;
}

export function UserscriptSettings() {
  const { snapshot, error, supported } = useUserscripts();
  const [busy, setBusy] = useState(false), [failure, setFailure] = useState(''), [source, setSource] = useState(''), [url, setUrl] = useState('');
  const [menus, setMenus] = useState<ScriptMenu[]>([]);
  useEffect(() => bootstrapUserscripts(), []);
  const run = (work: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true); setFailure('');
    void work().then(() => refreshUserscripts()).catch(e => setFailure(String(e))).finally(() => setBusy(false));
  };
  if (!supported) return <p>用户脚本需要原生桌面的内置浏览器。普通浏览器客户端不提供注入能力。</p>;
  return <section aria-label="内置浏览器用户脚本" aria-busy={busy}>
    <h2>内置浏览器 · 用户脚本</h2>
    <p>导入后脚本默认关闭。检查源码、匹配范围与权限后批准，再启用并重新加载目标页面。仅运行你信任的脚本。</p>
    {(failure || error) && <p role="alert">{failure || error}</p>}
    {busy && <p role="status">正在处理…</p>}
    <fieldset disabled={busy} style={{ border: 0, padding: 0 }}>
      <label>.user.js URL <input aria-label="用户脚本 URL" value={url} onChange={e => setUrl(e.target.value)} placeholder="https://…/script.user.js" style={{ width: '75%' }} /></label>{' '}
      <button disabled={!url.trim()} onClick={() => run(async () => { await userscriptRequest('import', { url: url.trim() }); setUrl(''); })}>从 URL 导入</button>
      <p><label>文件导入 <input type="file" accept=".js,.user.js,text/javascript" onChange={e => {
        const file = e.target.files?.[0]; if (file) run(async () => { if (file.size > 8 * 1024 * 1024) throw new Error('文件超过 8 MiB'); setSource(await file.text()); }); e.target.value = '';
      }} /></label></p>
      <details><summary>粘贴 / 检查导入源码</summary><textarea aria-label="导入源码" value={source} onChange={e => setSource(e.target.value)} rows={12} spellCheck={false} style={editorStyle} /></details>
      {source && <button onClick={() => run(async () => { await userscriptRequest('import', { source }); setSource(''); })}>导入以上源码（默认关闭）</button>}
      {snapshot && <>
        <p>{snapshot.migration}</p>
        <label><input type="checkbox" checked={snapshot.autoUpdate} onChange={e => run(() => userscriptRequest('settings', { autoUpdate: e.target.checked }))} />启用自动更新调度</label>{' '}
        <label>检查间隔（小时）<input aria-label="更新间隔" type="number" min={1} max={720} defaultValue={snapshot.intervalHours} onBlur={e => { const v = Number(e.target.value); if (v !== snapshot.intervalHours) run(() => userscriptRequest('settings', { intervalHours: v })); }} /></label>{' '}
        <button onClick={() => run(() => userscriptRequest('check'))}>检查全部更新</button>
        <p>更新失败保留旧版；新增权限或匹配范围等待批准。已经打开的页面继续当前代码，重载后使用新版本。</p>
        {!snapshot.scripts.length && <p>尚未安装脚本。</p>}
        {snapshot.scripts.map(script => <ScriptCard key={script.id} script={script} run={run} />)}
        <details><summary>页面执行状态</summary>
          {snapshot.statuses.map((s, i) => <p key={i}>{s.url} · {snapshot.scripts.find(script => script.id === s.scriptId)?.metadata.name || 'guest'} · {s.state}{s.message && `：${s.message}`}</p>)}
        </details>
      </>}
      <h3>已打开页面的脚本菜单</h3>
      <button onClick={() => run(async () => setMenus(await userscriptRequest('menus')))}>刷新脚本菜单</button>
      {menus.map(menu => <p key={`${menu.guestId}:${menu.scriptId}:${menu.id}`}><button onClick={() => run(() => userscriptRequest('invoke-menu', menu))}>{menu.label}</button> <small>{menu.url}</small></p>)}
    </fieldset>
  </section>;
}
