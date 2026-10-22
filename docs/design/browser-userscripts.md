# 内置浏览器用户脚本

2026-10-22。此模块替代 `webviewer-userscripts` 0.1.0 的注入和管理。实现完成后的
验收边界仍为静态 types / 隔离 bundles；没有启动 Electron、网页、服务器、单元或
HTTP/UI 测试，也没有操作真实 Vault、运行中的应用、`server/public` 或发布产物。

## 依据与实际脚本

只读核对本机 `obsidian-webviewer-userscripts` 的 AGENTS、设计及源码，以及
`.local/test-vault/.obsidian/plugins/webviewer-userscripts/data.json`。当前副本有四条：

| 脚本 | 版本 | 实际依赖 / 静态覆盖 |
| --- | --- | --- |
| ChatGPT Copy Fix | 3.4.11-local | `@grant none`，页面 DOM / 浏览器剪贴板 |
| Proxy Timezone Sync | 3.0.0 | `unsafeWindow`、同步 GM 存储、XHR、菜单、self / ipwho.is / 127.0.0.1 |
| Web Viewer Element Hider | 1.0.0 | `GM_addStyle`、document-start |
| ChatGPT Advanced LaTeX Renderer | 0.2.1 | GM 存储、值变更监听、样式、菜单、跨域字体请求、noframes |

这里只确认源码依赖已实现；登录站点、代理链、剪贴板权限、MathJax 字体和实际页面
修改效果未验收。时区脚本的后台 IP 请求仍不能自动证明当前网站的出口，继续由原
脚本的站点证据逻辑决定。保留原脚本与值，不改写其算法。

官方依据：

- [Tampermonkey 元数据/API 索引](https://www.tampermonkey.net/documentation.php)：兼容目标的定义。
- [run-at](https://www.tampermonkey.net/documentation.php?q=run_at)：四个 DOM 阶段；
  本实现不提供 Tampermonkey 的已发生 DOM 事件回放。
- [connect](https://www.tampermonkey.net/documentation.php?q=connect)：域名包括子域；
  请求和重定向目标均须检查。
- [GM XHR](https://www.tampermonkey.net/documentation.php?q=GM_xmlhttpRequest)：
  Promise 接口拼写是 `GM.xmlHttpRequest`，同时提供 abort。
- [更新 URL](https://www.tampermonkey.net/documentation.php?q=update_url)：
  检查需要 version，downloadURL none 禁用更新。
- [Electron 33.4.11 webFrame](https://github.com/electron/electron/blob/v33.4.11/docs/api/web-frame.md)：
  preload 的执行接口在 frame 未暂停时同步执行；不使用等待加载完成的主进程
  `webContents.executeJavaScript` 作为 document-start 注入方法。
- [同版本 contextBridge](https://github.com/electron/electron/blob/v33.4.11/docs/api/context-bridge.md)：
  给各 world 暴露绑定到具体脚本的函数包装，不暴露 ipcRenderer。
- [Electron 沙箱](https://www.electronjs.org/docs/latest/tutorial/sandbox)：
  preload 可用受限 electron 模块；该 bundle 不依赖 Node 内建模块或 Buffer。

## 一份存储、一套更新器、一个 guest 生命周期

`desktop/src/userscripts/store.ts` 唯一拥有源码、离线 assets、授权、启用、更新状态
及 GM 值。JSON 位于桌面 `server-data/userscripts/<vault-path-hash>.json`，Vault
键使用实际 `server-data/settings.json` 中的 `vault.path`，不只采用启动默认路径。
每次管理调用先核对有效 Vault；切换时取消更新/导入、失效旧 guest 权限并切换存储。
应用切库路径与退出等待异步队列落盘。临时文件写完后同目录原子 rename；损坏文件
直接报告，不以空配置覆盖。

第一次初始化只读导入旧 schema 1：保留 ID、启用状态、时间及全部 GM 值；已有
require 缓存离线导入。缺失 asset 或不支持元数据的脚本保留源码与值，关闭并显示
迁移错误，等待修复/重新导入。原插件目录和启用列表不变，加载器由协调模块阻止
旧注入器重复运行。新脚本和全局/逐脚本自动更新默认关闭。

源码/URL/文件导入共用 prepareBundle。下载并解析全部资产成功后才安装；同
namespace/name 的重导入暂存在原记录，明确审阅后替换。编辑器保存带 revision，
防止旧编辑器覆盖新源码。重新导入/更新保留原 ID、启用、存储和自动更新设置。
卸载可保留值：同 namespace/name 再次导入时恢复原 ID 和数据；不保留授权/启用。

`updater.ts` 每分钟检查到期任务，用户设置的间隔为 1–720 小时；只有全局与逐脚本
均开启才自动更新。单脚本并发合并，批量逐个处理；metadata 请求使用 ETag /
Last-Modified。@updateURL、@downloadURL 和来源 URL 有明确回退；none 无更新。
比较数字分段和自然预发布段，忽略 build metadata；不是 Tampermonkey 全部历史
版本字符串排序的复刻。下载源码须身份相同且版本不低于更新元数据，安装须仍为
被检查的 revision。资产/网络/校验失败保留旧版及旧校验器，供重试。

增加 grant、connect、页面 world 或正向 URL 规则、删除排除规则时暂存候选，
等待用户审阅。允许更宽权限仍须显式批准。
待审版本绑定唯一 candidateId，后台检查不能在旧审阅按钮下替换候选源码；手动同身份
导入进入 import-review，自动检查不会覆盖或安装。收紧匹配或授权立即限制旧 guest
的原生请求；旧下载的 revision 检查不能覆盖并发保存或导入。
更新不会把已打开网页上的旧脚本热替换，要重新加载页面；暂停/卸载取消其未完成的
GM 请求，但无法逆转已修改 DOM、原型或定时器。

网络统一由 `network.ts` 的 Electron net/session fetch 完成，不另建服务端代理。
脚本/资产 8 MiB，单脚本合计 24 MiB，GM 响应 16 MiB；至多八次重定向，每一跳
重新检查 HTTP(S)、凭据与 connect，跨源重定向移除 Authorization/Cookie 头。
GM 使用 guest 的 session；anonymous 请求不发 cookies。脚本/更新下载不发 cookies。
总 store 限制 96 MiB，单次 GM 值修改 8 MiB；限制错误直接显示。

## 隔离与生命周期

内置 WebViewer 不依赖 `trustedPlugins`。main 启用既有 webviewTag，但强制 guest
`sandbox=true`、`contextIsolation=true`、各 Node 开关关闭、webSecurity 开启；
外来 preload 被替换为应用已有的 `preload.js`，以 guest 专用启动参数分支执行。
不暴露桌面 host API、Node require 或文件能力，不新建浏览器/插件宿主。

初始脚本快照由 preload 同步取得，再通过 webFrame 执行：start 在 preload；body
等待 body；end 等 DOMContentLoaded；idle 在之后的任务。assets 均已离线准备。
Electron 接口允许提前同步执行，但具体站点的先后顺序、弹窗暂停及 CSP 行为仍需
用户验收；不宣称已在实际站点证明早于所有页面脚本。

有 GM 授权且没有 unsafeWindow 的脚本，各占一个 1000+ isolated world。无 grant、
grant none、unsafeWindow 使用页面 world，以覆盖现有 Date/Intl 修改和页面脚本。
页面 world 有明确代价：网站能够接触该脚本缓存值及其已授权桥接能力；不能把
它当作 Tampermonkey 的安全沙箱。导入默认关闭，审阅页明确展示这一点；从旧
插件迁移时保持其原有页面 world 信任与启用选择。

主进程检查 host 为本地顶层应用 frame；guest 为本应用 webview 主 frame，按文档
token、脚本 revision、当前启用、URL 元数据、grant、connect 和保存的批准范围
校验能力。完整导航/进程退出清除授权及菜单并取消请求；文档销毁由 Chromium
清除脚本环境。SPA 导航重新匹配，只运行此前未运行的新匹配脚本，每文档只一次；
已运行脚本自行处理应用 DOM 变化。当前 iframe 不注入，包括同源 iframe；没有
noframes 的脚本在设置中显示限制。BFCache 恢复时重新读取文档权限。

## 兼容矩阵

| 范围 | 支持 | 明确边界 |
| --- | --- | --- |
| @match / @exclude-match | HTTP(S)、通配 scheme/host/path、all_urls；不含 hash | 无 file/ftp/custom scheme，无显式端口模式 |
| @include / @exclude | URL glob、`/regex/` | 无 Tampermonkey 全部浏览器匹配扩展 |
| @run-at | start/body/end/idle | 无 context-menu/run-in，无 DOM 事件缓存回放 |
| @require | 按顺序离线下载、编译检查、和脚本同一词法 wrapper | HTTP(S)；不在页面加载时刷新；不支持 ES module import |
| @resource | 离线字节、UTF-8 text、data URL | 不提供 charset 协商或实时资源 URL |
| integrity | require/resource 的 sha256/384/512，hex/base64 | 其他 hash/多算法片段显式报错 |
| @grant | 只绑定声明 API；legacy grant 同时暴露相应 GM 方法；info 总可用 | 不支持的 grant/执行指令拒绝导入，不返回空 shim |
| @connect | 同源、self、域名及子域、IP、localhost、星号 | 不支持交互式临时域授权；每一跳重查；页面自身 fetch 仍受浏览器约束 |
| GM 值 | get/set/delete/list、批量 get/set/delete；legacy 同步缓存、modern Promise 落盘 | JSON 值；undefined 用 delete；同步 setter 的异步落盘错误显示状态，不能同步回抛 |
| 值监听 | add/remove，当前 world 本地 remote=false，其他 guest/设置修改 remote=true | JSON 数据；非完整 Tampermonkey 类型序列化 |
| DOM | addStyle/addElement、resource text/URL、log、info | 页面 CSP/Trusted Types 仍可能限制 DOM API；不规避站点策略 |
| 菜单 | register/unregister；页面工具条与设置页可执行；可用 id 替换同名 ID | 无 accessKey/图标/高级浏览器菜单选项 |
| GM XHR | legacy callbacks；modern abortable Promise；text/json/arraybuffer/blob/document；状态/最终 URL/响应头；abort/timeout/error/loadend/最终 readyState | body 仅 string/URLSearchParams；无 stream、进度、同步请求、FormData/文件、手工 cookie/proxy/认证/MIME 设置；不支持的选项当场报错 |
| Clipboard | plain text 写入 | 无 HTML/图片；网站普通 clipboard API 仍需浏览器权限 |
| Notification | 原生 text/title/silent | 无 click/image 等高级参数，显式报错 |
| 不提供的 GM | — | download、openInTab 控制句柄、cookie、webRequest、audio、tabs 等；声明即拒绝，不静默成功 |
| iframe | 不注入 | noframes 有效；其余脚本提示主文档限制 |
| 普通 web 客户端 | 显示不支持 | 无伪造注入/持久化成功 |

## 文件与集成入口

- Desktop metadata/network/store/updater/runtime/guest/service 各司一职；`main.ts`
  初始化/销毁并接 webview 生命周期，`preload.ts` 提供限定管理桥和 guest 分支。
- `web/src/lib/userscripts/client.ts`：`bootstrapUserscripts(): () => void`、
  `refreshUserscripts(): Promise<void>`、`useUserscripts()`、`userscriptRequest()`。
  初始化可重入并 ref-count；GM 值变更不触发整份源码列表重刷。
- `UserscriptSettings` 无 Props；`userscriptCommands` 汇入既有命令表。
  设置页事件 `userscripts:open-settings`；不另建命令/热键注册表。
- `WebViewerView` 复用既有 guest，增加导航/重载、脚本菜单与可读执行状态。
- WebViewer 使用右侧标签宿主（见 workspace-sidebars.md）。guest 的 HTTP(S)
  新页面由既有 setWindowOpenHandler 拒绝原生弹窗后转发给本地 host，再创建右侧标签；
  host 按 sourceGuestId 对照仍挂载的 WebViewer。切换标签不移除 webview，关闭才清理。
  这不保留 window.opener，也不支持 about:blank/document.write 弹窗或非 HTTP(S) URL；
  主应用外链的系统浏览器策略保持原有行为。
- 无 server route、API 依赖、manifest/lock 或新构建 entry。协调者负责 App、Settings、
  runtime、nativeCommands 与旧插件接管；精确接线留在忽略的 integration.md。

## 静态检查与待用户验收

已通过 desktop TypeScript、userscript 设置页/client/types 的独立 TypeScript、
输出到 `.local/feature-integration/userscripts/bundles` 的 main/preload/设置页 esbuild，
以及生成 main/preload 的 `node --check`。preload 静态只剩 `require('electron')`，
没有 Node 内建依赖；序列化 runtime 没有外部 bundler helper 引用。
此外，四条实际复制脚本均已生成完整注入源码并通过 `vm.Script` 仅语法解析；没有
执行其代码、GM API、DOM 或网络行为。

首次全 web types 只报告并行模块/stale core 声明的问题；最终共享检查由协调对话
完成。没有进行运行验收，也没有生成 portable。用户仍需验收四条实际脚本、真实
start 时序、登录/导航/BFCache、菜单、跨页 GM 值、自动更新/审批/失败保留与代理请求。
