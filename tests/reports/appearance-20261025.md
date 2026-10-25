# 外观正文字号与正文列宽 — 2026-10-25

## 交付与契约

基线 d27ee0b；本 owner 的产品源码已冻结，交父独立审查与复跑。没有 stage、commit、build、package 或安装；AGENTS/design 由父维护。

- 设置入口：原 Vault 页脚的「设置」→「外观」→「正文」，复用 SettingRow/SettingGroup。
- `ui.fontTextSize`：12–36 px 整数，默认 18；不修改 UI 字号。
- `ui.fileLineWidth`：320–2000 px 整数，默认 700。标签明确为「正文列宽（含左右边距）」。默认桌面两侧各 32px，因此净正文 636px；保留原 box-sizing/max-width 行为。
- 移动布局继续使用原两侧各 14px 的边距；列宽受可用视口限制。没有现存不限宽设置，本任务不增加开关或新偏好。
- 合法输入即时通过原 settings 服务保存，成功响应更新已挂载编辑/阅读视图；不刷新页面。主题保存同样移除旧 location.reload。
- 空值、非整数、越界输入保留为设置输入草稿、显示范围错误，不发写请求。服务端使用同一 schema，非法 API 请求返回 400，不改变文件或有效缓存。
- 写入失败显示真实错误，保留上次成功应用值和失败输入，允许继续修改重试；恢复默认同时保存 18/700，不重置主题或其他设置。

## 权威实现与删除

| 文件 | 职责 |
| --- | --- |
| `server/src/contracts/uiSettings.ts` | 唯一浏览器安全 UI schema、默认值、数值范围和类型 |
| `server/src/services/settings.ts` | 替换原内嵌 UI schema，复用原默认装载、验证、原子写、备份、更新队列和缓存 |
| `server/src/routes/settings.ts` | 使用该 schema 的 partial/strict 校验，仅合并提交字段；非法值返回 400 |
| `web/src/lib/api.ts` | 仅 UI-only putSettings 按提交顺序串行；已排队请求计入原 mutation 计数；成功 UI 响应发 settings-changed |
| `web/src/App.tsx` | 原主题投影扩展为 UI 投影；启动读和成功通知共用应用路径；body 上写原 CSS 变量，主题/debug 继续调用原实现 |
| `web/src/components/Settings.tsx` | 原 Settings 接收成功响应；Appearance 保存输入草稿与反馈，复用同一 schema，删除旧 theme-local 状态和 reload |
| `web/src/styles/obsidian.css` | 仅增加 title row 继承 `--font-text-size`；原标题 H1 em 比例因此随正文更新 |

没有第二状态库、存储、文档写路径、解析器、MathJax cache/observer 或坐标实现。App 内 UI 只是服务端配置的现有 React 投影，Appearance 的局部数值字符串只是输入草稿。

MathJax 的现有 CM geometry/requestMeasure/metrics/queue/cache 负责重测；没有给字号/宽度新增公式监听器或全量文档重解析。属性行保留原 14px 规则，正文标题保留原 em 比例。性能边界：仅配置更新时改变 CSS 变量；没有输入时延或性能提升测量结论。

父审查指出的全 settings 队列风险已删除：Vault/Git/search 等非 UI-only 请求走原 send 路径，不排在 UI 队列里。Vault 切换不计入原 mutation 计数。相邻单测确认切换等待期间后续 UI 请求仍能发送、完成并使 mutation 归零；未对真实 Vault 切换做浏览器验收。

## 最终验证

- 相邻 Vitest：9/9，3 文件，619ms。`server/src/services/settings.test.ts` 4例、`web/src/lib/apiSettings.test.ts` 3例、现有 `server/src/contracts.test.ts` 2例。
- Web types：`npm --workspace web run typecheck` 通过。
- Server types：`npm --workspace server run typecheck` 通过。
- 浏览器：`tests/browser/appearance.spec.ts` **8/8 通过，25.5s，0 skip/retry**。独立新进程、Edge、5301；每例启动真实 TS server 和独立 Temp/.agents Vault/data，所有配置和笔记由真实 API/磁盘读回。
- 最终证据：`.local/appearance-20261025/final-2/results/`。测试进程和端口已退出，临时 Vault/data 已由夹具删除；server logs/PNG/geometry JSON 留在证据目录。
- `git diff --check` 通过；新产品/测试文件没有新增源码 inline comments。Git index 为空；父的 design 修改与无关 `.workbuddy` 保留。

新浏览器覆盖：真实设置按钮/外观分类；已挂载编辑与阅读同步；公式/标题/属性/UI 字号；真实 settings 落盘、页面 reload 和恢复默认；客户端边界/空值/小数与服务端类型/边界错误；390px 几何；dirty source/同一编辑 DOM/Undo；延迟旧成功响应与快速两次变更；507 保存失败及重试；延迟前一失败后后一成功无过期错误覆盖。

写失败浏览器通过受控 507 响应验证反馈和有效值，真实磁盘 rename 失败由单测注入，验证旧缓存/旧文件/临时文件清理与后续重试。两者证据分开，不声称浏览器触发了真实磁盘故障。

## 几何证据

两模式观测值相同，详细 JSON 在对应测试的 `geometry.json`。

| 观测项 | 默认 | 调整后 | 390px 窗口 |
| --- | --- | --- | --- |
| 字号 | 18px | 24px | 30px |
| 设定列宽 | 700px | 900px | 2000px |
| 实际列宽 | 700px | 900px | 390px |
| 实际净正文宽 | 636px | 836px | 362px |
| 左右 padding 总和 | 64px | 64px | 28px |
| 文件标题字号 | 29.124px | 38.832px | 48.54px |
| H2 字号 | 26.316px | 35.088px | 43.86px |
| 属性行字号 | 14px | 14px | 14px |
| 行内公式 SVG 高度 | 19.5px | 26px | 32.5px |

桌面两模式正文左右居中空白均相等（默认199.75/199.75px，调整后99.75/99.75px）。窄屏正文左右偏移均0、body.scrollWidth=390、innerWidth=390。长公式保持现有 intrinsic 宽度和 CM scroller overflow-x:auto，窄屏 scrollWidth=5633/clientWidth=390，实际设置 scrollLeft=200 后读回大于0。此处保留的是原文档 scroller 横滚，不虚称新增公式 body 内滚动。

已查看最终4张截图（设置重载、双模式、窄屏、失败反馈）。浮动侧栏保持原产品行为，截图中覆盖文档不代表列宽计算发生偏移；窄屏证据截图通过真实侧栏按钮收起侧栏。

## 夹具与失败记录

`tests/browser/appearanceFixture.tsx` 直接挂载真实 App/原 CSS，模拟生产的单次挂载；页面原 main 开发入口有 StrictMode，会触发既有 nativeFeaturePreferences cleanup generation 错误。没有为本功能修改该旧生命周期，也没有将错误加入白名单。测试的 API 走真实隔离后端，应用 websocket 不转发；冻结夹具 HMR websocket 返回 connected、不应用更新，避免 HMR 双 store。

首轮8失败包含上述 StrictMode 错误、错误的公式 CSS selector 以及窄屏 `<390` 断言。第二轮功能断言均通过，但注入 HTML 后 Edge Local Network Access 阻断 Vite HMR，因此仍8失败。随后用冻结 HMR 夹具正常运行；第三轮7通过，唯一失败为真实列宽恰好390而测试误用 `<390`。改为视口内 `<=390` 后8/8；该轮有 teardown uistate proxy 日志，新增夹具 flush/unmount 后最终8/8且无该日志。产品源码未为这些夹具问题追加修复。

没有重跑或修改既有181/1/2全套及其不相关失败；没有 native EXE、实际用户 Vault/profile、物理IME、其他平台、长期或性能验收。已安装0.1.24和已有0.1.25安装包未改变。

## 父复跑命令

父协调独立验收：冻结源码后使用5303与Temp/.agents/appearance-parent-20261025运行同8项，8/8通过25.6s；完整单元59文件290/290通过4.01s，Web/Server类型通过。实际查看保存重载后的设置截图。审查发现全settings队列可能阻塞Vault维护屏障，已在最终实现限定UI-only串行并加入相关单元回归。未重跑全浏览器、未打包/安装；旧0.1.25安装包不含本功能。

```powershell
$env:RENDER_TEST_PORT='5301'
$env:RENDER_TEST_SKIP_CORE_BUILD='1'
$env:RENDER_TEST_BROWSER='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
$env:RENDER_TEST_OUTPUT_DIR='C:/Users/Meta/Project/Workspaces/meta-obsidian/.local/appearance-20261025/parent'
npx playwright test tests/browser/appearance.spec.ts --project=render
npx vitest run server/src/services/settings.test.ts web/src/lib/apiSettings.test.ts server/src/contracts.test.ts
npm --workspace web run typecheck
npm --workspace server run typecheck
```
