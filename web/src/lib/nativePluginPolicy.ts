/** Compatibility policy for modules whose implementation now belongs to core. */
export const nativePlusModules = {
  anyBlock: '自定义块效果',
  menuManager: '右键菜单',
  unusedImages: '未引用附件清理',
  multiTag: '批量标签',
  tagWrangler: '标签管理',
} as const;

export const migratedPluginIds: Record<string, string> = {
  'any-block': '已由内置自定义块效果接管，请在 Vault 中注册效果',
  'any-block-local': '已由内置自定义块效果接管，请在 Vault 中注册效果',
  'webviewer-userscripts': '已由内置浏览器脚本管理接管',
  'obsidian-menu-manager': '已由内置配置式右键菜单接管',
  'oz-clear-unused-images': '已由内置未引用附件清理接管',
  'multi-tag': '已由内置批量标签接管',
  'tag-wrangler': '已由内置标签管理接管',
};

type PlusModule = keyof typeof nativePlusModules;
const isMigrated = (key: string): key is PlusModule =>
  Object.prototype.hasOwnProperty.call(nativePlusModules, key);

/**
 * Plus 1.3.x exposes these ordinary prototype methods (TypeScript private, not
 * ECMAScript #private). Intercept module construction before onload so migrated
 * modules never register listeners/commands. Keep the persisted settings intact:
 * masking loadData would let Plus's startup save overwrite the original flags.
 */
export function adaptNativePlusModules(plugin: unknown): void {
  const plus = plugin as {
    manifest?: { version?: string };
    enableModule?: (key: string) => void;
    setModuleEnabled?: (key: string, enabled: boolean) => Promise<void>;
    register?: (cleanup: () => void) => void;
  };
  if (
    !/^1\.3\./.test(plus.manifest?.version ?? '') ||
    typeof plus.enableModule !== 'function' ||
    typeof plus.setModuleEnabled !== 'function' ||
    typeof plus.register !== 'function'
  ) {
    throw new Error('此 Obsidian Plus 版本需要更新原生模块适配；已停止加载以避免重复执行');
  }
  const enableModule = plus.enableModule;
  const setModuleEnabled = plus.setModuleEnabled;
  plus.enableModule = function (key) {
    if (!isMigrated(key)) enableModule.call(this, key);
  };
  plus.setModuleEnabled = async function (key, enabled) {
    if (isMigrated(key)) {
      throw new Error(`${nativePlusModules[key]}已内置，请使用应用原生设置和命令`);
    }
    return setModuleEnabled.call(this, key, enabled);
  };
  plus.register(() => {
    plus.enableModule = enableModule;
    plus.setModuleEnabled = setModuleEnabled;
  });
}
