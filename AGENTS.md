# AGENTS.md — WebObsidian

项目规则与结构以 [CLAUDE.md](CLAUDE.md) 为准;设计见 [PRD.md](PRD.md),进度见 [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md)。本文件只记录继续工作需要的当前事实和跨模块经验。

## Goal
个人使用的 WebObsidian 原生桌面/Android 应用(fork 自 xnohat/webobsidian,远程 `AlexbeatsZ/webobsidian`)。

## Current State
- 2026-11-08补正:Android已升级0.1.66/code66（源码3899d5f）；日常仅用不可调试release/tabletRelease，后者保留旧.debug包名与证书但debuggable/JNI/BuildConfig.DEBUG均false，WebView调试关闭。两实机无DEBUGGABLE、run-as拒绝，原UID/首次安装/权限保留。Mac/OMEN/ROG65正常启动无inspect或remote-debugging参数。Android独立android-v0.1.66预发布两非调试APK大小/tag源已核对，取代65Android日常交付。详见tests/reports/android-release-20261108.md。
- 源码main，0.1.65构建源a3cd52d已推送。v0.1.65为Latest，7资产（Mac arm64 DMG/ZIP/blockmap/latest-mac + Windows x64 NSIS/blockmap/latest）；独立android-v0.1.65预发布含debug/release两APK。所有资产大小和tag源一致。后续Mac仅Apple Silicon arm64，不再构建Intel/x64或universal。
- 2026-11-08已原位安装：Mac0.1.61→65、OMEN0.1.53→65、ROG0.1.28→65、Xiaomi Pad6Pro0.1.63-debug→65-debug、RedmiK70正式包0.1.37→65。Mac真实STEM服务1284ms健康/搜索2591ms，原生目录与大纲已目视确认；OMEN原STEM health200/16402ms、安装前后配置字节一致。ROG原先未配置Vault，保持选择流程，不创建新库。
- Android保留各自原签名、UID与firstInstallTime，两台安装/进程启动通过。平板watcher9423ms/扫描6572路径，锁屏后索引/UI待解锁；手机锁屏dozing且正式包不能run-as读取私有日志。Android仍使用1024MiB堆且跳过全文JSON缓存；平板原STEM同步未配置，旧资料备份仍在STEM/.trash/tablet-sync-20261106。
- 连续文档0.1.64实现沿用：稳定反向滚动，共用文件标题/H1/正文、标题改名同步JSON、大纲目录/逐层折叠、MD/PDF缩略图及不可绘制块留白。此前553单元/三端类型/构建、多轮浏览器和真实25章原生副本通过；本轮只改版本/打包/文档，生产与原生打包复验通过。见tests/reports/device-deployment-20261108.md和virtual-document-navigation-20261106.md。
- 本地仅保留最新交付物；旧Mac包/Intel tunnel输入、旧AndroidAPK及隔离构建/临时签名已清理，Windows旧release九版本和本次临时构建/安装输入也已清理。永久密钥、SDK/依赖缓存、用户数据、验收记录与历史Release保留。
- Release必须显式加 --repo AlexbeatsZ/webobsidian（本机gh默认上游），--target用完整SHA。gh release create经API建tag不会触发CI；Linux预构建仍为v0.1.43，本轮无在线Linux目标。
- Mac用户数据：~/Library/Application Support/@webobsidian/desktop；服务日志logs/server.log。

## Active Work
- 2026-11-13 正在实施 PRD1.41 三端宿主整理，用户最终要求部署 Mac、OMEN、ROG 和 K70，均已完成0.1.67升级和启动，桌面/Android Release已发布。用户要求停止进一步检查。实现a0e230a已推送；558单元/类型/生产和原生生命周期通过，浏览器396/402且6失败原提交复现；K70正式67原位升级/签名UID配置和原STEM健康通过，Back/剪贴板/导出UI待用户空闲。设计 docs/design/host-lifecycle.md，验收 tests/reports/host-lifecycle-20261113.md。
- 当前 Mac/OMEN/ROG/K70为0.1.67，平板维持0.1.66。桌面部署仅确认升级任务成功和启动命令，未追加功能验收。K70返回键/剪贴板/导出交互未验收，用户已停止进一步检查。
- MCP 说明笔记已交付源码与本机安装;用户尚未在 设置 › MCP 中选择笔记,真实 MCP 客户端的遵守情况未验收。
- 待做:格式化全文的 MCP 工具(格式化器 `web/src/lib/writing/format.ts` 在渲染器侧，需接通;结果走审阅)。

## Build / Run / Test
- 依赖与构建:`npm ci && npm run build`。
- Mac 本机包(只打当前架构,不发布):
  `cd desktop && node scripts/build.mjs && CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --mac dir --arm64 --publish never`
  产物在 `desktop/release/<版本>/mac-arm64/WebObsidian.app`(gitignored)。
- Mac 发布包仅arm64:`npx electron-builder --mac --arm64 --publish never` 后 `gh release upload v<版本> ...dmg ...zip ...blockmap latest-mac.yml`。不要添加Intel/x64或universal产物；旧构建可清理，原签名密钥/SDK/用户数据/验收记录/历史Release保留。
- 安装:退出应用后替换 `/Applications/WebObsidian.app`,`codesign --verify --deep --strict` 通过后启动;用服务端口的 `/healthz` 验证(端口用 `lsof -iTCP -sTCP:LISTEN | grep -i webobs` 查)。

## Durable Lessons
- 章节高度不能按宽泛`[role=status]`判未就绪（公式也有该角色）；只用整章`data-virtual-loading`。缓存会话重挂载时还要等CodeMirror `onReady`，否则空宿主会把长章缓存成81px，引起滚动跳动。加载标记移除后重测，原生验收必须做章节开头反向滚动。
- CodeMirror自己的measure会在wheel/touch后改外层scrollTop；聚合章节用requestMeasure+单个合并微任务识别这类布局位移。导航锁期间不得把程序滚动再累进锚点或用不一致高度表换窗；PDF分页补偿也要协调，详见虚拟文档设计。
- 本机universal Chrome可能被选为Rosetta x86_64，导致开发测试初始化极慢；2026-11-06通过`/tmp/.agents`包装脚本`exec /usr/bin/arch -arm64 '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' "$@"`并将`RENDER_TEST_BROWSER`设为脚本恢复正常，无需改系统或安装浏览器。
- 虚拟阅读导航必须在真实长章节中检查正文位于可视区域；仅检查 DOM 挂载会漏掉前序章节异步长高导致的空白跳转。构建 core 后再跑单元/浏览器测试，不能与 core dist 写入并行。
- 本机走 Clash 代理(127.0.0.1:7897):`@electron/get` 需要 `ELECTRON_GET_USE_PROXY=1` + `GLOBAL_AGENT_HTTPS_PROXY`;Node 原生 `fetch`(`bundle-tunnel.mjs`)不读代理变量,超时后可先用 curl 把 tunnel zip 和 licenses 放进 `desktop/.gen/tunnel-downloads/`(脚本会校验 SHA-256)。
- Node 26 下 `extract-zip` 在解压 tunnel zip 时 Promise 永不 resolve,进程以 13(unsettled top-level await)退出,且只解出部分文件。处理:用系统 `unzip` 解到 `desktop/.gen/tunnel/<arch>/`,`chmod 755 tunnel-client`,拷贝 licenses 为 `THIRD-PARTY-LICENSES.txt`,写 `version.txt`(内容为 TUNNEL_VERSION),之后 build/before-pack 会直接跳过。CI 用 Node 20 不受影响。
- OMEN Windows 构建：常规仓库 `C:\Users\Meta\Project\Workspaces\meta-obsidian` 常有未提交改动，只 `git fetch`,用 `git archive <commit>` 导出到 `%TEMP%\.agents\webobsidian-build-<ver>` 隔离构建(`npm ci`→`npm run build`→`desktop: node scripts/build.mjs`→`electron-builder --win nsis --x64 --publish never`)。OMEN 上 `npm ci` 的 Electron 下载会无限挂起：设 `ELECTRON_SKIP_BINARY_DOWNLOAD=1`,electron-builder 会用 `%LOCALAPPDATA%\electron\Cache` 里已有的 zip;tunnel 下载会超时：把常规仓库 `desktop/.gen/tunnel-downloads/tunnel-client-v0.0.19-windows-amd64*` 复制进隔离目录同一路径。PowerShell 5.1 脚本不要用 `$ErrorActionPreference='Stop'`(git 的 stderr 进度会被当成错误),改看 `$LASTEXITCODE`。
- 浏览器回归直接用 `RENDER_TEST_BROWSER='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'`；已有核心 dist 时设 `RENDER_TEST_SKIP_CORE_BUILD=1`。2026-11-06 本轮 160 个相关浏览器/集成、546 个单元全部通过，旧的 16 个已知失败已经修复；不再视为允许忽略的基线失败。全单元用 `npx vitest run --testTimeout=30000`，Git 子进程测试需这个超时。临时撤下代码后必须先 `npm run build:core`，不能沿用旧 dist。
- 发版时上传大文件常遇 GitHub HTTP 500/502,`gh release create` 带文件失败会删掉整个草稿。做法:先 `--draft` 建空 Release,逐个 `gh release upload --clobber` 并重试,用 API 按 release id 核对大小(草稿按 tag 查不到),再 `gh release edit --draft=false --latest`。主检出有其他任务改动时，用 `git worktree add --detach /tmp/.agents/webobsidian-release-<ver> <sha>` 隔离构建，复制主检出当前平台所需的 `desktop/.gen/tunnel/arm64` 跳过 tunnel 下载（Mac只保留arm64）。
- 渲染 harness(`/__render-test`):slot 0 实时预览、slot 1 阅读；`reset` 后光标在 0，测首行嵌入控件前先移到文末。快捷键测试直接发 `Control`/`Alt`，按用户要求不换成 Command；Shift+Z 应发大写 `Z`。脚注跳转是异步任务，用 `expect.poll` 等待位置完成。
- 测试源码里用 JS `String.replace` 插入 `$$…$$` 时替换参数必须用函数(`() => '…'`),字符串里的 `$$` 会被当成一个 `$`,公式变成行内数学，看起来像编号丢失。
- zsh 默认 noclobber,`>` 覆盖已有日志会失败导致命令未执行;构建链放进 `bash -c` 或用 `>|`。

- 跑浏览器套件期间不要改源码：Vite HMR 带 `?t=` 的导入可能与测试里动态导入的无版本模块各生成一份 store/StateField，造成错误的状态身份或空分栏。若发生，废弃该轮并重启 Vite 后从干净服务复验。

## Docs Index
- `docs/design/`:模块设计文档。Callout 颜色/图标 → `callout-styles.md`;Callout 布局 → `callout-lists.md`;源码展开语法灰色 → `source-reveal.md`;`\\( \\)`/`\\[ \\]` 公式 → `native-math.md`;内容引用与嵌入控件 → `content-references.md`;公式编号、嵌入实例与引用编号解析 → `native-equations.md`。
- `docs/log/`:按月工作记录。
- 虚拟文档 → `docs/design/virtual-documents.md`；真实资料原生验收 → `tests/desktop-virtual-documents.mjs`。
