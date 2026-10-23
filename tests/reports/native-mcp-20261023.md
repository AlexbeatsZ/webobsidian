# 原生 MCP 整合针对性验收 — 2026-10-23

功能源码：`a6eb52e122c12e8d3db582a0d95a860f5585edfc`，
`feat(mcp): 合并原生候选审阅与操作入口`，已正常推送。
实现负责人完成必要编译、类型及独立服务端依赖检查；协调者独立执行下列运行验收。

## 隔离和来源

- 使用实现负责人最后一次生产编译的独立产物，复制到 Temp/.agents/
  meta-obsidian-mcp-platform-acceptance-20261023/bundle-150512。
  负责人确认编译后仅改README/设计说明；产物包含工具条移入CM文档列的最终修正。
- 新建临时 Vault、DATA_DIR、回环端口和浏览器上下文，明确设置 VAULT_PATH、ALLOWED_ROOTS。
  CLI/MCP仅指向这份临时服务器；清空继承的endpoint-file选择，未接入现用MCP。
- 实际运行生产服务器、CLI、stdio MCP和已安装Edge的无头浏览器。
  浏览器使用真实应用入口及已有编辑器；没有关闭错误断言或强制点击。
- 所有临时服务/浏览器在结束后关闭。原STEM、用户profile/config、日常应用、
  真实MCP连接和现用server/public未改动。

## 结果

| 层次 | 结果 | 检查行为 |
| --- | --- | --- |
| 纯审阅核心 | 8/8 | 部分接受/拒绝保留未改字节，完整应用准确，安全重定位保留无关编辑，同位置冲突，恢复保留无关编辑/拒绝覆盖，空文档与混合换行 |
| HTTP/CLI/MCP及实际编辑器 | 14/14 | 六工具发现，无机器接受/恢复工具；CLI和stdio initialize/list/read；BOM/CRLF/单独CR坐标；提案不直接写、幂等、过期/不支持操作拒绝；真实工作区上下文；逐块接受、Undo/Redo/保存、拒绝剩余、恢复；候选JS不执行；无页面/控制台错误；服务重启后的状态/幂等恢复 |
| 工作区冲突协议 | 5/5 | 模拟不同草稿、已切Vault、保存中和不响应的WS客户端，均拒绝不可靠快照；所有拒绝后原磁盘字节不变 |

核心检查对交付后的review.ts再次执行，结果不是只沿用早期开发快照。
工作区冲突组使用协议fixture模拟其他客户端，不能据此宣称实际多设备全部验收。

## 真实失败与修正

首次生产运行通过前九项，随后“拒绝剩余”按钮被左侧浮动SidebarDock覆盖，普通点击
持续被回收站按钮拦截。截图实际查看并交回原源码负责人；没有force click、临时隐藏
侧栏或关闭断言来改变结果。

负责人将原全宽兄弟工具条改为CM文档列中的原生块，复用已有按钮主题，未增加侧栏
偏移、z-index覆盖或另一测量通道。复制最终重新编译产物后，同一流程14项全部通过。
修正前9/10结果和截图继续保留，未改写为通过。

## 证据与复现

临时目录`C:/Users/Meta/AppData/Local/Temp/.agents/meta-obsidian-mcp-platform-acceptance-20261023`：

- `pure/acceptance.mjs`、`pure/results-final.json`：交付源码8项核心检查。
- `runtime-acceptance.mjs`、`runtime-gAYFWl/results.json`及截图：最终14项工作流。
- `runtime-P64g63/results.json`、`review-before.png`：修正前真实失败。
- `workspace-acceptance.mjs`、`workspace-oB8QJS/results.json`：5项工作区协议检查。
- 关键结果、脚本和截图另存项目Git忽略目录`.local/acceptance-mcp-platform-20261023/mcp`。

运行命令为`node runtime-acceptance.mjs <bundle目录> <server/dist/index.mjs>`及
`node workspace-acceptance.mjs <bundle目录>`。脚本自建临时Vault/数据/端口，结束时关闭
自建进程；不能改成日常Vault执行。静态产物的编译入口和架构见
`docs/design/native-mcp.md`及本地`status-mcp-integration.md`。

## 边界

这不是原生Electron窗口、macOS或Android验收，也没有新便携包。
未穷举真实断电、磁盘故障、每种丢失回执、固定标签规则中途变更、大文档性能、IME、
所有原笔记和多文件操作。创建/移动/删除/多文件组为本批明确不支持的契约。
跨平台适配在本阶段交付后另行推进；不能把此报告当作两端设备通过。
