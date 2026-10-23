import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { eventHotkey, hotkeyLabel, hotkeySignature, type Hotkey } from '@webobsidian/search-core';
import { sharedApp, pluginRevision, subscribePlugins } from '../lib/plugins';
import { consumeHotkeySettingsRequest, peekHotkeySettingsRequest, matchName, updateHotkeys, useSearch } from '../lib/search';
import { SettingGroup, SettingRow } from './SettingRow';
import Icon from './Icon';
import '../styles/hotkeys.css';

type Filter = 'all' | 'assigned' | 'unassigned' | 'custom' | 'conflicts' | 'unavailable';
const mac = () => /Mac|iPhone|iPad/.test(navigator.platform);

/** One live command catalog serves this page, the palette and key dispatch. */
export default function HotkeySettings() {
  const { hotkeys, hotkeyError } = useSearch();
  const revision = useSyncExternalStore(subscribePlugins, pluginRevision);
  const [query, setQuery] = useState(peekHotkeySettingsRequest);
  const [filter, setFilter] = useState<Filter>('all');
  const [recording, setRecording] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const recorder = useRef<HTMLInputElement>(null);
  const search = useRef<HTMLInputElement>(null);
  useEffect(() => {
    consumeHotkeySettingsRequest();
    const focus = (event: Event) => {
      const id = (event as CustomEvent<string>).detail || consumeHotkeySettingsRequest();
      consumeHotkeySettingsRequest(); setQuery(id || ''); setFilter('all'); search.current?.focus();
    };
    window.addEventListener('hotkeys-settings-open', focus);
    window.addEventListener('search-settings-open', focus);
    return () => { window.removeEventListener('hotkeys-settings-open', focus); window.removeEventListener('search-settings-open', focus); };
  }, []);
  useEffect(() => { if (recording) recorder.current?.focus(); }, [recording]);
  const catalog = useMemo(() => sharedApp.commands.hotkeyCatalog().map(command => ({
    ...command, bindings: sharedApp.commands.getHotkeys(command.id), custom: Object.hasOwn(hotkeys.bindings, command.id),
  })), [hotkeys, revision]);
  const collisions = useMemo(() => {
    const bindings = new Map<string, typeof catalog>();
    for (const command of catalog) if (command.installed) for (const binding of command.bindings) {
      const signature = hotkeySignature(binding, mac());
      const list = bindings.get(signature) ?? [];
      if (!list.some(other => other.id === command.id)) bindings.set(signature, [...list, command]);
    }
    return bindings;
  }, [catalog]);
  const conflictNames = (id: string, binding: Hotkey) => {
    const group = collisions.get(hotkeySignature(binding, mac())) ?? [];
    const effective = group.some(command => command.custom) ? group.filter(command => command.custom) : group;
    return effective.some(command => command.id === id) && effective.length > 1 ? effective.filter(command => command.id !== id).map(command => command.name) : [];
  };
  const conflicted = (command: typeof catalog[number]) => command.bindings.some(binding => conflictNames(command.id, binding).length);
  const filtered = catalog.filter(command => {
    if (filter === 'assigned' && !command.bindings.length || filter === 'unassigned' && command.bindings.length || filter === 'custom' && !command.custom || filter === 'unavailable' && command.installed || filter === 'conflicts' && !conflicted(command)) return false;
    const terms = query.trim().split(/\s+/).filter(Boolean);
    const haystack = `${command.name} ${command.id} ${command.bindings.map(binding => hotkeyLabel(binding, mac())).join(' ')}`;
    return terms.every(term => !!matchName(term, haystack));
  });
  const save = async (id: string, bindings: Hotkey[] | null) => {
    setBusy(id); setError('');
    try { await updateHotkeys(id, bindings); setRecording(''); }
    catch (failure) { setError(String(failure)); }
    finally { setBusy(''); }
  };
  return <div className="hotkey-settings">
    <h2>快捷键</h2>
    <p className="setting-description">原生命令与已加载插件共用此目录。支持多组按键；空列表禁用默认值。未实现或未加载的迁移项会保留并标为不可用。</p>
    <div className="hotkey-toolbar">
      <div className="hotkey-search"><Icon name="search" size={16} /><input ref={search} type="search" value={query} placeholder="搜索命令、ID 或快捷键…" aria-label="搜索快捷键" onChange={event => setQuery(event.target.value)} /></div>
      <select aria-label="快捷键筛选" value={filter} onChange={event => setFilter(event.target.value as Filter)}>
        <option value="all">全部</option><option value="assigned">已分配</option><option value="unassigned">未分配</option><option value="custom">自定义 / 已迁移</option><option value="conflicts">冲突</option><option value="unavailable">不可用</option>
      </select>
    </div>
    <p className="hotkey-summary" role="status">显示 {filtered.length} / {catalog.length} 项 · {catalog.filter(command => command.installed).length} 个可用命令 · {catalog.filter(conflicted).length} 项冲突</p>
    {error && <p className="hotkey-error" role="alert">{error}</p>}
    {hotkeyError && <p className="hotkey-error" role="alert">{hotkeyError}</p>}
    {hotkeys.migration && <p className="hotkey-migration">{hotkeys.migration}</p>}
    <SettingGroup className="hotkey-list">
      {filtered.map(command => <SettingRow key={command.id} className={command.installed ? '' : 'hotkey-unavailable'} name={<><span>{command.name}</span>{!command.installed && <span className="hotkey-status">不可用</span>}</>} desc={<><code>{command.id}</code>{command.custom && <span className="hotkey-status">{command.bindings.length ? (hotkeys.imported.includes(command.id) ? '已迁移 / 自定义' : '自定义') : '已禁用'}</span>}</>}>
        <div className="hotkey-controls">
          <div className="hotkey-bindings">{command.bindings.map((binding, index) => {
            const conflicts = conflictNames(command.id, binding);
            return <span className={`hotkey-binding${conflicts.length ? ' hotkey-conflict' : ''}`} key={index} title={conflicts.length ? `与 ${conflicts.join('、')} 冲突；调整后才能执行` : undefined}>
              <kbd>{hotkeyLabel(binding, mac())}</kbd><button type="button" aria-label={`移除 ${command.name} 的 ${hotkeyLabel(binding, mac())}`} disabled={!!busy} onClick={() => void save(command.id, command.bindings.filter((_, at) => at !== index))}>×</button>
            </span>;
          })}{!command.bindings.length && <span className="hotkey-empty">未分配</span>}</div>
          <div className="hotkey-actions">
            <button type="button" className="hotkey-icon-button" title="添加快捷键" aria-label={`为 ${command.name} 添加快捷键`} disabled={!!busy || !hotkeys.vault || command.bindings.length >= 32} onClick={() => setRecording(command.id)}><Icon name="plus" size={15} /></button>
            {command.custom && <button type="button" className="hotkey-icon-button" title="恢复默认值" aria-label={`恢复 ${command.name} 的默认快捷键`} disabled={!!busy} onClick={() => void save(command.id, null)}><Icon name="reset" size={15} /></button>}
          </div>
          {recording === command.id && <input ref={recorder} data-hotkey-recorder readOnly className="hotkey-recorder" placeholder="按下组合键；Esc 取消" aria-label={`录入 ${command.name} 的快捷键`} onBlur={() => setRecording('')} onKeyDown={event => {
            event.preventDefault(); event.stopPropagation();
            if (event.nativeEvent.isComposing || event.nativeEvent.getModifierState('AltGraph')) return;
            if (event.key === 'Escape') { setRecording(''); return; }
            const binding = eventHotkey(event.nativeEvent);
            if (!binding) return;
            if (!binding.modifiers.length && !/^F\d{1,2}$/.test(binding.key)) { setError('请使用带 Ctrl、Alt、Shift 或 Command 的组合键，或功能键。'); return; }
            const signature = hotkeySignature(binding, mac());
            if (command.bindings.some(existing => hotkeySignature(existing, mac()) === signature)) { setRecording(''); return; }
            void save(command.id, [...command.bindings, binding]);
          }} />}
        </div>
      </SettingRow>)}
    </SettingGroup>
    {!filtered.length && <p className="hotkey-empty">没有匹配的命令。</p>}
  </div>;
}
