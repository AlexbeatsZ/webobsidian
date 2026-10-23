# 引用前缀与跨行强调回归 — 2026-10-23

本轮获得临时测试授权。测试负责人只新增测试，未修改功能源码，也未操作用户原生界面。
原生 Computer Use 由协调者执行；以下结果来自独立 Edge 浏览器 fixture，二者不能互相替代。

## 来源与隔离

- 功能源提交：`be0d8b9`、`d64533c`。
- 实际归档快照：`aedbd7f7cde383a130f1d42116374506cb9fde0a`（随后 0.1.15 版本提交，包含上述修正）。
- 快照：`C:/Users/Meta/AppData/Local/Temp/.agents/meta-obsidian-prefix-tests-20261023/source`。
- 复用 `tests/browser/test.ts` 的页面／控制台错误断言及现有 `RenderHarness`。
- 在显式快照 cwd 和 `npm --prefix <snapshot>` 下重新编译 search-core/markdown-core，均完成。
  Vite 仅在快照中运行，端口 5187，缓存、Playwright 结果和 trace 均独立保存。
- 使用已安装的 Edge；没有安装浏览器、启动 EXE、连接真实服务或写入原／测试 Vault 笔记。
  测试笔记全部由内存 DocumentSession 合成。
- root `server/public/index.html` 的长度 909、UTC 修改时间 2026-10-23T12:05:49.8534997Z
  与本次运行前一致。这只是入口元数据检查，不代表历史误写已恢复或整棵目录审计。

## 首轮结果

正确依赖配置后的运行耗时 20.4 秒：**5 通过，1 失败**。运行错误断言保持开启且未触发。

| 用例 | 结果 | 实际检查 |
| --- | --- | --- |
| 选区／实际鼠标点击前缀稳定 | 通过 | CM 同步后立即读取及随后逐帧共 32 组、4 个正文锚点；最大水平变化 0 CSS px，容许误差 0.1px；源码不变 |
| 删除／合并行与 Undo | 通过 | 删除引用行后相邻普通行未继承旧前缀样式；合并结果与新挂载的同源码几何一致；Undo 恢复原文 |
| 跨行粗体 | 通过 | 两行 QuoteMark 和 ListMark 的原前缀宿主均保留，只显隐自身定界符，源码不变 |
| 跨行斜体 | 通过 | 同上 |
| 跨行删除线 | 通过 | 同上 |
| 跨行行内代码 | 失败 | 期望两个 `.cm-quote-prefix`，实际只有一个；第二行直接显示 `>`，未进入原前缀布局路径 |

失败使用的合成源码：

```markdown
> - `QuoteFirst
>   QuoteSecond`

Tail
```

现有 `codeRanges` 完整覆盖行时的跳过逻辑可能令第二行在构造引用／列表装饰前被跳过。
这只是源码定位线索；测试负责人未修改该逻辑，保留了失败断言，供协调者派给原源码 owner。

## 证据与运行方式

上述临时目录下保留：

- `results-run2.json`：完整结果，包含通过用例附带的几何数据。
- `prefix-position-samples.json`：解码后的 32 组锚点位置。
- `results-run2/prefix-render--prefix-mult-9739e-ral-quote-and-list-prefixes-render/`：
  `error-context.md`、`test-failed-1.png`、`trace.zip`。
- `provenance.json`、`REPORT.md`：快照与过程记录。
- `source/playwright.prefix.config.ts`：仅临时配置，复用原配置并隔离端口、缓存和输出。

实际命令在快照 cwd 执行，设置 `RENDER_TEST_BROWSER` 为已安装 Edge，然后运行：

```text
npm --prefix <snapshot> exec -- playwright test --config playwright.prefix.config.ts --project=render --grep @prefix
```

第一次配置遗漏 web 工作区独立依赖，误选根目录 picomatch 2.3.2，导致 RenderHarness 启动前
报 `process is not defined`。发现后中止重复超时，保留初始 trace；补齐快照 `web/node_modules`
已有依赖链接后使用正确的 picomatch 4.0.3。没有注入全局 process、关闭错误检查或修改正式配置。
这一配置错误不计为应用启动回归，也不计为前缀用例通过／失败。

本组不是全仓、性能、IME、打印或原生窗口验收；不覆盖原用户笔记的所有布局组合。
