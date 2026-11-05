# AGENTS.md — WebObsidian

项目规则与结构以 [CLAUDE.md](CLAUDE.md) 为准;设计见 [PRD.md](PRD.md),进度见 [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md)。本文件只记录继续工作需要的当前事实和跨模块经验。

## Goal
个人使用的 WebObsidian 原生桌面/Android 应用(fork 自 xnohat/webobsidian,远程 `AlexbeatsZ/webobsidian`)。

## Current State
- 源码:`main`,桌面版本 0.1.54(MCP 内容引用目标查询与类型 ID 校验)。
- GitHub Release:v0.1.54 有 Mac arm64/x64(Mac 本机构建)和 Windows x64 NSIS(OMEN 构建);v0.1.53 有 Windows 与 Mac 包;linux 预构建最新为 v0.1.43。Release 用 `gh release create` 通过 API 建 tag,不会触发 CI 的 release 工作流。
- 安装情况(2026-11-05):Mac(arm64)`/Applications/WebObsidian.app` 0.1.54(本地构建);OMEN 0.1.53(Windows 安装包)。
- Mac 用户数据:`~/Library/Application Support/@webobsidian/desktop`,服务日志 `logs/server.log`。

## Active Work
- 待做:格式化全文的 MCP 工具(格式化器 `web/src/lib/writing/format.ts` 在渲染器侧，需接通;结果走审阅)。
- `operations.test.ts` 的大小写改名用例在 macOS(大小写不敏感)上失败，原代码即如此。

## Build / Run / Test
- 依赖与构建:`npm ci && npm run build`。
- Mac 本机包(只打当前架构,不发布):
  `cd desktop && node scripts/build.mjs && CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --mac dir --arm64 --publish never`
  产物在 `desktop/release/<版本>/mac-arm64/WebObsidian.app`(gitignored)。
- Mac 发布包:`npx electron-builder --mac --arm64 --x64 --publish never` 后 `gh release upload v<版本> ...dmg ...zip ...blockmap latest-mac.yml`;x64 需先按下面经验准备 `.gen/tunnel/x64`。
- 安装:退出应用后替换 `/Applications/WebObsidian.app`,`codesign --verify --deep --strict` 通过后启动;用服务端口的 `/healthz` 验证(端口用 `lsof -iTCP -sTCP:LISTEN | grep -i webobs` 查)。

## Durable Lessons
- 本机走 Clash 代理(127.0.0.1:7897):`@electron/get` 需要 `ELECTRON_GET_USE_PROXY=1` + `GLOBAL_AGENT_HTTPS_PROXY`;Node 原生 `fetch`(`bundle-tunnel.mjs`)不读代理变量,超时后可先用 curl 把 tunnel zip 和 licenses 放进 `desktop/.gen/tunnel-downloads/`(脚本会校验 SHA-256)。
- Node 26 下 `extract-zip` 在解压 tunnel zip 时 Promise 永不 resolve,进程以 13(unsettled top-level await)退出,且只解出部分文件。处理:用系统 `unzip` 解到 `desktop/.gen/tunnel/<arch>/`,`chmod 755 tunnel-client`,拷贝 licenses 为 `THIRD-PARTY-LICENSES.txt`,写 `version.txt`(内容为 TUNNEL_VERSION),之后 build/before-pack 会直接跳过。CI 用 Node 20 不受影响。
- OMEN Windows 构建：常规仓库 `C:\Users\Meta\Project\Workspaces\meta-obsidian` 常有未提交改动，只 `git fetch`,用 `git archive <commit>` 导出到 `%TEMP%\.agents\webobsidian-build-<ver>` 隔离构建(`npm ci`→`npm run build`→`desktop: node scripts/build.mjs`→`electron-builder --win nsis --x64 --publish never`)。OMEN 上 `npm ci` 的 Electron 下载会无限挂起：设 `ELECTRON_SKIP_BINARY_DOWNLOAD=1`,electron-builder 会用 `%LOCALAPPDATA%\electron\Cache` 里已有的 zip;tunnel 下载会超时：把常规仓库 `desktop/.gen/tunnel-downloads/tunnel-client-v0.0.19-windows-amd64*` 复制进隔离目录同一路径。PowerShell 5.1 脚本不要用 `$ErrorActionPreference='Stop'`(git 的 stderr 进度会被当成错误),改看 `$LASTEXITCODE`。
- zsh 默认 noclobber,`>` 覆盖已有日志会失败导致命令未执行;构建链放进 `bash -c` 或用 `>|`。

## Docs Index
- `docs/design/`:模块设计文档。
- `docs/log/`:按月工作记录。
