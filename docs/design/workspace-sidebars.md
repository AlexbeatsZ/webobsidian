# 双侧悬浮栏与视图归属

## Android / touch (0.1.17)

`useIsMobile` and the matching responsive CSS now also select a coarse primary
pointer, covering Android tablets regardless of viewport width. There is still
one `mobileDrawer` and one App touch lifecycle, shared by both SidebarDock hosts.
Edge-in opens, drawer-out closes; vertical scrolling/multitouch/cancel/selection
and horizontally scrolling content cancel or bypass the gesture. No per-platform
drawer store, duplicate listener or backend notification is added. Detailed
thresholds, storage and device acceptance entry points are in android-runtime.md.

## 用户需求与视觉基准

- 删除原生日记创建动作、命令及入口；已有 Daily 文件继续作为普通笔记，不删除用户内容。
- 左竖栏顶部为文件、搜索；右竖栏顶部为反向链接、出链、标签、大纲四个固定入口。
- 中央、左栏和右栏的 + 只创建 Homepage 标签，不创建文件。左右下方是独立笔记、
  已注册插件视图。中键、Delete、
  标题关闭按钮和右键菜单关闭标签，方向键选择标签。
- 只读参照实际 STEM `.obsidian/snippets/Hider.css` 的有效规则：浮在正文之上，
  左面板默认 280px，右栏整体 opacity=.95。hover 自动隐藏代码处于注释状态，不采用。
  两侧位于 32px 工作区标题栏下方，不覆盖原生窗口按钮；展开/收起不改变正文列宽。
- 采用用户提供的 Obsidian 参考：16–18px 单色细线图标、中性底色、紧凑菜单行、
  8px 菜单圆角、右侧勾选标记、胶囊形启动动作、带图标和分组的设置导航。
  主色和字体仍来自现有主题变量，不加载外部图标包或重新实现一套主题。
- 删除右竖栏底部的命令、插件快捷入口、同步和主题工具组；设置放到左侧仓库底栏。
  底栏用双向小箭头和仓库名打开当前仓库勾选/切换菜单，移除钻石。切换菜单打开现有
  Vault 设置，不再造一套文件夹选择器。顶部标签使用 8px 上圆角、选中标签与正文连接的
  下角、非选中 hover、选中及 hover 可见的关闭按钮，保留 32px 标题行和原生拖拽安全区。

## 一份状态与生命周期

| 职责 | 唯一归属 | 复用方式 |
| --- | --- | --- |
| 两侧壳体、宽度和拖拽清理 | SidebarDock | side 参数决定方向；宽度设备本地保存 |
| 固定面板选择、动态条目和激活 id | 既有 store + uistate | 保留 rightTabs wire 名称，side 区分位置，leftActiveId/rightActiveId 分别激活 |
| 正文、历史、冲突及落盘 | DocumentRegistry/DocumentSession | 两侧直接使用 Editor path；不复制 content |
| 选区、光标、视图模式 | 各 Editor/MarkdownView 实例 | 同文件中央/左右共享会话，保持独立编辑视图 |
| 自定义视图的创建与清理 | WorkspaceLeaf + viewRegistry + Component | SidebarTabPanels 调用既有 mountView；Modal 和左右侧栏共享加载路径 |
| 全局编辑焦点 | activeEditor | 排除 hidden/aria-hidden，覆盖命令、模板、保存 |
| 标题、块、公式定位 | fragmentNavigation | 可指定 EditorView，避免同路径多实例跳错 |
| 图标路径 | lib/icons.ts | React Icon 与 Obsidian DOM getIcon 共用目录 |
| 右键、视图、搜索排序菜单行 | ContextMenu.MenuList | 共用图标列、标签列、勾选与键盘操作 |
| 空工作区与三处 Homepage | WorkspaceLauncher | 共用新建笔记、白板、文件、网页、图谱动作，调用已有命令/选择器 |
| 左右动态栏的键盘、关闭和菜单 | SidebarTabRail | side 参数只影响位置，复用同一 store 保存/替换/关闭流程 |

rightTabs 只保存 `{id,type,state,title,icon,side?}`，不保存正文、DOM、事件或 guest id。
旧数据缺少 side 时仍归右侧；空标签迁移为 Homepage 标题/图标。中央 Homepage 使用
`home://<uuid>` 作为既有 tabs 的非文件身份，URL 映射为 `/home/<uuid>`，不进入最近文件，
不加载 DocumentSession。标签显式关闭前保留；访问其他标签不隐式删除 Homepage。
Homepage 的新建笔记、白板和图谱沿用中央工作区动作；侧栏文件选择器沿用已有 picker，
笔记可替换该侧空标签。白板和媒体继续由中央既有视图承载，不复制 Canvas/media。
本体尚无数据库产品或创建动作，截图中的“新建数据库”未实现，不提供无效按钮。
同路径可以有多个稳定 id。恢复时校验形状并丢弃已移除的网页视图，保留未知插件
视图 state，等待实际注册后重试。旧 leftPanel=tags/bookmarks 迁移到右侧；左侧回退文件。
关闭、替换和远端布局移除笔记前共用 saveLeavingSidebarTab；保存失败或保存期间又发生
修改时保留原标签。每个异步替换/关闭有代次，过期结果不能覆盖较新的选择。

左右笔记和插件视图首次选中才挂载；随后隐藏时保留实例，避免丢光标/滚动。
App 保留左侧 Sidebar 外壳，只用 open 控制可见固定面板和动态内容；不再收起就卸载宿主。
标签关闭才卸载。WorkspaceLeaf 串行化挂载、用代次取消过期结果；不重复调用 onOpen，
相同状态的 setState 不重复执行。React StrictMode cleanup 后可以安全重新挂载。
手动保存指向活动编辑器的路径；MarkdownView.save 指向自身 file，后台保存保留原含义。

## 中央分屏编辑（2026-11-01）

- 两个中央 Markdown 栏必须复用完整宿主链 `WorkspacePane → EditorPane → Editor → MarkdownView`，均显式传 `path` 和 `navigationId: main | split`；不是两个不同宿主各自调用 MarkdownView。删除副栏独有路径标题行、`.split-head` 和直接挂 Editor 的分支。两栏共用 `.pane` 布局与不占正文流的 overlay 关闭按钮；inset 分隔不扣除单栏正文宽度。Canvas 保持原中央能力，不代表支持双 Canvas。
- 不再强制分栏 `reading`。主栏即使显式传 path，仍使用既有持久化 workspace viewMode；仅侧栏及显式 path 的非 main 栏使用实例内 live/source/reading。选区、折叠与滚动继续归各 MarkdownView，不增加共享视图状态。
- 同文件复用同一 DocumentSession 的正文、历史、分析和 autosave；不同文件继续各自会话。Workspace Markdown/activeLeaf 通过注册 context.navigationId 定位 main/split/sidebar，删除 readOnly、同路径及 DOM 位置猜测。activeEditor 原 activate handler 同时处理 focusin/pointerdown，空白阅读页点击也能激活正确栏；保留 nearest-editor 过滤及对称清理，不强制 focus、不二次改 selection、不另建保存或键盘管线。
- `openToSide` 替换前和 `closeSplit` 关闭前统一等待 DocumentRegistry.saveLeaving。保存失败或保存期间再输入时保留分栏／草稿并报告错误；现有 splitGeneration 防止过期异步操作关闭或覆盖新分栏。远端布局应用也先保存原分栏，导航在打开失败后不继续定位到旧视图。
- 不新增输入时全文分析、索引构建或工作区序列化，不宣称性能提升。最终27项相关单元、25项浏览器通过；同笔记12组主题/模式/空白与富文本对照最大差0 CSS px，实际glyph字体一致。实际安装040资源零route覆盖复验通过。覆盖真实编辑落盘、独立模式/选区、共享Undo/Redo、关闭/替换屏障、507恢复及空白阅读页命令定位；报告 `tests/reports/split-editing-20261101.md`。
- 边界：Canvas 嵌入 Editor 尚未显式传 navigationId，默认 split 身份是待单独回归的静态风险；不因此恢复猜测分支。本轮不声称 Canvas、物理IME、其他平台或用户当前窗口验收。

## 平等分屏与分屏标签组（2026-11-01）

用户要求：两栏地位平等，不是一主一附；进入分屏时新侧打开 Homepage 而不是复制当前页；可以把标签拖进分栏。内部仍保留 `activePath`(main)/`splitPath`(split) 两个槽位和 navigationId，平等体现在行为上：

- `openToSide` 把副栏页面放进 `tabs`(紧跟当前主栏标签)。副栏原本是 Homepage 时，被打开的文件原位替换该 Homepage 标签，避免残留新标签页。旧 uistate 中不在 `tabs` 的 `splitPath` 仍可显示(组内临时合成标签)。
- 标签栏把 `activePath` 与 `splitPath` 两个标签合成 `.tab-split-group`(方向图标 + 两个同构 `.tab`)，副栏标签不在组外重复出现。组内点击只 `activateNavigation` 并聚焦编辑器。这取代了旧约定"主标签栏点击显式指定 main"。键盘左右按 `tabs` 顺序，通过 `data-tab-path` 定位焦点。
- 分屏组是一个整体标签(用户 2026-11-01 纠正：不能把组外标签塞进聚焦栏)。标签栏点击统一走 `showTab(path)`：分屏可见时点组外标签 C → `closeSplit`(保存屏障)后记录 `parkedSplit = { main, side, direction }`，再在主栏单独打开 C；点暂存组成员 → 清空 `parkedSplit`、主栏打开 main、`openToSide(side, direction)`，聚焦所点成员。`openFile(path, _, 'main')` 遇到暂存组成员也转给 showTab，所以快速切换器等入口同样恢复整组。不变式：`parkedSplit` 只在 `splitPath === null` 时存在；`openToSide` 建立新分屏时丢弃旧暂存组(只支持一个分屏组)。`parkedSplit` 进入 PERSIST_KEYS，路径重命名/删除时随 remap 更新或解散。关闭暂存组成员 → 解散组；关闭当前标签后若下一个活动标签是暂存组成员则恢复整组。暂存组在标签栏以 `.is-parked`(细边框、无活动底色)渲染在 main 成员的位置。`workspace:next-tab` 等命令仍在聚焦栏内切换页面，不经过 showTab。
- `closePane(view)` 是关闭一栏的唯一入口：关闭副栏 = `closeSplit` 后移除其标签；关闭主栏 = 保存屏障后把副栏页面提升为 `activePath`，并把副栏 DOM 上的 `data-mode` 写入 workspace `viewMode`，保持存活页面的模式。同文件双栏关闭任一栏只退出分屏，不删标签。`closeTab`、正文 overlay ×、`workspace:close`、`WorkspaceLeaf.detach` 都走这条路径。`closeSplit` 只表示"取消分屏"，两页都保留为标签。
- 标签右键"向右/向下分屏"、命令 `split`/`split-down` 调 `splitWithHomepage`：保留该页在主栏，新侧 `openHomepage('split')` 并聚焦。文件树/书签/链接的"在右侧打开"仍打开指定文件。
- 拖拽：标签 `draggable`，数据类型 `TAB_DRAG_TYPE`，dragover 期间路径放在 `lib/tabDrag.ts`(dragover 读不到数据)。`.editor-area` 用 capture 阶段的 dragover/drop 并 stopPropagation，防止 CodeMirror 把标签当文本插入。分屏时落点为指针下的栏；未分屏时右半/下半区域建立 right/down 分屏，其余替换主栏。指示层 `.pane-drop-indicator` 相对 `.workspace` 绝对定位，`.editor-area` 不加定位以免影响子元素。

## 活动页面与命令路由（2026-11-01）

- `activeEditor` 同时保留瞬时 navigationId 与实际活动编辑器。中央 main/split 和 sidebar:<id> 宿主在 pointerdown/focus capture 激活显式身份；原编辑器 focusin/pointerdown 继续处理实际编辑目标。弹窗、标题输入、空白阅读页、加载/卸载编辑器不把身份重置成主栏。身份不持久化，也不在普通光标移动时写工作区。
- store 的 `currentViewId/currentPath` 校验页面仍存在且可见。`openFile/navigate/openWikilink/openHomepage` 默认使用这一目标；初始 deep-link 和浏览器 URL 恢复显式指定 main；标签栏点击见“平等分屏与分屏标签组”。保存、收藏、移动、命令面板标题搜索、模板/命令上下文与插件 Workspace 使用同一解析。关闭页面后清理其历史并回到有效页面。
- 主栏保留原 history/histIndex 结构；副栏和侧栏按 navigationId 保存相同 NavigationLocation 栈。正文、选区定位、变更映射、恢复和代次取消仍调用 fragmentNavigation/DocumentSession；不同页面的返回/前进不互相消耗历史。重命名沿原路径映射同时更新全部栈。
- 右侧固定属性/引用/大纲/缩略图、底部字数和视图切换读取同一活动页面；缩略图显式传 viewId，避免同路径两个视图时跳到主栏。视图模式仍归各 MarkdownView，通过已有 mode callback 修改，不另存副本。
- 本修复不增加键盘事件管线、全文解析、索引或保存实现；焦点变化只通知实际订阅页面身份的 UI 和插件。

## 性能与简化

- 出链和大纲读取同一 DocumentSession.analysis 的共享 metadata。出链从已有本地
  MetadataCache 解析，传入源文件路径，删掉逐次正文正则和最多 200 个 resolve HTTP。
- 固定面板仅在可见时挂载；未访问的动态标签不创建编辑器/guest。
- 工作区保存监听比较 PERSIST_KEYS 的引用；真正持久化前再序列化。普通输入不再
  对完整 tabs/bookmarks 等结构做两次 JSON.stringify。
- 保留挂载的笔记/插件视图用 memo 避免其他标签的标题更新连带重渲染；指定 path 的
  Editor 不再订阅中央 activePath，侧栏也不订阅中央视图模式。
- 左侧重复 Tags/Bookmarks 宿主删除；标签命令指向右侧唯一 TagsPanel。
- 原生/插件菜单保留各自的调用与配置语义，复用图标目录和公共样式；不增加第二套菜单注册表。
- 删除 RibbonUtilities 的独立 Git 状态 15 秒轮询；原有 StatusBar 同步入口/轮询继续负责此能力。
  没有新增输入时的全文扫描或工作区序列化；未测量性能，不宣称速度改善比例。

## 仓库切换

底栏菜单和设置共用现有 VaultSettings 与 `PUT /api/settings/`。路径仍经过现有 allowedRoots
和目录校验；客户端先保存 DocumentRegistry 的脏文档，再检查同一维护 blocker。所有含
vault.path 的 PUT 复用 withVaultMaintenance/drainFileUpdates，确认所有窗口的 dirty、conflict、
saving、Canvas、pending mutation 和可信原生插件状态，维护期间冻结输入和 HTTP/后台 Git 写入。
该请求本身不计入客户端 pendingMutations 或服务器 activeWrites，避免等自己的响应造成死锁。
普通非路径设置沿原有 updater，不另建切换 endpoint 或维护队列。

server/index 持有同一 watcher 引用：先停止旧监听并 drain，再更新设置、清空文件 stat、
经既有 rebuildFileIndexes/initSearch 更新唯一索引，恢复同一 watcher；失败尝试恢复先前设置、
索引和监听。uistate 在 DATA_DIR/workspaces 归档旧仓库布局，再选取新仓库布局，避免同名
路径套用另一仓库的标签/书签/最近文件。成功沿既有 vault-changed 使旧页面停止写入，发起页
重新加载。其他窗口保留原会话直到自行重新加载。没有改真实配置或实际执行切换。

原生菜单切库现分发 vault-switch，打开同一个 VaultSettings，不再只改启动提示后重启。
启动读取服务端有效 Vault，首次/恢复选择通过既有 initialVault 通路提交；取消不创建
默认目录。可信原生插件仍按维护 blocker 拒绝切换。完整原生行为未验收。

## Document lifecycle follow-up (2026-10-23)

DocumentRegistry owns one autosave debounce per session; central/sidebar exits
share saveLeaving. FileTree, FolderPicker, WorkspaceTabs and plugin Vault share
renamePath/removePath, covering directory descendants and saved session/history.
Markdown views/sidebar hosts retain stable session/tab identities. Canvas drafts
block path changes and defer external refresh. See architecture-optimization.md
for exact rules and deleted branches. Source/diff only; no runtime checks.

## 原生应用范围（2026-11-01）

用户已取消内置网页浏览器、网页脚本和浏览器产品。WebViewer 的 guest/预加载/IPC/
弹窗路由、工作区专用挂载分支及入口均删除；恢复布局时丢弃旧 WebViewer 标签。
笔记与插件视图继续复用 SidebarDock、WorkspaceLeaf 和 DocumentSession 的生命周期。
不改原有插件文件、网页脚本存储或浏览会话数据。见 native-only.md。

## 2026-10-22 修改意见交付边界

本批遵循用户“不要验收”：仅源码阅读、修改和 Git diff 检查。没有执行类型检查、构建、
测试/fixture、浏览器、服务或原生程序，也未新增验收测试。没有打包或改 server/public/release、
真实 Vault、现有 profile。Homepage、左侧生命周期、切仓库及圆角标签均为源码完成、未验收。

## 先前实现的静态证据（不是本批结果）

本轮仅静态类型、回归源码类型和隔离生产/bundle 检查。新增 sidebarTabs.test.ts 与
tests/browser/sidebar.spec.ts 的 2 个纯状态与 4 个浏览器用例是待执行的回归源码，
不代表已运行通过。类型检查包含完整 web/server/desktop；独立生产 web、main/preload、
standalone server bundle 与相对 require/生成代码语法检查均通过。构建有既存依赖
浏览器兼容和大 chunk 提示。实际悬浮几何、
触摸/键盘、输入/保存、恢复、站点登录、新页面和长时间性能仍待用户验收。
不启动浏览器、Electron 或服务器，不改真实 Vault，不覆盖 server/public/release，不打包。

## 2026-10-23 settings and transition follow-up

Only the visible Homepage content heading was removed; launcher actions, central/
left/right + behavior and tab state remain. Both dock sides now use one shared
shell transform/visibility transition. Ribbon and content are children of that
shell; the old sidebar/right-sidebar width transition was removed. SidebarDock
retains content for the closing transition before releasing inactive fixed panels,
so the panel does not disappear while the rail moves. The caller's open flag is
still the sole expansion state; the short retention is presentation lifetime only.
The same shell works for floating desktop and narrow overlay layouts. Existing
retained note/guest views keep their previous close lifecycle. Source/diff review
only; no animation/UI/runtime acceptance or performance measurement.
