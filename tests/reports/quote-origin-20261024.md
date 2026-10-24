# 引用竖线、Callout 图标间距与空列表退格：小页面测试

2026-10-24（America/New_York）。用户明确要求运行基于代码的小页面测试，随后追加竖线与图标间距不足的截图。

## 最终结果

**最新 6/6 通过，10.5 秒，0 跳过、0 不稳定重试、0 页面运行错误。**

用户进一步明确普通引用白线在本层 `>` 左侧，只有 Callout 彩线在右侧。
上一轮把两种规则都断言为右侧，是需求理解错误；旧4/4结果不能证明这一澄清。
本轮已修正源码和断言，并真实复现回车、Tab、Backspace 将四空格变两空格的问题。

使用项目现有 `/__render-test`、RenderHarness、MarkdownView、DocumentSession 和
Playwright 的 runtimeErrors 检查；左侧编辑态、右侧同一会话的只读阅读态。
没有重新实现一个展示用 Markdown 解析器。字体、样式和原生编辑器均来自当前代码。

| 检查 | 结果 |
| --- | --- |
| 普通引用和 Callout 标题的 `>` 从其内容起点开始；注入旧 `.callout-title` 的 12px/flex/伪元素规则后仍正确 | 通过；源前缀左边缘与容器起点差 0 CSSpx |
| 普通引用白线在本层 `>` 左侧，Callout 彩线在右侧；两种前缀显现/隐藏不改变位置 | 通过；白线右缘与标记左缘、彩线左缘与标记右缘误差均小于0.02 CSSpx；前后位置差 0 |
| 外层 Example、二级 Tip、三级普通引用；内层类型独立、正文 `[!warning]+` 不创建新 Callout | 通过；各层原始 `> `、`> > `、`> > > ` 保留，正文颜色不继承标题色 |
| 实际按 Enter：`> [!tip]` → `> [!tip]\n> `，默认 Tip 标题与两行前缀正常出现 | 通过；本次最小复现正常，未证明历史瞬态问题的根因 |
| 引用表格后 `> ---`、嵌套 `> > ***` 和普通分隔线；Setext/代码不计作分隔线 | 通过；每个视图各有 1 表格、3 条实际 hr；代码保留 `> ---` |
| 竖线到图标的空隙 | 修改前约 1.49995px；修改后外层约 6.890575px、内层约 6.890625px |
| 实际输入 `- 测试`，Enter → Tab → Backspace | 修改前 `- 测试\n    - ` → `- 测试\n  `；修改后保留 `- 测试\n    `，随后正文仍带四空格 |
| 空列表标记退格的字面 Tab、引用、有序列表变体 | 通过；只删除语法 ListMark 至行尾，前面的字节完整保留 |
| 手写两空格、四空格与字面 Tab 的续行 | 保持原样；四空格和 Tab 可见宽度相同，引导线至正文约11.05px；手写两空格约2.05px，未自动扩宽或批量修笔记 |

图标留白只有既有 `.cm-callout-head` 增加 `padding-inline-start: .3em`。
它属于 `[!type]` 的渲染宽度，`>`、源码空格和前缀测量均未改动。
源文件在非输入测试中完全保持原文，键盘测试检查每一步预期的唯一文本变化。

原有高优先级 Backspace 直接调用 CodeMirror 的 deleteMarkupBackward。该命令
按列表上下文的起点删除一层标记，起点可早于 ListMark，因而把四空格中的两格
和 `- ` 一起删掉。Tab 加四格本身正常。现有 editorCommands 的同一键位复用
markdownListLine/语法 ListMark 范围，仅为空项缩小删除范围；其他上下文继续
调用原命令。没有新键位/解析器/监听/缩进补偿，也没有调整列表样式来掩盖源码变化。

## 环境与重现

- 源码：`2d14b7f` + 本轮普通白线侧别、空列表退格与 quote-origin.spec.ts 回归更新。
- 浏览器：已安装 Microsoft Edge，Playwright 独立临时配置/浏览器上下文；视口 1480 × 900。
- 快照：`C:/Users/Meta/AppData/Local/Temp/.agents/meta-obsidian-quote-page-20261024/source`。
- 隔离 Vite：`127.0.0.1:5197`；源码别名指向快照 core/search 的 `src/index.ts`，没有修改/编译根仓库 dist 或 server/public。
- 依赖复用根和各工作区的 node_modules，Vite cache 位于快照内。
- 命令（必须在快照 cwd）：`node node_modules/@playwright/test/cli.js test --config playwright.quote.config.ts`。
- 临时配置复用原有 Vite 配置，仅增加源码别名、独立 cache/端口；没有修改全局环境或安装依赖。
- 最终结果：快照父目录 `results-run9-final.json` / `results-run9-final/`。
- 精简证据副本：仓库 `.local/quote-origin-tests-20261024/correction/` 下 `results-final.json`、
  `origin-geometry.json`、`nested-geometry.json`、`list-guide-geometry.json`、`list-keyboard-source.json`，
  以及普通/Callout、嵌套、列表缩进比较、退格后正文和分隔线五张截图。
  普通/Callout、嵌套、缩进比较与退格后正文均实际查看；分隔线沿用已有视觉与本次DOM回归。
- 测试结束自动关闭自己的浏览器和开发服务；5197 无监听。

## 保留的失败与修正边界

1. run1：快照漏链接 web/node_modules，误选根 picomatch2，页面启动 `process is not defined`；在 beforeEach 超时后停止。
   仅修正临时工作区依赖链接（web 实际声明/使用 picomatch4），未加 process shim、未改产品代码。
2. run2：3 通过、1 失败；测试文本把表格直接接在 Callout 标题后，缺少原笔记中实际存在的空引用行。
   改正这份测试文本后，run3 的 4 项在 8.4 秒内全通过。
3. run4-gap-before：用户追加间距反馈后，新间距断言实际捕获约 1.5px 的不足；保留失败 trace/报告。
4. run5-final：增加类型图标内部留白后，完整 4 项在 7.6 秒内通过；未压制 console/pageerror。
5. run6-correction-red：按用户澄清修改白线侧别断言后，2通过3失败。两项捕获普通白线位置错误；
   列表探针因遍历了没有目标正文的标题行而失败，随后把探针限定到真实缩进续行。
6. run7-list-red：真实 Enter/Tab/Backspace 捕获四格变两格；缩进探针测到两格间距仅2.05px。
   用户随后明确少格出现在删除空列表 `- `，因此将“所有手写两格也须有6px间距”的假设
   改为保留显式源码差异，并验证正确四格与字面Tab的相同宽度及充足间距。
7. run8-correction：六项全部通过10.0秒。补充显现普通引用的稳定性断言与退格后截图，
   run9-final 再次6/6通过10.5秒。没有压制页面错误或修改依赖。

本轮没有新便携包、生产 Web 构建、原生 EXE、真实 Vault、用户资料/配置或用户进程改动。
用户正在使用的 0.1.19 不包含 `862d1ef` 和本轮留白；小页面结果不等于该 EXE 已更新或完整原生验收。
未检查长标题所有换行、IME、OS 原生输入、折叠全组合或大笔记性能。
