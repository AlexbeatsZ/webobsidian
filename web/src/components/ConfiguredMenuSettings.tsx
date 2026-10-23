import { useState, useSyncExternalStore } from 'react';
import { getMenuConfigurationController, getMenuConfigurationRevision, subscribeMenuConfiguration } from '../lib/configuredMenus/controller';
import { MENU_CONFIG_DIRECTORY, MENU_CONFIG_ROOT } from '../lib/configuredMenus/config';
import type { MenuConfigurationController } from '../lib/configuredMenus/controller';
import { SettingGroup, SettingRow } from './SettingRow';
import ConfigurationFile from './ConfigurationFile';

function MenuConfigurationFiles({ controller }: { controller: MenuConfigurationController }) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const [error, setError] = useState('');
  const paths = [...new Set([MENU_CONFIG_ROOT, ...state.sources.map(source => source.path)])];
  return <section>
    <h2>右键菜单</h2>
    <SettingGroup title="配置文件" desc="在外部编辑 JSONC，保存后自动加载；配置无效时保留上一次有效菜单。">
      {state.sources.find(source => source.path === MENU_CONFIG_ROOT && !source.exists) && <SettingRow name="创建菜单配置" desc="创建空规则配置，继续使用已有菜单。"><button disabled={state.loading} onClick={() => {
        const source = state.sources.find(item => item.path === MENU_CONFIG_ROOT);
        if (source) { setError(''); void controller.save(source, '{\n  "version": 1,\n  "rules": [],\n  "items": []\n}\n').catch(cause => setError(String(cause))); }
      }}>创建配置文件</button></SettingRow>}
      <SettingRow name="重新加载菜单" desc="包含根文件引用的配置文件。"><button disabled={state.loading} onClick={() => {
        setError(''); void controller.reload().catch(cause => setError(String(cause)));
      }}>重新加载</button></SettingRow>
      {paths.map(path => <ConfigurationFile key={path} path={MENU_CONFIG_DIRECTORY + path} desc={state.sources.find(source => source.path === path)?.exists ? undefined : '文件尚未创建。'} />)}
    </SettingGroup>
    {error && <p role="alert">{error}</p>}
    {state.diagnostics.length > 0 && <div role="alert"><p>配置未应用，请修复以下位置。</p><ul>{state.diagnostics.map((diagnostic, index) => <li key={index}><code>{diagnostic.file}:{diagnostic.line}:{diagnostic.column}</code> — {diagnostic.message}</li>)}</ul></div>}
  </section>;
}

export default function ConfiguredMenuSettings() {
  useSyncExternalStore(subscribeMenuConfiguration, getMenuConfigurationRevision);
  const controller = getMenuConfigurationController();
  return controller ? <MenuConfigurationFiles key={controller.sessionId} controller={controller} /> : <p>当前仓库的菜单配置尚未初始化。</p>;
}
