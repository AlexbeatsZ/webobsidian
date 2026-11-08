# 0.1.65 设备部署与构建保留

构建源：`a3cd52d384557c822aff37b84f3a15fd6de77b7b`。本次沿用0.1.64已验收的连续文档实现；只调整平台交付版本、Mac目标和文档。

## 安装与验证

| 设备 | 升级前 | 安装后 | 验证 |
| --- | --- | --- | --- |
| Mac Apple Silicon | 0.1.61 | 0.1.65 | 正常退出并保存后原位替换；安装包与安装版codesign deep/strict通过；EXE为arm64；Vault和设置文件字节未变；真实STEM服务1284ms健康、搜索2591ms加载；HTTP /healthz 200；原生窗口显示统一标题/H1/目录和可折叠大纲 |
| OMEN Windows x64 | 0.1.53 | 0.1.65 | 隔离原生构建；NSIS exit0；desktop-config/settings安装前后字节一致；原STEM服务HTTP health200，fresh server healthy16402ms；桌面快捷方式指向新版EXE，用户session1启动 |
| ROG Windows x64 | 0.1.28 | 0.1.65 | 同一NSIS包exit0；桌面快捷方式指向新版EXE，用户session1启动；UIAutomation确认可见原生#32770窗口“选择仓库文件夹”；原先无desktop-config/settings，未代选或创建Vault，无服务符合首次选择流程 |
| Xiaomi Pad 6 Pro | 0.1.63-debug / code63 | 0.1.65-debug / code65 | install -r成功；原debug包名、证书、UID10415及首次安装2026-10-24 03:44:50均保留；进程启动，watcher9423ms，扫描6572路径且解析至100篇后设备息屏 |
| Redmi K70 | 0.1.37 / code37 | 0.1.65 / code65 | install -r成功；原release包名、证书、UID10817及首次安装2026-10-27 08:20:41均保留；启动进程存在，设备锁屏dozing，正式包不能run-as读取私有日志 |

两台Android处于锁屏状态，本轮确认安装与进程启动；完整前台UI、索引完成和health验收仍待解锁。没有卸载、清数据或改动Vault/同步配置。

## 构建与发布

生产renderer/server/core构建、桌面静态独立bundle检查通过；Mac arm64 DMG/ZIP与ad-hoc签名通过。Windows原生生产/独立bundle/NSIS构建通过。Android隔离源码复用本提交对应的已生产构建server/dist和server/public，debug/release assemble、lint及16KiB ZIP对齐通过，证书分别匹配原安装。Lint每个变体0 Error/Fatal、12 warnings（存储分发策略、AGP版本、WebView JS、备份声明与图标/本地化等既有项），详情在本轮临时报告。完整连续文档测试证据见同目录`virtual-document-navigation-20261106.md`，本轮没有重复执行已通过且源码未变的整套测试。

桌面v0.1.65已发布Latest，7个资产（仅Mac arm64 + Windows x64）；独立Android android-v0.1.65已发布为prerelease，两个APK。逐个API资产大小与本地一致，两个标签均对应上述完整源码SHA，latest API确认v0.1.65；历史Release保留。

## 保留策略与清理

Mac默认/CI打包均仅Apple Silicon arm64；不再生成Intel或universal包。保留各平台最新交付物，历史GitHub Release、签名密钥、SDK/dependency缓存、用户数据与验收报告保留。Mac旧0.1.64 release目录已由打包cleaner替换；确认新安装健康后删除旧0.1.61应用副本与Mac x64 tunnel解包/下载输入，共487526400字节（不含已替换的旧release目录）。Android旧隔离源码、旧APK、本次source与临时密钥副本删除，du汇总7726837760字节（含APFS克隆，不能当成实际空闲空间增量）；主库仅保留两个最新APK及可复用.runtime/local.properties，原永久密钥留在OMEN。Windows已清理：OMEN旧release九版本、本次隔离源码/node_modules/产物tar共2948568071字节；ROG临时安装包/探针129803923字节，合计3078377334字节。OMEN常规repo三项原脏改动保留；ROG独立webobsidian-sync/.local/sync-server保留，未触碰同步服务。两机用于启动的临时计划任务均已删除，仅保留小脚本/日志。

## 最新交付物

| 产物 | 字节 |
| --- | ---: |
| WebObsidian-0.1.65-mac-arm64.dmg | 166350565 |
| WebObsidian-0.1.65-mac-arm64.zip | 160223375 |
| WebObsidian-0.1.65-win-x64-setup.exe | 129800001 |
| WebObsidian-0.1.65-Android-debug.apk | 138813338 |
| WebObsidian-0.1.65-Android-release.apk | 135526840 |

临时证据：`/tmp/.agents/webobsidian-android-deploy-0.1.65/summary.json`和lint XML；临时目录仅88KiB，签名副本与旧APK已移除。Mac界面通过CUA截图直接确认，未更改正文或JSON配置。
