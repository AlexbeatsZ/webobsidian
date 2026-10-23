# 快捷键

## 唯一命令目录

`CommandManager` 是快捷键、命令面板和设置页共用的目录来源：原生 `NativeCommand` 与运行中
插件注册的命令合并为同一列表，默认按键随命令一起提供（`NativeCommand.hotkeys`）。
`hotkeyCatalog()` 额外列出已迁移但当前能力/插件不存在的命令，标记为不可用，只读展示，
不注册空命令。

命令 ID 的重命名集中在新版 `@webobsidian/search-core` 的 `hotkeyCommandId`（旧
Fuzzy/编辑命令/标题移位/插件 ID → 本体命令）。`writing/commands.ts` 原有的
`writingCommandId` 别名表与 `runWritingHotkey` 已删除，写入快捷键不再有第二套匹配实现。

## 分发语义

`App` 只在捕获阶段挂一个 `keydown`：命中即 `preventDefault` 并停止继续分发，未命中则交回
原编辑器/输入法。规则：

- 输入法组合（`isComposing`/`AltGraph`）、已 `defaultPrevented` 的事件不处理；
- 焦点在弹窗、命令面板、设置浮层或快捷键录入框内时不处理；普通输入框内只响应带修饰键的组合；
- `hotkeyScope: 'editor'` 的命令只在 CodeMirror 内响应，正文外的同名按键不触发；
- 用户显式绑定优先于默认值；`[]` 表示禁用默认按键，并在编辑器内阻止该键落到原生编辑动作；
- 同优先级的多个命令不按注册顺序择一执行，改为提示冲突并列出命令名，由用户在设置页调整；
- 索引按配置对象、插件 revision 与原生命令数组缓存，普通字符输入不解析配置或重建列表。

## 配置与迁移

按 Vault（绝对路径）存储在应用 settings 的 `hotkeys` 字段，`GET/PUT /api/settings/hotkeys`
只做窄字段读写，沿用既有 Vault 身份/revision/串行写入检查。首次读取时迁移一次：

1. `.obsidian/hotkeys.json` 只读导入，原文件不改；
2. 旧 `search.chinese.shortcuts` 的单值绑定（含空值禁用语义）按命令别名并入；
3. 旧写作/LaTeX 快捷键经同一别名表并入。

迁移结果通过 `updateSettings` 写入一次，之后用户编辑只改 `bindings`；`null` 删除覆盖以
恢复默认，`[]` 保留为显式禁用。

## 设置界面

`HotkeySettings` 由设置页“快捷键”分区挂载，提供名称/ID/按键搜索、已分配/未分配/自定义/
冲突/不可用筛选、按命令录入组合键、移除单组、恢复默认。录入使用 `eventHotkey`（布局字符
优先，Shift+数字/标点取基础键），拒绝无修饰的普通字符并保留功能键；保存串行，失败显示
错误。命令面板的“配置快捷键”通过 `hotkeys-settings-open`/`search-settings-open` 事件跳到
该命令。

## 交付边界

2026-10-23 收尾：修复 `HotkeySettings` 的 React 事件类型错误，删除被统一目录取代的
`runWritingHotkey`/`writingCommandId`。已做全仓 `typecheck`；未运行 tests、构建、应用、
服务、浏览器、真实键盘/IME 或性能验收，未写真实 Vault 快捷键文件。
