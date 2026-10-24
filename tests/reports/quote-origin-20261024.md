# 引用起点、竖线与 Callout 图标间距：小页面测试

2026-10-24（America/New_York）。用户明确要求运行基于代码的小页面测试，随后追加竖线与图标间距不足的截图。

## 最终结果

**4/4 通过，7.6 秒，0 跳过、0 不稳定重试、0 页面运行错误。**

使用项目现有 `/__render-test`、RenderHarness、MarkdownView、DocumentSession 和
Playwright 的 runtimeErrors 检查；左侧编辑态、右侧同一会话的只读阅读态。
没有重新实现一个展示用 Markdown 解析器。字体、样式和原生编辑器均来自当前代码。

| 检查 | 结果 |
| --- | --- |
| 普通引用和 Callout 标题的 `>` 从其内容起点开始；注入旧 `.callout-title` 的 12px/flex/伪元素规则后仍正确 | 通过；源前缀左边缘与容器起点差 0 CSSpx |
| 竖线跟在本层 `>` 右侧；显现/隐藏前缀不改变位置 | 通过；竖线起点与标记右边缘最大差约 0.00005 CSSpx；前后位置差 0 |
| 外层 Example、二级 Tip、三级普通引用；内层类型独立、正文 `[!warning]+` 不创建新 Callout | 通过；各层原始 `> `、`> > `、`> > > ` 保留，正文颜色不继承标题色 |
| 实际按 Enter：`> [!tip]` → `> [!tip]\n> `，默认 Tip 标题与两行前缀正常出现 | 通过；本次最小复现正常，未证明历史瞬态问题的根因 |
| 引用表格后 `> ---`、嵌套 `> > ***` 和普通分隔线；Setext/代码不计作分隔线 | 通过；每个视图各有 1 表格、3 条实际 hr；代码保留 `> ---` |
| 竖线到图标的空隙 | 修改前约 1.49995px；修改后外层约 6.890575px、内层约 6.890625px |

图标留白只有既有 `.cm-callout-head` 增加 `padding-inline-start: .3em`。
它属于 `[!type]` 的渲染宽度，`>`、源码空格和前缀测量均未改动。
源文件在非输入测试中完全保持原文，Enter 测试检查预期的唯一文本变化。

## 环境与重现

- 源码：`862d1ef` + 本轮 `.cm-callout-head` 留白和新增 `quote-origin.spec.ts`。
- 浏览器：已安装 Microsoft Edge，Playwright 独立临时配置/浏览器上下文；视口 1480 × 900。
- 快照：`C:/Users/Meta/AppData/Local/Temp/.agents/meta-obsidian-quote-page-20261024/source`。
- 隔离 Vite：`127.0.0.1:5197`；源码别名指向快照 core/search 的 `src/index.ts`，没有修改/编译根仓库 dist 或 server/public。
- 依赖复用根和各工作区的 node_modules，Vite cache 位于快照内。
- 命令（必须在快照 cwd）：`node node_modules/@playwright/test/cli.js test --config playwright.quote.config.ts`。
- 临时配置复用原有 Vite 配置，仅增加源码别名、独立 cache/端口；没有修改全局环境或安装依赖。
- 最终结果：快照父目录 `results-run5-final.json` / `results-run5-final/`。
- 精简证据副本：仓库 `.local/quote-origin-tests-20261024/` 下 `results-final.json`、
  `origin-geometry.json`、`nested-geometry.json` 与 `quote-origin.png`、`quote-nested.png`、`quote-rules.png`。
  三张最终截图均实际查看过。
- 测试结束自动关闭自己的浏览器和开发服务；5197 无监听。

## 保留的失败与修正边界

1. run1：快照漏链接 web/node_modules，误选根 picomatch2，页面启动 `process is not defined`；在 beforeEach 超时后停止。
   仅修正临时工作区依赖链接（web 实际声明/使用 picomatch4），未加 process shim、未改产品代码。
2. run2：3 通过、1 失败；测试文本把表格直接接在 Callout 标题后，缺少原笔记中实际存在的空引用行。
   改正这份测试文本后，run3 的 4 项在 8.4 秒内全通过。
3. run4-gap-before：用户追加间距反馈后，新间距断言实际捕获约 1.5px 的不足；保留失败 trace/报告。
4. run5-final：增加类型图标内部留白后，完整 4 项在 7.6 秒内通过；未压制 console/pageerror。

本轮没有新便携包、生产 Web 构建、原生 EXE、真实 Vault、用户资料/配置或用户进程改动。
用户正在使用的 0.1.19 不包含 `862d1ef` 和本轮留白；小页面结果不等于该 EXE 已更新或完整原生验收。
未检查长标题所有换行、IME、OS 原生输入、折叠全组合或大笔记性能。
