# Android日常构建关闭调试

用户要求日常使用不要debug/调试。此前平板为沿用旧应用身份交付了0.1.65-debug，现以非debuggable的正式变体改正。Android0.1.66源码：3899d5f21b99a71d1806a8586e485a2d6bf1bd60；桌面保持0.1.65。

## 构建约定

release用于RedmiK70；tabletRelease继承release，保留平板已安装的.debug包名和原签名以原位升级，但debuggable/JNI debugging显式为false，BuildConfig.DEBUG=false关闭WebView调试，版本名不带-debug。包名/签名是数据身份，不能将它们与可调试构建混淆。

## 验证

- Mac安装版所有进程无inspect/remote-debugging启动参数。
- OMEN五进程、ROG三进程均无inspect、inspect-brk、remote-debugging端口/pipe、自动DevTools或开发启动参数；主进程为安装版EXE无参数，未重启。
- 平板变非debug前正常HOME后台触发现有保存流程，以run-as保留server-data/shared_prefs/旧privateVault的tar权限备份，存于权限700临时目录内600文件；未force-stop、卸载或清除数据。
- 两变体assemble与lint构建通过，APK aapt manifest确认debuggable=false、generated BuildConfig.DEBUG=false、版本66且版本名无-debug；原证书分别与65现装包一致，16KiB zipalign通过。两设备install-r成功；安装后flags均为HAS_CODE/ALLOW_CLEAR_USER_DATA，不含DEBUGGABLE；run-as均exit1且明确package not debuggable。平板/手机UID分别10415/10817、首次安装分别2026-10-24 03:44:50与2026-10-27 08:20:41保持；MANAGE_EXTERNAL_STORAGE appops未变。

仅移除调试开销，本轮没有做同设备前后性能基准，不能据此宣称具体加速倍率或已消除所有卡顿。Android官方文档也明确debuggable构建存在性能开销，性能验收应使用release：developer.android.com/studio/profile 与 developer.android.com/codelabs/android-macrobenchmark-inspect。

## 安装包与收尾

| 变体 | 包名 | 字节 |
| --- | --- | ---: |
| tabletRelease | io.github.alexbeatsz.webobsidian.debug | 135526844 |
| release | io.github.alexbeatsz.webobsidian | 135526840 |

两变体lint各0 Error/Fatal、12 Warning，与65相同类别。平板的.debug仅为保留旧数据身份，不代表启用调试。部署期间设备锁屏，完整前台UI和性能基准未执行。安装后各一次普通am start成功（无调试flag），平板PID10197、手机PID31642；手机仍锁屏，未绕过锁屏或读取正式包私有日志。桌面三设备保持65，无需重装。

临时源码、临时签名和本地65旧APK已清理，主库android/release仅保留两个66正式构建。du汇总5167329280字节，含APFS克隆，非物理空闲增量。证据：/tmp/.agents/webobsidian-android-release-0.1.66/summary.json；私有备份在同任务private-backup/tablet-private-before-nondebug.tar，目录0700/文件0600，内容不进Git。永久原签名仍在原OMEN位置。

Android独立预发布android-v0.1.66已发布，两个远端APK大小与本地一致，标签源3899d5f21b99a71d1806a8586e485a2d6bf1bd60已核对。GitHub prerelease标记不改变APK的非调试构建类型。桌面Latest保持v0.1.65；历史65Android发布说明标注66取代旧debug日常包。
