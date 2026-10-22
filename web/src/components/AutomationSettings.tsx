import { useEffect, useState } from 'react';
import { sharedApp } from '../lib/plugins';
import { readAutomation, importAutomation, type AutomationSettings as Preferences, type AutomationConfiguration } from '../lib/userCommands';

export default function AutomationSettings() {
  const [snapshot, setSnapshot] = useState<AutomationConfiguration>();
  const [commands, setCommands] = useState<Preferences['commands']>([]);
  const [templates, setTemplates] = useState('');
  const [folder, setFolder] = useState('');
  const [selected, setSelected] = useState(0);
  const [message, setMessage] = useState('正在读取…');
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let active = true;
    void readAutomation().then(value => {
      if (!active) return;
      setSnapshot(value); setCommands(value.settings.commands); setFolder(value.settings.templates.folder);
      setTemplates(JSON.stringify({ bindings: value.settings.templates.bindings, folderRules: value.settings.templates.folderRules }, null, 2)); setReady(true); setMessage('');
    }).catch(error => { if (active) setMessage(String(error)); });
    return () => { active = false; };
  }, []);
  const command = commands[selected];
  const patch = (value: Partial<Preferences['commands'][number]>) => {
    setCommands(items => items.map((item, index) => index === selected ? { ...item, ...value } : item)); setMessage('');
  };
  const save = async () => {
    setBusy(true); setMessage('正在保存…');
    try {
      const value: Preferences = { version: 1, commands, templates: { ...JSON.parse(templates), folder: folder.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '') } };
      const saved = await sharedApp.automation.save(snapshot!.source, value);
      setSnapshot(saved); setCommands(saved.settings.commands); setMessage('已保存到当前 Vault 并应用');
    } catch (error) { setMessage(String(error)); }
    finally { setBusy(false); }
  };
  return <div>
    <h2>用户指令与模板</h2>
    <p>定义保存在当前笔记仓库的 <code>.obsidian/webobsidian/automation.jsonc</code>，随仓库一起移动和同步。</p>
    <p>注册的指令可以通过命令面板、快捷键、右键菜单和模板调用。保存后生效。</p>
    <fieldset disabled={!ready || busy} style={{ border: 0, padding: 0 }}>
      <h3>JavaScript 指令</h3>
      <select className="text-input" aria-label="选择用户指令" value={commands.length ? selected : ''}
        onChange={event => setSelected(Number(event.target.value))}>
        {!commands.length && <option value="">暂无用户指令</option>}
        {commands.map((item, index) => <option key={index} value={index}>{item.name || item.id}</option>)}
      </select>{' '}
      <button onClick={() => { setCommands(items => [...items, { id: `user:command-${crypto.randomUUID()}`, name: '新指令',
        code: 'const name = await prompt("请输入名称");\ncontext.assertCurrent();\nreturn name;', enabled: true }]); setSelected(commands.length); }}>新增</button>
      {command && <>
        <div className="setting-row"><label>名称 <input className="text-input" value={command.name} onChange={event => patch({ name: event.target.value })} /></label></div>
        <div className="setting-row"><label>指令 ID <input className="text-input" value={command.id} onChange={event => patch({ id: event.target.value })} /></label></div>
        <p>ID 以 user: 开头；模板、菜单和快捷键通过这个 ID 引用。</p>
        <label><input type="checkbox" checked={command.enabled} onChange={event => patch({ enabled: event.target.checked })} /> 启用</label>{' '}
        <button onClick={() => { setCommands(items => items.filter((_, index) => index !== selected)); setSelected(Math.max(0, selected - 1)); }}>移除此指令</button>
        <textarea className="text-input" aria-label="JavaScript 指令代码" spellCheck={false} rows={13}
          style={{ width: '100%', fontFamily: 'monospace', marginTop: 12 }} value={command.code} onChange={event => patch({ code: event.target.value })} />
        <p><code>app, args, context, signal, onCleanup, prompt, choose, execute</code> 可直接使用。return 返回调用结果；await 后编辑笔记前调用 context.assertCurrent()。</p>
      </>}
      <h3>笔记模板</h3>
      <label>模板目录 <input className="text-input" value={folder} onChange={event => setFolder(event.target.value)} placeholder="例如 07模板" /></label>
      <p>在 Markdown 模板中使用 <code>{'<% title %>'}</code>、<code>{'<% date "YYYY-MM-DD" %>'}</code>、<code>{'<% command "user:example" {} %>'}</code>。操作指令使用 <code>{'<% do "user:example" {} %>'}</code>。</p>
      <p>bindings 为模板注册稳定指令，folderRules 按最长文件夹路径匹配新建的空笔记。启用文件夹规则前请停用原 Templater。</p>
      <textarea className="text-input" aria-label="模板指令与文件夹规则" spellCheck={false} rows={10}
        style={{ width: '100%', fontFamily: 'monospace' }} value={templates} onChange={event => setTemplates(event.target.value)} />
      <p><code>{'{ "bindings": [{ "id": "template:lab", "name": "插入实验记录", "path": "07模板/实验.md" }], "folderRules": [{ "folder": "实验", "template": "07模板/实验.md" }] }'}</code></p>
      <button onClick={() => void save()}>保存并应用</button>
      {snapshot && !snapshot.source.exists && <button onClick={() => {
        setBusy(true);
        void importAutomation(snapshot.source).then(async value => {
          setSnapshot(value); setCommands(value.settings.commands); setFolder(value.settings.templates.folder);
          setTemplates(JSON.stringify({ bindings: value.settings.templates.bindings, folderRules: value.settings.templates.folderRules }, null, 2));
          await sharedApp.automation.reload(); setMessage('已从旧应用设置导入；原配置保留');
        }).catch(error => setMessage(String(error))).finally(() => setBusy(false));
      }}>从旧应用设置导入</button>}
    </fieldset>
    {message && <p role="status">{message}</p>}
  </div>;
}
