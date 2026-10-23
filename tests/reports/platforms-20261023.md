# Windows / macOS 0.1.17与Android修正版构建及验收

功能源码：`41183b8a83afc179d02f537ed5bcf0343cf162db`，
`feat(platforms): 适配macOS并新增安卓本地离线版本`，正常推送。
前置MCP源码a6eb52e已交付并完成独立验收，报告为native-mcp-20261023.md；
本报告分别记录三平台产物及真实运行边界。

## Windows补交付0.1.17

用户追问后补齐Windows x64 portable，从exact41183b8的git archive建立
独立快照，全新编译core/search/Web/server、desktop和shared standalone bundle，
既有dependency guard及portable封装通过。未带入随后Android0.1.18修改。

产物：desktop/release/0.1.17/WebObsidian-0.1.17-win-x64-portable.exe，
85,815,956字节，PE file/product version均0.1.17。来源与边界在同目录
BUILD-INFO-win.json。仅隔离snapshot执行predist cleanup；根Mac四包及
BUILD-INFO.json完整保留，server/public入口元数据前后一致。未启动新EXE，
不能把构建/已完成MCP生产工作流验收当作这个Windows包的原生启动验收。

## 构建与架构

实现负责人在隔离源快照完成core/search/Web/server/desktop编译、类型和既有
standalone dependency guard。两个实际平台调用同一scripts/bundle-server.mjs。
Android使用薄Java/JNI/WebView宿主和真正的Bionic Node24运行原有本地服务，
随机127.0.0.1端口及普通文件Vault均在设备内；未复制笔记业务后端。
会话、保存、历史、索引及Markdown/MathJax仍由现有模块负责。

Mac在Darwin arm64/Xcode27.1构建arm64和x64的DMG/ZIP。初次whole-app签名
实际未完成，负责人撤回ready，修正签名hook并重新打包；最终两架构
`codesign --verify --deep --strict`通过。当前是ad-hoc签名，没有Developer ID
或公证，也没有公开发布。

Android在Windows现有Java17/SDK35/NDK28.2/CMake3.22.1构建arm64，最低Android11，
target35/versionCode17。release/debug构建和release lintVital通过，release APK v2
签名、zipalign 16KB和Node ELF LOAD 0x4000对齐静态检查通过。Node来自
fogtape/nodejs-mobile v24.22.1-0 fullICU，该发行标记为prerelease。

当前产物及准确字节数记录在desktop/release/0.1.17、android/release/0.1.18中的
BUILD-INFO文件。旧Android17包已由原owner按现有保留当前版本规则清走，旧metadata
在Temp/.agents/meta-obsidian-platforms-20261023/BUILD-INFO-android-017-failed.json，
17失败截图/事件和测试Vault保留。未安装全局程序或更改全局SDK/runtime/PATH配置。

## Mac实际arm64应用：8/8通过

通过Mac现有SSH和Playwright Electron连接实际签名后的打包可执行文件，
没有以开发服务器代替。新建独立profile、server-data和两处一致的Vault路径，
全部位于/tmp/.agents/meta-obsidian-platforms-20261023。

| 检查 | 结果及证据 |
| --- | --- |
| 打包应用启动 | 版本0.1.17，实际隔离Vault，监听启动成功 |
| 原生菜单 | WebObsidian/文件/编辑/显示/窗口菜单、系统编辑roles及快捷键存在 |
| 原生打开命令 | 调用原生菜单后到达现有文件选择器 |
| 顶栏与红绿灯留位 | 实测行高32px、左padding84px、右0；Electron按钮位置{x:12,y:9} |
| 原生保存命令 | 编辑输入后原生保存，磁盘回读包含MAC-SAVED-017 |
| 快捷键与设置 | Cmd+O打开选择器，原生设置命令进入既有设置 |
| 全屏生命周期 | 进入全屏、重载、退出后原生及DOM状态一致 |
| 关闭/重新启动 | 同一隔离profile/Vault保留已保存内容 |

renderer errors为空；测试应用正常关闭。mac-renderer.png已经实际查看，
但它只截renderer，不含操作系统红绿灯；按钮坐标来自真实Electron API，
不冒充整窗红绿灯截图。未在真实Intel设备运行x64产物。

证据：`.local/acceptance-mcp-platform-20261023/mac/`下results.json、menus.json、
chrome.json、mac-renderer.png。原始运行目录为Mac的mac-acceptance-gcuSs0。

## Android 0.1.17真机：已发现失败，修正中

用户明确允许在Pad6Pro（Android15/arm64）安装独立debug测试版；包名
io.github.alexbeatsz.webobsidian.debug，原日常release应用和Vault不覆盖。
最初两次安装返回INSTALL_FAILED_USER_RESTRICTED，pm path确认未装入；
用户处理系统USB安装限制后第三次安装成功。本机Node启动，实际日志显示
127.0.0.1:38617及应用私有Vault/server-data，Homepage和新建Untitled可进入。

实际失败与用户纠正：

- 用户指出没有先明确选择Vault，自动创建私有库后已进入工作区。这不符合期望；
  后续首次启动须先让用户选择已有本地库或主动新建，取消不进入工作区，不自动建库。
  事后的存储说明不能替代首次选择。旧测试Vault/内容保留，不自动清理。
- 系统时间/状态栏覆盖应用顶栏。原WebView padding没有形成正确的原生内容边界。
- 同pid出现两个attached WebView，其中旧portrait页面不可见。负责人只读dumpsys
  实际确认Task中有两个MainActivity（暂停/前台），与重复启动叠实例吻合；尚未
  单独证明旋转recreate/destroy失败。旧页面不响应WS快照，切换Vault出现
  “有应用窗口未确认编辑状态”，不能通过放宽服务端保护来掩盖宿主生命周期问题。
- 用户报告手指滑动不能呼出侧栏。父在真实landscape 2880x1800/DPR2.5上以ADB
  注入左边缘12px、y900横滑，WebView未收到touch，drawer未开；同一注入方式在
  内容区纵滑收到完整事件，排除注入整体无效。随后从60px（24CSSpx）开始的
  左横滑收到touchstart/move/end并成功打开左侧栏。因此原共享JS在收到合适事件时
  可用，最边缘原生/系统触摸归属仍失败。曾过早向负责人同步“60px也失败”，
  在工具结果返回后立即更正；edge-events-before-fix.json保留实际成功值。

上述截图已实际查看，targets-before-fix.json、边缘事件及启动日志保留在
`.local/acceptance-mcp-platform-20261023/android/`。原负责人继续Android0.1.18：
singleTask/唯一原生父容器Insets与系统手势排除、明确初次Vault选择，保持同一
RuntimeHost/设置路径校验和现有配置权威。父不修改业务源码。保存、重启、断网和
两侧完整手势尚未完成，不把部分启动观察记为整端通过。

Android修正源码`5da1505ebc77e5198cfc74f602596a0ede1db45a`已正常推送。
0.1.18 release为121,842,473字节，debug为124,419,322字节；构建/签名/16KB
检查通过，来源在android/release/0.1.18/BUILD-INFO.json。父已使用`install -r -t`
成功更新同一独立debug包，未清除数据或覆盖日常release应用。
更新后启动时平板已锁屏；仅唤醒屏幕确认锁屏，不绕过解锁。实际首次选库、
取消无建库、12px双边侧滑、系统Insets、保存/重启等关键复测仍待用户解锁，
未把0.1.18构建成功记成实际修复通过。旧Vault/Untitled.md仍在，旧runtime-17/
server.log保留；18尚未作出选库前不能声称它的新服务已启动。

## 触摸浏览器补充与保护边界

1200x800/coarse pointer无头Edge补充中，平板模式、左边缘呼出/收回、右边缘
呼出/收回、边缘纵滑不呼出这六项通过。随后页面中部横滑造成页面上下文丢失，
保留失败结果和截图；未确定是宿主导航还是产品原因，不能算全组通过，
也没有根据这一未定问题修改产品。真机证据另行记录。

原STEM、日常profile/config/Vault、现用server/public和用户进程保留；
无关.workbuddy未暂存。未做原Vault全面、IME全组合、长时间性能、断电、
磁盘故障、所有Android厂商/手机或真实Intel全场景验收。
