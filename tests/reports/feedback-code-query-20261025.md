# F01：代码围栏选择与原生 query 部分支持

基线：`2012afb2bde626cd170f1a5d0efc00378d266c2d`。开始时只有无关 `.workbuddy/`。本任务不 stage、commit、push，不改 AGENTS、公共设计文档、用户 DOCX、现有公共测试、CSS、MathWidget、mathjax.ts，不构建安装包。

## 根因与 red

`livePreview.ts` 的 FencedCode 分支在光标不处于块内时，用 `Decoration.replace` 删除整个首尾围栏行的 DOM 文本；是否揭示只接受空光标选区。因此鼠标没有原始文字可命中，非空键盘选区也不会揭示首尾标记。右上角 language flair 来自 CSS 生成内容，不是源码文本。query 则根本没有原生 processor 注册。

修改产品源码前，使用真实 Edge、`/__render-test`、5301 端口和临时浏览器 profile 建立三个失败案例：

1. `Ctrl+Home`、`Ctrl+Shift+End` 后，DOM/浏览器选区没有 opening ` ```query `；实际文本只有 `Beforetag:#chemistryAfter`。
2. 鼠标点 opening 行，`Home`、`Shift+End` 后 opening 行仍为空，无法选出原始 info string。
3. reading 没有 `.block-language-query` 结果。随后补充与生产相同 private context 的独立 red，仍失败。

第一次 red：3 failed；private-context red：1 failed。证据在 `.local/feedback-code-query-20261025/red/results/` 与 `red-private/results/`，均保留失败上下文及 Playwright trace。没有以构建或源码检查替代浏览器复现。

## 精确修改范围与复用

| 文件 | 本任务范围 |
| --- | --- |
| `web/src/lib/livePreview.ts` | 代码块注释及 FencedCode 分支，约1845行；复用 Lezer `CodeMark` 子节点，不再用正则识别围栏。编辑态失焦围栏保留透明 mark 的原生文本尺寸、命中和选择；空光标或非空选区触及块时显露。reading 继续隐藏围栏。删除旧整行替换/空光标判断分支。 |
| `web/src/lib/obsidian/markdown.ts` | `Processor`/`registerCodeProcessor` 可选 `requiresClosed`；`build` 对所有 code processor 一致处理相交非空选区；reading 不揭示；Escape 的原有 forceRendered 优先。没有 query language 特判。 |
| `web/src/lib/obsidian/runtime.ts` | 约39行 import、800行注册、807行退出清理，和原生 Javascript/blocks 使用同一 bootstrap 生命周期。 |
| `web/src/lib/queryBlock.ts` | 新增约80行原生 query processor。 |
| `tests/browser/feedback-code-query.spec.ts` | 新增专属38例；不改共享 harness、Playwright 配置或现有公共测试。 |
| `tests/reports/feedback-code-query-20261025.md` | 本报告。 |
| `.local/feedback-code-query-20261025/STATUS.md` | 自有恢复状态与证据。 |

现有 Lezer/MarkdownModel/blockContainers 是唯一语法和范围来源；原生 CM 负责命中、坐标、输入与选择；sourceControls 负责源码入口和 Escape；DocumentSession 负责原始字节、历史和保存。没有新增 parser、keymap、坐标管线、源码重写、全局 CSS 或重复 renderer。

query 复用 `registerCodeProcessor`、`CodeWidget`、DOM-owned RenderLifetime 与现有 private `allowPlugins` 能力。随原生 host 注册，无需安装/启用用户插件；受限、print/nonExecuting 的 context 不获得此能力。API 使用现有 Vault identity/lease，`api.search` 调用原 `QmdEngine`，查询经原 `parseSearchQuery`，刷新复用 `subscribeSearch`（现有 index 通知完成 refreshSearch 后发出）。没有第二搜索索引、watcher、订阅框架、词法分析器或搜索解析器。`requiresClosed` 是父审查明确要求的现有注册选项扩展，不改 RenderContext 或公式契约。

性能边界：每个挂载 query 在首次载入和已有 search 通知时请求；替换请求/卸载均 abort，旧结果不提交。最后验收补充将请求限制为101条、同步DOM最多100条，超额提示仅说明还有更多匹配，不声称总数。没有输入时重新解析整篇笔记或建立第二索引，没有性能提升或大 Vault 压测结论。

## 官方语义与支持范围

已实时查阅 Obsidian 官方 primary docs：[Search](https://obsidian.md/help/plugins/search)。官方定义 `query` fenced code block 嵌入搜索结果，并包含精确短语、多词 AND、OR、括号、否定、regex、file/path/content、大小写、line/block/section/task 和属性条件等完整搜索语义。

现有 search-core/QmdEngine 不实现全部官方语义；本次明确交付**原生 query 部分支持**，不把官方 `embed OR search` 示例伪装成普通词查询。

| 表达式 | 本次处理 |
| --- | --- |
| 单个 Unicode 字母/数字字词，如 `atom` | 原 QmdEngine literal API；匹配仍服从应用原有 prefix/fuzzy 设置，非新增 Obsidian 全兼容引擎。 |
| `tag:#chemistry`、`#chemistry`、`-tag:#old`、`-#old`，以及层级标签 | 原 search-core 标签过滤；支持多标签 AND、排除和后代，亦可与单个字词结合。 |
| `path:目录/sub_dir/file-name.md` | 原 parser/API 接受，不剥掉路径标点。沿用现有 QmdEngine 分词、prefix/fuzzy 语义；结果区域明确提示尚未实现 Obsidian 完整路径匹配语义。fixture 有真实同路径文件并与同一 engine 结果比较。 |
| 多词、引号短语、OR/AND/NOT、分组、普通词否定、regex（包括带 flags）、属性和其他操作符 | 可见的“此 query 表达式暂不支持”说明，完全不发搜索请求。不会静默退回普通搜索词。 |
| 空 query、未闭合围栏 | 空 query 显示范围说明；未闭合围栏保持原始文本且不发搜索请求。 |

普通词暂不接受标点，带空格/引号/正则的 path 暂不支持。`title:`、`body:`、`heading:` 虽为应用现有方言，也不会伪称为 Obsidian 原生语义。API 默认 literal，不隐式启用拼音模式。结果只涵盖原搜索引擎已保存索引，不搜索未保存草稿，也未新增 Canvas 或附件索引。

## 安全、错误与生命周期

- 标题和 snippet 仅以 `createElement` / `textContent` 输出，无 `innerHTML`、Markdown mount、脚本求值或内容执行。即便结果带 `<img onerror>`、`<script>` 或 JS 围栏也保持文字；带 `javascript:` 的伪造路径经过路径段编码，anchor 协议仍为 HTTP，点击走现有 openLink/linkIntent。
- pending、空结果和 HTTP 错误可见；503 案例显示原服务错误文字，源码入口仍可用。
- 新请求 abort 旧请求；返回后检查当前请求 signal 和原 RenderLifetime signal；dispose 中 abort 并取消现有 search 订阅。真实 fetch 的 `requestfailed` 证明旧请求被取消，迟到输出不覆盖新结果，销毁后 search 通知不再请求。
- Live 的原 sourceButton 支持进入源码、真实首尾选择和 Escape 返回；跨块非空选区对所有 code processor 一致揭示源码。reading 无编辑按钮，键盘和直接 dispatch 均不能改变原文。

## 验证结果

产品修复后的最小原始三例：3/3 passed（5.7s）。

38例最终专属回归：**38/38 passed，50.6s，0 skip/retry**，包含真实路径文件和伪造 `javascript:` URL 的检查。此前同产品源码38/38 passed（50.1s）；最终仅加深 fixture，没有再修改产品源码。

覆盖：原始鼠标/键盘 red；首尾 fences；backtick/tilde；quote、list、quote+list、与 list marker 同行的围栏；BOM、混合 CRLF/LF、emoji、无末尾换行、info string 编辑/Undo/save 原始字节；readonly；真实 search-core + QmdEngine（临时 Vault、独立 VaultCatalog、真实 parseNote、固定 prefix/fuzzy）；层级/排除/路径/空结果；源码入口/Escape；unsupported 不请求；未闭合；安全文字/URL；可见503；abort、迟到输出和取消订阅。

额外运行现有 `render.spec.ts` 中6个相关回归，6/6 passed（11.7s）：inline HTML/code literal、br copy/composition、失焦 Live/Reading 像素一致、原 inline 非空选区策略、table source entry、nested callout/math/code fold。未修改这些公共测试。

`npm --workspace web run typecheck` 通过；现有 `web/src/lib/javascript/codeBlocks.test.ts` 5/5通过（13ms，Vitest总924ms）；`git diff --check` 通过（只有仓库已有 LF/CRLF 提示）。父协调另报57文件283/283单测通过，不算本 owner 执行证据。

扩展过程保留真实失败：Escape 与非空选区显露相互作用是发现并修复的产品问题；quote `>` 前缀断言过强、无变化保存不应写入、reading 未真正获得 DOM focus、settings API 漏写末尾 slash 是 fixture 错误，均修正后重跑。中间一次 fixture 漏拦截 `/api/settings/` 导致 Vite 向默认代理发起失败连接；未启动真实 server、未读取/修改 Vault。最终专属 fixture 兜底拦截未知 API 返回501，阻止代理落到现有服务。

## 精确命令

均在 `C:/Users/Meta/Project/Workspaces/meta-obsidian`、PowerShell 执行。Edge：`C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe`。没有 core 修改，因此合法跳过 core build；只起 Vite dev fixture，不写 server/public。

```powershell
$env:RENDER_TEST_PORT='5301'
$env:RENDER_TEST_BROWSER='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
$env:RENDER_TEST_SKIP_CORE_BUILD='1'
$env:RENDER_TEST_OUTPUT_DIR='C:/Users/Meta/Project/Workspaces/meta-obsidian/.local/feedback-code-query-20261025/red'
npx playwright test tests/browser/feedback-code-query.spec.ts --project=render --timeout=12000
```

red-private 时只运行 `--grep 'native query' --timeout=15000`；green 初始命令用同文件、`--timeout=15000`、输出 `green-initial`。最终完整回归：

```powershell
$env:RENDER_TEST_OUTPUT_DIR='C:/Users/Meta/Project/Workspaces/meta-obsidian/.local/feedback-code-query-20261025/final'
npx playwright test tests/browser/feedback-code-query.spec.ts --project=render --timeout=15000
$env:RENDER_TEST_OUTPUT_DIR='C:/Users/Meta/Project/Workspaces/meta-obsidian/.local/feedback-code-query-20261025/existing-regression'
npx playwright test tests/browser/render.spec.ts --project=render --grep 'unfocused live syntax|only the caret-owned|nested callouts own|simple inline HTML|copy across|table source entry' --timeout=20000
npm --workspace web run typecheck
npx vitest run web/src/lib/javascript/codeBlocks.test.ts
git diff --check
```

测试创建的 `Temp/.agents/feedback-code-query-*` 只含隔离 data/settings 和合成 Vault，afterAll 先检查父路径/专属名称再删除；浏览器 profile 和 Vite 随 Playwright 退出。证据持久留在本项目 `.local/feedback-code-query-20261025/`。

## 截图与交付边界

以下截图均已实际打开检查，位于项目绝对路径前缀 `C:/Users/Meta/Project/Workspaces/meta-obsidian/.local/feedback-code-query-20261025/accepted/results/`：

- `feedback-code-query-F01-qu-94bfc-drag-and-keyboard-selection-render/nested-fences.png`
- `feedback-code-query-F01-qu-40bd0-ape-and-readonly-boundaries-render/query-source.png`
- `feedback-code-query-F01-na-ecaf7--for-tag-chemistry--tag-old-render/query-results.png`
- `feedback-code-query-F01-qu-1265e--executes-note-HTML-or-code-render/query-safe-text.png`
- `feedback-code-query-F01-vi-7c372-ource-entry-is-still-usable-render/query-failure.png`

最终 `final/results/` 重跑也生成同名截图，最终 safety fixture 改用恶意路径以加深 URL 协议断言；final 安全文字图亦已实际打开检查。5301 最终无 listener，Playwright/Vite 已正常退出。

源码和浏览器隔离验收完成不代表正式安装版/真实 Vault 验收。未运行生产打包/安装/实际 EXE；未测试实体 IME、触屏、跨平台、长时间或大 Vault 性能、全部第三方 code processor 插件兼容性、完整 Obsidian query 语法和生产 bootstrap 的登录/真实 Vault E2E。实际 HTTP search router 以 Playwright 拦截桥接真实 QmdEngine 验证，没有启动/触碰真实 server；native bootstrap 注册/销毁连接有源码与类型检查证据。

并发隔离：`obsidian.css`、`equations.css` 和 livePreview 的 MathWidget 约448行差异属于 F02 owner。本任务没有改它们；自有 livePreview 仅围栏区段。AGENTS/DOCX/公共设计文档交由父协调处理，Git index 保持未暂存，不执行提交/推送；`.workbuddy/` 保留。F01 可将“围栏选择已修复”与“query 部分支持，完整语义仍有限制”分别标记，不能把完整 query 兼容标为完成。

## 最后验收补充：有界 query 结果

父审查指出 `api.search(query, undefined)` 导致现有 route/QmdEngine 的 limit=0“返回全部”行为；query 又同步生成每条结果DOM，会放大广标签大 Vault 的编辑卡顿风险。此收尾仅改 `queryBlock.ts` 请求/展示上限、专属测试与本报告/自有状态，不动 `requiresClosed`、共享选区显露或其他源码。

- 同一个 `queryResultLimit=100` 控制现有 API 请求 `limit=101`，额外一条仅用于检测截断。
- DOM 循环始终 `hits.slice(0,100)`，即使上游意外返回150条也只创建100个结果项、100个链接和100个snippet。
- 恰好100条显示“100 个结果”；101或更多显示“已显示前 100 个结果；还有更多匹配，请缩小搜索范围”。不宣称101为总数，不新增分页、加载更多、计数请求或新通知机制。
- 新增100/101/150三种真实 Edge 回归，同时验证 Live/Reading、limit参数、结果顺序、状态和源码保持。产品修改前 red 三例全部失败：100例发现limit被省略，101/150例真实DOM为101/150。修改后完整 **41/41 passed（Playwright显示1.1m），0 skip/retry**；Web类型检查及diff检查通过。
- 现有真实QmdEngine fixture现按请求参数传递limit，以保持与原route相同的有限返回语义。类型检查已通过。

命令继续使用上述5301/Edge/skip-core环境；red输出 `limit-red`，green输出 `limit-green`：

```powershell
$env:RENDER_TEST_OUTPUT_DIR='C:/Users/Meta/Project/Workspaces/meta-obsidian/.local/feedback-code-query-20261025/limit-red'
npx playwright test tests/browser/feedback-code-query.spec.ts --project=render --grep 'bounded query' --timeout=15000
$env:RENDER_TEST_OUTPUT_DIR='C:/Users/Meta/Project/Workspaces/meta-obsidian/.local/feedback-code-query-20261025/limit-green'
npx playwright test tests/browser/feedback-code-query.spec.ts --project=render --timeout=15000
npm --workspace web run typecheck
git diff --check
```

此上限约束正常API响应条数和前端同步DOM工作量；没有改变QmdEngine内部候选匹配/排序，也没有大Vault真实负载性能验收。

截断截图已实际打开查看：`C:/Users/Meta/Project/Workspaces/meta-obsidian/.local/feedback-code-query-20261025/limit-green/results/feedback-code-query-F01-bo-91768-t-100-for-150-returned-hits-render/query-truncated.png`。独占范围已释放，不再编辑产品源码；无stage/commit/push。

## workspace/palette 七项失败归因（父全套后复查）

结论：父长运行 Vite 收到本任务 queryBlock.ts 限流编辑的 HMR 失效后，测试以裸 URL 动态导入 store，而组件的 Vite 改写依赖引用带时间戳 store，形成两份 Zustand 实例。不是 query 执行/refresh 清空同一实例；相同机制在精确2012afb源码也存在。此次未修改任何产品源码或公共测试，不降低断言。

- 父七项 trace 网络记录全部同时有 `/src/lib/store.ts?t=1792912379510` 与 `/src/lib/store.ts`；对应 RightSidebar/CommandPalette 同样存在两种URL。queryBlock.ts 文件mtime1792912379507，差3ms。父失败时间戳2026-10-25 03:12:59.510 -04:00。
- 当前稳定源码、全新5301 Vite：原始workspace4项+palette4项 **8/8通过，11.9s**。没有改原断言、mock或启动等待。
- Temp当前源码副本只在queryBlock.ts末尾追加空行触发HMR，新浏览器页面仍复现：plain store !== timestamp store；plain.paletteOpen=true、timestamp.paletteOpen=false、dialog=0。只写组件所用timestamp store，dialog立即=1。没有搜索请求/工作区恢复介入。
- 精确baseline通过 `git archive 2012afb` 解包到 `C:/Users/Meta/AppData/Local/Temp/.agents/f01-hmr-zXxZX9`；复用现有依赖与未改core产物，不执行build。仅在副本既有obsidian/markdown.ts末尾追加空行触发HMR（该基线不注册query）；同一单项探针产生完全相同结果。不是基线全套验收。
- 精确JSON：`.local/feedback-code-query-20261025/hmr-evidence.json`、`baseline-hmr-evidence.json`；恢复截图`hmr-recovered.png`、`baseline-hmr-recovered.png`，基线恢复图已查看。父sidebar三项采用同样裸store导入且trace同样双实例，结合无改动8/8通过，解释同一组症状；未逐项对基线sidebar注入HMR。

复现命令（仓库cwd，Edge同前，5301）：
```powershell
$env:RENDER_TEST_PORT="5301"
$env:RENDER_TEST_BROWSER="C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"
$env:RENDER_TEST_SKIP_CORE_BUILD="1"
$env:RENDER_TEST_OUTPUT_DIR="$PWD/.local/feedback-code-query-20261025/sidebar-palette-current"
npx playwright test --project=workspace --project=palette --timeout=15000
node .local/feedback-code-query-20261025/hmr-probe.mjs
$env:F01_BASELINE="1"
node .local/feedback-code-query-20261025/hmr-probe.mjs
Remove-Item Env:F01_BASELINE
```

处置：冻结源码编辑后重启Vite运行既有测试即可；不要通过query懒加载、sidebar重置或降低断言掩盖。若未来需要测试支持运行中HMR，应另行协调测试共享模块身份契约，不在F01范围扩修。父独立query41/41、gradual1/1及额外3/3、unit283/283和三端types为父证据，不冒领本轮执行。gradual首次失败仍未归因，本轮未触碰。

探针搭建期间先后因副本缺tsconfig导致decorator语法错误、未复制web局部picomatch依赖导致process未定义而失败；补齐原有配置/局部依赖后得到上述有效对照。早期baseline副本packages junction EEXIST发生在启动前；随后保留基线packages源码，只复用根node_modules。上述是隔离环境准备错误，未进入产品归因。所有浏览器/API均隔离mock，无真实Vault/profile/server/public/release修改；5301已退出，范围再次释放，无stage/commit/push。
