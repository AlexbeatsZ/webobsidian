# PRD — WebObsidian

> Product Requirements Document
> Phiên bản: 1.20 · Cập nhật: 2026-11-01 · Trạng thái: Draft
> Changelog 1.20 (选择器排序回到上游插件逻辑): 用户反馈快速切换器排序不如原 fuzzy-chinese 插件——`rlx`
> 会把隔字跳跃命中的英文长文件名排在"热力学…"前面(旧算法字面匹配恒高于拼音匹配)。所有名称选择器
> (文件/命令/标题/文件夹/补全)改用 lazyloong/obsidian-fuzzy-chinese 的逐字 DP 匹配(字符、声母、zh/ch/sh、
> 全拼、末音节前缀,允许跳字)与评分(覆盖率² + 靠前 + 段数少 + 连续段长)。正文搜索不变。
> Changelog 1.19 (分屏组是一个整体标签): 修正 1.18 的组外标签行为。分屏组 [A,B] 相当于浏览器里的一个标签:
> 点击组外标签 C 时单独显示 C,[A,B] 作为暂存组(`parkedSplit`,随工作区持久化)留在标签栏;再点 A 或 B 恢复整组分屏
> 并聚焦所点成员。从其他入口在主栏打开暂存组成员同样恢复整组。关闭暂存组的成员会解散该组,另一页保留为普通标签。
> Changelog 1.18 (平等分屏与分屏标签组): 两个分屏栏地位平等。副栏页面也是 `tabs` 中的标签,
> 与主栏标签在标签栏合并为浏览器式分屏组;点击组内标签聚焦对应栏(组外标签行为见 1.19);
> 关闭任一栏的标签后另一栏铺满并保留其模式。标签"向右/向下分屏"及分屏命令保留当前页并在新侧打开
> Homepage(不再复制当前页),新侧 Homepage 打开文件时被替换。标签可拖到某一栏替换其内容,
> 未分屏时拖到编辑区右/下半边直接建立分屏。组内右键提供切换方向、取消分屏(两页都保留为标签)。
> Changelog 1.17 (精简与搜索性能): 删除 Canvas 白板(FR-12 退役;现有 .canvas 文件保留,
> 作为普通文本文件打开,附件清理仍识别其中的引用)与繁体字拼音词典(设置项 `search.chinese.traditional`
> 删除,索引版本升级后自动重建)。快速切换器拼音匹配改为编译式状态机 + 字母集合预筛,
> 继续输入时只在上一次结果中筛选,输入框使用延迟排序不被阻塞;匹配结果与原算法逐项一致。
> Changelog 1.16 (PRD 与现状对齐): 按 1.15 原生应用边界和 2026-10-23 个人本地运行时决定,
> 改写 §1/§2/§4–§8 及 FR-3/4/5/6/8/9/10/13:删除已退役的登录、公开分享、深链 URL、
> Agent REST API/API Key、Docker 部署和插件在线安装描述,改为本地访问控制、原生文件同步 +
> Git 备份、MCP 原生笔记操作、Android 应用;新增 FR-14/15/16 概述 fork 已交付的原生写作、
> 原生工作流和阅读辅助能力。FR 编号保持不变以免旧引用失效。仅文档修改,代码行为不变。
> Changelog 1.15 (native applications only): the owner retires the browser product,
> Web deployment/URL routing, embedded webpage browser and userscript manager.
> Maintain desktop and Android only. Retain their shared internal renderer/local
> runtime, independent sync and MCP. No future browser fallback or Web adaptation.
> [Native application boundary](docs/design/native-only.md) supersedes historical
> browser/share/deployment requirements throughout this document.
> Changelog 1.14 (native workflows): desktop browser userscripts with reviewed
> import/update/storage/GM support; per-Vault JSONC context menus; preview and
> revalidated unused-attachment trash; native tag hierarchy, source-preserving
> batches and Tag Pages. Reuse existing command/menu/catalog/session/update
> owners and suppress only migrated legacy modules. See [native workflows](docs/design/native-features.md).
> Types and isolated bundles only; runtime acceptance and new packaging remain deferred.
> Changelog 1.13 (native writing): integrate LaTeX Suite snippets/formula helpers
> and Linter formatting with shared source analysis, session history and MathJax.
> One LaTeX replacement language serves both; legacy Linter replacements migrate
> once. Preserve user snippet files and rule ordering; Conceal defaults off;
> matrix shortcuts, input-method switching and Vim are excluded. Manual save
> formats; background autosave only persists. See [native writing](docs/design/native-writing.md).
> Types and isolated bundles are static evidence; runtime acceptance is deferred.
> Changelog 1.12 (native Chinese search): one VaultCatalog, one scoped path index,
> and one MiniSearch instance for original/phonetic fields; native file/command/
> folder/heading/template pickers and link/tag completion replace Fuzzy Chinese
> Pinyin loading. Full-text panel opts into pinyin; literal agent/unlinked-mention
> calls retain their semantics. See [Chinese search](docs/design/chinese-search.md).
> Runtime and performance acceptance remain deferred; no new desktop package.
> Changelog 1.11 (compact workspace; Windows portable delivery): Windows packaging
> now defaults to x64 portable only, without a setup installer. Remove the visible desktop File/Edit menu;
> share one 32px row between tabs, sidebar toggles and native window controls.
> Remove the redundant note/format headers; move file actions to tab context menus
> and Markdown modes to a bottom-right icon menu. Collapse the ribbon with the left
> sidebar. See [workspace chrome](docs/design/desktop-window.md) for platform scope
> and the static-only acceptance boundary.
> Changelog 1.10 (editing performance): index-driven backlinks; dependency-aware
> decorations; cached plugin metadata and incremental links; reusable target and
> reverse-link indexes; shared syntax/Lezer fragments; sparse raw-source mappings;
> unified file update queues and per-file stat patches. Public file formats,
> source preservation and plugin resolution rules remain unchanged. Static-only
> checks and user acceptance: [performance design](docs/design/performance.md).
> Changelog 1.9 (plugin host): commands, settings/persistence, vault/metadata,
> workspace/editor/CM6 extensions, Markdown processors and lifecycle cleanup;
> optional trusted desktop Node/Web Viewer host. Scope and final static-only
> verification boundary: [plugin compatibility](docs/design/plugin-compatibility.md).
> Changelog 1.8 (rendering unification): source-preserving document sessions;
> one instance-scoped client engine for Live/Reading/splits/tables/embeds/Canvas;
> inclusive br source boundaries; local YAML/JSON/table patches; full-document
> readonly print and capability-scoped share enhancement with SSR fallback.
> Acceptance and v1 limits: [rendering design](docs/design/rendering-unification.md).
> Changelog 1.7 (fork direction): rebuild an Obsidian-like application for personal
> customization beyond plugin limitations. Use obsidian-typings as an API reference;
> prioritize editable core behavior and selective, verified compatibility. See §1.4.
> Changelog 1.6 (FR-13 — compact desktop title bar): Windows/Linux use a single top row
> containing File / Edit / View / Window / Help and native window controls, without an app
> icon or app-name label. Keep native menu actions and accelerators, a draggable empty area,
> and light/dark styling. macOS keeps its system menu bar. Browser UI is unchanged.
> Changelog 1.5 (FR-13 — Desktop app Electron đa nền tảng, theo yêu cầu người dùng): bổ sung **FR-13** —
> đóng gói WebObsidian thành **app cài đặt** macOS/Windows/Linux (arm64/x64/ia32). Workspace mới `desktop/`
> là **Electron shell** spawn đúng server Express hiện có như tiến trình con (qua `ELECTRON_RUN_AS_NODE`,
> bind `127.0.0.1` + cổng ngẫu nhiên) và load SPA trong `BrowserWindow`. Server được esbuild bundle thành
> **1 file `.mjs`** (không native module runtime nên cross-arch chỉ là đổi Electron binary). Lần đầu **chọn
> vault**, dữ liệu vào `userData`, **auto-login** bằng mật khẩu ngẫu nhiên/máy (không bắt đổi pass). Đóng gói
> bằng **electron-builder** (dmg/zip · Windows x64 portable · AppImage/deb); CI mới `release.yml` build matrix
> macOS/Windows/Ubuntu khi push tag `v*` và publish **GitHub Release**. Không đổi server/web code.
> Changelog 1.4 (FR-2 — Audio/Video embed: phát được như Obsidian, theo yêu cầu người dùng): embed
> `![[clip.mp4]]` / `![[song.mp3]]` giờ render **trình phát HTML5 thật** (`<video controls>` / `<audio
> controls>`) ở **cả** Live Preview, Reading view và trang public share — trước đây chỉ hiện link xanh.
> Mở thẳng file media từ file tree cũng hiện player (như ảnh). Hỗ trợ video: `mp4/webm/ogv/mov/mkv`,
> audio: `mp3/wav/m4a/3gp/flac/ogg/oga/opus` (khớp bộ extension của Obsidian). Size param `![[clip.mp4|W]]`
> đặt chiều rộng video. **Quan trọng:** route serve binary (`GET /api/files/content`, raw share) nay
> **stream + hỗ trợ HTTP Range** (206 Partial Content) nên thanh tua/seek video hoạt động và Safari phát
> được — thay vì đọc cả file vào RAM. MIME map + bộ extension gom về `server/services/mime.ts` &
> `web/lib/media.ts`. Không thêm API mới.
> Changelog 1.3 (FR-1 — File explorer header toolbar parity Obsidian, theo yêu cầu người dùng): header sidebar
> **Files** bổ sung đủ nút như Obsidian: **New note**, **New canvas**, **New folder**, **Change sort order**
> (dropdown 6 kiểu: File name A→Z/Z→A, Modified time new↔old, Created time new↔old), **Auto reveal current
> file** (toggle: tự mở folder cha + cuộn tới file đang xem), **Collapse all / Expand all**. Sort theo thời gian
> nhanh nhờ **stat cache trong RAM** ở server (`listTree` fill 1 lần, watcher invalidate file đổi → 0 syscall
> ở steady-state); `TreeNode` thêm `ctime`. Không thêm API mới (tree cũ nay kèm `mtime`/`ctime`). Canvas (FR-12):
> fix Android Chrome double-tap edit không lưu được text (commit qua doc-level pointerdown + double-tap detect).
> Changelog 1.2 (FR-2 — Ảnh: resize + zoom, theo yêu cầu người dùng): ảnh nhúng trong note giờ **kéo để
> resize** (2 thanh handle trái/phải hiện khi hover trong Live Preview) — ghi lại kích thước vào source dưới
> dạng size param Obsidian: `![[img|W]]` cho wikilink embed, `![alt|W](url)` cho ảnh markdown chuẩn (giữ tỉ lệ,
> height auto). Size param `|300` / `|300x200` nay áp dụng **cả** ảnh markdown `![](…)` (trước chỉ `![[…]]`),
> ở cả Live lẫn Reading. **Click ảnh → lightbox toàn màn hình** (cả 2 mode): cuộn chuột/pinch để zoom (theo
> con trỏ/tâm 2 ngón), kéo/1-ngón để pan, double-click reset, Esc hoặc click nền để đóng. Không thêm API mới.
> Changelog 1.1 (FR-1 — Trash UI + chế độ xoá, theo yêu cầu người dùng): bổ sung **giao diện Trash** để xem,
> **khôi phục (Restore)** và **xoá vĩnh viễn** từng file đã xoá, cùng nút **Empty trash**. Mở Trash từ nút 🗑
> trên header sidebar Files hoặc command palette ("Open trash"). Thêm setting `vault.deleteMode`
> (`trash` = chuyển vào `.trash` khôi phục được [mặc định] · `permanent` = xoá vĩnh viễn ngay) trong
> Settings → Vault & Files. API mới: `GET /api/files/trash`, `POST /api/files/trash/restore`,
> `DELETE /api/files/trash/item`, `DELETE /api/files/trash`. Restore tự né trùng tên (suffix `.restored-<ts>`)
> và dọn thư mục rỗng trong `.trash`; mọi thao tác trash đều guard path traversal (chỉ tác động trong `.trash`).
> Changelog 1.0 (FR-12 — Canvas, theo yêu cầu người dùng): clone tính năng **Canvas** của Obsidian. Khung vẽ
> vô hạn (pan/zoom) chứa các node (text markdown, file embed/link tới note hoặc ảnh, link URL, group) và các
> edge nối cạnh node có mũi tên + nhãn. Đọc/ghi đúng định dạng mở **JSON Canvas** (`.canvas`, tương thích
> Obsidian). Tạo/di chuyển/resize/đổi màu/xóa node, nối edge bằng kéo từ chấm cạnh, multi-select + marquee,
> double-click nền tạo text node, double-click text node để sửa. Autosave debounce như editor (qua store
> `content`/`save`). Tạo canvas mới: context menu file tree + command palette. Không thêm API mới (dùng
> `/api/files/content`).
> Changelog 0.9 (FR-1 — Copy/Cut/Paste trong context menu file tree theo yêu cầu người dùng): menu chuột phải
> file/folder bổ sung **Copy**, **Cut**, **Paste** (clipboard session-local, không persist/broadcast). Cut dùng
> `rename` (move) cho cả file lẫn folder; Copy dùng endpoint mới **POST `/api/files/copy`** copy đệ quy file/folder
> (qua `fs.cp` recursive, reindex các `.md` mới). Paste vào folder đích (folder được click hoặc thư mục cha của file):
> tự đặt tên không trùng (`… copy`/`… copy N`), chặn dán folder vào chính nó/thư mục con, dán Cut vào đúng chỗ cũ là
> no-op; row bị Cut làm mờ chờ dán; mục **Paste** chỉ hiện khi clipboard có dữ liệu. Right-click vùng trống
> file tree cũng ra context menu của app (New note / New folder / Paste vào vault root) thay vì menu native trình duyệt.
> Changelog 0.8 (FR-2/FR-4 — menu ⋯ parity Obsidian theo yêu cầu người dùng): menu **More options (⋯)**
> dựng lại theo cấu trúc Obsidian Desktop và bổ sung: **Backlinks in document** + **Open linked view**
> (Backlinks/Outgoing links/Outline → mở right panel); **Open in new window** (mở deep-link `/note/<path>`
> ở tab mới); **Add file property** (chèn property rỗng vào frontmatter YAML); **Find…** trong note
> (`@codemirror/search`, ⌘F/⌘⇧F/⌘G); **Export to PDF…** (Reading view + `window.print()` qua CSS
> `@media print`); **Reveal file in navigation** (mở folder tổ tiên + scroll/flash row trong file tree);
> **Open version history** (FR-4): `git log`/`git show` cho từng file qua `/api/git/log|/show`, modal liệt
> kê commit + preview + Restore version. Bỏ "Reveal in Finder"/"Open in default app" (desktop-only).
> Changelog 0.7 (FR-10 UX theo phản hồi): menu "Copy public link" → "Share…" mở **Share dialog**
> per-note (tạo link, copy URL, toggle bật/tắt, đặt/đổi password, xoá link) ở cả context menu file
> tree lẫn menu ⋯ của pane; note đang share public có **icon globe** (màu accent) cạnh tên trong
> file tree; danh sách share cache trong store (đồng bộ giữa dialog, Settings → Sharing và badge).
> Changelog 0.6 (FR-9 deploy hardening cho open-source self-host): tham số deploy chuyển hết sang `.env`
> (`VAULT_HOST_PATH`/`HTTP_BIND`/`HTTP_PORT`/`WEBOBSIDIAN_WATCH`) nên `docker-compose.yml` không bị clobber
> khi redeploy; file watcher tự fallback polling khi đụng inotify limit; healthcheck `start_period=90s`.
> Changelog 0.5: Graph (FR-2) thêm tìm node theo keywords — ô search nổi trên Graph view, gõ keywords
> hiện danh sách note/tag khả dĩ (match label/path, tag luôn xếp trước, sau đó prefix > label > path + degree), click
> (hoặc Enter = kết quả đầu) bay camera (fly animation pan+zoom mượt) tới node và highlight node đó
> (node sáng màu accent, phần không liên kết mờ đi) tới khi di chuột; Esc đóng danh sách.
> Changelog 0.4: thêm FR-11 (Mobile / responsive UI cho smartphone màn hình cảm ứng) — sidebar trái/phải
> thành drawer overlay trượt (hamburger + edge-swipe + backdrop), workspace full-width, mobile editing
> toolbar trên bàn phím (bold/italic/heading/list/checkbox/link/…), touch target ≥44px, safe-area insets.
> Tham chiếu UX Obsidian Mobile app. Cập nhật NFR khả dụng.
> Changelog 0.3: mở rộng FR-2 theo phản hồi người dùng — (a) menu "More options" (⋯) trên header mỗi pane
> (Split right/Split down, Copy screenshot cho Graph, Bookmark, Copy public link, Make a copy, Rename/Move/
> Copy path/Delete, Close tab/Close others) giống Obsidian; (b) Right sidebar đại tu thành tab strip icon
> (Backlinks · Outgoing links · Tags · Outline) với Linked mentions + **Unlinked mentions** và **Outgoing
> links** (resolved/unresolved) — trước đó chỉ có 2 panel cố định.
> Changelog 0.2: thêm FR-10 (deep-link URL `/note/...` + public share link readonly + trang quản lý share tập trung), API `/api/shares` + `/public/shares`, data model `data/shares.json`.

---

## 1. 概述

**WebObsidian**(本 fork:AlexbeatsZ/webobsidian,源自 xnohat/webobsidian v0.1.1)是一个面向个人使用的
类 Obsidian 原生应用,支持 Windows/macOS/Linux 桌面端和 Android。应用直接读写本地 Vault 目录中的
Markdown、附件和 Canvas 文件。上游的自托管网页版、登录、公开分享和 Docker 部署已全部退役,
边界见 [原生应用边界](docs/design/native-only.md) 和 [个人本地运行时](docs/design/personal-local-runtime.md)。

### 1.1 目标
- 提供与 Obsidian 桌面版相当的编辑/阅读体验(编辑器、实时预览、双链、图谱、反向链接)。
- Vault 是本地真实目录,保留现有 Markdown、附件、Canvas 和 `.obsidian/` 数据;
  配置、主题和插件的兼容程度按 §1.4 单独评估。
- 原生文件同步(独立 `sync-server/`)负责多设备实时同步,Git(含 LFS)作为定期备份和冲突历史。
- 运行时只监听本机回环地址,不需要账号或密码;配置使用 JSON/JSONC 文件,不引入数据库引擎。
- 通过 MCP 让 AI 读取 Vault 上下文、搜索,并以"提议 → 本地审阅 → 接受"的方式修改笔记。
- 内置中文(拼音)搜索、LaTeX/公式写作、格式化(Linter)等原生能力,替代对应社区插件。
- 支持加载用户实际使用的 Obsidian 社区插件(已安装的 `.obsidian/plugins/*`)。

### 1.2 不在范围内
- 浏览器版、自托管网页部署、Docker 镜像、公开分享链接、笔记 URL 深链、内置网页浏览器和用户脚本
  (2026-11-01 退役,不再添加浏览器适配)。
- 账号、密码、会话、API Key 和对外开放的 REST API(2026-10-23 退役)。
- 多用户实时协作编辑(CRDT);Obsidian Sync/Publish 官方服务。
- 应用内在线下载/安装社区插件;100% 兼容所有依赖 Obsidian 内部 Electron/Node API 的插件。

### 1.3 目标用户
- 本 fork 的所有者本人:在自己的桌面和 Android 设备上使用同一个 Vault,并按个人工作流定制核心行为。

### 1.4 本 fork 的目标与优先级

本项目的目的是重建一个可以满足用户个性化需求的 Obsidian。背景是现有 Obsidian
插件对宿主行为的修改能力有限，因此本 fork 需要允许直接修改编辑器、工作区、文件管理
和界面交互。以上目标指导后续需求取舍；前述自托管能力是已有基础。

- 以实际个性化工作流决定下一步功能，不将全量复刻或全量社区插件兼容作为前置条件。
- 参考 [obsidian-typings](https://github.com/obsidian-typings/obsidian-typings)
  理解未公开 API、对象关系和插件依赖；类型定义与辅助工具不等于完整运行时实现。
- 保留现有 Markdown、附件与 Canvas 数据，分别评估文件格式、配置语义和插件行为的兼容性。
- 现用 Manage / STEM 插件已盘点并作为首批兼容对象；命令、设置、生命周期和 CM6 等入口已接入宿主。
- 可加载不代表完整兼容；原生能力需启用可信桌面模式，最终用户工作流验收见插件兼容文档。

设计依据、源码现状和后续顺序见 [项目定位与参考边界](docs/design/product-direction.md)。

---

## 2. 系统架构

```
┌──────────────────────────────┐   ┌──────────────────────────────┐
│ 桌面壳 Electron (desktop/)   │   │ Android 壳 (android/)        │
│ 窗口/标题栏/菜单/MCP 启动器   │   │ WebView + libnode RuntimeHost│
└──────────────┬───────────────┘   └──────────────┬───────────────┘
               │ 加载共享原生渲染器 (web/:React + CodeMirror 6)
               │ HTTP + WebSocket,仅 127.0.0.1 随机端口
┌──────────────▼───────────────────────────────────▼───────────────┐
│ 本地运行时 (server/:Node + Express + TS,打包为单个 .mjs)          │
│ 本地访问检查 │ Vault 文件 │ 搜索/索引 │ 文件同步 │ Git 备份 │ 插件 │ MCP 操作 │
└──────┬──────────────┬──────────────┬──────────────┬──────────────┘
       │              │              │              │
  应用数据目录      Vault 目录      sync-server     Git 远程仓库
  settings.json    (.md/附件/       (独立发布的     (备份,可选 LFS)
  索引/日志        .canvas/.obsidian) 同步服务)
```

`packages/markdown-core`(Markdown 源码模型、审阅合并)和 `packages/search-core`(中文/拼音搜索)
由渲染器和运行时共用。

### 2.1 技术栈
| 层 | 选型 | 说明 |
|----|------|------|
| 桌面壳 | Electron + electron-builder | 以 `ELECTRON_RUN_AS_NODE` 启动打包后的本地运行时 |
| Android | 原生 Activity + WebView + Bionic `libnode.so` | 与桌面共用同一份打包运行时和渲染器 |
| 本地运行时 | Node 20+、Express、TypeScript | 只在本机回环地址提供服务 |
| 渲染器 | React + Vite + TypeScript | 原生应用内部界面,不作为网页发布 |
| 编辑器 | CodeMirror 6 | |
| Markdown | 自有 markdown-core 源码模型 + MathJax | 保留原始字节,支持局部修改 |
| 搜索 | QMD(基于 MiniSearch)+ search-core 拼音 | |
| 同步 | 原生 HTTPS 文件同步 + simple-git/git-lfs 备份 | |
| AI 集成 | MCP(本地 HTTP `/mcp` 与 stdio)+ 共享 Zod 操作契约 | 与 CLI 共用同一套操作 |
| 配置 | JSON/JSONC 文件 | 不使用数据库 |

### 2.2 项目目录结构
```
webobsidian/
├── desktop/        # Electron 壳:窗口、标题栏、路径、MCP 启动器、打包脚本
├── android/        # Android 壳:MainActivity、RuntimeHost
├── server/         # 本地运行时
│   └── src/
│       ├── routes/       # files, search, git, file-sync, plugins, settings, tags, menus, operations, mcp…
│       ├── services/     # vault, 索引, 同步, git, 插件, 设置, 标签, 附件清理…
│       ├── operations/   # MCP/CLI 共用的操作契约与分发
│       └── middleware/   # localAccess(本地访问检查)、错误处理
├── web/            # 共享原生渲染器(components, lib, styles)
├── packages/       # markdown-core, search-core
├── sync-server/    # 独立发布的文件同步服务(sync-server-v* 标签)
├── scripts/        # bundle-server 等构建/迁移脚本
├── tests/          # 单元、渲染器(Chromium)与打包后应用测试
└── docs/           # design/(模块设计)、log/(工作日志)、examples/
```

---

## 3. Yêu cầu chức năng (Functional Requirements)

### FR-1 · Vault management
- Mở/đổi Vault qua Vault 启动器(Vault 底栏);运行时只访问 `allowedRoots` 内的目录。
- CRUD file & folder: tạo, đọc, ghi, đổi tên, di chuyển, xoá. Chế độ xoá cấu hình qua
  `vault.deleteMode`: `trash` (→ `.trash`, khôi phục được — mặc định) hoặc `permanent` (xoá hẳn).
- **Trash**: giao diện xem các file đã xoá, **Restore** về vị trí gốc, **xoá vĩnh viễn** từng file, **Empty
  trash**. Trash ẩn khỏi file tree (dotfile) và khỏi watcher; mở qua nút 🗑 header Files hoặc command palette.
- **Copy/Cut/Paste** trên context menu file tree (file & folder): clipboard session-local; Cut = move (`rename`),
  Copy = copy đệ quy (`POST /api/files/copy`, `fs.cp` recursive); Paste vào folder đích, tự né trùng tên, chặn dán
  folder vào chính nó/thư mục con.
- Hỗ trợ attachments (ảnh/pdf/…); thêm/kéo thả vào app. Thư mục đích upload resolve **case-insensitive** với folder
  sẵn có (`vault.resolveDirCaseInsensitive`) — tránh tạo thư mục trùng khác hoa-thường (vd `attachments` cạnh
  `Attachments` có sẵn) trên filesystem phân biệt hoa-thường (Linux).
- Watch filesystem (chokidar) để phản ánh thay đổi ngoài (git pull, sửa trực tiếp).
- Tương thích cấu trúc `.obsidian/` (config, plugins, themes).

### FR-2 · Editor & rendering
- CodeMirror 6: syntax highlight Markdown, keybindings cơ bản.
- Live preview / Reading view chuyển đổi.
- Wikilinks `[[note]]`, embeds `![[file]]`, tags `#tag`, callouts, tasks `- [ ]`.
- **Ảnh nhúng — resize & zoom**: kéo handle 2 cạnh (trái/phải) trên ảnh trong Live Preview để đổi rộng,
  ghi lại vào source dạng size param Obsidian `![[img|W]]` / `![alt|W](url)` (giữ tỉ lệ, height auto).
  Size param `|W` / `|WxH` áp dụng cho **cả** `![[…]]` và ảnh markdown `![](…)`, ở Live lẫn Reading.
  Click ảnh → **lightbox toàn màn hình**: wheel/pinch zoom (theo con trỏ/tâm), kéo/1-ngón pan,
  double-click reset, Esc/click nền đóng (xem §22 mobile: pinch-zoom ảnh trong reading).
- **Audio/Video nhúng**: `![[clip.mp4]]` → `<video controls>`, `![[song.mp3]]` → `<audio controls>`
  (Live Preview, Reading). Video: `mp4/webm/ogv/mov/mkv`; audio: `mp3/wav/m4a/3gp/flac/ogg/
  oga/opus`. `![[clip.mp4|W]]` đặt chiều rộng video. Mở thẳng file media từ file tree → hiện player.
  Binary serve qua HTTP Range (206) để seek/Safari hoạt động; MIME + extension: `services/mime.ts` /
  `lib/media.ts`.
- Backlinks panel, outline, tag pane.
- Right sidebar dạng **tab strip icon** (giống Obsidian): Backlinks · Outgoing links · Tags · Outline.
  - Backlinks: "Linked mentions" (đếm + danh sách) **và** "Unlinked mentions" (note nhắc tên note hiện tại
    bằng plain text mà chưa link — tìm qua QMD search, loại trừ note đã link).
  - Outgoing links: mọi wikilink trong note hiện tại, phân biệt resolved/unresolved, click để mở/tạo.
- Menu **More options (⋯)** trên header mỗi pane (note lẫn Graph view), dựng theo cấu trúc Obsidian Desktop:
  - Note: Backlinks in document, Split right / Split down, Open in new window, Rename / Move file to / Make a
    copy, Bookmark, Add file property, Export to PDF…, Find…, Copy path, Open version history, Open linked view
    (Backlinks / Outgoing links / Outline), Reveal file in navigation, Close tab / Close other tabs, Delete.
  - Graph view: Copy screenshot (PNG vào clipboard), Close tab.
  - Split pane hỗ trợ 2 hướng: right (cạnh phải) và down (bên dưới); hướng split persist trong uistate.
  - Hai pane split bình đẳng: trang ở pane phụ cũng là một tab trong `tabs`; tab bar gộp hai tab đang hiển thị
    thành nhóm split kiểu trình duyệt. Click tab trong nhóm → focus pane đó (pane focus được làm nổi); click tab
    ngoài nhóm C → hiển thị riêng C; nhóm [A,B] được tạm cất (parkedSplit, persist) và vẫn hiện thành nhóm trên
    tab bar; click A hoặc B → khôi phục cả nhóm split và focus vào mục được click. Đóng tab thành viên của nhóm tạm
    cất → giải tán nhóm, tab còn lại thành tab thường. Đóng tab của một pane khi đang split → pane còn lại chiếm
    toàn bộ, giữ mode của nó.
  - "Split right/down" trên tab và lệnh split giữ trang hiện tại, mở Homepage ở phía mới (không nhân bản trang);
    Homepage phía mới bị thay thế bởi file được mở từ nó. Chuột phải tab trong nhóm: đổi hướng, bỏ split (giữ cả hai tab).
  - Kéo tab thả vào một pane để mở ở pane đó; khi chưa split, thả vào nửa phải/dưới của vùng soạn thảo để tạo split.
  - **Find/Replace trong note**: tích hợp `@codemirror/search` (panel top, ⌘F mở Find, ⌘⇧F Replace, ⌘G next).
  - **Reveal file in navigation**: mở rộng folder tổ tiên + cuộn/nháy sáng row trong file tree.
  - **Add file property**: chèn property rỗng vào frontmatter YAML (tạo block nếu chưa có) → render trong Properties widget.
  - **Export to PDF**: 整篇文档以只读方式在本地 iframe 中渲染后调用系统打印对话框(见 FR-16)。
  - Không có "Reveal in Finder" / "Open in default app"; "Open in new window" theo URL đã bỏ cùng FR-10.
- Graph view (lực đẩy, từ wikilinks).
  - Tìm node trên graph: ô search nổi (góc trên-trái), gõ keywords → danh sách node khả dĩ
    (note/tag/attachment đang hiển thị trên graph); click hoặc Enter → camera bay (pan+zoom mượt)
    tới node, node được highlight kiểu hover (accent + dim phần không liên kết) tới khi di chuột.

### FR-3 · 本地访问控制(取代原登录)
- 2026-10-23 起删除账号、密码、会话、JWT 和 API Key;详见 [个人本地运行时](docs/design/personal-local-runtime.md)。
- 运行时只绑定 `127.0.0.1` 随机端口。`server/src/middleware/localAccess.ts` 是唯一的访问判断:
  要求回环地址的 socket 对端和本地 Host;带 Origin 时必须是本地 HTTP(S) 来源;不信任任何转发头。
  Express 在所有路由和静态资源前执行该检查,WebSocket 升级复用同一判断。
- 渲染器静态资源只提供给带桌面/Android 壳标识的请求,普通浏览器请求返回 404,没有 SPA 兜底路由。
  该标识只用于区分产品形态,不是身份认证。
- 路径越界防护、Vault 维护租约、脏会话协调、基准版本校验和附件预览令牌保持原有实现。

### FR-4 · 原生文件同步与 Git 备份
- 设计见 [原生文件同步与 Git 备份](docs/design/file-sync.md)。
- **文件同步**:原生 HTTPS 传输负责实时同步 Markdown、Canvas 和附件,服务端是独立发布的
  `sync-server/`(`sync-server-v*` 标签,不影响桌面/移动版本号)。每个 Vault 的开关、有序地址列表、
  令牌和间隔保存在 `.obsidian/webobsidian/sync.jsonc`;每轮从第一个可用地址开始,认证/身份/回滚/冲突
  错误直接停止,不静默切换数据源。公网连接要求校验证书的 HTTPS,HTTP 仅允许私有/回环地址。
- **Git 备份**:Git 只做定期备份和冲突历史,配置在每个 Vault 的 `.obsidian/webobsidian/git.jsonc`
  (远程、分支、凭据、间隔、LFS 规则);备份会显式包含 `sync.jsonc`,克隆私有 Vault 仓库即可恢复同步配置。
- **单文件历史版本**:`git log`/`git show` 列出触及该文件的提交,可预览并恢复某个版本。
- 冲突:检测并提示用户,不自动合并覆盖数据。

### FR-5 · 配置(JSON/JSONC 文件)
- 应用级设置保存在应用数据目录的 `settings.json`(原子写入,zod 校验),包括 Vault 路径与删除方式、
  文件/附件默认位置、搜索(中文/拼音)、快捷键、原生功能开关、写作设置等。
- 每个 Vault 的原生配置集中在 `.obsidian/webobsidian/`:`sync.jsonc`、`git.jsonc`、`writing.jsonc`、
  `math.jsonc`、`automation.jsonc`、`menus/`、`blocks/`、`snippets/` 等。
- 不自动迁移或改写正在使用的 Vault;保留原始插件数据和未知配置。

### FR-6 · MCP 与原生笔记操作(取代原 Agent API)
- 设计见 [原生 MCP](docs/design/native-mcp.md)。不恢复账号、API Key 或对外 REST API。
- MCP 通过本地 HTTP `/mcp` 和 stdio(`server/src/mcp.ts`)提供,CLI 转发同一份 JSON;
  三者共用 `server/src/operations/contract.ts` 中的 Zod 契约。
- 六个工具:上下文、已保存文件列表、原生搜索、按范围读取、提议修改、状态查询。
- 每个提议只含一项 Markdown 笔记操作(编辑 / 新建 / 重命名);删除文件/文件夹、文件夹操作和批量操作
  在校验阶段拒绝。提议进入本地审阅收件箱,用户逐项审阅、接受后才写入。
- 桌面端提供 MCP 启动器,方便外部 AI 客户端连接。

### FR-7 · QMD Search engine
- Index toàn bộ `.md`: nội dung, tiêu đề, headings, tags, path, frontmatter.
- Truy vấn: full-text, prefix, fuzzy, fielded (`tag:`, `path:`, `title:`), boolean.
- Cập nhật incremental khi file thay đổi (qua watcher).
- Index lưu/khôi phục trên disk (`data/qmd-index.json`) để khởi động nhanh.
- 中文/拼音:见 FR-15;只内置简体字读音表(繁体词典已于 1.17 删除)。

### FR-8 · Community plugins
- Chỉ dùng plugin đã có trong Vault (không tải/cài trực tuyến). Đọc danh sách plugin từ `.obsidian/plugins/*` (manifest.json, main.js).
- Plugin loader evaluates trusted CommonJS `main.js` against the host API; this is not a security sandbox. Native Node modules require explicit desktop trust.
- Read and update vault `.obsidian/community-plugins.json`; keep each plugin's `data.json`; runtime enable/disable cleans registrations.
- Detailed APIs, existing-plugin versions, verification status and unsupported internals: [plugin compatibility](docs/design/plugin-compatibility.md).

### FR-9 · Android 应用(取代原 Docker 部署)
- 设计见 [Android 本地运行时](docs/design/android-runtime.md)。Docker 镜像/Compose 部署已于 2026-11-01 删除。
- Android 独立离线运行:`RuntimeHost` 在应用进程的后台线程中加载 Bionic `libnode.so`,运行与桌面相同的
  打包运行时(`scripts/bundle-server.mjs`);WebView 只连接本机 `127.0.0.1` 随机端口。
- 原生壳负责生命周期、WebView、权限和文件选择;编辑、保存、索引和配置沿用共享实现。
- 用户明确选择 Vault 后才启动 Node;切到后台或页面隐藏时请求保存脏会话,常规 900ms 自动保存不变。
- 内置资源按版本解压到 `files/runtime-<code>`,用户 Vault 和配置不参与解压;日志写入 `files/logs/server.log`。

### FR-10 · 深链 URL 与公开分享(已退役)
- 2026-10-23 删除公开分享;2026-11-01 删除笔记 URL(`/note/...`)、地址/历史同步、"复制应用链接"
  和"在浏览器窗口打开"等功能。见 [原生应用边界](docs/design/native-only.md)。
- 笔记内容中的外部超链接仍交给操作系统打开;不得重新引入浏览器入口或分享服务。

---

### FR-11 · Mobile / responsive UI (smartphone cảm ứng)
Mục tiêu: trải nghiệm **đọc note** và **soạn thảo note** thuận tiện trên điện thoại màn hình cảm ứng,
tham chiếu UX Obsidian Mobile. Kích hoạt theo breakpoint (`max-width: 768px`) — không phải app riêng,
cùng một codebase React.
本节布局由 Android 应用(FR-9)和窄窗口桌面端使用,不面向手机浏览器。
- **Layout drawer**: ribbon + sidebar trái và right sidebar trở thành **drawer overlay** trượt đè lên
  nội dung (không đẩy layout). Mặc định đóng → editor chiếm trọn màn hình. Mở bằng: nút hamburger (☰)
  trên thanh tab, **vuốt từ mép trái/phải** (edge-swipe), hoặc các nút toggle panel. Có **backdrop** mờ;
  chạm backdrop hoặc chọn note → drawer tự đóng. Drawer trái gồm strip ribbon (chuyển panel Files/Search/
  Graph/Bookmarks/Tags/Settings) + panel nội dung.
- **Trạng thái drawer là cục bộ thiết bị** (không persist, không broadcast qua WebSocket) → mở/đóng drawer
  trên điện thoại không ảnh hưởng trạng thái sidebar của desktop đang đồng bộ chung `uistate`.
- **Touch targets**: hàng cây thư mục, nút công cụ, tab ≥ 44px; tăng padding chạm; bỏ hover-only affordance
  (nút close tab luôn hiện trên mobile).
- **Compact editor chrome (1.11)**: no formatting strip or duplicate note header.
  Source/live/reading modes use a bottom-right icon menu, also reachable on mobile.
  File actions live in the tab context menu. Existing editor shortcuts remain.
- **Viewport & safe-area**: `viewport-fit=cover`; chừa `env(safe-area-inset-*)` cho notch/home-indicator;
  không cho double-tap zoom (app-like) nhưng giữ pinch-zoom ảnh trong reading.

### FR-12 · Canvas 白板(已退役)
- 2026-11-01 删除白板视图、"新建白板"入口和相关命令。
- Vault 中现有的 `.canvas` 文件不删除、不改写:文件同步和 Git 备份照常处理它们,打开时按普通文本(JSON)显示;
  附件清理继续解析其中的文件引用,避免误删仍被旧白板引用的附件。

### FR-13 · 桌面应用(Electron,多平台)
- 设计见 [桌面窗口](docs/design/desktop-window.md) 和 [桌面运行时打包](docs/design/desktop-runtime.md)。
- **架构**:Electron 主进程以 `ELECTRON_RUN_AS_NODE=1` 启动打包好的本地运行时
  (`resources/server/dist/index.mjs`,esbuild 单文件,不带 `node_modules`),绑定 `127.0.0.1` 随机端口,
  再在 `BrowserWindow` 中加载渲染器。直接打开本地服务,不生成密码、不登录、不写 cookie。
- **窗口外观(1.11)**:Windows/Linux 上,标签页和左右侧栏开关与原生最小化/最大化/关闭按钮共用一行 32px;
  不显示 File/Edit 菜单、应用名称、重复的笔记标题或格式工具栏。F10 打开原生应用菜单,原有快捷键保留。
  功能区竖条随左侧栏一起折叠;Markdown 视图模式切换在右下角。macOS 保留系统标题栏和菜单栏。
  两侧侧栏悬浮在文档之上;"+"打开主页而不新建文件;设置和 Vault 切换位于 Vault 底栏。
- **Vault**:通过 Vault 启动器选择或切换;Vault 内容不随应用打包。
- **打包**:electron-builder。macOS `dmg`+`zip`(arm64/x64,ad-hoc 签名,未公证);Windows x64 NSIS 安装包;
  Linux `AppImage`+`deb`(x64/arm64)。推送 `v*` 标签时 GitHub Actions 在三个平台构建并发布 Release。
- **外部依赖**:Git 备份需要系统中可用的 `git`;没有 git 时本地编辑和文件同步照常工作。
- **不做**:自动更新、商业代码签名、内置便携版 git、同一实例内多窗口打开多个 Vault。

### FR-14 · 原生写作与数学
- 设计见 [原生写作](docs/design/native-writing.md)、[原生数学](docs/design/native-math.md)、
  [公式编号](docs/design/native-equations.md)。
- **LaTeX 片段与公式辅助**:改编自 obsidian-latex-suite 1.14.0(MIT),保留片段语义、TeX 语法、括号/隐藏算法;
  不包含矩阵快捷键、输入法切换和 Vim。隐藏(Conceal)默认关闭。
- **格式化(Linter)**:改编自 obsidian-linter 1.31.2(MIT),保留全部规则、执行顺序和选项;
  手动保存时格式化,后台自动保存只写盘;拼写词典只在启用纠错时加载。
- **公式**:MathJax 渲染、宏/前导(preamble)、公式编号与引用、行内公式提示。
- 原插件实例不再加载,由 `nativePluginPolicy` 屏蔽已迁移的插件,原插件文件保持不变。

### FR-15 · 原生工作流
- 设计见 [原生功能](docs/design/native-features.md) 及其链接的子文档。
- **标签**:层级标签面板、批量重命名/合并、标签页(Tag Page)、按文件夹自动打标签规则。
- **附件清理**:预览未被引用的附件,用户明确勾选并重新校验后移入回收站,可恢复。
- **自定义菜单**:每个 Vault 用 JSONC 声明右键菜单(`.obsidian/webobsidian/menus/`)。
- **命令与快捷键**:命令面板、可自定义快捷键、用户命令、模板、标题级别命令。
- **块与脚本**:可执行的 JavaScript 代码块(含图表/组件)、查询块、块效果、图表(diagrams)、callout 列表。
- **外观**:CSS 片段、主题、字体;新建文件和附件的默认位置;正文首个标题作为笔记标题。
- **中文搜索**:单一 VaultCatalog + MiniSearch 支持原文和拼音字段;文件/命令/文件夹/标题/模板选择器
  以及链接/标签补全使用原生实现,替代 Fuzzy Chinese Pinyin 插件(见 [中文搜索](docs/design/chinese-search.md))。

### FR-16 · 工作区与阅读辅助
- 设计见 [工作区侧栏](docs/design/workspace-sidebars.md)、[文档导航](docs/design/document-navigation.md)。
- 分屏编辑(左右/上下),命令和导航跟随当前聚焦的页面;左右侧栏支持固定入口和动态标签页。
- PDF 阅读器(页面缩略图、目录大纲)、Markdown 小地图、链接悬停预览、内容引用与块引用跳转。
- 整篇文档只读打印/导出 PDF(通过本地 iframe 打印)。

---

## 4. 非功能需求(NFR)
- **安全**:运行时只监听回环地址,所有 HTTP/WebSocket 请求经 `localAccess` 检查;路径越界防护
  (拦截 `..`、`.git` 段和逃出 Vault 的符号链接);插件 `id` 先校验再作为路径段;同步令牌、Git 凭据等
  机密不写入日志和错误信息。社区插件以受信任代码运行,不是安全沙箱;原生 Node 模块需要显式信任。
- **性能**:约 1 万篇笔记的 Vault 搜索 < 100ms;大文件树按需加载;编辑时使用增量索引和按依赖更新的装饰
  (见 [性能](docs/design/performance.md))。
- **可靠性**:设置和笔记原子写入;保留原始字节,只做局部修改;同步和 Git 操作不得丢失数据,
  冲突时停止并提示。
- **平台**:Windows/macOS/Linux 桌面(x64/arm64)与 Android。
- **可用性**:桌面与触屏布局(Android)、深色/浅色主题。

---

## 5. 本地运行时 API 概览
仅供桌面/Android 壳内的渲染器和本机 MCP/CLI 调用,不对外开放。
```
GET    /api/vault-identity
/api/files/*           # 文件树、读写、新建/上传、重命名/移动、复制、删除、回收站
/api/search, /api/backlinks, /api/graph …   # 搜索与链接索引
/api/tags/*            # 标签批量操作
/api/attachments/*     # 未引用附件预览与清理
/api/git/*             # Git 备份状态/操作、单文件历史
/api/file-sync/*       # 原生文件同步状态与配置
/api/plugins/*         # 已安装插件列表、启用/停用、资源
/api/menus/*           # 自定义菜单
/api/settings, /api/writing, /api/native-features, /api/uistate
/api/operations/*      # 原生操作分发(与 MCP 共用契约)
POST   /mcp            # MCP(另有 stdio 入口)
WS     /ws             # 文件变更、索引更新等通知
```

---

## 6. 数据模型
- **应用数据目录**(每台设备):`settings.json`、搜索/文件索引、同步检查点和收发日志、缓存、日志。
  `settings.json` 主要分组:`vault`(路径、`allowedRoots`、`trash`、`deleteMode`、文件/附件默认位置)、
  `search`(中文/拼音、选择器选项)、`hotkeys`、`nativeFeatures`(标签、附件清理等)、`writing`。
- **Vault 内**:Markdown、附件、`.canvas`(JSON Canvas)、`.trash/`、`.obsidian/`(原有配置与插件)、
  `.obsidian/webobsidian/`(本 fork 的原生配置,见 FR-5)。

---

## 7. 风险与决策
- **插件兼容**:很多插件依赖 Obsidian 内部 API → 只保证用户实际使用的子集;缺失接口软失败并记录警告。
  常用插件(LaTeX Suite、Linter、Fuzzy Chinese Pinyin、用户脚本等)优先改为原生实现或明确屏蔽。
- **机密**:同步令牌和 Git 凭据保存在 Vault 配置或本地凭据中,禁止进入日志。
- **大文件**:Git 备份需配置 LFS;实时同步由原生文件传输承担。
- **同步冲突**:优先提示并手动处理,不自动合并覆盖数据。
- **无浏览器回退**:不添加浏览器兼容目标;渲染器测试可用 Chromium 作为引擎,但与原生窗口、Android 设备
  和真实 Vault 的验收分开记录。

---

## 8. 完成标准(Definition of Done)
1. 桌面端和 Android 端都能打开 Vault,浏览文件树。
2. 编辑器能打开/修改/新建/删除笔记,实时预览、双链和反向链接正常。
3. 示例 Vault 中搜索(含拼音)在 100ms 内返回结果。
4. 原生文件同步在两台设备间同步笔记和附件;Git 备份(含 LFS)成功。
5. 外部 AI 客户端通过 MCP 读取上下文、搜索,并经本地审阅完成一次笔记修改。
6. 至少一个用户实际使用的社区插件能加载并启用。
7. 推送 `v*` 标签后,三个桌面平台的安装包成功发布到 GitHub Release。
