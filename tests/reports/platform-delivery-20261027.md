# 2026-10-27 WebObsidian 0.1.28 五设备交付

## 源码与构建

- 用户明确要求构建最新版本并安装到本机、ROG、Mac和两个移动设备。
- 产品源码基线123e5e5，版本提交a8520b3668f956e8e18797eec85a7fbf92cfbdc7：Desktop0.1.28、Android0.1.28/code28。其后仅修正打包冒烟测试和增加交付记录，不改变打包产品代码。
- Windows/Android使用精确git archive快照，路径`C:/Users/Meta/AppData/Local/Temp/.agents/webobsidian-five-device-0128-20261027/source`；Mac对应`/tmp/.agents/webobsidian-five-device-0128-20261027/source`。均重新编译共享core、Web、Server与本平台宿主，不在原仓库生成server/public。
- Electron下载最初超时，改用已有33.4.11运行时；Mac旧展开缓存缺少Info.plist，改从本机已有官方Electron ZIP重新展开，未修改系统或全局工具链。
- Windows NSIS、Mac arm64 DMG/ZIP、Android arm64 debug/release及lintVitalRelease构建通过。Mac完整app ad-hoc codesign deep/strict验证通过；非Developer ID、未notarize。Android签名v2及16KB zipalign通过，原个人release密钥保留。

## 实际安装

| 设备 | 安装结果 | 保留边界 |
| --- | --- | --- |
| 本机META-OMEN | 正常NSIS0.1.27升级0.1.28，exit0；物理EXE版本0.1.28 | desktop-config逐字节一致；备份server-data，保留现有快捷方式 |
| META-ROGALLY | 全新正常NSIS0.1.28，exit0；物理EXE版本0.1.28，开始菜单入口存在 | 未创建/迁移Vault，未启动日用实例；临时安装计划任务已删除 |
| MetadeMBP arm64 | `/Applications/WebObsidian.app`0.1.28，标识`com.xnohat.webobsidian`；实际安装app签名验证通过 | 原`/Applications/Obsidian.app`保留；未自动选择或迁移Vault |
| 平板23046RP50C，serial cd94ae18 | 同一`io.github.alexbeatsz.webobsidian.debug`原位升至0.1.28-debug/code28；首次安装时间仍为原日期 | 安装前后私有Vault、server-data、shared_prefs的tar字节完全相同；未卸载/清数据/启动 |
| 手机23113RKC6C，192.168.31.22:39891 | 新装个人签名`io.github.alexbeatsz.webobsidian`0.1.28/code28，PackageManager Success | 首轮系统取消；用户明确等待授权后重新发起并获准成功，未绕过安全设置或自动选库 |

- 平板USB连接中途消失，mDNS公布`adb-cd94ae18`的192.168.31.228:5555；重新读取serial确认同一设备后完成安装。
- ROG在SSH非交互上下文启动NSIS时，Application1000记录其临时System.dll发生0xc0000005。相同安装包改由已登录用户的临时InteractiveToken任务执行后exit0；未改安装器产品逻辑、系统服务或安全策略，尚未确定该DLL异常的内部根因。
- 不因各设备系统时区不同而把PackageManager日期当成任务日期；本报告按2026-10-27 America/New_York记录。

## 验证

- 新快照全量单测406/406、73个文件通过；Web/Server随生产构建完成类型检查，Desktop独立typecheck通过。
- 实际Windows包的standalone guard通过。最初启动冒烟完成真实编辑/落盘等步骤且renderer errors为空，但旧固定栏总数断言4与当前5不符；改为限定右侧并逐一断言反向链接、出链、标签、大纲、缩略图，不放宽检查。
- Mac首轮冒烟被Windows专属Control+o阻塞；统一使用Playwright ControlOrMeta快捷键，保留实际UI键盘入口，不替换为内部直接调用。
- 最终使用本机**已安装**`WebObsidian/resources`运行生产SPA+server隔离Vault冒烟通过，4236ms，renderer errors为空。
- 最终使用Mac**已安装**`/Applications/WebObsidian.app/Contents/Resources`运行同一冒烟通过，4110ms，renderer errors为空。
- 两次最终检查均覆盖生产入口、Vault身份、真实键盘编辑/磁盘保存、snippet、命令模板、JS/block/equation、读写模式、拼音检索、菜单、附件扫描保护、Homepage和五个固定入口。fixture与自有浏览器/服务正常结束，不接触日用Vault。
- 原仓库server/public/index.html仍为909bytes，UTC mtime仍为2026-10-23T12:05:49.8534997Z。首次JSON比较因PowerShell自动转DateTime显示false，按UTC ticks规范化后确认一致；无资源恢复或重写。

## 产物

| 文件 | 字节 |
| --- | ---: |
| desktop/release/0.1.28/WebObsidian-0.1.28-win-x64-setup.exe | 106161287 |
| desktop/release/0.1.28/WebObsidian-0.1.28-mac-arm64.dmg | 138894845 |
| desktop/release/0.1.28/WebObsidian-0.1.28-mac-arm64.zip | 133387934 |
| android/release/0.1.28/WebObsidian-0.1.28-android-arm64-debug.apk | 138912848 |
| android/release/0.1.28/WebObsidian-0.1.28-android-arm64.apk | 135621979 |

两个产物目录均有BUILD-INFO.json。原始日志、备份、安装JSON和包启动结果保留在上述Temp/.agents任务目录；Mac日志保留在对应/tmp/.agents目录。原有版本产物与无关.workbuddy未清理。

## 未宣称完成的验收

- 安装及已安装资源的浏览器/服务器检查不等于原生Electron窗口、手机/平板触摸、IME、离线持久性、长时间运行或全量浏览器回归。
- 未启动日用实例、选择新设备Vault、批量迁移真实Vault、授予Android存储权限或操作原Obsidian；新设备首次打开仍由用户明确选择笔记库。
- 未发布新的GitHub Release；本次交付NSIS而非portable，无新增portable发布操作。
