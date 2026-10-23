import { useEffect, useState } from 'react';
import { defaultMathConfiguration, mathPackages, type MathConfiguration } from '@webobsidian/markdown-core';
import { updateWriting, useWriting } from '../lib/writing/config';
import { useStore } from '../lib/store';
import { SettingGroup, SettingRow } from './SettingRow';

export default function MathSettings() {
  const { settings } = useWriting();
  const [draft, setDraft] = useState<MathConfiguration>(settings.math ?? defaultMathConfiguration());
  const [options, setOptions] = useState(JSON.stringify(draft.packageOptions, null, 2));
  const [message, setMessage] = useState(''), [busy, setBusy] = useState(false);
  useEffect(() => { const value = settings.math ?? defaultMathConfiguration(); setDraft(value); setOptions(JSON.stringify(value.packageOptions, null, 2)); }, [settings.math]);
  return <SettingGroup title="MathJax 宏包与自定义命令">
    <p>配置保存在当前 Vault 的 <code>.obsidian/webobsidian/math.jsonc</code>。首次读取旧插件的数学导言区；保存后由此配置接管。原文件与本地 TeX 编译设置保留。</p>
    <fieldset disabled={busy || !settings.mathSource} style={{ border: 0, padding: 0 }}>
      {mathPackages.map(entry => <SettingRow name={entry.name} key={entry.id}>
        <input type="checkbox" aria-label={entry.name} checked={draft.packages.includes(entry.id)} onChange={event => setDraft({ ...draft,
          packages: event.target.checked ? [...draft.packages, entry.id] : draft.packages.filter(id => id !== entry.id),
        })} />
      </SettingRow>)}
      <p>AMS 和基本数学命令始终可用。Physics 会重定义部分命令，与 Braket、siunitx 分别冲突；siunitx 自动启用所需基础扩展。</p>
      <SettingRow name="导言区文件" desc="Vault 内的相对路径">
        <input aria-label="导言区文件" value={draft.preambleFile} placeholder="例如 math/macros.tex" onChange={event => setDraft({ ...draft, preambleFile: event.target.value })} />
      </SettingRow>
      {draft.preambleFile && <button onClick={() => void useStore.getState().openFile(draft.preambleFile)}>编辑导言区文件</button>}
      <p>文件先执行，下面的附加宏后执行。重定义按 MathJax 的实际命令语义处理；不支持完整 LaTeX 宏包的任意 .sty 文件。</p>
      <SettingRow name="附加宏"><textarea rows={9} aria-label="MathJax 附加宏" spellCheck={false}
        value={draft.preamble} onChange={event => setDraft({ ...draft, preamble: event.target.value })} /></SettingRow>
      <details><summary>宏包选项（JSON）</summary><textarea rows={6} aria-label="MathJax 宏包选项" spellCheck={false}
        style={{ width: '100%', fontFamily: 'monospace' }} value={options} onChange={event => setOptions(event.target.value)} /></details>
      <button onClick={() => {
        setBusy(true); setMessage('正在检查并保存…');
        void Promise.resolve().then(() => updateWriting({ math: { ...draft, packageOptions: JSON.parse(options) } }))
          .then(() => setMessage('已保存并应用到公式显示')).catch(error => setMessage(String(error))).finally(() => setBusy(false));
      }}>保存数学配置</button>
    </fieldset>
    {message && <p role="status">{message}</p>}
  </SettingGroup>;
}
