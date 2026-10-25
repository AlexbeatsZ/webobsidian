# F02：公式自动编号与长公式重叠

## 结论和范围

- 基线：`2012afb2bde626cd170f1a5d0efc00378d266c2d`，2026-10-25。
- 已实际查看用户截图 `C:/Users/Meta/AppData/Local/Temp/.agents/obsidian-feedback-20261025/image1.png`，截图末尾公式与 `(2-3)` 接触/重叠。
- 在原有渲染夹具中重建截图公式，先复现几何碰撞，再进行最小修复。长公式保持内在宽度，可无限超出正文列；编号参与布局，随公式横向滚动。短公式保持居中，编号保持靠右。
- 专项最终 **16/16 通过，29.4s**；既有公式相关回归 **20/20 通过，37.1s**；Web 类型检查通过。没有跳过、重试或扩大容差掩盖失败。
- 只修改 MathWidget 测量区段、公式专属 CSS、新专项测试和本报告；`mathjax.ts` 经追踪后无需修改。
- 没有 stage、commit、push、安装或打包。共享文件中其他 agent 的代码围栏/query 改动仍归其他 agent；本报告不将其计为 F02 改动。

## 根因证据

原 `.cm-equation-number` 用绝对定位固定在公式宿主右侧，不参与宽度计算。原 `.cm-numbered-equation` 的 `padding-inline:4em` 与稍后加载、同等 specificity 的 `.cm-math-rendered.math-block` 的 `padding:0.5em 0` 冲突，实际横向保留空间为零。同时公式 body 使用 `overflow-x:auto`，宿主/MathJax 容器限宽；长 SVG 的右侧与独立编号发生叠压，body 又形成了第二个横向滚动区域。单纯增加 padding 或隐藏溢出不能满足本反馈。

基线 red（相同首个碰撞断言、修改生产代码之前）：

| 几何量 | CSS px |
| --- | ---: |
| 公式宿主 left / right | 774 / 1410 |
| 完整 SVG left / right | 776 / 1848.53125 |
| 编号 left / right | 1363 / 1401 |
| 编号 left − 完整 SVG right | **−485.53125** |
| body clientWidth / scrollWidth | 636 / 1075 |

基线截图可直接看到编号覆盖已经可见的公式字形，并非只由离屏 SVG 的外框推断。对应文件：

- `.local/feedback-equation-number-20261025/evidence/red-collision.png`
- `.local/feedback-equation-number-20261025/evidence/red-geometry.json`
- `.local/feedback-equation-number-20261025/red-overflow/results/feedback-equation-number-F-5e20a-r-of-the-screenshot-formula-render/trace.zip`

## 既有所有者和最小改动

1. `markdown-core/equations.ts` 继续从不可变文档模型派生自动编号；编号仍不写回 TeX 或进入 SVG 缓存键。
2. `web/src/lib/livePreview.ts` 的 MathWidget `measure()`：display 公式从原来测量 body，改为测量宿主父级正文行。body 现在能随内在公式宽度增长，不能再让其增长后的宽度反过来成为转换输入；父级正文行保持稳定并保留引用/列表前缀的可用宽度。
3. `web/src/styles/equations.css`：删除固定 padding、绝对定位、top/translate 偏移。编号宿主使用 `1fr max-content 1fr` grid、`1em` 列间距；公式位于中列，编号位于右列。两边对称轨道让短公式仍居中；长公式与编号共同决定宿主的内在宽度。selector specificity 明确高于通用 math-block 规则，避免导入顺序再次覆盖 grid。
4. `web/src/styles/obsidian.css` 只改公式规则：display 宿主 `width:max-content; min-width:100%; max-width:none`，body `min-width:max-content`，删除 body 的内部滚动；display 的 MathJax 容器取消最大宽度。行内公式原有规则保留。
5. `renderMath` 的单队列、256 项缓存、pending 去重、配置修订、MathJax package state reset、唯一 clone ID 和 AbortSignal 原样复用。没有新解析器、TeX/source 改写、观察器、生产 instrumentation、第二条尺寸/坐标管线或新缓存。
6. 显式 `\\tag` 继续由 MathJax `tags:none` 下的原生显式 tag 排版处理，不抽取/改写 tag，也不叠加第二个自动编号。cursor tooltip、链接预览和 print 原有调用链均不另建 renderer。

生产改动定位：MathWidget 约 451 行；equations.css 1–20 行；obsidian.css 586–591 行。其他 livePreview.ts 区段和共享文件差异为并行任务，不属于本修复。

## Red / green 执行记录

| 轮次 | 结果 | 说明 |
| --- | --- | --- |
| `red` | 1/1 pass，4.4s | 初始单段截图公式、720px 夹具不足以触发碰撞；明确没有把它当成 red |
| `red-overflow` | **0/1，1 failed** | 将同一公式扩为单行长式，原断言得到 −485.53125px，截图实际重叠；日志中的单测时间 1.7s |
| `green-initial` | 0/1 | 第一次 grid selector 与通用 block selector 同 specificity，display 被覆盖；改正自身公式 selector，无其他补丁 |
| `green-layout` | 1/1 pass，4.0s | 原碰撞断言转绿，完整 SVG 与编号间距 20px |
| `green-matrix` / `green-matrix-2` | 各 1 pass / 11 failed | 新增测试把 `\\text` 放在 tag 自身的文本模式，MathJax 正确报 `text is only supported in math mode`；属于测试输入错误，随后改为合法 `\\tag{A long explicit tag}` 并添加无 merror 断言 |
| `probe-explicit` | 0/1 | 确认上述测试输入错误；没有据此修改生产 TeX 处理 |
| `green-matrix-3` | 2/2 pass，5.3s | 窄窗口和打印准备通过 |
| `green-lifecycle` | 1 pass / 2 failed，19.1s | 测试错误地要求 source 模式没有已有的编辑预览，并把链接预览当 cursor tooltip；按既有语义改测试 selector/操作 |
| `green-lifecycle-2` | 2/2 pass，5.9s | source reveal 和实际 Reading 链接预览通过 |
| `green-final` | 14 pass / 2 failed，26.5s | 新测量断言误要求正文列宽不变时也必须更新、误把字形外框中心当宿主行框中心；改成实际不变量：仅列宽变化更新，编号相对 body 居中 |
| `green-resize` | 2/2 pass，5.9s | 捕获真实 4 / 4 / 0 次 adoption，稳定帧无追加更新 |
| `final` | **16/16 pass，29.4s** | 完整最终专项，无 skip/retry |
| `green-affected` | **20/20 pass，37.1s** | 既有相关回归，未修改公共测试 |
| `final-preview` | **1/1 pass，6.4s** | 在最终整跑后补强实际预览横向滚动断言，显式 tag 完整落入预览窗口可见范围；无生产代码变化 |

最终完整输出：`.local/feedback-equation-number-20261025/final-run.log`。历史每轮的 Playwright trace、error-context、截图和几何文件各自保留在同名子目录；中间失败均没有覆盖 red 证据。

## 覆盖和几何结果

- 420px / 1040px 宿主，实际浏览器 viewport 分别 900px / 2140px；body、quote、nested quote、list、Callout 共 10 组，同时验证 Live Preview 和 Reading。
- 每组包含短自动编号、单行超长自动编号、单行超长显式 `\\tag{2-3}`、短式长文本显式 tag，共 **80 个公式几何样本**。长式 SVG 宽 **1072.53125px**，保持单行自然高度，没有缩放、裁剪、强制换行或公式最大宽度。
- 自动编号最小 gap **20px**；显式 tag 最小 gap **15.32196044921875px**。body `overflow-x:visible`，body scrollWidth 与 clientWidth 差不超过 1px；实际文档 scroller 可横向滚动到公式末尾和编号。滚动后再次测量不重叠。
- dark / 600px 单独复现原截图长度、原 `(2-3)` 章节编号的公式，横向滚动后仍有完整字形和可见间距。
- source reveal、source/reading 模式切换、H1 插入导致重编号、Undo 后 BOM/CRLF 原始字符串严格相等；没有真实 Vault 写入或无关文本改写。
- 8 轮选择/相同尺寸通知保持原 MathJax DOM。宿主宽度按 720→420→1040→720 变化时，实际正文行宽 **636→356→636→636**，四个已挂载公式合计 adoption **4→4→0**；每次再等 8 帧无追加 adoption。内在 overflow 没有自激尺寸反馈。
- 直接调用同一服务，两路并发相同公式只转换 **1 次**，第三个同条件调用仍总计 **1 次**；三个 clone 的 **66 个 ID 全部唯一**。强制延迟另一次转换、abort 并移除 body，完成后取消宿主 **0 个子节点**。
- inline cursor preview 仍用既有 tooltip；实际 Reading 公式链接预览用 `.cm-link-preview` 的共享 fragment/MathWidget，版本 **4.1.3**，显式 tag gap **15.71234130859375px**，额外自动编号 **0**。补强测试实际横向滚动预览，断言整个 tag 在 popup 左右界内，`final-preview` 1/1 通过，6.4s；稳定证据目录中的预览截图和 JSON 已更新为滚动后版本。
- print：实际 `preparePrintDocument` 生成并冻结的 800px iframe，4 个公式、2 个自动编号、2 个显式 tag，`contenteditable=false`，body overflow visible。长式自动编号 gap **20px**，显式长式 gap **21.915252685546875px**；长式宿主超出 800px 正文列。截图仅为查看而在冻结后把 iframe 显示并加宽；验收几何采集于原 800px 打印宿主，记录在 print-geometry.json。
- 公共 fixture 的 pageerror / console.error 检查全部通过。

## 复跑

PowerShell，在仓库根目录，使用已有项目依赖：

```powershell
$env:RENDER_TEST_PORT='5302'
$env:RENDER_TEST_BROWSER='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
$env:RENDER_TEST_SKIP_CORE_BUILD='1'
$env:RENDER_TEST_OUTPUT_DIR='.local/feedback-equation-number-20261025/recheck'
npx playwright test tests/browser/feedback-equation-number.spec.ts --project=render
```

既有受影响回归：

```powershell
npx playwright test tests/browser/math-inline.spec.ts tests/browser/math-fonts.spec.ts tests/browser/render.spec.ts --project=render --grep 'inline source|simple formulas|tall inline|formula|MathJax|nested callouts own'
npm --workspace web run typecheck
```

`RENDER_TEST_SKIP_CORE_BUILD=1` 使用已有 core dist，夹具只启动 5302 Vite dev；没有根 build 或 server/public 输出。未将父协调另报的 283/283 单测计入本 agent 的测试执行。

## 截图和机器证据索引

稳定证据目录：`.local/feedback-equation-number-20261025/evidence/`。

| 文件 | 含义 |
| --- | --- |
| `red-collision.png` / `red-geometry.json` | 生产改动前，完整 SVG 与编号实际重叠 |
| `green-body-overflow.png` | 420px 下 Live/Reading 横向滚动末尾，自动/显式编号可见 |
| `green-callout-overflow.png` | Callout 中相同横向 overflow |
| `green-dark-formula.png` | 原截图长度公式、dark、(2-3) |
| `green-print.png` / `print-geometry.json` | 冻结 print DOM 与原 800px 宿主测量 |
| `green-reference-preview.png` / `reference-preview.json` | 实际公式链接预览的显式 tag |
| `green-source-preview.png` | 正在编辑源码的既有 display preview |
| `green-geometry.json` | 与首个 red 对应的最终几何 |
| `lifecycle.json` | 初始/稳定/resize 几何、adoption 4/4/0 |
| `queue-cache-cancel.json` | 去重、缓存、clone ID 和取消结果 |

上述截图均已实际打开查看。每个矩阵用例的完整两模式几何和横向滚动前后截图仍在 `final/results/` 对应用例目录。

## 验证边界 / 交接

- 本次完成的是源码 + 隔离真实 Edge 夹具 + 打印 DOM 准备验收。没有构建、安装或运行新的 Electron EXE；现有已安装 0.1.24 尚不包含本次修复。
- 没有运行 OS 打印对话框、物理 IME、长时间稳定性、Mac/Android、全套浏览器测试、真实 Vault/个人 CSS 全量验收；不声称这些已通过，也不声称长期性能提升。
- 原 Vault/profile/installed/root server/public/release/.workbuddy、用户 DOCX、AGENTS 和公共设计文档未修改；公共现有测试只执行、不编辑。唯一新测试是 feedback-equation-number.spec.ts。
- Vite/Edge 随 Playwright 正常结束，5302 已无本任务监听；Git index 仍空。不操作其他 agent 的进程、暂存区或文件。
- 本 agent 的实现与专项验证完成；交由父协调独立验收并决定 DOCX 标注。没有提交，未替父协调标记 DOCX 完成。
