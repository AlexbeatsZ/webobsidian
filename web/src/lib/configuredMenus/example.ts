/** Passive by default. Users opt into each rule/action by editing their Vault file. */
export const MENU_CONFIG_EXAMPLE = `// 当前 Vault 的右键菜单配置。支持注释和尾逗号。
// 路径：.obsidian/webobsidian/menus/menu.jsonc
{
  "version": 1,
  // 在当前文件规则之前加载；imports 是 includes 的别名。
  // "includes": ["imports/files.jsonc"],
  "rules": [
    // { "match": { "id": "file:rename" }, "title": "重命名", "icon": "pencil", "order": 0 },
    // { "match": { "id": "file:delete" }, "when": { "modifiers": { "shift": false } }, "hide": true },
    // { "match": { "id": "file:copy-path" }, "move": { "parent": "custom:tools", "index": 0 } },
    // 无稳定 ID 的插件项才允许显式弱匹配；title 不受语言切换保护。
    // { "match": { "weak": { "title": "Plugin action", "icon": "wand", "section": "plugin" } }, "group": "plugins" },
  ],
  "items": [
    // 命令 ID 来自已有命令注册表；未知或当前不可用的命令显示为禁用。
    // { "id": "custom:tools", "title": "笔记工具", "icon": "wrench",
    //   "when": { "contexts": ["file", "tab"], "fileTypes": ["md"] },
    //   "submenu": [
    //     { "id": "custom:bookmark", "title": "切换书签", "command": "bookmark" },
    //     { "id": "custom:source", "title": "源码视图", "command": "source" },
    //   ]
    // },
  ],
}
`;
