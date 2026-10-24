# 快捷键

## Vault identity follow-up (2026-10-23)

Hotkeys uses Vault.vaultPathKey with native features/configuration/workspace.
Equivalent historical Windows hotkey keys merge only when overlapping command
values agree; conflicts preserve stored state and report errors. First migration
also finds old writing hotkeys across equivalent keys without rewriting them.
Linux casing and existing token/file encodings remain. Format menus call the
same editorCommands using their captured view. Source/diff evidence only.

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

## 2026-10-23 目录接线修正

- 命令弹窗只从 `CommandManager.getHotkeys` 读取有效绑定，显示全部组合，显式空列表不回退到旧
  `search.chinese.shortcuts` 或弹窗私有默认表。跳转配置页先保存 pending command，设置挂载后消费；
  初始化只读 pending，避免 React StrictMode 重复 initializer 消耗目标 ID。
- `refreshSearch` 分别接受 catalog、搜索设置与快捷键请求结果，单项失败保留该项最后有效快照，
  不丢弃其他成功结果；快捷键错误显示在设置页。快捷键写入在排队和成功时递增独立 generation，
  先前/写入中开始的 GET 不得在 PUT 完成后覆盖绑定。
- `CommandManager` 的平台 signature 索引对同一命令去重。Windows 的 Mod/Ctrl 或 macOS 的
  Mod/Meta 同义绑定不会制造与自身的冲突；不同命令之间的同优先级冲突规则保持不变。
- 模式切换由已挂载 MarkdownView 注册回调，回调读取该视图最新 mode/onModeChange；原生命令
  先调用当前编辑器对应的回调。侧栏笔记保留自己的模式状态，没有 mode handler 的只读视图
  不会把操作重定向到中央。视图销毁时解除注册；无活跃编辑器时才沿用工作区模式入口。
- 缩进规则由列表 owner 接到同一 `indentMarkdown`，Tab 与目录命令不再分别实现缩进算法。

本修正只做源码/调用关系/Git diff 检查，未运行 tests、类型检查、构建、应用、服务、浏览器或
真实键盘/IME/性能验收；无新测试或打包，原始 Vault/config/profile 保持不变。

## 交付边界

2026-10-23 早先收尾：修复 `HotkeySettings` 的 React 事件类型错误，删除被统一目录取代的
`runWritingHotkey`/`writingCommandId`。已做全仓 `typecheck`；未运行 tests、构建、应用、
服务、浏览器、真实键盘/IME 或性能验收，未写真实 Vault 快捷键文件。
