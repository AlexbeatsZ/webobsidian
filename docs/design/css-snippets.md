# CSS 样式片段

## 配置与来源

外观设置提供当前 Vault 的 `.obsidian/snippets/*.css` 文件列表、搜索、逐项启用开关、
刷新与外部文件夹打开。设置内不嵌入 CSS 编辑器，不改写 CSS 文件。启用状态直接沿用
`.obsidian/appearance.json` 的 `enabledCssSnippets`（不含 `.css` 后缀）；不另存一份开关。
文件名可含中文，磁盘扩展名大小写保留。列表只枚举片段目录的直接 CSS 文件，不扫描笔记。

`GET/PUT /api/settings/css-snippets` 由同一 settings 路由与本机来源规则提供。写入只改
appearance.json 的 enabledCssSnippets 范围，保留其余配置、注释和未编辑字节。VaultConfiguration
复用既有路径/Vault 身份检查、revision 冲突拒绝、串行原子写入及新文件独占创建；原配置写入
入口仅允许 appearance.json。Obsidian hotkeys 的原文件仍只读。读取或打开设置不创建文件。
用户切换开关且原 appearance.json 缺失时才创建该启用列表文件。

CSS 资产走同一配置路由，复用 resolveInVault/readFileSnapshot，不增加解析器或内容改写。
每个文件限制 1 MiB；HTTP 缓存由现有文件 mtime/size stamp 失效，不为列表散列 CSS 正文。

## 样式与生命周期

Plugins/runtime 已经使用 link 元素和组件宿主清理来加载样式。片段沿用 link 机制，
initializeCssSnippets 挂在原 loadPlugins/stopHost 生命周期内。插件样式在片段前插入，
片段按 enabledCssSnippets 顺序应用。只更新启用/新增/改变的 link；禁用删除对应元素。
切 Vault、卸载宿主时移除全部片段，晚到的旧请求不会恢复已关闭宿主的样式。

现有 watcher 仅扩展 appearance.json 和 snippets 下的直接 CSS 文件，复用
vault-configuration-changed 通知；这些路径仍绕过笔记目录树和索引。原生运行时对通知
合并重载，不增加 watcher 或输入时工作。外部改动、新文件和删除文件经同一事件生效；
设置内刷新也调用同一流程。读取配置失败时保留已加载样式并显示错误。

## 交付边界

2026-10-23 仅源码与 Git diff 检查。没有运行 tests/typecheck/build/probe、应用、服务、
浏览器、系统打开、实际 CSS 切换或性能验收，没有写真实 Vault/appearance/profile，没有打包。
