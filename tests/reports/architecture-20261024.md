# 架构改进与集成验收（2026-10-24 至 2026-10-25）

## 范围与基线

用户授权 GPT-6.1 Sol 分工实现，并由协调者独立验收。基线为 main
`7286060`，初始仅有与本任务无关的 `.workbuddy/`。Vault 并发、渲染生命周期、
退出持久化使用 xhigh；依赖解耦与性能使用 high；测试/CI 维护使用 medium。
后续像素诊断、隔离生产验收使用 high。协调者负责共享契约、跨模块接线、
最终复测、文档及串行提交。

不改用户原始 Vault、日常配置/profile、已安装 0.1.24、根 server/public、
旧安装包；不安装全局工具，不发布新版本。所有运行验收使用可丢弃测试数据。
此轮不是承诺全部插件、全部平台或所有可能输入都正确。

## 实施结果与单一所有者

| 项目 | 原问题与改法 | 复用、删除及边界 |
|---|---|---|
| R01 Vault 身份 | 公共请求携带身份，DocumentRegistry 固定打开时的 Vault，迟到读结果校验；缺失/过期文件请求拒绝 | 继续使用原会话/CAS；身份代表根目录，不是切换次数 |
| R02 操作许可 | 计数覆盖实际 handler promise、GET 迁移、媒体 pipeline、独立后台 Git；断开响应不等于工作结束 | 扩展原维护门禁，移除 response close/finish 释放逻辑 |
| R03 关闭保存 | 桌面关闭/Cmd-Q 等待文档保存和 workspace flush，失败/超时保留窗口，校验 IPC token/发送者 | 调用现有 saveLeaving；浏览器/Android 强制终止不能保证异步保存 |
| R04 渲染资源 | 脚注资源按实际 DOM 持有；Mermaid 独立 stage/ID；Component 迟到注册立即回收、可串行重载；公开渲染 Promise 取消后结束 | 继续 RenderLifetime，不新增另一套生命周期管理器 |
| R05 数学与 HTML | HTML/entity/break 装饰排除完整及未闭合 mathRanges | 使用同一核心解析结果，不另建正则公式解析器 |
| R06 物理写入 | text/binary/plugin data 共用路径队列和临时文件；独占创建原子发布完整字节 | 删除插件私有队列；二进制不读旧内容/不散列；hard-link 文件系统支持需实机覆盖 |
| R07 索引完成 | 区分 indexed/failed/skipped，Tag Page 返回已保存路径；UI 警告且重试打开不再次创建 | 保留原索引队列；不把 drain 当成功，不宣称跨索引原子事务 |
| R08 工作区持久化 | desired/in-flight/ack 分离、单 PUT、有界重试；初次读取失败不写默认；服务端串行原子写 | 扩展原 scheduler/uistate，删除提前确认保存 |
| R09 运行时环 | 纯 conceal/macro 处理移出编辑扩展，MathMode 归 mathbounds，模式绑定归 navigation | 目标两组循环移除；静态 SCC 从 5 组降为 3 组，未声称全无循环 |
| R10 失效范围 | 比较 RenderContext 实际值，稳定 mountFragment；Mermaid/fold/HTML/blockLayout 明确能力依赖 | 无新解析器/缓存；NoteEmbed 广泛失效保守保留，详见后续 |
| R11 Writing 请求 | 删除私有 fetch，统一身份、错误、待写计数，保留候选编译和成功后生效 | 不绕过现有校验/串行配置保存 |
| R12 打印准备 | 从首次 CSS 开始统一截止时间，取消/坏图/字体失败清理，整页渲染与 ownerDocument 正确 | 使用同一非执行 MarkdownFragment；OS 打印对话框另行验收 |
| R13 共享契约 | DTO 在 server/src/contracts.ts，纯 AutomationSchema 在 contracts/automation.ts；Web 不导入 IO service | 原服务重导出兼容类型，测试约束浏览器依赖边界 |
| R14 后处理取消 | 现有 lifetime 暴露 signal/isCurrent/assertActive，失效时立即取消旧批次，迟到错误不污染新内容 | 合作取消；不能阻止第三方无视信号直接写 DOM |
| R15 回归与 CI | 更新现有 fixture、非空断言、卸载计时器检查、独立端口/输出；CI 严格安装并运行浏览器套件 | 不降低像素容差，不以本地 Windows 结果冒充远端 Linux CI |

## 协调者验收记录

- 首次 unit 有 6 个缺失导出错误，原因是本地 core dist 陈旧；仅重建 core 后
  200/200 通过。代理已经开始编辑，因此这不是纯净基线测试。
- 当前集成 unit：57 文件、283/283 通过，5.90 秒。故障注入测试的 stderr
  是预期路径，不代表忽略失败。Server/Web/desktop 类型检查分别通过。
- 集成/侧栏/命令面板：16/16 通过，21.7 秒。代理先前 7 个失败在冻结后未复现，
  不能据此声称它们的历史原因已完全确认。
- 第一次完整 render：100/106 通过。两项新生命周期用例是 fixture 光标/状态字段
  不完整，修正保留原断言；代理复跑 17/17，故障两项各五轮合计 10/10。
- Tag Page 新 UI 回归：1/1 通过，验证已保存但索引失败的提示、打开失败后
  再打开不重复 POST。初次两次为测试 harness 名和模块导出 fixture 错误，已修正。
- 插件 fixture：1/1 通过，含真实命令/设置/元数据/CM扩展/代码块与卸载。
  父验收发现 CI grep 完整标题的开头锚点导致零匹配，已移除锚点并实跑验证。
- 最终冻结源码浏览器四项目合计 **124/124 通过，3.0 分钟**（render 108、
  integration 8、workspace 4、palette 4），无失败、跳过或重试。限额中断后
  协调者读取完整结束日志确认结果，没有重复运行已完成的套件。
- 三个导航失败的 trace 均有正确 Vault 字段；页面 HMR store URL 与 fixture
  裸 URL 导入产生两个实例。fixture 复用实际已加载 URL，新增实例唯一性与
  activePath 检查，原导航断言保留；专项 17/17、3/3 后通过最终全套。
- 最终 unit 再跑 **57 文件、283/283，5.18 秒**；Server/Web/desktop 类型检查通过。
- 隔离生产 search/core/Web/server 编译、desktop bundleServer 与 standalone guard
  通过；真实 Edge 生产 smoke 七组断言通过、零未捕获 renderer 异常。
- 真实项目 Electron 主进程/preload/生产 SPA 的两项关闭验收通过：dirty 内容在
  native window-closed 前已落盘；注入 HTTP 507 后保留窗口/草稿/原磁盘内容，
  恢复编辑后再次关闭成功。协调者复核结果 JSON、关闭事件顺序和失败保留截图。
  仅错误弹窗替换为日志，不是物理磁盘满或安装包验收。
- 最终生产快照回读的差异仅为 CI、设计文档与导航测试；没有产品源码差异。
  root server/public 入口大小/时间不变，原 Vault/profile/安装版/旧发布物保留。
  生产细节见 `tests/reports/architecture-production-20261024.md`；本轮没有生成或安装新 EXE。

## 像素差异的归因边界

旧 scroll500 差异是像素 `(147,327)` 灰度 32→34；本轮 scroll1000 是
`(358,248)` 灰度 140→142。旧 `73d95ca` 基线证据均出现相同坐标/值。
不是测得的 1px 布局偏移：公式相对几何与 SVG path 一致，也没有光标节点。
同屏幕位置探针三轮四个滚动位置共 12/12 完全相同；仅两个相同 SVG 的静态页
仍可复现 scroll1000 的位置相关差异。内部 Skia 舍入/缓存机制尚未确定，
最小静态页没有复现 scroll500，不能把底层链路描述为完全确定。

因此截图期间仅把 Reading 水平移到 Live 的屏幕绘制位置并隐藏另一列，
不改宽度/内部布局/滚动/产品 CSS。每通道 1/255 容差不变。专项修正后
6/6 通过（每次 0/500/1000/1500），无重试；有限重复不保证永不波动。

## 性能证据与后续顺序

真实 EditorState、原 blockLayout builder，8,670 UTF-16 单位/150 段，
每样本 100 次等价 context reconfigure、预热后五组交替：旧身份比较每组
100 次重建，新比较 0 次。协调者全套并发时旧组 33.13–44.03ms、新组
1.80–4.02ms；独立运行更快。此为受控状态事务微基准，不是打字延迟或
整应用加速倍数，也没有拿不同负载时间作产品承诺。

1. **下一优先级：NoteEmbed 精确依赖。** 先覆盖前置宏定义、公式编号、源码
   offset、嵌入路径和执行权限的组合，再用既有核心模型派生依赖；禁止只按
   文本相等复用挂载。必须同时验证局部修改不重挂载和前置宏变化正确更新。
2. **跨平台文件系统与退出。** 在 macOS、Android 实机与非 NTFS Vault 运行
   独占创建/读写失败/退出中保存/后台恢复；明确断电、SIGKILL 不属于关闭握手保证。
3. **真实工作负载。** 大型原文副本、多窗共享会话、快速折叠/切换/长时插件运行，
   记录输入 p95、挂载/销毁计数和内存趋势，再决定是否优化剩余重渲染。
4. **合作插件与打印。** 对实际插件异步处理、原生打印对话框、物理 IME 做专项
   验收；不扩大权限、不擅自修改原 Vault 或恢复已删除的兼容导入路径。

## 证据位置

- 父任务：`C:/Users/Meta/AppData/Local/Temp/.agents/architecture-parent-20261024/`
- 像素诊断：`C:/Users/Meta/AppData/Local/Temp/.agents/architecture-pixel-20261024/REPORT.md`
- 代理交接：`.local/opinion-integration-20261022/status-architecture-*-20261024.md`
- 设计契约：`docs/design/architecture-optimization.md`、`rendering-unification.md`、`native-writing.md`

Temp 证据不是永久发布物；本报告与测试代码保留可复现的范围和断言。
