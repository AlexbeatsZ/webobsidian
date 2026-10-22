# 当前 Vault 的可配置右键菜单

## 目标与参考边界

用户希望像 `C:/Program Files/Nilesoft Shell/shell.nss` 一样，直接维护有注释的
配置文件，自定义应用已有右键菜单。2026-10-22 只读检查了该文件以及实际导入的
`imports/modify.nss`、`file-manage.nss`、`taskbar.nss` 等规则：实际使用了 imports、
稳定系统 ID 隐藏/移动、标题弱匹配、Shift 可见性、类型/多选条件、图标、分组和子菜单。
这里复用这些声明式操作；不实现 NSS 表达式语言、Windows Shell 命令或管理员执行。

同时只读检查 `obsidian-plus/AGENTS.md` 和 `src/menu/{types,rules,settingsData,
menuCapture,main}.ts`。有价值的部分是标题空白/大小写归一化、原 section 参与弱匹配、
分组/顺序和独立生命周期。原实现的 Menu 原型全局拦截、观察项次数/历史、DOM 重排和
持久捕获目录均不迁移。原 Plus 配置、模块 flags、插件源文件完全保留。

测试 Vault 副本中的 Plus 菜单配置有 15 条规则，主要隐藏旧 Linter/Templater 动作、
改名并重排 fuzzy pinyin 移动动作、改名 Tag Folder 动作。这些名称属于旧插件；已有原生
搜索、标签、格式化取代其部分贡献，不能把旧标题哈希伪装成新的稳定 ID。现有规则不自动
执行或写回；需要时参考原数据手动写显式弱匹配，优先改用下面的新稳定 ID。

## 文件与加载生命周期

- 当前 Vault：`.obsidian/webobsidian/menus/menu.jsonc`。缺失时使用默认菜单，启动不
  创建文件。设置页可把带注释范例放入草稿，然后由用户保存。
- 文件顶层为 `version: 1`、`includes` / `imports`、`rules` 和 `items`。两种导入字段
  都是相对文件路径数组；先 includes、后 imports，深度优先处理依赖，再处理当前文件。
  一个文件只应用一次。路径名按大小写不敏感去重，便于跨 Windows/macOS/Linux 迁移。
- 只允许菜单配置目录内的 `.jsonc`；允许 `../` 回到该目录内的同级文件。拒绝越界、
  URL、反斜杠、Windows 保留设备名、符号链接/目录联接和非 JSONC 扩展名。
- 每次 Reload 最多读取 32 个文件、合计 1 MiB。配置读取仅发生在初始化、显式重载、
  设置保存或已有文件变更事件中；不扫描 Vault，不增加 watcher，不在菜单打开时读盘。
- 一次重载完整验证所有文件之后原子替换内存编译结果。JSONC 语法、未知字段、重复对象
  key、非法字段类型、循环/缺失导入、重复自定义 ID 都会阻止替换，报告文件、行、列。
  首次加载失败时使用默认菜单；后续失败时保留本 Vault 的上一个有效配置。
- 重载有 generation 标识，较慢的旧请求不能覆盖新结果。每个服务器响应携带 Vault
  token；导入和保存必须匹配同一 Vault。切换 Vault 必须释放旧 controller、创建新
  controller，禁止跨 Vault 保留上一份有效规则。
- 设置页保持每个文件自己的草稿和原始 revision；外部重载不覆盖正在输入的内容。
  已存在文件保存复用 `writeTextFile` 的串行、原子替换和冲突拒绝；新文件独占创建，
  范例不会覆盖已被外部编辑器创建的文件。保存无效配置允许继续修复，菜单保留旧规则。
- `GET /api/menus/config`、`PUT /api/menus/config` 使用现有认证和请求错误处理。
  新路由自行 `requireAuth`，主服务器只需挂载。浏览器和桌面均通过同一 Vault 服务。
- 导出下载 JSON 包，保存本次已读取的各文件相对路径和原始 JSONC（保留注释）。不导出
  未保存草稿、绝对路径或 Vault token。恢复时将各 `files[].content` 写回对应相对路径。

## JSONC 规则

```jsonc
{
  "version": 1,
  "includes": ["imports/files.jsonc"],
  "rules": [
    { "match": { "id": "file:rename" }, "title": "重命名", "icon": "pencil", "order": 0 },
    {
      "match": { "id": ["file:delete", "folder:delete"] },
      "when": { "modifiers": { "shift": false } },
      "hide": true
    },
    { "match": { "id": "file:copy-path" }, "move": { "parent": "custom:tools", "index": 0 } }
  ],
  "items": [
    {
      "id": "custom:tools", "title": "笔记工具", "icon": "wrench",
      "when": { "contexts": ["file", "tab"], "fileTypes": ["md"] },
      "submenu": [
        { "id": "custom:bookmark", "title": "切换书签", "command": "bookmark" },
        { "id": "custom:source", "title": "源码视图", "command": "source" }
      ]
    }
  ]
}
```

每个被导入文件同样带 `version: 1`，可再导入并包含自己的 rules/items。不会求值
JavaScript、模板插值或系统命令；未知字段直接报错。
可直接复制的被动范例位于 `docs/examples/configured-menus/`，包含根文件和真实的
`imports/files.jsonc`；默认不改变菜单，按需要取消对应规则的注释。

| 字段 | 实际语义 |
| --- | --- |
| `match.id` | 精确匹配字符串 ID 或字符串 ID 数组；不依赖标题/显示语言。 |
| `match.weak` | `{title, icon?, section?}`；只匹配没有 ID 的贡献。title 折叠空白并转小写，icon/section 精确比较。不会回退弱匹配有 ID 的项。 |
| `when.contexts` / `sources` | 精确匹配当前打开菜单的 kind/source。上下文由调用者显式传入。 |
| `when.selection` | `text` / `none`，检查打开瞬间的文本选区是否非空。 |
| `when.files` | `{min?, max?}`，检查打开瞬间选中文件/文件夹路径数量。 |
| `when.fileTypes` | 扩展名数组，忽略大小写和开头的点；`fileMatch: all` 默认要求所有选中项满足，`any` 要求任意满足。混合选择中的文件夹应提供空扩展名。 |
| `when.paths` | 路径 glob 数组，任一模式可满足每个选中路径。`*` 不跨 `/`，`**` 跨目录，`?` 为一个非斜杠字符；`**/` 可匹配零级目录。忽略大小写。 |
| `when.link` / `tag` | 布尔值，检查当前上下文是否包含 link/tag 字符串。 |
| `when.modifiers` | `{shift?, ctrl?, alt?, meta?}`。只约束填写的键；使用右键事件快照，不读取后来键盘状态。 |
| `when.all` / `any` / `not` | 组合条件；同一对象内所有字段做 AND，嵌套最多 12 层。 |
| `hide` | true 隐藏，false 恢复前面规则隐藏的项；隐藏子菜单父项同时隐藏其内容。 |
| `title` / `icon` | 改显示名和已有应用图标名。空 icon 清除图标。 |
| `order` | 所在分组内数值顺序，越小越前；未填写项用当前位置，数值相同时保持输入次序。 |
| `group` | 同一父菜单内相同命名组聚合，以该组首次出现的位置确定组次序；组之间一条分隔线。 |
| `move` | `{parent: ID或null, before?: ID, after?: ID, index?:非负整数}`；null 为根菜单，后三项最多填写一个，默认末尾。不存在/重复目标 ID、错误 sibling anchor 或移到自己的后代均跳过。 |
| `items` | 新增 ID、标题、图标、条件、顺序、分组；一个动作只能有 `command` 或 `submenu`。`separator:true` 可添加分隔符。空子菜单可作为 move 的容器，最终为空则移除。 |

规则按导入后顺序处理；后面的属性覆盖前面的属性。匹配依据始终是打开时的原始 ID/标题/
icon/section，前一条改名不会改变后一条弱匹配的对象。输入模型与插件贡献不被原地修改。
已存在菜单 ID 与配置新增 ID 冲突时，保留现有项并跳过该新增项。新建项的 ID 在整个配置
导入图内必须唯一。运行时重复贡献 ID 不允许作为 move 的歧义目标。

## 同一转换与已有渲染器

- 共享转换：`configuredMenus/transform.ts`。输入/输出都是现有 `ContextMenuItem`
  的扩展，保留 onClick、disabled、checked、danger、icon、section 和 submenu。
- React `ContextMenu.tsx` 在完整 items（含插件贡献）上同步调用 `applyConfiguredMenu`。
  配置更新后对原模型重新转换，避免反复改名/重复新增；禁用项不执行，勾选态可见。
  切换/释放配置会话时关闭已有 React 菜单；旧会话保留的回调也拒绝执行。
- Obsidian `Menu` 通过 `toContextMenuItems()` 使用同一转换；`loadContextMenuItems()`
  是反向桥。`MenuItem.setId()`、`setSection()`、`setWarning()` 保留元数据。
  `extendFileMenu` / `extendEditorMenu` 只做贡献合并与上下文标记，规则仅在最终渲染时运行。
- Obsidian Menu 仍用原 Menu renderer；子菜单共享根关闭生命周期，Esc、点击外部、执行
  子项、重载均释放 DOM 监听器。重载时关闭已经打开的 imperative menu，下次打开用新规则。
- 最终清理删除隐藏项/空子菜单，合并连续分隔线并去掉首尾分隔线；不丢失禁用项回调。
- 新增 command 经注入 host 委托 `sharedApp.commands`；不创建命令注册表。未知命令或
  checking 阶段不可用命令显示禁用，执行前再次检查。执行时使用打开瞬间的上下文，宿主
  必须检查文档版本/选区/活动路径防止晚到操作改到其他笔记；不能为支持某命令悄悄切换文件。

文件、文件夹、tabs、编辑器、选区、链接、标签的 ID/上下文接线归协调者，详见本地
`.local/feature-integration/menus/integration.md`。通用 `new Menu()` 默认为 generic；
没有显式上下文时不猜测当前文件、选区、链接或修饰键。未接线调用者只能应用 generic/无条件规则。
最终共享集成已为多数 file/tab/editor/link 等入口附加上下文和稳定 ID；
编辑器暂未发送插件 `editor-menu` 事件，因为调用处尚未获得兼容 Obsidian Editor/View
bridge。共享规则已经适用于其原生菜单；插件 editor-menu 贡献的完整接线仍属兼容边界。

原生 tags、attachment cleanup 和 plugin menus 应先提供带稳定 ID 的实际贡献，再走
共享转换；这些模块继续负责权限、确认、删除前重验与实际执行。配置隐藏/排序不授予删除
权限。禁用 Plus menuManager 子模块应在其构造前拦截，保留 flags/data 和其他 Plus 模块。

## 代码边界与静态验证

菜单专属代码：`web/src/lib/configuredMenus/*`、`ConfiguredMenuSettings.tsx`、
`server/src/{routes,services}/configuredMenus.ts`。本功能不修改 App、Settings、Editor、
MarkdownView、store、api、nativeCommands、runtime 或服务端入口；协调者统一整合。
web 必须直接声明既有 `jsonc-parser` 3.3.1；服务端不解析 JSONC，无新增依赖。

仅运行 TypeScript 和隔离 bundle；纯回归文件 `configuredMenus.test.ts` 已编写，当前
指令下不执行。静态证据不能代替实际右键、鼠标/键盘、插件兼容和真实 Vault 验收。
最终具体静态结果和残余共同文件错误记录在 integration.md。

本模块最终静态检查：映射当前 markdown/search-core 源码的 web 菜单入口（含准备好的
回归文件和传递依赖）TypeScript 通过；服务端菜单 route/service 的源码映射类型检查
通过；隔离 browser 菜单 bundle（store 为集成 seam）和 Node 菜单 route bundle 通过，
Node bundle 的 `node --check` 通过。输出均在 Temp/.agents/meta-obsidian-menus。
整应用静态构建和共享 host 的上下文/命令检查仍由协调者最终核对。

## 用户手动验收清单（本轮未执行）

1. 在独立测试 Vault 创建带 comments/trailing comma/includes 的配置；保存、外部编辑+
   Reload、页面刷新后确认生效。删除根配置应回到默认菜单，原 Plus 配置字节保持不变。
2. 故意制造语法错误、未知字段、循环/缺失导入、重复 ID；核对文件/行/列和上一个有效
   菜单仍可用。修复后一次 Reload 立即恢复；无效配置不覆盖其他 Vault 的规则。
3. 在 React 与 Obsidian Menu 分别检查隐藏、改名、图标、分组、同组排序、跨层移动、
   空容器、嵌套子菜单、首尾/连续分隔线、checked、disabled、danger 和原始 callback。
4. 检查 file/folder/multiple selection/tab/editor/link/tag/generic 条件、大小写扩展名、
   glob、Shift/Ctrl/Alt/Meta、组合条件，以及本地化后稳定 ID 仍匹配、弱匹配明确失配。
5. 执行已有 native/plugin 命令，检查 checkCallback 不可用态；菜单打开后切换文档/
   修改选区或正文，再点击动作，应拒绝过时上下文，不能编辑其他笔记。
6. 外部修改配置后保存旧草稿，应拒绝覆盖并保留草稿；新文件被外部创建时保存范例也应
   拒绝覆盖。切换 Vault 时清空旧会话规则和设置草稿，晚到旧请求不能覆盖当前会话。
7. 执行 tag/attachment 贡献时继续经过各自确认和重验；插件菜单贡献只应用一次规则。
   多次打开/关闭菜单后没有残留窗口监听、观察目录增长或额外 Vault 扫描。
