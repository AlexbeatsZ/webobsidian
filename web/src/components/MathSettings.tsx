import { useState } from 'react';
import { defaultMathConfiguration, mathPackages } from '@webobsidian/markdown-core';
import { updateWriting, useWriting } from '../lib/writing/config';
import { SettingGroup, SettingRow } from './SettingRow';
import ConfigurationFile from './ConfigurationFile';

export default function MathSettings() {
  const { settings } = useWriting();
  const math = settings.math ?? defaultMathConfiguration();
  const [busy, setBusy] = useState(false);
  return <SettingGroup title="MathJax 宏包与自定义命令">
    <ConfigurationFile path=".obsidian/webobsidian/math.jsonc" desc="在外部编辑导言区和宏包选项；保存后自动加载。" />
    <fieldset disabled={busy || !settings.mathSource}>
      {settings.mathSource && !settings.mathSource.exists && <SettingRow name="创建数学配置" desc="将当前宏包和导言区配置保存到仓库。"><button onClick={() => {
        setBusy(true); void updateWriting({ math }).catch(() => {}).finally(() => setBusy(false));
      }}>创建配置文件</button></SettingRow>}
      {mathPackages.map(entry => <SettingRow name={entry.name} key={entry.id}>
        <input type="checkbox" checked={math.packages.includes(entry.id)} onChange={event => {
          setBusy(true);
          void updateWriting({ math: { ...math,
            packages: event.target.checked ? [...math.packages, entry.id] : math.packages.filter(id => id !== entry.id),
          } }).catch(() => {}).finally(() => setBusy(false));
        }} />
      </SettingRow>)}
    </fieldset>
    {math.preambleFile && <ConfigurationFile name="导言区文件" path={math.preambleFile} />}
  </SettingGroup>;
}
