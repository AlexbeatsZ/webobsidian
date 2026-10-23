# 2026-10-23 源码审查与归属收敛

审查基线：`90fa913`，范围：`199c4b4..90fa913`。所有项目源码行号均来自
`git show 90fa913:<path>`，不是修复中的工作区行号。后续提交修正状态不会改变本报告对
基线问题及其来源的判断。本文合并三组审查者已追到实际调用者的结果，共 **12 项问题
（P1 一项、P2 十一项）和一项清理建议**；不表示全仓、所有角度已无其他问题。

本轮只读源码、Git 差异与依赖源码。未运行 tests、typecheck、build、probe、应用、
服务、浏览器、EXE 或 UI/IME/性能验收，未新增测试。DeepSeek 收尾的 typecheck 是历史
记录，不能算本轮验证。`0.1.11` 是源码版本；已有 `0.1.10` EXE 早于本次范围中的追加
修改，本轮无新包。原 Vault、profile、运行实例与 live server/public 不变。

## 处理顺序和唯一负责人

用户要求主对话只收意见、记录和调度；功能代码由原负责人处理。强度按任务分配，
不把全部任务升为极高。以下是分派与已收到的源码回报，不是运行验收结论。

| 阶段 | 唯一负责人 | 强度 | 范围与依赖 | 当前记录 |
| --- | --- | --- | --- | --- |
| 1 | shared：data 图片 | 高 | 接续父对话未提交的 data SVG 半成品；复用图片解析树与宿主，先独立提交 | `9f8a178` 源码已提交并推送；运行/UI 未验收 |
| 2 | shared：核心 | 极高 | 阶段 1 后处理 R1/R9/R10；统一 DOM cleanup、宽度失效和区间归属计算 | R1 `f091201`、R9 `ded19c7`、R10 `64da890` 源码已提交并推送；运行/UI 未验收 |
| 并行 | blocks | 高 | quote 源码 `>` 左移一字符且正文位置不变；R2/R3 共用真实列表边界和缩进动作 | 源码修正 `a635a93` 已提交并普通推送；未验收 |
| 并行 | palette | 高 | R4–R8；实际 Editor 模式接口、CommandManager、快捷键配置生命周期 | `7edb516` 源码已提交并推送；运行/UI 未验收 |
| 并行 | JS／desktop／部署原负责人 | 中等 | R11/R12；外部路径展开和服务/健康检查 PORT 一致 | `0579ff2` 源码已提交并推送；运行/UI 未验收 |
| 并行 | math 原负责人 | 中等 | C1 删除分享遗留死导出 | `ea83f3c` 源码已提交并推送；运行/UI 未验收 |
| 收敛 | 文档协调 | 中等 | 本文及临时静态 HTML；主对话维护 feedback/AGENTS | 不改功能代码，不暂存或提交 |

共享文件先认领具名范围，再由一个 owner 实施。`livePreview.ts` 的公共 cleanup、宽度失效
归 shared；Callout/list 段归 blocks，交叉改动先协商。配置与模式接口各沿原 owner；不建
近似 helper 或第二状态。Git 写操作使用 `.local/opinion-integration-20261022/git-write.lock`
的 `FileMode.CreateNew` 排他锁；仅持有者释放，提交前检查暂存区并仅加入本人改动。

## R1 · P1 · 既有 Widget cleanup 随实例保存，不能跨 DOM 复用

**证据。** `web/src/lib/livePreview.ts:421–423` 的 MathWidget 把 controller/subscription
放在实例 WeakMap；NoteEmbedWidget `501–503`、TableWidget `846–850` 同样保存实例 cleanup，
HtmlPreviewWidget `683` 与 `710` 把 resize 回调放在实例字段。当前安装的 CodeMirror 源码
`node_modules/@codemirror/view/dist/index.js:2552–2562` 可把等价 widget 的旧 DOM 交给新
widget；`3461–3465` 对 `Reused.DOM` 不调用旧 tile 的 destroy，最终由新 tile 在 `2142`
调用新 widget 的 destroy。依赖行号是安装内容的辅助证据，不属于 Git 基线文件。

**触发与影响。** 例如把 Callout 类型作同长 `note → info` 修改，`blockLayout.ts:25–32`
的 wrapper 属性改变，需要重建外壳；内部公式文本/范围不变，MathWidget.eq (`427–428`)
仍成立。新 widget 可继承旧 DOM，却查不到旧实例 WeakMap 内的资源，后续销毁不能清理
相应订阅、abort controller、子编辑器或 listener。各 widget 的具体资源种类不同，属于
同一所有权缺陷；不是本轮新引入的四个独立问题，也不能据此认定两种抖动同根因。

**归属收敛。** shared 沿 `web/src/lib/obsidian/markdown.ts:71` 的模块级 `mounts` 和
`98–99` 的 DOM 绑定方式，使 cleanup 随 DOM 而不是 widget 实例。合并并删除被替代的
实例存储；不另建宿主。未运行泄漏或运行复现验证。

## R2 · P2 · 折叠与 Tab 对未缩进正文采用不同列表边界

**证据。** `web/src/lib/editorCommands.ts:26–29` 从列表首行扩展到 parser 的
`context.item.to`；而 `web/src/lib/listLayout.ts:30–58` 的 `markdownListFold` 已按实际
源码缩进收窄范围，拒绝把未缩进 lazy continuation 作为折叠正文。

**触发与影响。** 在列表项后紧接无缩进普通正文时，折叠不收它，但在列表首行按 Tab
仍可能把它一起真正缩进，改变原本不属于用户列表层级的源文本。复用语法树不等于复用
用户要求的范围约束。

**归属收敛。** blocks 让折叠和整项缩进消费同一显式范围，保留真实缩进续行/子项，
不增加 parser。**回报：`a635a93` 已源码修正并普通推送，未验收。**

## R3 · P2 · 新缩进命令与 Tab 的结构编辑语义重复且不一致

**证据。** `web/src/lib/nativeEditorCommands.ts:35` 把增加/减少缩进注册到 fmtIndent/
fmtOutdent；`web/src/lib/activeEditor.ts:83–94` 调用通用 indentMore/indentLess。
`web/src/lib/editorCommands.ts:10–52` 则是 Tab 使用的整项、引用前缀保护和一次事务逻辑。

**触发与影响。** 光标在带子项的父列表行时，命令可能只移动当前行，Tab 则移动整项；
改变父行缩进但未同步子项会改变 Markdown 层级归属。新命令暴露了第二套已有缩进语义。

**归属收敛。** blocks 提供既有核心动作，activeEditor 与快捷键调用它，palette 只接
exports。R2/R3 是两个可观察问题，共用一个修复核心。**回报：`a635a93` 已源码修正并
普通推送，未验收。**

## R4 · P2 · 侧栏模式命令误操作中央文档模式

**证据。** `web/src/lib/nativeCommands.ts:68–72` 直接读写全局 viewMode，Mod+E 位于
`71`。`web/src/components/Editor.tsx:20–24` 的侧栏模式却由独立 sidebarMode/setSidebarMode
拥有；本范围移除了 `editorCommands.ts` 原 Mod+E 调用 view-local togglePreview 的路径
（基线 `231` 起已只保留结构编辑键位）。

**触发与影响。** 焦点在侧栏笔记时按 Mod+E，中央模式变化，侧栏模式保持原值。
reading/live/source 相关命令也应沿当前 Editor 的模式接口核对。

**归属收敛。** palette 将命令接入实际 Editor 的 view-local 模式接口，与该视图按钮
复用；内容仍归 DocumentSession，模式不提升成共享文档状态。

## R5 · P2 · 较早的快捷键 GET 可覆盖已成功 PUT 的客户端状态

**证据。** `web/src/lib/search.ts:55–62` 在一个 Promise.all 等 catalog/settings/keys，
最后按 generation 写入 keys。`66–74` 的 updateHotkeys 成功后更新 hotkeys，却不使旧
refresh 的快捷键读取失效。

**触发与影响。** refresh 已读到旧 keys、仍在等较慢 catalog 时，PUT 完成并写入新
hotkeys；旧 Promise.all 随后完成，再写旧 keys。这里确认的是客户端回退及后续编辑的
风险，没有证据把它写成服务端已发生数据损坏。

**归属收敛。** palette 在同一配置生命周期保护读取/写入时序及 Vault 身份；不建立
第二份快捷键状态或索引。与 R6 同一配置 owner 连贯处理。

## R6 · P2 · 坏快捷键迁移阻断无关搜索目录载入

**证据。** `web/src/lib/search.ts:57` 把三份请求绑成整体成功；
`server/src/services/hotkeySettings.ts:25–28` 首次迁移读取并解析原 hotkeys.json，
坏 JSON/无效配置可使该请求拒绝，从而整组不更新 entries/settings。

**触发与影响。** 首次快捷键迁移失败时，搜索 entries 仍为空；后续目录刷新继续经过
同一失败路径，无关文件搜索也无法恢复。错误应在快捷键配置面显露。

**归属收敛。** palette 解耦 catalog 和快捷键载入的失败边界，复用现有唯一目录与
通知生命周期；不能吞掉配置错误后宣称迁移成功，也不建立第二索引。

## R7 · P2 · 同命令的等价按键被误判为冲突

**证据。** `web/src/lib/commands.ts:101–103` 按 signature 无条件追加候选，`122–126`
在候选多于一个时拒绝执行。规范化配置按 JSON 表示保留合法多组绑定；平台归一后，
Windows 的 Mod+B/Ctrl+B、macOS 的 Mod+B/Meta+B 会得到同一 signature。
`web/src/components/HotkeySettings.tsx:38–41` 却按命令 id 去重，因此设置页显示无冲突。

**触发与影响。** 同一个命令同时配置上述等价组合后，按键提示该命令与自己冲突并不
执行；设置页与实际分发判断不一致。

**归属收敛。** palette 在唯一 CommandManager 中按 signature + command id 去重；
保留不同命令的真实冲突和显式覆盖优先级，不复制分发器。

## R8 · P2 · 命令面板提示未消费有效快捷键

**证据。** `web/src/components/CommandPalette.tsx:123–126` 从旧 settings.shortcuts、
defaultShortcuts 或命令默认 hotkeys 选择提示；`147` 的 memo 依赖没有新 hotkeys。
有效覆盖/空数组禁用已由 `web/src/lib/commands.ts:82–84` 的 getHotkeys 定义。

**触发与影响。** 用户改键后面板仍可显示旧键；显式 `[]` 禁用打开命令后仍提示 Mod+O。
这是提示来源错误，与 R7 的分发误冲突分开记录。

**归属收敛。** palette 从 CommandManager.getHotkeys 取唯一有效值，并订阅既有配置
revision；不保留面板本地默认映射作为第二真相。

## R9 · P2 · 既有已知窗口宽度改变不重做公式断行

**证据。** `web/src/lib/livePreview.ts:444–466` 的 MathWidget render 在初建和数学配置
变化时运行；`427–428` 的等价判断没有宽度。`web/src/lib/mathjax.ts:261–270` 仅在
renderMath 调用时读取 containerWidth 传入转换/cache。

**触发与影响。** 窗口、侧栏或分栏改变可用宽度，内容和配置不变时复用旧 SVG，断行
仍针对旧宽度。AGENTS 已明确记录此缺口；本报告不把它称作新回归或两种抖动的根因。

**归属收敛。** shared 沿既有测量链比较有效宽度并失效必要公式，继续共用 MathJax
queue/cache；不为每个 widget 新增 observer，也不在每次测量无条件全部重渲染。

## R10 · P2 · 新公式/Callout 归属派生引入 M×C 扫描

**证据。** `web/src/lib/syntaxModel.ts:67–70` 为每个 display formula 遍历所有 Callout，
选择最深包含项；`84` 在每次 docChanged 得到新模型后执行 blocks 派生。

**触发与影响。** 同一笔记公式数 M、Callout 数 C 增长时，此段比较量为 O(M×C)，
进入普通文档修改路径。缓存保住 selection-only 更新，但不能消除每个新模型的乘积
工作量。源码证明复杂度，不证明用户已卡顿，也不包含提速数值。

**归属收敛。** shared 复用有序区间做一次扫描/嵌套栈，保持最深 Callout 归属和每个
不可变模型一次派生，不新增全文索引或第二语法模型。实际耗时未测量。

## R11 · P2 · 外部打开没有沿加载规则展开 ~/ 路径

**证据。** `web/src/lib/writing/config.ts:92` 加载规则支持 `~/` 展开到 homedir；
`web/src/components/WritingSettings.tsx:76–77` 把原始配置路径交给 ConfigurationFile。
`desktop/src/main.ts:434–439` 的 IPC 仅区分绝对路径和 Vault 相对路径，`~/` 被当成后者。

**触发与影响。** 已能从 `~/...` 加载的外部片段点击“打开”时，却解析成 Vault 下的
`~/...`，无法打开实际文件。

**归属收敛。** desktop JS 原负责人在既有外部打开路径解析中先展开受支持 home 写法，
保持 Vault 相对路径约束，不新增第二打开桥。

## R12 · P2 · Compose 自定义 PORT 与健康检查端口不一致

**证据。** `docker-compose.yml:11` 让服务使用 `${PORT:-8787}`；`25` 的 healthcheck
仍固定请求 `http://localhost:8787/healthz`。本范围改变网络/端口连接方式后，该固定值
与可配置服务端口不再对应。

**触发与影响。** 使用非 8787 PORT 时，即使服务在配置端口正常监听，健康检查仍检查
8787 并标记 unhealthy；默认值不触发此问题。

**归属收敛。** desktop/部署原负责人让健康检查消费同一 PORT，核对 Dockerfile 中同类
默认探测关系；不运行 Docker 或网络 probe 验收。

## C1 · 清理 · 分享删除后的数学配置死导出

`server/src/services/mathSettings.ts:48–54` 的 sharedMathProfile 是分享用途；基线
`git grep sharedMathProfile 90fa913` 只剩定义，无调用者。math 原负责人清理此死导出及
仅供它使用的依赖，保留实际数学配置读写。它不单列为已确认用户行为故障。

## 已排除及保留不确定的判断

- CloseSourceWidget/sourceKind 旧分支已删除，JS 已走同一自动源码生命周期；旧 EXE
  截图不能反推新源码仍有 Close source。
- Ctrl+S 的 store 保存路径已按 activeEditor 选择文档，未发现“侧栏编辑错存中央笔记”。
- 本机 HTTP/WS 共享同一来源 predicate；去 JWT 是用户明确授权的个人本地使用方案，
  不建议恢复登录，也不将此既定选择列为缺陷。
- Vault 配置已有 revision/串行保护，CSS 修改只 patch 目标字段；没有依据报告整份
  配置被无条件覆写。同命令跨窗口 PUT 整个绑定数组的冲突策略仍待定义，不列确认损坏。
- DeepSeek 翻译没有已确认的图标 ID/命令 ID 错改；不把翻译本身列作问题。
- 两种相反触发条件的公式抖动尚无运行根因证明；静态修正、编译历史、源码提交和用户
  实际验收分别记录，不互相替代。

## 本轮文档交付

### 源码交付快照（2026-10-23）

此表独立记录后续处理状态，不改写 R1–R12 的基线证据与触发条件。只读 Git 确认时，
本地 HEAD 与本地 `origin/main` 跟踪引用均为 `64da890`；未额外联网刷新远端引用。
下列“已提交”仅指源码交付，所有问题的运行/UI/IME/性能表现均未验收。

| 项目 | 源码交付 | 状态边界 |
| --- | --- | --- |
| R1 | `f091201` | 源码已提交，已包含于 `origin/main` 跟踪引用 |
| R2/R3 | `a635a93` | 源码已提交，已包含于 `origin/main` 跟踪引用 |
| R4–R8 | `7edb516` | 源码已提交，已包含于 `origin/main` 跟踪引用 |
| R9 | `ded19c7` | 源码已提交，已包含于 `origin/main` 跟踪引用 |
| R10 | `64da890` | 源码已提交，已包含于 `origin/main` 跟踪引用 |
| R11/R12 | `0579ff2` | 源码已提交，已包含于 `origin/main` 跟踪引用 |
| C1 | `ea83f3c` | 清理源码已提交，已包含于 `origin/main` 跟踪引用 |
| data 图片追加反馈 | `9f8a178` | 源码已提交，已包含于 `origin/main` 跟踪引用；不属于原 12 项问题 |

本次已安排的 R1–R12、C1 及 data 图片追加源码任务均已交付；没有剩余的本轮源码实施项。
这不表示运行问题已消失，也不关闭既有延后项或未知风险。

`0.1.11` 仍仅为源码版本，已有 `0.1.10` 是旧 EXE；这些后续提交未形成新包。
本轮没有测试、类型检查、构建、探测、应用/服务/浏览器启动或网页渲染验收。

本文是基线问题与调度记录。配套中文静态概览保存在
`C:/Users/Meta/AppData/Local/Temp/.agents/architecture-review-meta-obsidian-20261023.html`，
内含三组修复前后所有权图；完全自包含，无脚本、CDN 或远程资源，未打开浏览器。
根 AGENTS 和 feedback 清单由主协调维护；本文不暂存、不提交、不修改功能代码。
