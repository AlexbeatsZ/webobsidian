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

## 源码修正后的复跑

原源码 owner 交付 `9aaeaec1b8f33ae8ac133b4c90ff3eb80030bc24` 后，使用显式
`git archive 9aaeaec` 更新同一独立快照，核对新的 `lineExcludedRanges` 与
InlineCode 路径。保留正确的 web 工作区 picomatch 4.0.3、隔离配置和缓存；在快照中
重新编译 search-core/markdown-core，均完成。没有修改功能源码、关闭错误检查或弱化原断言。

1. **Run3：原六项全部通过，10.1 秒。** 此前失败的跨行行内代码引用／列表前缀断言通过；
   32 组、4 个锚点的最大水平变化仍为 **0 CSS px**。旧 red trace 与截图保持原样。
2. 随后只追加两个直接保护本次代码范围调整的边界：跨行行内代码中的 HTML-shaped 行
   保持字面文本、不生成 HTML widget；围栏代码中的引用／列表／HTML 语法仍保持字面文本。
   两个边界同时检查 live 和 readonly 视图。
3. **Run4：六项原回归加两个边界全部通过，共 8 项，12.0 秒。** 页面／控制台错误断言
   均未触发，源码保留断言通过。此结果只适用于上述合成 fixture 和浏览器环境。

新增证据位于相同临时目录：

- `provenance-run3.json`：明确源码提交、测试来源及快照路径。
- `results-run3.json`、`prefix-position-samples-run3.json`：原六项 green 与几何数据。
- `results-run4.json`、`prefix-position-samples-run4.json`：最终八项结果与几何数据。
- `REPORT.md` 保留首次依赖配置错误、真实 red、源码修正和 green 的完整过程。

原 **5 pass / 1 fail** 是修正前的真实结果，没有被覆盖为通过。源码修正由原 owner 实施；
测试提交只增加两个边界与本报告。没有重跑无关旧套件，没有操作真实 Vault/profile 或新 EXE。
原生新包验收与是否重新打包由协调者、构建负责人另行记录，本报告不把浏览器通过冒充原生通过。
