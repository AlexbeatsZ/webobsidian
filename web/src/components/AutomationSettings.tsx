import { useEffect, useState } from 'react';
import { SettingGroup, SettingRow } from './SettingRow';
import ConfigurationFile from './ConfigurationFile';
import { sharedApp } from '../lib/plugins';
import { readAutomation, importAutomation, type AutomationSettings as Preferences, type AutomationConfiguration } from '../lib/userCommands';

export default function AutomationSettings() {
  const [snapshot, setSnapshot] = useState<AutomationConfiguration>();
  const [message, setMessage] = useState('正在读取…'), [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    void readAutomation().then(value => { if (active) { setSnapshot(value); setMessage(''); } })
      .catch(error => { if (active) setMessage(String(error)); });
    return () => { active = false; };
  }, []);
  const run = (work: () => Promise<AutomationConfiguration>) => {
    if (busy) return;
    setBusy(true); setMessage('');
    void work().then(setSnapshot).catch(error => setMessage(String(error))).finally(() => setBusy(false));
  };
  const save = (patch: Partial<Preferences>) => {
    if (snapshot) run(() => sharedApp.automation.save(snapshot.source, { ...snapshot.settings, ...patch }));
  };
  return <div>
    <h2>用户指令与模板</h2>
    <SettingGroup>
      <ConfigurationFile path=".obsidian/webobsidian/automation.jsonc" desc="在外部编辑指令代码、模板指令和新建文件规则。保存后自动应用。">
        <button disabled={busy} onClick={() => run(async () => { await sharedApp.automation.reload(); return readAutomation(); })}>重新加载</button>
      </ConfigurationFile>
      {snapshot && !snapshot.source.exists && <SettingRow name="创建配置" desc="保存当前配置到仓库；原有配置文件保留。">
        <button disabled={busy} onClick={() => save({})}>创建配置文件</button>
      </SettingRow>}
      {snapshot && !snapshot.source.exists && <SettingRow name="导入旧应用配置" desc="只在当前仓库尚无配置文件时可用。">
        <button disabled={busy} onClick={() => run(async () => { const value = await importAutomation(snapshot.source); await sharedApp.automation.reload(); return value; })}>导入</button>
      </SettingRow>}
    </SettingGroup>
    {snapshot && <fieldset disabled={busy}>
      <SettingGroup title="JavaScript 指令">
        {!snapshot.settings.commands.length && <p>暂无用户指令。请在配置文件中添加。</p>}
        {snapshot.settings.commands.map(command => <SettingRow key={command.id} name={command.name} desc={command.id}>
          <input type="checkbox" checked={command.enabled} onChange={event => save({ commands: snapshot.settings.commands.map(item => item.id === command.id ? { ...item, enabled: event.target.checked } : item) })} />
        </SettingRow>)}
      </SettingGroup>
      <SettingGroup title="笔记模板">
        <SettingRow name="模板目录" desc="使用当前仓库的相对路径。">
          <input key={snapshot.settings.templates.folder} defaultValue={snapshot.settings.templates.folder} onBlur={event => {
            if (event.target.value !== snapshot.settings.templates.folder) save({ templates: { ...snapshot.settings.templates, folder: event.target.value.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '') } });
          }} />
        </SettingRow>
        {snapshot.settings.templates.folder && <ConfigurationFile name="模板文件夹" path={snapshot.settings.templates.folder} />}
        <SettingRow name="模板指令" desc="在配置文件的 templates.bindings 中维护。"><span>{snapshot.settings.templates.bindings.length} 个</span></SettingRow>
        <SettingRow name="新建文件模板规则" desc="在配置文件的 templates.folderRules 中维护；使用前请停用原 Templater。"><span>{snapshot.settings.templates.folderRules.length} 条</span></SettingRow>
      </SettingGroup>
    </fieldset>}
    {message && <p role="status">{message}</p>}
  </div>;
}
