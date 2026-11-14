# Native host lifecycle acceptance 2026-11-13

## Source and scope

Implementation a0e230a014714aa23f44480eff5b6b5d0462e862, desktop0.1.67 and Android0.1.67/code67. Requested follow-up to session mac:claude:5b01a0dd. The final requested installation scope is Mac, OMEN, ROG and Redmi K70. All four devices received 0.1.67. The tablet retains its previous version. The user requested immediate deployment and stopped additional checks.

## Verified

- 558/558 unit tests in99files pass, including close readiness, crashed renderer confirmation, Tunnel forced stop, live log rotation and pre-start cancellation.
- server/web/desktop TypeScript pass. Production renderer/server, standalone desktop bundle, Android release Java/C++ build and lint pass. Android lint has14warnings and zero errors. Warnings cover personal all-files storage, API33 Back flag, JavaScript-enabled local WebView, backup/launcher icon/resource/text conventions.
- Real standalone server validates PORT=0 discovery, supplementary Unicode/comma Vault path, IPC and SIGTERM shutdown, pending search-cache persistence, owned endpoint removal, and rejection of a missing native Vault without creating it. Embedded startup failure retains its process and publishes a recoverable failure.
- Real Electron33.4.11 on Mac arm64 closes its startup window before readiness, reopens by activate, mounts the application, receives the renderer save acknowledgement, closes/reopens a macOS workspace while retaining its service, offers and accepts explicit crashed-renderer close, and gracefully quits/removes its endpoint.
- Production-entry acceptance passes native access/Vault identity, editing/save, snippets, command templates, JS/custom blocks, equation references/body titles, reading/source, pinyin, configured menus, attachment protection, right tabs and personal merged-table surfaces. Zero uncaught renderer errors.
- Full browser contracts finish396/402passed. The6failures are two narrow-embed metrics tests reading a disposed staged host, one font metrics test passing a non-Element to getComputedStyle, two tag-panel interactions timing out, and one palette expectation of Ctrl+L against the existing macOS Control+L label. Targeted original df1d08c source runs reproduce each failing group. Original navigation retry passes, and the current navigation and split-editing regressions pass after preserving operations-endpoint.json readiness semantics.
- New host browser tests3/3pass for shared platform identity/actual Android version, port-backed clipboard/export cancellation and Back lifetime registration.
- Mac arm64 DMG/ZIP/blockmap/update metadata built. codesign --verify --deep --strict passes.
- Windows x64 NSIS built on OMEN from the exact archived implementation in an isolated TEMP directory using project Node22.23.4. Clean npm ci, production build, desktop types and standalone bundle pass. Installer129800416bytes, blockmap135343bytes, update metadata370bytes. OMEN and ROG were subsequently upgraded using this installer in the interactive user session. Both installation jobs reported success and ProductVersion0.1.67.0, then launched the installed executable.

## Redmi K70 installation

Installed only user0 with adb install --user0 -r, using the existing release package io.github.alexbeatsz.webobsidian and original certificate. UID10246, firstInstallTime2026-11-10 21:38:13 device-local and settings.json bytes unchanged. Version0.1.67/code67. Package remains non-debuggable and run-as is rejected. No uninstall/data clear. The device's system clock differs from this chat's client clock, so reported LastUpdateTime is retained only as device evidence.

The new embedded process PID15498 returns health200 with the same PID. Original STEM has13top-level entries and its existing configured path/storage permission is retained. Runtime extraction leaves one runtime-<build-id> folder. Temporary port forwarding removed. Configuration/preferences and original APK were privately staged before upgrade. Existing user notes were not edited.

Unlocked foreground launch showed the native WebObsidian homepage and the Files drawer listing the existing STEM folders. During a subsequent Back check the phone foreground switched to TIM. Following taps landed in the Android Switch Access setup guide. This invalidates that Back test and the planned settings/export/paste interaction. No settings were toggled. Phone input stopped immediately and the user was informed to leave the guide. Return-key dismissal, actual native clipboard read and ACTION_CREATE_DOCUMENT completion remain unverified on K70.

## Review dispositions

All confirmed lifecycle/platform/export/path items have source changes. Duplicate background save requests already reuse DocumentSession's single writer and equality check, and lifecycle events are coalesced. Package workspace versions retain normal independent package metadata, while runtime diagnostics use the actual host version. Supported Linux release configuration and checksum/download targets remain. A missing online Linux target is not evidence of retirement. The embedded Node process remains single-invocation per process. Android OS kills can still interrupt in-flight work, as documented in the existing autosave contract.

## Release and remaining work

Desktop v0.1.67 and Android android-v0.1.67 use the exact implementation tag target. Final release asset verification/publication and local cleanup are recorded by the task runbook. 用户随后明确要求停止检查、直接部署。K70已完成部署，停止后续手机输入与测试。桌面v0.1.67和Android android-v0.1.67均已发布。用户随后要求Mac和Windows部署，Mac正常退出后替换应用并启动，OMEN和ROG正常退出后通过交互用户会话静默升级并启动，安装任务均成功返回0.1.67.0。部署后未追加功能测试。临时源码、密钥副本、Windows安装输入及一次性计划任务已清理。

## Desktop deployment

Mac installed /Applications/WebObsidian.app from the completed arm64 build after normal application quit, then launched it. The previous bundle was removed after the replacement succeeded. OMEN and ROG used the published x64 NSIS installer with /S in the logged-in interactive user session, after requesting normal window closure and allowing up to45seconds for saving. Each deployment job returned ok=true and ProductVersion0.1.67.0 at C:\Users\Meta\AppData\Local\Programs\WebObsidian\WebObsidian.exe and issued Start-Process. Further functional/UI acceptance was skipped at the user's request.
