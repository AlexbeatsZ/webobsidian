# 链接跳转、位置历史与脚注交互

## 安装后反馈与编号回跳修正

2026-10-24 实读用户指定的安装目录 `C:/Users/Meta/AppData/Local/Programs/WebObsidian`：
EXE/asar 均为 0.1.23，已安装首页引用的 JS/CSS 不含 cm-navigation-target、cm-footnote-entry、
cm-link-preview，保留旧 cm-footref。先前安装交付没有包含 1a783ed，不能把源码验证当成安装版验收。
截图原文确在化学动力学 01 第 1381 行定义，正文引用位于第 1337 行；仅只读查找，未改原笔记。

另修复源码两处遗漏：Live 定义 marker 改为可点击编号，阅读尾注编号 span 改为回跳链接；
均复用 core footnoteReferenceFragment 和 bindRenderedLink，返回第一处引用，保留逐处回跳箭头。
替换后的引用 widget 复用 navigationHighlight 投影背景及失效，解决 mark 无法覆盖 widget 的问题。
没有新增解析器、坐标、滚动、计时器或历史状态。

现有导航浏览器套件增加截图原句的长页双模式往返用例。修复前失败，修复后 17/17 通过，
24.9 秒，无跳过/重试；确认定义全文高亮、编号回跳、引用 widget 高亮、源文本不变。
落点截图已查看，Web 类型检查通过。首次生产构建发现 searchNavigation.test 直接引入核心源路径触发 server rootDir 错误；改为公开包入口，聚焦单测 1/1 通过。另一次构建中断来自 PowerShell 5 把 Vite 的 stderr 警告作为终止错误，构建脚本已保留原退出码判断并容许正常 stderr。0.1.24 从最终已提交源码的独立快照重建，安装和实际 EXE 验证待记录。

日期：2026-10-24。研究提交 `4452d77`；实施在共享工作区完成，合入并保留并发的 tags/Vault 提交
`39df16e`、`73d95ca` 和独立桌面提交。用户批准执行后，本轮实现首轮闭环。

## 交付行为

- 普通链接、标题链、块、公式、脚注定义及逐处引用解析为核心源范围。跳转指定 main/split/sidebar/片段
  视图，使用原折叠和 sourceControls 展开目标，原生 Decoration 高亮三秒；目标失效明确反馈。
- 正文点击、Enter、光标处跟随、菜单、标题选择器、目录、搜索具体命中、反链具体出现处及插件
  openLinkText 共用导航。插件 eState.line 继续使用零基行号。Ctrl/Cmd/中键使用现有动态侧栏标签，
  Shift 使用分栏；没有增加另一套中央多标签实现。
- 位置历史记录选区、滚动和模式；同页与跨页均可返回，快速前进后退不会多写历史分支。
  活跃视图范围随 changes 映射，重新挂载后校验有限上下文，不把旧偏移当成可靠目标。
- 普通链接 Live 需 Ctrl/Cmd 才预览，阅读模式与脚注直接 hover；浮层允许移入、滚动、复制和 Esc 关闭。
  关闭释放订阅、挂载和异步请求；预览不创建缺失文件，不执行笔记脚本。
- 脚注首次引用编号、多次引用逐处返回、行内脚注、富 Markdown/公式正文及缺失/重复状态共用核心语义。
  阅读视图合成文末脚注，Live 保留定义原位编辑；原 ID、CRLF/BOM 和其他原文不因导航而改写。
  脚注片段携带全笔记上下文，另一脚注定义改变时同步失效，避免悬停展示旧正文。

## 所有者与删除

原 Lezer Markdown parser 增加 footnoteSyntax，footnotes/extractMetadata 按不可变 MarkdownModel 缓存，
fragments 继续拥有目标范围。fragmentNavigation 继续拥有视图定位；DocumentSession、VaultCatalog、
原折叠状态、MarkdownFragment 和 MathJax 保留原职责。预览生命周期由 linkPreview 共用。

删除前端脚注 regex/私有编号/直接 dispatch、重复 Markdown/裸 URL widget 解析、独立公式 hover、
path-only pending 和 path-only history。没有新增解析引擎、文件索引、保存服务或平行折叠状态。
位置记录最多 100 条、每个活跃视图最多映射 220 个位置。选区更新和 hover 复用模型缓存，未做
长笔记性能测量，不声称编辑延迟已经改善。

## 验证环境与结果

测试输出与 Vite 缓存放在 `Temp/.agents/meta-obsidian-link-navigation-20261024`，使用已安装 Edge，
本轮独立端口 5196。API mock 和 DocumentSession 样例不接触真实 Vault；生产 server/public 未重建。
临时 Vite 精确匹配 core、search-core 及其 query 子路径；测试 CJS 仅直接导入需要的 core 纯模块。

- 核心/搜索/服务命中坐标：23 文件 **107/107 通过**，最后一次 1.89 秒。
  命令：`npx vitest run packages/markdown-core/src packages/search-core/src server/src/services/searchNavigation.test.ts`。
- 核心独立声明编译、Web/Server 隔离类型检查通过，输出不写回原 dist/public。
- 最终浏览器完整回归 **86/87 通过**，约 2.7 分钟，其中导航/脚注 **15/15 通过**；无 skip 或自动重试。
  唯一失败仍是下述已有像素断言，这次位于 scroll 500。此前一轮为 85/86，新增脚注依赖刷新用例后
  再次完整运行；没有把定向复跑的通过结果代替完整回归结果。
- 样例覆盖：主视图/侧栏同文件归属、折叠 Callout、正文/阅读/源码模式、标题/公式落点、缺失/重复脚注、
  首次编号/多处返回/行内脚注、普通 hover 修饰键/订阅/销毁、源范围校验及旧请求取消、嵌套 URL/转义
  wiki、CRLF/BOM 保留、指定行兼容、同页/跨页/编辑后历史恢复与快速前进后退。
- 已实际查看 `footnotes.png` 与 `footnote-preview.png`：文末分隔、富正文/公式、多处回跳和可进入浮层显示正常。
  截图和日志保留于 `.local/link-navigation-20261024/verification/`，此目录不进入提交。

## 像素断言与基线对照

原全语法像素用例默认两视图布局相同。现在 Live 保留脚注定义原位，阅读模式生成文末脚注，二者有意
采用不同布局；该用例只从比较样本中剔除 core 识别的脚注源范围。原 fixture 原文未改，脚注布局、
预览、回跳和源文档不变由独立导航测试验收。嵌套的真实 MarkdownFragment 产生多个 cm-content，原
语义断言明确选外层第一个。**像素容差仍为每通道 1/255，没有 skip、放宽或重试隐藏失败。**

修改后一次完整回归仍在 scroll 1000 失败：720×700 图像仅坐标 `(358,248)` 的 1 个像素相差 2/255，
可见行位置/高度完全相同。早先三次定向重复为 1 通过、2 失败，另一次在 scroll 500 的公式边缘出现
同样 1 像素、2/255 差异。

用 **未含本轮功能代码的 `git archive 73d95ca`** 做隔离对照，原像素用例三次均在 scroll 500/1000
失败；第一次同样在 `(358,248)` 仅 1 像素相差 2/255。基线和当前证据、几何及日志均已保留。
这证明该微小像素差异在基线已经存在；尚未确定抗锯齿/栅格化链路中的具体原因，不据此声称完整回归通过。

基线初次探针因临时 dependency 解析到根目录 picomatch 旧版而 `process is not defined`，不能用作产品结论；
补齐并精确指向与当前 Web 相同的项目本地 picomatch 后才得到上述有效对照。一次漏传 grep 的基线探针
被停止，只终止了明确本轮创建的基线进程树；后续探针正常退出。没有修改应用依赖或全局环境。

## 边界

专用可编辑脚注侧栏、可编辑 hover、移动端触控属于可选后续阶段。本轮没有生产构建、新 EXE、
原生窗口/物理 IME/原 Vault/全部插件/长时间使用或性能对比验收；现有 0.1.23 包不含这次源码改动。
原 Vault、profile、配置、public、用户进程及其他交付物保留。后续真实使用反馈仍可能暴露未覆盖场景。
