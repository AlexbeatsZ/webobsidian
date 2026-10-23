import { useEffect, useState } from 'react';
import { bootstrapUserscripts, refreshUserscripts, useUserscripts, userscriptRequest } from '../lib/userscripts/client';
import type { ScriptRecord, ScriptMenu } from '../lib/userscripts/types';
import { SettingGroup, SettingRow } from './SettingRow';
import ConfigurationFile from './ConfigurationFile';

function permissions(script: ScriptRecord) {
  return `${script.metadata.grants.join(', ') || '(无 GM 权限，页面 world)'}\n@connect: ${script.metadata.connects.join(', ') || '(仅同源)'}\nURL: ${[...script.metadata.matches, ...script.metadata.includes].join(', ') || '(无匹配)'}\n排除: ${[...script.metadata.excludes, ...script.metadata.excludeMatches].join(', ') || '(无)'}`;
}
function ScriptSettings({ script, run }: { script: ScriptRecord; run: (work: () => Promise<unknown>) => void }) {
  const [reviewed, setReviewed] = useState(false), [removing, setRemoving] = useState(false), [keepValues, setKeepValues] = useState(true);
  useEffect(() => setReviewed(false), [script.revision, script.update.candidateId]);
  const action = (name: string, extra: Record<string, unknown> = {}) => userscriptRequest(name, { id: script.id, revision: script.revision, ...extra });
  const pending = script.update.pending;
  return <SettingGroup title={script.metadata.name} desc={`${script.metadata.version || '无版本号'} · ${script.metadata.description}`}>
    <SettingRow name="启用脚本" desc="下次页面加载生效。"><input type="checkbox" checked={script.enabled} onChange={event => run(() => action('configure', { enabled: event.target.checked }))} /></SettingRow>
    <SettingRow name="允许自动更新"><input type="checkbox" checked={script.autoUpdate} onChange={event => run(() => action('configure', { autoUpdate: event.target.checked }))} /></SettingRow>
    <SettingRow name="脚本源码" desc="在外部查看；编辑后从文件重新导入，同身份脚本进入审批。"><button onClick={() => run(() => action('open-source'))}>外部打开</button></SettingRow>
    <SettingRow name="检查更新" desc={`${script.update.state}${script.update.availableVersion ? ` → ${script.update.availableVersion}` : ''}`}><button onClick={() => run(() => action('check'))}>检查更新</button></SettingRow>
    <SettingRow name="安装可用更新"><button onClick={() => run(() => action('update'))}>更新</button></SettingRow>
    {script.update.error && <p role="alert">{script.update.error}；已保留原版本。</p>}
    <details><summary>匹配、权限与兼容提示</summary><pre>{permissions(script)}</pre>
      {script.warnings.map(warning => <p key={warning}>{warning}</p>)}
      <p>执行时机：{script.metadata.runAt}；仅主文档。{script.sourceUrl && `导入来源：${script.sourceUrl}`}</p>
      <SettingRow name="已检查当前源码、匹配范围与权限"><input type="checkbox" checked={reviewed} onChange={event => setReviewed(event.target.checked)} /></SettingRow>
      <button disabled={!reviewed} onClick={() => run(async () => { await action('approve'); setReviewed(false); })}>批准当前版本权限</button>
    </details>
    {pending && <details><summary>待更新版本 {pending.metadata.version}</summary>
      <pre>{permissions({ ...script, metadata: pending.metadata })}</pre>
      {pending.warnings.map(warning => <p key={warning}>{warning}</p>)}
      <button onClick={() => run(() => action('open-source', { pending: true, candidateId: script.update.candidateId }))}>外部查看待更新源码</button>{' '}
      <button onClick={() => run(() => action('approve', { pending: true, candidateId: script.update.candidateId }))}>批准并安装以上更新</button>
    </details>}
    <SettingRow name="卸载脚本"><button onClick={() => setRemoving(!removing)}>卸载…</button></SettingRow>
    {removing && <div>
      <SettingRow name="保留此脚本存储"><input type="checkbox" checked={keepValues} onChange={event => setKeepValues(event.target.checked)} /></SettingRow>
      <p>卸载后请重新加载已打开的匹配页面。</p>
      <button onClick={() => run(() => action('remove', { keepValues }))}>确认卸载</button>{' '}<button onClick={() => setRemoving(false)}>取消</button>
    </div>}
  </SettingGroup>;
}

export function UserscriptSettings() {
  const { snapshot, error, supported } = useUserscripts();
  const [busy, setBusy] = useState(false), [failure, setFailure] = useState(''), [url, setUrl] = useState('');
  const [menus, setMenus] = useState<ScriptMenu[]>([]);
  const [storePath, setStorePath] = useState('');
  useEffect(() => bootstrapUserscripts(), []);
  useEffect(() => {
    if (!supported) return;
    let active = true;
    void userscriptRequest('paths').then(paths => { if (active) setStorePath(paths.store); })
      .catch(cause => { if (active) setFailure(String(cause)); });
    return () => { active = false; };
  }, [supported, snapshot?.vault]);
  const run = (work: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true); setFailure('');
    void work().then(() => refreshUserscripts()).catch(cause => setFailure(String(cause))).finally(() => setBusy(false));
  };
  if (!supported) return <p>用户脚本需要原生桌面的内置浏览器。</p>;
  return <section aria-label="内置浏览器用户脚本" aria-busy={busy}>
    <h2>内置浏览器脚本</h2>
    {(failure || error) && <p role="alert">{failure || error}</p>}
    <fieldset disabled={busy}>
      <SettingGroup title="配置与源码">
        {storePath && <ConfigurationFile name="脚本配置与存储" path={storePath} desc="在外部查看存储；脚本设置由各脚本自带界面保存。" onOpen={() => userscriptRequest('open-store')}>
          <button onClick={() => run(() => userscriptRequest('open-directory'))}>打开文件夹</button>
          <button onClick={() => run(() => refreshUserscripts())}>刷新列表</button>
        </ConfigurationFile>}
      </SettingGroup>
      <SettingGroup title="导入脚本" desc="导入后默认关闭。请先在外部查看源码、匹配范围和权限，批准后再启用。">
        <SettingRow name=".user.js URL"><input value={url} onChange={event => setUrl(event.target.value)} placeholder="https://…/script.user.js" /><button disabled={!url.trim()} onClick={() => run(async () => { await userscriptRequest('import', { url: url.trim() }); setUrl(''); })}>导入</button></SettingRow>
        <SettingRow name="从文件导入"><input aria-label="从文件导入用户脚本" type="file" accept=".js,.user.js,.txt,text/javascript,text/plain" onChange={event => {
          const file = event.target.files?.[0]; event.target.value = '';
          if (file) run(async () => { if (file.size > 8 * 1024 * 1024) throw new Error('文件超过 8 MiB'); await userscriptRequest('import', { source: await file.text() }); });
        }} /></SettingRow>
      </SettingGroup>
      {snapshot && <>
        <SettingGroup title="更新调度">
          <SettingRow name="自动更新调度"><input type="checkbox" checked={snapshot.autoUpdate} onChange={event => run(() => userscriptRequest('settings', { autoUpdate: event.target.checked }))} /></SettingRow>
          <SettingRow name="检查间隔" desc="以小时为单位。"><input type="number" min={1} max={720} key={snapshot.intervalHours} defaultValue={snapshot.intervalHours} onBlur={event => {
            const value = Number(event.target.value); if (value !== snapshot.intervalHours) run(() => userscriptRequest('settings', { intervalHours: value }));
          }} /></SettingRow>
          <SettingRow name="检查全部更新" desc="失败保留旧版；新增权限或匹配范围等待批准。"><button onClick={() => run(() => userscriptRequest('check'))}>检查更新</button></SettingRow>
        </SettingGroup>
        {!snapshot.scripts.length && <p>尚未安装脚本。</p>}
        {snapshot.scripts.map(script => <ScriptSettings key={script.id} script={script} run={run} />)}
        <details><summary>页面执行状态</summary>{snapshot.statuses.map((status, index) => <p key={index}>{status.url} · {snapshot.scripts.find(script => script.id === status.scriptId)?.metadata.name || 'guest'} · {status.state}{status.message && `：${status.message}`}</p>)}</details>
      </>}
      <SettingGroup title="已打开页面的脚本菜单">
        <SettingRow name="刷新脚本菜单"><button onClick={() => run(async () => setMenus(await userscriptRequest('menus')))}>刷新</button></SettingRow>
        {menus.map(menu => <SettingRow key={`${menu.guestId}:${menu.scriptId}:${menu.id}`} name={menu.label} desc={menu.url}><button onClick={() => run(() => userscriptRequest('invoke-menu', menu))}>执行</button></SettingRow>)}
      </SettingGroup>
    </fieldset>
  </section>;
}
