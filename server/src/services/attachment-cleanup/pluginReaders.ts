import { collectReferences, type ReferenceCollection } from './references.js';

/** Exact local migrated configuration shapes, not arbitrary plugin-code evaluation.
 * Values containing generated text are inspected for literal reference syntax only.
 * Script execution belongs to the existing host; it is never run by maintenance. */
const KEYS: Record<string, readonly string[]> = {
  'any-block': ['select_list', 'select_quote', 'select_code', 'select_heading', 'select_brace', 'decoration_source', 'decoration_live', 'decoration_render', 'is_neg_level', 'alias_use_default', 'alias_user', 'user_processor', 'is_debug', 'enhance_refresh_time', 'reg_header', 'reg_header_noprefix', 'inline_split', 'pro'],
  'fuzzy-chinese-pinyin': ['global', 'file', 'heading', 'command', 'other'],
  'local-latex-renderer': ['schemaVersion', 'engine', 'compilerCommand', 'dvisvgmCommand', 'compilerPreamble', 'mathJaxPreamble', 'timeoutSeconds', 'cacheEntries'],
  'obsidian-latex': ['preamblePath'],
  'obsidian-latex-suite': ['snippets', 'snippetVariables', 'snippetsEnabled', 'snippetsTrigger', 'suppressSnippetTriggerOnIME', 'removeSnippetWhitespace', 'autoDelete$', 'loadSnippetsFromFile', 'loadSnippetVariablesFromFile', 'snippetsFileLocation', 'snippetVariablesFileLocation', 'concealEnabled', 'concealRevealTimeout', 'colorPairedBracketsEnabled', 'highlightCursorBracketsEnabled', 'mathPreviewEnabled', 'mathPreviewPositionIsAbove', 'autofractionEnabled', 'autofractionSymbol', 'autofractionBreakingChars', 'matrixShortcutsEnabled', 'taboutEnabled', 'autoEnlargeBrackets', 'wordDelimiters', 'autofractionExcludedEnvs', 'matrixShortcutsEnvNames', 'autoEnlargeBracketsTriggers', 'forceMathLanguages'],
  'obsidian-linter': ['ruleConfigs', 'lintOnSave', 'recordLintOnSaveLogs', 'displayChanged', 'suppressMessageWhenNoChange', 'lintOnFileChange', 'displayLintOnFileChangeNotice', 'settingsConvertedToConfigKeyValues', 'additionalFileExtensions', 'foldersToIgnore', 'filesToIgnore', 'linterLocale', 'logLevel', 'lintCommands', 'customRegexes', 'commonStyles'],
  'obsidian-menu-manager': ['observedItems', 'rules'],
  'obsidian-plus': ['schemaVersion', 'modules', 'menuManager', 'anyBlock', 'liveReferences'],
  'templater-obsidian': ['command_timeout', 'templates_folder', 'templates_pairs', 'trigger_on_file_creation', 'auto_jump_to_cursor', 'enable_system_commands', 'shell_path', 'user_scripts_folder', 'enable_folder_templates', 'folder_templates', 'enable_file_templates', 'file_templates', 'syntax_highlighting', 'syntax_highlighting_mobile', 'enabled_templates_hotkeys', 'startup_templates', 'intellisense_render'],
  'webviewer-userscripts': ['schemaVersion', 'scripts', 'values'],
};

export function readKnownPluginReferences(pluginId: string, path: string, content: string): ReferenceCollection | null {
  if (!KEYS[pluginId] || !path.endsWith('/data.json')) return null;
  const value: unknown = JSON.parse(content);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('插件配置必须是 JSON 对象');
  const data = value as Record<string, unknown>;
  if (Object.keys(data).some((key) => !KEYS[pluginId].includes(key))) return null;
  // Browser userscripts run in the isolated guest, not the Vault. Their JavaScript
  // source is never treated as an executing Markdown reference source. Native script
  // records retain imports/source URLs; per-script storage retains literal evidence.
  if (pluginId === 'webviewer-userscripts') {
    if (data.schemaVersion !== 1 || !Array.isArray(data.scripts) || !data.values || typeof data.values !== 'object') return null;
    return collectReferences(path, JSON.stringify({
      scripts: data.scripts.map((s: Record<string, unknown>) => ({ id: s.id, metadata: s.metadata })),
      values: data.values,
    }), { literalData: true });
  }
  return collectReferences(path, content, { literalData: true });
}
