# 链接、跳转与脚注：Obsidian 行为研究及实现设计

日期：2026-10-24。研究基线：WebObsidian `7bf49b7` / 0.1.23；本机 Obsidian 1.14.5。
研究于 `4452d77` 交付；2026-10-24 用户批准后已实现首轮产品闭环。
研究时的差距保留为历史基线，当前实现及边界见下节；验证记录见
`tests/reports/link-navigation-20261024.md`。

## 当前实现

- `markdown-core` 的既有 Lezer parser 配置加入脚注语法，`footnotes.ts` 按不可变模型缓存完整定义、
  首次引用编号及逐处引用。多行定义沿用 Markdown 容器解析；不在前端另建脚注 parser。
  metadata 保留 wiki、Markdown、引用式及裸 URL 的出现范围；`fragments.ts` 提供预览范围和独立落点，
  包括标题链、块、公式、脚注定义和第几处引用。实际不存在或重复定义的脚注给出明确状态。
- `fragmentNavigation.ts` 以 main、split、sidebar ID 或具体 EditorView 归属请求；异步请求可取消，
  沿用标题/列表/Callout 的折叠状态和 sourceControls。落点用原生 mark/block wrapper 高亮三秒，
  不产生源文件编辑。历史保留选区、滚动锚点和模式；活跃视图位置随 transaction changes 映射，
  再挂载时校验小段上下文，唯一匹配或语义目标无法恢复时明确报错，不盲信过期字符偏移。
- 正文 widget、光标命令、目录/标题选择器、搜索命中、反链具体出现处、侧栏和插件 openLinkText
  共用同一入口。搜索服务从 SourceDocument 得到归一化坐标并携带原命中文本；反链展开时才读取
  候选笔记的现有 DocumentSession。插件的 eState.line 沿用零基行号并由同一导航处理。
- `linkPreview.ts` 共用可进入的延迟浮层和内容挂载；复用现有 renderEmbed、DocumentSession、
  MarkdownFragment 和 MathJax。Live 普通链接需 Ctrl/Cmd，阅读视图及脚注直接 hover；支持移入、
  滚动、复制、Esc 和关闭释放订阅。预览使用非执行上下文，缺失目标不会创建笔记。
- 阅读视图把脚注投影到文末，保留 Markdown/公式、首次引用编号和每一处回跳；Live 保留定义原位编辑，
  引用可预览并打开定义。Live 定义编号和阅读尾注编号都返回第一处引用，多处回跳箭头仍逐处定位。
  引用替换 widget 直接投影原 navigationHighlight 的范围与三秒生命周期，避免 CodeMirror mark
  无法覆盖替换节点造成落点无可见高亮；不增加第二份导航状态。片段携带完整模型和绝对范围，
  包含从零偏移开始的片段；合成页脚不写回源文件。
  尾注内嵌编辑器使用透明背景，由所属脚注条目提供背景，避免覆盖条目的落点高亮。

旧的前端脚注 regex/私有编号/直接 dispatch、Markdown 和裸 URL widget 重复识别、独立公式 hover、
path-only pending 和 path-only history 已删除。没有增加文档保存服务、Vault 索引、MathJax 引擎或折叠系统。
普通选区更新复用模型缓存，hover 不绑定 mousemove 全文扫描；预览按实际命中延迟挂载，历史最多 100 条，
每个活跃视图最多保留 220 个受 changes 映射的位置。尚未做长文性能对比，不声称提速。

打开意图为主键/Enter 当前视图、Ctrl/Cmd/中键新动态侧栏标签、Shift 分栏；继续使用现有 SidebarTabPanels，
没有另外实现中央同文件多标签系统。专用可编辑脚注侧栏、可编辑 hover 和移动端触控交互仍是后续可选阶段。
本轮交付源代码和隔离浏览器验证；原 Vault、原生窗口、物理 IME、长期使用和新安装包不在本轮验收内。

## 需求与结论

用户反馈跳转后落点不清晰，缺少 Obsidian 的高亮反馈；脚注不便预览，整体链接与导航体验尚不成熟。
需要补齐一条完整的使用流程：辨认目标、就地预览、打开到明确落点、看清目标、回到原位置。

现有问题横跨语义解析、视图导航、预览和位置历史。应扩展现有所有者并迁移调用方，不能仅在各个
链接 widget 上分别加背景色、滚动、弹窗和返回状态。普通链接、标题、块、公式引用和脚注共享
定位与导航能力；脚注另有定义、引用次数、显示编号和多处回跳的语义。

## 证据范围与可复查入口

1. 官方说明：[Internal links](https://obsidian.md/help/links)、
   [Page preview](https://obsidian.md/help/Plugins/Page%2Bpreview)、
   [Basic formatting syntax](https://obsidian.md/help/syntax)、
   [Footnotes view](https://obsidian.md/help/plugins/footnotes)。
2. 本机只读参考：`C:/Users/Meta/AppData/Roaming/obsidian/obsidian-1.14.5.asar`。
   通过仓库已有的 `@electron/asar` 读取 `package.json`、`app.js`、`app.css`；归档报告版本为 1.14.5。
   安装器外壳的版本号不同，不能把 `Program Files/Obsidian/resources/app.asar` 的包版本当成当前应用版本。
3. 使用 computer-use 只读查看了现有 STEM 窗口，窗口标题也报告 1.14.5；没有点击、输入、切页、修改
   真实笔记或设置。该截图仅提供版本和当前界面观察，不能证明下列交互已经逐项操作验收。
4. 当前仓库按以下模块逐条追踪；本轮未运行测试、类型检查、构建或新应用实例。

下表偏移为上述 `app.js` 解码成 JavaScript 字符串后的 **0 起始 UTF-16 索引**，不是字节位置。
压缩标识只用于定位证据，不应成为我们实现中的名称或依赖。仓库不保存第三方程序解包副本。

| 参考入口 | 索引/行号 | 可确认的事实 |
| --- | --- | --- |
| `$m` / 导出的 `resolveSubpath` | app.js 779350 | 从 metadata 的 headings、blocks、footnotes 解析目标；支持标题层级链及 `#[^id]` 脚注子路径 |
| MarkdownView.setEphemeralState | app.js 3090594 | subpath 先转换成 line、startLoc、endLoc，再交给当前模式 |
| 编辑器 setHighlight / highlightSearchMatches | app.js 3082281 附近 | 高亮采用源范围；光标、滚动、高亮分别处理，并可展开相交的折叠 |
| 编辑器 addHighlights / XF | app.js 2563181 / 1717274 | CodeMirror decoration 随 changes 映射，并用 effects 添加/清除 |
| 阅读 renderer.applyScroll / applyScrollDelayed | app.js 2016012 附近 | 尚未完成渲染时延后定位；定位可带 center/highlight，先显露折叠 section |
| 阅读 renderer.highlightEl | app.js 2017866 | 清除旧 is-flashing，标记目标，3 秒后移除 |
| renderer.onFootnoteLinkClick | app.js 2003569 | 在自己的 sections 中寻找脚注目标，显露、挂载、居中并高亮 |
| 脚注 HTML 转换 | app.js 764354 附近 | 定义和各次引用各有身份；同一脚注多次引用生成多个返回链接 |
| footnote postprocessor | app.js 2023206 附近 | DOM ID 加 docId 后缀，区分不同渲染文档实例 |
| 阅读脚注 hover / 编辑器 onEditorLinkMouseover | app.js 2021878 / 2591100 附近 | 两者把脚注转换成 `#[^id]`，交给通用 hover-link 入口 |
| Page preview.onHoverLink | app.js 3521951 附近 | 根据 source 选择是否需要 Mod，统一进入预览 |
| JZ / HoverPopover | app.js 2419581 | 默认等待 300ms；指针留在触发点、弹窗、子弹窗或焦点在弹窗内时维持显示；离开后延迟收起 |
| E1.create | app.js 2549907 | 使用现有 embed 文件加载/渲染能力；预览可进入原生编辑能力，而非 title 文本提示 |
| Footnotes view / Ote / Fte | app.js 3471803 附近 | 通过 metadata 维护定义与所有引用位置，按首次引用顺序组织，共用脚注 embed，支持局部编辑 |
| is-flashing / footnote styles | app.css 3307 / 12562 附近 | 高亮用主题变量；脚注与回跳有独立样式 |

## Obsidian 的行为与实现原理

### 目标先解析为语义位置，再交给视图

`[[笔记#标题]]`、`[[笔记#^块ID]]` 不是让浏览器任意查询一个全局 DOM ID。
Obsidian 先由 metadata 解析源位置，再将临时导航状态交给当前 Markdown 模式。
标题还可以按父子标题链定位；块目标可带列表结构；脚注目标携带其定义范围。

阅读和编辑模式各自完成显示。编辑模式使用 CodeMirror 的范围装饰与滚动，并展开相关折叠；
阅读模式在自己的渲染 section 中找到目标，必要时等待渲染/挂载、显露折叠，再滚动和高亮。
由此可以区分“目标不存在”和“目标存在但尚未显示”。

### 高亮是导航反馈，有自己的生命周期

阅读模式的 `highlightEl` 会清除之前的高亮，给目标添加 `is-flashing`，3 秒后移除。
编辑模式使用源范围 decoration，并将其随编辑变更映射。该调用链没有同样的 3 秒 timer，
所以不能声称两种模式有完全相同的清除时机。

`app.js` 另有一个 750ms 的通用闪烁工具；不能因它同样使用 `is-flashing` 就把它认作链接导航的时长。
我们的产品可以选择统一的短时反馈，但应把它记为自身交互选择，而非未经验证的 Obsidian 精确复刻。

### Page preview 是可进入的内容视图

官方说明与本机源码一致：预览按来源区分触发策略；编辑区通常需要 Ctrl/Cmd，阅读区默认不需要。
本机默认 source 注册还区分 search、editor、preview、tab-header，用户配置能覆盖默认值。

弹窗有显示、隐藏、焦点和子弹窗生命周期。鼠标从链接移入弹窗，不应立即关闭；可以滚动查看内容。
加载/销毁和定位也归弹窗宿主，而非在每个链接里临时创建一套监听器。
内容来自现有 embed/Markdown 渲染器，因此标题、块、脚注都可以复用这个入口。

### 脚注是双向引用关系

引用的原始 ID 与展示序号是两件事；显示序号跟随首次引用顺序。同一脚注可以在多处引用。
阅读视图为这些引用分别建立返回目标，定义后的返回链接能够区分各次引用。
点击阅读脚注会显露并居中目标，同时高亮；悬停走通用预览，但内容是脚注正文。

原生 Footnotes view 是补充入口：列出当前笔记脚注，允许在侧栏查看/编辑并定位回文档。
它复用 metadata 和 embed，不维护另一套脚注文档。官方还明确说明行内 `^[...]` 仅在阅读视图支持；
不能默认把这一限制当成我们也必须保留的产品要求。

## 研究基线中的实现差距（7bf49b7）

| 现有所有者/调用方 | 已有能力 | 本轮确认的差距 |
| --- | --- | --- |
| core `links.ts` / TargetIndex / server resolve | 文件、相对路径、编码、歧义及协议策略 | 可继续复用，不需要新文件索引或第二个路径 resolver |
| core `fragments.ts` / fragmentRange | 标题 section、普通块、公式块源范围 | 没有脚注目标；没有父子标题链；目标、预览范围、高亮范围未区分 |
| `fragmentNavigation.ts` | 视图注册、同文件片段、挂载前 pending、居中滚动 | reveal 仅用 range.from，丢弃完整范围；没有高亮、明确结果或导航位置历史；pending 仅按 path 归属 |
| `store.ts` / openWikilink | 文件解析、打开及调用 openFragment | history 为 string[]，同路径不入栈；丢失原位置、片段与视图身份；catch 静默；失效片段无反馈 |
| `semanticDecorations.ts` | 引用式链接、首次出现编号缓存、脚注编号 widget | 脚注扫描及语义位于前端；definition 只存起始 marker；点击直接 selection+scrollIntoView；title 仅是 ID/行内文字，无正文预览和回跳 |
| `livePreview.ts` | wiki/Markdown widget、脚注源样式、公式引用预览 | wiki 与 Markdown 链接打开路径不同；另有脚注 regex；公式专用 hover 尚未覆盖普通链接/脚注 |
| `editorCommands.ts` / followLink | 光标处打开 wiki/内联 Markdown 链接 | 独立按行 regex，未覆盖脚注/引用式链接，也没有统一的打开意图 |
| `CommandPalette.tsx` / headings 模式 | 当前笔记标题候选 | 另行 selection+scrollIntoView，未接入片段导航/高亮/位置历史 |
| `SearchPanel.tsx` / `RightSidebar.tsx` | 搜索上下文、反链和未链接提及 | 点击搜索命中/未链接上下文仍只 openFile；已链接提及只拿到文件列表，不能定位具体出现处 |
| 搜索 matchesFor / backlinksFor | 现有搜索与链接图 | MatchContext.ranges 只相对裁切后的 snippet，未保留全文源坐标；backlinksFor 只返回 path[] |
| `MarkdownView.tsx` / configuredMenus | 已有 link 菜单上下文、打开/复制入口 | 普通 widget 使用 data-menu-link，而引用式链接/脚注 widget 未提供同等目标；菜单应消费统一语义及打开意图 |
| `SidebarTabPanels.tsx` | 侧栏同文件显式指定 EditorView | 独立解析和打开逻辑，缺少统一的结果/历史；同文件多视图必须保留该目标归属 |
| Obsidian workspace adapter | openLinkText、leaf.openFile | 已解析到文件时绕过 openWikilink；没有统一消费链接 fragment，leaf 只处理部分 eState.line |
| `vaultRenderContext.ts` / renderEmbed | DocumentRegistry、完整模型、片段范围、订阅和渲染上下文 | 可作为预览的数据入口；需明确片段绝对位置和同笔记完整定义可见性 |
| MarkdownFragment / MathTooltip / TagPageHover | 共用 Markdown 渲染器、公式预览生命周期、标签页预览 | 没有覆盖所有来源的通用链接预览；TagPageHover 目前挂载独立片段 snapshot，未订阅后续正文更新 |

`FootnoteReference` 的定义缺失时仍显示数字而点击无结果；行内脚注的 definition 为 -1，
title 提供纯文本。这些源码事实足以解释当前能力边界，但不等于已复现用户每一次实际操作。

现有浏览器 `render.spec.ts` 对脚注主要断言显示为数字 1；这不能证明正文预览、双向导航、
重复引用和落点高亮可用。现有公式/块测试也不能替代这些场景。

## 已采用的实现设计：扩展原有核心并迁移入口

### 1. 让现有 Markdown 核心拥有脚注与目标语义

在 `packages/markdown-core/src` 补齐一个缓存于不可变 MarkdownModel 的脚注结果，
由现有 syntax/parser、literal/comment/math 范围和容器规则提供语法边界。
若需增加脚注语法支持，扩展现有 markdownParser 的配置；不能另外解析整篇 Markdown。
结果包含定义完整范围、正文范围、每次引用范围、原始 ID、显示编号、行内脚注与缺失/重复定义状态。
多行、多段、列表、引文、转义和嵌套行内标记必须由同一分析负责。

扩展 `fragments.ts` 的权威解析结果，提供目标身份、预览范围及落点范围，支持脚注子路径和标题链。
标题预览需要整个 section，而落点提示可只标出标题；块/公式/脚注按实际目标给出范围。
这是我们拟采用的高亮选择，具体范围在隔离样例中确认；不能把整个长 section 无区别染色。
现有 embed、公式、Editor 等调用方一并迁移，不另留独立的范围推断分支。

同一片段里的脚注引用，必须能够访问原文件完整模型中的定义，并携带正确的绝对位置。
不得只扫描切出来的正文，导致预览或表格中脚注失联、重新编号。

删除 `semanticDecorations.ts` 和 `livePreview.ts` 中重复的脚注识别/编号逻辑，统一消费核心结果；
插入脚注命令也复用此结果确定 ID，不再通过全篇字符串 includes 猜测占用。

现有链接 metadata 也需要保留 occurrence 的源范围和目标，而不只留下去重后的字符串集合。
键盘 followLink、反链上下文及命中定位消费同一结果，避免再写一套 token regex。
反链文件候选仍来自既有 VaultCatalog/链接图，展开时才按候选笔记获取具体出现处，不建立第二个反链索引。

### 2. 扩展现有 fragmentNavigation，完成明确的落点反馈

保留已有视图注册机制，但将请求归属到具体 leaf/EditorView 和导航代次，不只使用 path。
来自正文、侧栏、嵌入或预览的同文件跳转应回到明确指定的视图；异步加载的旧请求不能跳动后续打开的笔记。

一次导航负责解析、打开目标视图、等待模型/挂载就绪、调用现有折叠展开、滚动和高亮。
返回明确的完成、目标缺失、歧义、被取消或读取失败结果，由已有通知入口呈现实际失败。
没有找到片段不能伪装为成功定位；预览一个不存在的目标不会创建文件。

高亮放在现有 CM 扩展链的一个视图局部状态中，以 effect 更新，用原生 Decoration 显示并随 changes 映射。
渲染成替换 widget 的公式/表格等，装饰其已有宿主，不能靠覆盖层或再次移动光标补偿。
沿用现有 sourceControls 和折叠所有者，不为了高亮强制把公式、链接、整段源码全部展开。
高亮不产生文档编辑/Undo，不共享给同文件另一视图；新导航替换旧高亮，视图卸载清理 timer/effects。
拟使用约 3 秒的短时反馈，主题变量决定颜色，避免闪烁动画。

将 WikilinkWidget、MdLinkWidget、ReferenceLink、FootnoteReference、光标处 followLink、
标题选择器、搜索命中、反链/未链接提及、侧栏与插件 openLinkText 都接入这条路径，统一传递打开意图。
主键点击、Ctrl/Cmd/Shift/中键、新标签/侧栏、键盘 Enter 的行为需要按模式明确；
保留正常编辑定位与文本选择。替换当前各 widget 的无差别 mousedown 打开，不增加第二套鼠标/键盘管线。
右键菜单沿用已有 configuredMenus 与 link 上下文，统一“打开、新标签/侧栏、复制链接”的目标，
不另建链接菜单系统。

搜索结果定位扩展既有 matchesFor/API 返回值，保留匹配的绝对源范围和版本/修订上下文。
当前搜索 body 经 gray-matter 去掉 frontmatter，snippet 还会 trim；其 ranges 不是 CM 的全文坐标。
必须通过现有 SourceDocument 的 BOM/CRLF 规范化和原始范围建立映射，不能直接拿 snippet 下标滚动。
目标有未保存修改时在该 session 的共享模型中重新校准命中，不能把磁盘旧范围强行当成当前范围。
这属于补齐现有结果契约，不更换搜索引擎或新增全文缓存。

### 3. 升级现有历史条目，恢复具体位置

保留 store 中的返回/前进命令和入口，条目从 path 升级为带视图身份、path、fragment、
选区、滚动、模式和文档版本的位置。同文档跳转也能形成一次历史；预览与鼠标移动不入栈。
在离开前记录实际源位置，恢复时优先使用语义目标，再使用仍有效的视图位置；不得盲用变更后的旧偏移。
对已知变更沿现有 changes 映射位置；没有可用映射时重新解析并采用明确的退化策略。
所有位置仍属于视图，文档内容/保存/Undo 继续属于 DocumentSession。

脚注定义的“返回引用”指向某次具体 occurrence，区别于普通 workspace 返回上一位置。
多个引用可以提供多个返回目标；从预览进入定义时应带上其来源 occurrence。
回跳本身使用上述同一导航路径。

### 4. 共用内容与生命周期的预览

编辑器内沿用 CodeMirror hoverTooltip 的定位与清理；目录、搜索、反链等无 CM 位置的入口
使用 DOM 宿主适配。两类宿主共用目标解析、延迟/取消、来源策略和预览内容，不各自实现解析或抓取。
这是具体宿主差异，不应为了表面统一强行将侧栏包装成编辑器。

用现有 `RenderContext` / `renderEmbed` / DocumentRegistry 读取目标（优先当前未保存的 session），
由 MarkdownFragment 挂载既有 Markdown、资源和 MathJax 渲染。
按目标显示整篇笔记、标题 section、块、公式或脚注正文；公式仍使用现有 MathJax 缓存与宏上下文。
扩展并迁移公式引用/标签页现有预览生命周期，避免同一链接同时出现通用和公式两个浮层。
公式编号所需的语义订阅可以保留；悬停才挂载昂贵的预览内容，不能因合并而破坏编号更新。

预览首版只读、可滚动、可移入和选择复制，提供打开目标入口；Esc/离开/源视图销毁可关闭。
编辑模式默认 Ctrl/Cmd+悬停，阅读模式默认悬停，来源策略由同一设置所有者管理。
移动端没有 hover 时，使用同一预览内容提供显式入口；具体手势在后续设备交互设计中确定。
延迟读取要有 abort/generation，快速换目标、切页和卸载不会显示过期内容；正文变化通过现有订阅刷新。
预览上下文使用既有 `nonExecutingContext`，无需因看一个链接执行脚本。

### 5. 脚注正文、回跳及后续侧栏

阅读视图由核心脚注结果投影文末脚注列表和对应回跳，不把合成列表写进源文件。
Live 保留原始定义的可编辑位置，引用处展示编号并支持正文预览/打开定义；原始 ID 不自动重编号或迁移。
行内脚注可以在 Live 也提供内容预览，这是针对本产品的改进选择，需在实现时明确一致性。
缺失、重复定义提供可辨识状态，不能点击后无反应。

基础闭环完成后，可在现有 SidebarTabPanels/动态标签机制中增加脚注视图，不建立平行的侧栏系统。
侧栏列出正文、所有引用位置、未引用定义，复用同一语义/预览/导航。
侧栏编辑通过原 DocumentSession 的带版本范围补丁实现，保留其他字节和统一 Undo；
不能把 MarkdownFragment 的局部草稿误当成独立的脚注持久化文档。
可编辑 hover 和复杂嵌套预览留在此后的独立阶段，首轮无需复制 Obsidian 全部窗口能力。

## 性能、删除范围与依赖顺序

依赖顺序：脚注/片段语义 → 视图内落点与反馈 → 位置历史/各入口迁移 → 预览与脚注闭环 → 可选侧栏编辑。
拆分交付时，每一阶段都迁移自己的真实调用方并删去旧分支，不并存两条同等权威的导航路径。

- 脚注分析随 MarkdownModel 缓存；选区/viewport 变化不重扫全文，也不重建 VaultCatalog。
- hover 根据命中的元素及现有源范围取目标；不在 mousemove 中遍历所有链接、解析整篇笔记或批量渲染公式。
- 读取/渲染按实际目标发生，预览关闭后释放订阅、资源和计时器；后台变更走现有 session 通知。
- 导航历史随实际跳转写入；不在每次输入/光标变化序列化 workspace，不保存无界快照或完整变更链。
- 删除前端脚注 regex/私有编号、脚注直接 dispatch、分散链接打开处理、path-only pending 与 path-only history。
- 不新增文件索引、文档保存服务、Markdown/MathJax 引擎、独立折叠状态或源码重写器。

## 验收矩阵

这些是完整行为的验收要求；已经运行的样例和真实覆盖范围以报告为准，不能把矩阵视为全部通过。

| 层面 | 必须覆盖的行为 |
| --- | --- |
| core | 父子标题链、编码与中文、普通块/列表块/公式、脚注定义及所有引用、多段/嵌套/转义、缺失/重复定义、literal/math 排除 |
| 落点 | 同页/跨页、Live/阅读/源码、首次挂载、已折叠目标、公式/表格替换宿主、标题选择器/搜索命中/反链具体出现处、连续导航取消旧请求、目标消失明确反馈 |
| 视图归属 | 中央/侧栏同文件双开、嵌入/表格片段，只有指定视图移动/高亮，其他视图选区与滚动保留 |
| 历史 | A 的段落 → B 的标题 → B 的脚注 → 返回两次，精确恢复原位置；同页入栈、预览不入栈；编辑/改名后的恢复策略 |
| hover | Ctrl/Cmd 策略、延迟、移入滚动/复制、Esc、快速换目标、未保存正文、切页销毁、公式宏/编号、片段外定义、缺失与错误 |
| 脚注 | 非数字 ID、首次引用编号、同 ID 多次引用逐处返回、行内脚注、Live 与阅读一致、合成列表不落盘 |
| 输入与源文档 | 普通选择/编辑、Ctrl/Shift/中键/键盘、跳转不改文本/Undo，编辑脚注只改目标范围，CRLF/BOM/其他字节保留 |
| 性能 | 长笔记里普通输入/选区/鼠标移动不新增全篇扫描；对比分析次数、预览挂载次数、公式转换及订阅释放，测量后才声称改善 |

研究阶段只读取官方资料、本机版本/程序源码和当前仓库调用链；批准实施后补齐了上述共享语义、
导航、位置历史、预览和脚注闭环，并新增核心与浏览器样例。测试不能替代原 Vault、原生窗口、
物理键鼠/IME、移动端和长期验收；本轮没有生产构建或新安装包。
