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
  WebViewer 或已注册插件视图。中键、Delete、
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
| 内置网页、脚本、网络和 guest 权限 | 原有 WebViewer/UserscriptService | 只改宿主和新页面转发，不增加浏览器管理器 |
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
笔记和网页可替换该侧空标签。白板和媒体继续由中央既有视图承载，不复制 Canvas/media。
本体尚无数据库产品或创建动作，截图中的“新建数据库”未实现，不提供无效按钮。
同路径可以有多个稳定 id。恢复时校验形状与 WebViewer HTTP(S) 地址，保留未知插件
视图 state，等待实际注册后重试。旧 leftPanel=tags/bookmarks 迁移到右侧；左侧回退文件。
关闭、替换和远端布局移除笔记前共用 saveLeavingSidebarTab；保存失败或保存期间又发生
修改时保留原标签。每个异步替换/关闭有代次，过期结果不能覆盖较新的选择。

左右笔记和 guest 首次选中才挂载；随后隐藏时保留实例，避免丢光标/滚动或重载网页。
App 保留左侧 Sidebar 外壳，只用 open 控制可见固定面板和动态内容；不再收起就卸载宿主。
标签关闭才卸载。WorkspaceLeaf 串行化挂载、用代次取消过期结果；不重复调用 onOpen，
相同状态的 setState 不重复执行。React StrictMode cleanup 后可以安全重新挂载。
手动保存指向活动编辑器的路径；MarkdownView.save 指向自身 file，后台保存保留原含义。

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

原生 F10 的旧 switchVault 重启路径不是新底栏调用链，本轮未修改 desktop main；可信原生
插件模式仍按既有维护 blocker 拒绝切换。完整原生切换行为未验收。

## 浏览器新页面

既有 guest setWindowOpenHandler 向本地 preload 发送 `{sourceGuestId,url}`；host
对照仍挂载的 WebViewer 再创建右侧标签。拒绝原生新窗口和非 HTTP(S)，每个新 guest
继续执行既有 main 的 sandbox/contextIsolation/Node/preload 校验与 userscripts 附着。
webview 必须先设置经过验证的 src 再插入文档，否则会被原有 will-attach-webview 拒绝。
此路径不保留 window.opener；about:blank/document.write、下载、自定义 scheme 不是浏览器
兼容承诺。已有 guest 登录 session 继续使用既有默认会话，不创建或重置用户 profile。

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
