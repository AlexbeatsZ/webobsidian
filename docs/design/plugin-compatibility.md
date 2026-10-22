# 现用 Obsidian 插件兼容宿主

2026-10-22：Interactive JS 0.1.0 已迁入原生代码块宿主、可信 JS 运行与便捷 widgets。
普通 JS 使用现有 CodeMirror；`js-widget` / `javascript-widget` 和旧 `// @obsidian-js`
显式块由内置实现接管，原插件不再重复加载。原文件和启用配置保留。只有类型与隔离
构建检查；实际控件、图表及原笔记验收尚未进行。详见 [原生 JS](native-javascript.md)。

2026-10-22：`fuzzy-chinese-pinyin` 已由原生中文搜索取代；加载器阻止重复执行，
保留原插件文件与 Obsidian 启用配置。下方原包加载记录仅为历史证据。
详见 [内置中文搜索](chinese-search.md)。

2026-10-22：LaTeX Suite 与 Linter 已迁入原生公式/片段和文档格式化模块；加载器同样
跳过原包，设置页显示“内置接管”。片段与格式化统一使用 LaTeX Suite 替换语义，
旧 Linter 正则替换在首次导入配置时转换，原插件文件及启用配置保留。
详见 [原生写作能力](native-writing.md)。下方原包加载结果及 `mk` 失败记录是历史证据；
原生输入、IME 和完整工作流仍待用户统一验收。

## 范围与依据

目标是直接加载现用插件的 CommonJS `main.js`，让命令、设置、文件访问、编辑器扩展、
Markdown 处理器及卸载映射到真实应用能力。参考 [Obsidian 官方公开 API](https://github.com/obsidianmd/obsidian-api)；
obsidian-typings 只作内部接口资料，不把类型声明当作运行时实现。

2026-10-18 只读盘点 Windows 的 Manage / STEM，发现以下版本：

| 插件 | Manage | STEM | 已自动检查的范围 |
| --- | --- | --- | --- |
| obsidian-plus | 1.3.0 | 1.3.1 | 原包加载、按原配置启动模块、设置页 |
| fuzzy-chinese-pinyin | 2.29.2 | 2.27.23 | 原包加载、设置页、命令注册 |
| obsidian-linter | 1.32.0 | 1.31.2 | 原包加载、设置页、保存命令入口 |
| templater-obsidian | 2.25.0 | 2.16.2 | 原包加载、设置页、真实模板解析 `Value <% 2+3 %>` |
| obsidian-latex-suite | 1.12.5 | 1.9.8 | 原包加载、设置页、原代码片段文件读取、CM 扩展注册 |
| dataview | 0.5.68 | 未启用 | 原包加载、设置页、测试笔记索引及 LIST 代码块 |
| local-latex-renderer | 0.8.1 | 0.8.1 | 原包加载、设置页、共享 MathJax 预导言入口 |
| interactive-js | 0.1.0 | 0.1.0 | 原包加载、显式 opt-in 代码块执行、普通 JS 保持惰性 |
| reading-live-parity | 未启用 | 0.1.7 | 原包加载、Markdown 处理器注册 |
| webviewer-userscripts | 0.1.0 | 0.1.0 | 原生隔离宿主加载、真实 webview 注入及 GM 保存；浏览器 unsupported |
| obsidian-context-mcp | 未启用 | 0.1.0 | 原生隔离宿主加载、独立端点的上下文 RPC 及卸载；浏览器 unsupported |
| obsidian-footnotes | 启用列表残留 | 启用列表残留 | 两库均缺少安装目录，无法测试原插件 |

原包加载和设置页检查不等于所有子模块、每条用户脚本、TeX 编译器、网页站点或 MCP
外部客户端均已验收。隔离测试复制读取插件源码和设置到内存；不写入原库。
Templater 的用户脚本目录、启动模板和系统命令在测试夹具中关闭，防止执行真实自动化。
LaTeX Suite 新版会先按 ES module 解析片段文件，再尝试补 `export default`；
其预期失败分支会输出 `SyntaxError`，测试区分该日志与最终加载错误。

验证状态以用户最后的要求为准：用户要求后续只静态验证，保留界面验收供其统一执行。
该要求之前已完成 31 项单元/HTTP、38 项浏览器回归、原生隔离宿主及生产产物测试；
之后不再启动浏览器、Electron 或 Computer Use。最终源码继续通过 core/server/web 与
desktop 类型检查；先前动态结果只证明当时快照，不能视为最终代码的再次动态验收。

最后的实际打字回归未通过 LaTeX Suite `mk` 自动展开。静态检查随后补齐了
`workspace.updateOptions()` 对原地变更扩展数组的重新配置；最终 `mk` 行为仍待统一验收。
请保留这个回归，不以加载成功或片段数量代替实际输入结果。

## 实现分工

- 性能约定（2026-10-19）：MetadataCache 按会话版本缓存打开文档，按原文复用未打开文档元数据；位置换算复用行索引。modify 只更新对应源文件链接，create/delete/rename 按路径依赖重解析受影响源文件，批处理后统一 resolved；不更改插件既有链接选择规则。详见 performance.md，当前仅静态验证。

- `web/src/lib/obsidian/events.ts`：Events、Component、子组件、事件、DOM 监听和定时器清理。
- `dom.ts`、`ui.ts`：非枚举 DOM 辅助方法、模态框、建议、菜单、设置控件。
- `vault.ts`：稳定文件对象、父子目录、真实读写/二进制/资源 URL、元数据和链接解析。
- `workspace.ts`：当前编辑器、分栏、叶子、自定义视图、布局和文件事件。
- `editor.ts`：Editor 位置/选区/事务桥，插件与宿主共用 CM6 模块及扩展 compartment。
- `markdown.ts`：代码块 widget、渲染子组件、后处理器及取消/卸载。
- `runtime.ts`：CommonJS 模块映射、插件状态、命令/快捷键、持久设置、加载/卸载。
- `menus.ts`、`PluginElements.tsx`：文件菜单、Ribbon、状态栏与真实 UI 集成。
- `server/src/services/plugins.ts`：读取现有启用列表、插件 JSON 持久化、vault-scoped adapter。
- `server/src/routes/plugins.ts`：认证后的插件资源、配置、adapter 与 HTTP 请求接口。

`loadData()` 缺失时返回 null；损坏 JSON 报错，不悄悄以空配置覆盖。
`saveData()` 串行写入临时文件后重命名。启停只更新所选插件，保留缺失插件的原 ID。
启动读取 `.obsidian/community-plugins.json`，不在读取时改写现有设置。

渲染后处理器不得重写 CM 管理的可编辑正文；实时编辑只向其暴露 HTML/插件渲染块，
readonly 视图可处理呈现 DOM。以文档和 viewport 标识缓存处理批次，避免插件异步输出
再次触发自己的子组件卸载/重建。Dataview 还依赖 `onNodeInserted()` 的真实 DOM 挂载通知。
插件编辑器扩展的注册数组可能在注册后原地变更，必须在 `updateOptions()` 重新解析。

## 浏览器与原生桌面

普通浏览器提供 vault-scoped 文件操作及服务端 HTTP 代理，不提供本机 shell。
Templater 的模板解析和公开文件/交互入口已接入；系统命令调用返回明确的能力错误。
任意用户模板与私有 Obsidian API 的兼容性仍按其实际操作检查。

桌面 File 菜单新增 `Trust native plugins (next launch)`，默认关闭。用户自行启用并下次
启动时，本地宿主允许插件通过 Node `createRequire` 加载内置模块，接入实际 vault 路径。
此模式的插件具有用户级文件和进程权限，应当只用于信任的插件。
禁用后同样在下次启动恢复隔离设置；菜单动作不自动重启或丢弃会话。

原生模式使用独立、无 Node 的 sandboxed `<webview>` 承载远程网页；拒绝非 HTTP(S)
guest URL、guest preload 和主窗口跳转到远程页面。新窗口链接交给系统浏览器。
Web Viewer 可从命令面板打开；Userscripts 插件能在 `webviewer` 叶子上找到实际 webview。
桌面 requestUrl 经受限 IPC 使用 Electron net，遵循应用网络会话配置。

可信插件运行用户 JS 和 ES module 片段需要私有 SPA 的 `unsafe-eval` 和 blob script/worker。
`/share/` 文档保持严格 script/worker CSP，并且没有插件渲染权限。
打印上下文关闭插件执行；插件专用块的打印输出仍是后续兼容项目。

## 验证与使用

```powershell
npm run typecheck
npm --workspace desktop run typecheck
npm run test:unit
$env:RENDER_TEST_BROWSER = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
npx playwright test --project=plugins
# 选择现用原包进行只读隔离测试（不在 CI 中依赖本机目录）
$env:OBSIDIAN_PLUGIN_VAULTS = 'C:/Users/Meta/Documents/Obsidian/Manage;C:/Users/Meta/Documents/Obsidian/STEM'
npx playwright test --project=plugins
```

生产构建应输出至 Temp/.agents 独立目录，再运行 `tests/packaged-plugins.mjs <build-root>`。
该测试启动自己的服务器和临时 vault，检查认证、生产 CSP 下原样 CommonJS 加载、
代码块、跨刷新 JSON 持久化、raw 资源、路径越界拒绝和实时卸载。
原有渲染回归仍用 `test:render`、`test:integration` 和 `tests/packaged-rendering.mjs`。

使用时选择含 `.obsidian/plugins/` 的 vault，在设置 → Community Plugins 查看每个插件的
实际加载状态；插件设置页会出现在设置侧栏。启停无需刷新整个网页。
对复杂插件按真实笔记逐项验收，尤其是私有 DOM monkey patch、主题布局、跨站脚本、
IME、移动手势、原生 TeX 和外部 MCP 审阅流程。

## 尚未宣称的能力

- 完整 Obsidian 私有 DOM、所有 core 插件、所有命令和内部 API。
- 所有 Dataview inline 表达式和自定义语法节点的等价性；本轮首先验证笔记索引。
- 自定义扩展名关联、持久化自定义视图布局、真正独立的多窗口 workspace。
- 外部 CLI 和操作系统 obsidian:// 协议分发；目前只保留插件处理器注册。
- 缺失 `obsidian-footnotes` 安装包的行为。
- 自动迁移、写入或接管现用 Obsidian 会话，以及外部设备/登录站点验收。

回滚用 `git revert` 回退交付提交，不重置或删除用户 vault。
