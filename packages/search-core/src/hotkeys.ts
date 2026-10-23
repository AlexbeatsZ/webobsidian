/** One binding format for native commands, plugin adapters and legacy imports. */
export interface Hotkey { modifiers: string[]; key: string }
export interface HotkeyPreferences {
  version: 1;
  bindings: Record<string, Hotkey[]>;
  imported: string[];
  migration: string;
}
export interface VaultHotkeys extends HotkeyPreferences { vault: string }
export const emptyHotkeys = (): HotkeyPreferences => ({ version: 1, bindings: {}, imported: [], migration: '' });

const aliases: Record<string, string> = {
  'editor:save-file': 'save', 'command-palette:open': 'commands', 'switcher:open': 'files',
  'fuzzy-chinese-pinyin:open-search': 'files', 'fuzzy-chinese-pinyin:execute-command': 'commands',
  'fuzzy-chinese-pinyin:move-file': 'move', 'fuzzy-chinese-pinyin:search-heading': 'headings',
  'fuzzy-chinese-pinyin:insert-templates': 'templates', 'fuzzy-chinese-pinyin:rebuild-index': 'reindex',
  'app:open-settings': 'settings', 'global-search:open': 'search', 'graph:open': 'graph',
  'file-explorer:open': 'file-explorer', 'bookmarks:open': 'bookmarks', 'outline:open': 'outline', 'tag-pane:open': 'tags',
  'workspace:new-tab': 'new-tab', 'workspace:split-vertical': 'split', 'workspace:split-horizontal': 'split-down',
  'markdown:toggle-preview': 'toggle-preview', 'editor:toggle-source': 'toggle-source',
  'obsidian-heading-shifter:decrease-heading': 'editor:promote-headings',
  'obsidian-heading-shifter:increase-heading': 'editor:demote-headings',
  'templater-obsidian:07模板/Cmd-提升 标题层次.md': 'editor:promote-headings',
  'templater-obsidian:07模板/Cmd-降低 标题层次.md': 'editor:demote-headings',
  'obsidian-quiet-outline:quiet-outline': 'outline',
  'obsidian-plus:clear-unused-images': 'attachments:cleanup',
  'obsidian-linter:lint-file': 'format', 'obsidian-linter:lint-file-unless-ignored': 'format',
  'obsidian-linter:lint-all-files': 'format-vault', 'obsidian-linter:lint-all-files-in-folder': 'format-folder',
  'obsidian-linter:ignore-file': 'format-ignore-file', 'obsidian-linter:ignore-folder': 'format-ignore-folder',
  'obsidian-linter:paste-as-plain-text': 'paste-plain',
  'obsidian-latex-suite:latex-suite-box-equation': 'formula-box',
  'obsidian-latex-suite:latex-suite-select-equation': 'formula-select',
  'obsidian-latex-suite:latex-suite-enable-all-features': 'formula-input-enable',
  'obsidian-latex-suite:latex-suite-disable-all-features': 'formula-input-disable',
  'obsidian-latex-suite:latex-suite-toggle-all-features': 'formula-input-toggle',
  'obsidian-latex-suite:latex-suite-toggle-conceal': 'formula-conceal',
};
export function hotkeyCommandId(id: string): string {
  const heading = /^obsidian-heading-shifter:apply-heading([0-6])$/.exec(id);
  return heading ? `editor:set-heading-${heading[1]}` : aliases[id] ?? id;
}
export function normalizeKey(key: string): string {
  const aliases: Record<string, string> = { ' ': 'Space', esc: 'Escape', return: 'Enter', left: 'ArrowLeft', right: 'ArrowRight', up: 'ArrowUp', down: 'ArrowDown' };
  return aliases[key.toLowerCase()] ?? (key.length === 1 ? key.toUpperCase() : key);
}
export function normalizeHotkey(value: unknown): Hotkey | null {
  if (!value || typeof value !== 'object') return null;
  const binding = value as Partial<Hotkey>;
  if (typeof binding.key !== 'string' || !binding.key || binding.key.length > 40 || !Array.isArray(binding.modifiers)) return null;
  const names: Record<string, string> = { mod: 'Mod', ctrl: 'Ctrl', control: 'Ctrl', meta: 'Meta', cmd: 'Meta', command: 'Meta', alt: 'Alt', option: 'Alt', shift: 'Shift' };
  const mods = binding.modifiers.map(mod => typeof mod === 'string' ? names[mod.toLowerCase()] : undefined);
  if (mods.some(mod => !mod)) return null;
  return { modifiers: ['Mod', 'Ctrl', 'Meta', 'Alt', 'Shift'].filter(mod => mods.includes(mod)), key: normalizeKey(binding.key) };
}
export function bindingFromString(value: string): Hotkey | null {
  // Split modifiers from the front so Ctrl++ remains a valid plus key.
  const modifiers: string[] = []; let key = value.trim();
  for (;;) {
    const match = /^(Mod|Ctrl|Control|Meta|Cmd|Command|Alt|Option|Shift)\+/i.exec(key);
    if (!match) break;
    modifiers.push(match[1]); key = key.slice(match[0].length);
  }
  return normalizeHotkey({ modifiers, key });
}
export function hotkeySignature(binding: Hotkey, mac = false): string {
  const mods = new Set(binding.modifiers.map(mod => mod === 'Mod' ? (mac ? 'Meta' : 'Ctrl') : mod));
  return ['Ctrl', 'Meta', 'Alt', 'Shift'].filter(mod => mods.has(mod)).concat(normalizeKey(binding.key).toLowerCase()).join('+');
}
/** Layout characters first; shifted number/punctuation keys retain their base key. */
export function eventHotkey(event: { key: string; code: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean }): Hotkey | null {
  if (['Control', 'Meta', 'Alt', 'Shift', 'Dead', 'Process', 'Unidentified'].includes(event.key)) return null;
  const punctuation: Record<string, string> = { Backquote: '`', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\', Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/' };
  const key = event.shiftKey ? (/^Digit[0-9]$/.test(event.code) ? event.code.slice(5) : punctuation[event.code] ?? event.key) : event.key;
  return normalizeHotkey({ modifiers: [event.ctrlKey && 'Ctrl', event.metaKey && 'Meta', event.altKey && 'Alt', event.shiftKey && 'Shift'].filter(Boolean), key });
}
export function hotkeyLabel(binding: Hotkey, mac = false): string {
  return [...binding.modifiers.map(mod => mod === 'Mod' ? (mac ? '⌘' : 'Ctrl') : mod === 'Meta' && mac ? '⌘' : mod), binding.key].join(' + ');
}
export function mergeHotkeys(target: Hotkey[], source: readonly Hotkey[]): Hotkey[] {
  const known = new Set(target.map(key => JSON.stringify(key)));
  return [...target, ...source.filter(key => { const id = JSON.stringify(key); if (known.has(id)) return false; known.add(id); return true; })];
}
export function normalizeHotkeyMap(value: unknown): Record<string, Hotkey[]> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('快捷键配置必须是命令与按键组的映射');
  const result: Record<string, Hotkey[]> = Object.create(null);
  for (const [id, list] of Object.entries(value)) {
    if (!id || id.length > 512 || !Array.isArray(list) || list.length > 32) throw new Error(`快捷键配置无效：${id}`);
    const bindings = list.map(normalizeHotkey);
    if (bindings.some(binding => !binding)) throw new Error(`快捷键组合无效：${id}`);
    const key = hotkeyCommandId(id);
    result[key] = mergeHotkeys(result[key] ?? [], bindings as Hotkey[]);
  }
  return result;
}
