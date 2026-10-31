# WebObsidian 文件同步服务

使用固定版本的 `@alexbeatsz/file-sync-core` 实现不可变附件 blob、精确版本 CAS 和持久化操作回执。WebObsidian 自己维护路径、清单、请求检查、token 约束、配置和网关策略。原始文件字节通过 HTTP 传输，与 Git 定时备份无关。

服务端单独使用 `sync-server-v<版本>` tag 和 Release，不跟随桌面/移动端版本，也不覆盖客户端 latest Release。完整包包含所测核心源码、许可证和 `BUILD-INFO.json`；启动只需 Node.js 22+，无需 `npm install`，不运行期读取其他项目源码。Node 运行时本身不在包内。

## 运行

下载独立服务端 ZIP 或 TAR.GZ，解压后在包根运行：

```text
node sync-server/server.mjs <配置文件绝对路径>
node sync-server/server.mjs --version
node sync-server/server.mjs --help
```

配置文件置于受当前账户保护的独立目录，不放进 Vault 或 Git。包内 `sync-server/server.example.json` 只作模板；升级现有服务时继续使用原配置和原 token：

```json
{
  "dataDir": "C:/Users/Meta/AppData/Local/WebObsidianSync/data",
  "host": "127.0.0.1",
  "port": 18744,
  "token": "replace-with-a-random-secret-of-at-least-32-bytes"
}
```

默认只监听回环。需要其他地址直连时，必须显式选择监听地址并检查防火墙；不得将未加密 HTTP 暴露到公网。客户端只允许私有 IP/回环 HTTP，公网必须 HTTPS。不要把访问令牌放进 URL、任务参数或日志。

原配置文件位置参数和 `WEBOBSIDIAN_SYNC_DATA`、`WEBOBSIDIAN_SYNC_TOKEN`、`WEBOBSIDIAN_SYNC_HOST`、`WEBOBSIDIAN_SYNC_PORT` 均保持兼容。配置字段优先于对应环境变量。相对 `dataDir` 仍相对于进程工作目录解析；服务部署应使用原数据根的绝对路径，避免更改任务工作目录后意外建立空库。token 必须为 32–512 个可打印 ASCII 字符。启动错误仅输出错误名称/代码，不输出配置正文。

在终端使用 Ctrl+C 或 SIGTERM 有序关闭：等待已接收请求和提交完成后释放数据根单写者锁。Windows 计划任务强制结束进程不等同于有序关闭；停止后必须确认原进程已退出再替换代码，不能同时启动两个写入者。

## 接入已有 Sakura Web

新增专用 `/webobsidian-sync/v1/` 路由转发到回环 `18744`；保留 Mojian、Dayweave、订阅服务及其他原处理器。ROG 的 `18742` 和 `18743` 已被 Mojian 使用，不复用其端口或凭据：

```text
node sync-server/shared-gateway.mjs <原Dayweave网关模块绝对路径> <现有Mojian gateway-route.mjs绝对路径>
```

客户端地址可填写已有 Sakura Web 地址并加 `/webobsidian-sync/v1/`。按行填写多个地址，每次从第一行开始严格顺序尝试；所有地址必须指向同一数据目录和工作区身份，不切换到其他独立服务器。网关只开放 manifest、blob、commit 三类接口，不开放应用 API 或 MCP。

修改共享网关任务/监听/防火墙或启用服务属于单独部署操作。本实现没有自动更改 ROG 任务、SakuraFrpService 或 Tailscale，也不自动启用客户端同步。

ROG 当前最外层入口为 KeePass 的 `shared-gateway.mjs`，它继续导入本包 `sync-server/shared-gateway.mjs` 的 `addFileSyncRoute`。本包保留该导出、`routeWebObsidian` 和 `createSyncServer`，并保留 `sync-server/` 目录层级。升级代码时不要把任务入口改回旧的仅 Dayweave 包装器，也不要删除仍被其他路由引用的 Dayweave 或 Mojian 模块。

## 升级与回退

1. 先在独立临时目录解压并核对 `BUILD-INFO.json` 中的服务版本、源提交和核心提交。不要覆盖私有配置或数据。
2. 保留当前任务定义、启动命令、运行身份、工作目录和本次回退代码。确认配置 `dataDir` 指向原根，并记下原 workspaceId/revision。
3. 在维护窗口停止唯一后端进程，确认其已退出；整体备份原数据根，包括 `state.json`、可能存在的 `manifest.json`、`blobs/`、`history/` 和全部 receipts。不要单独复制/重建清单。
4. 仅替换运行代码。旧部署 `webobsidian-sync/sync-server/` 下需同步更新 `server.mjs`、`cli.mjs`、`protocol.mjs`、`gateway-route.mjs`、`shared-gateway.mjs`、`package.json`、`core-source.json`，以及包内 `node_modules/@alexbeatsz/file-sync-core/`；`BUILD-INFO.json` 放部署根。私有 `.local/native-sync/` 及原数据根保持原位。
5. 用原身份、原配置、原端口重新启动；认证 GET manifest 核对 workspaceId/revision。验证客户端读取后再执行已授权的写入验收。网关只有在确需加载新模块时由协调部署统一重启；Sakura/Tailscale 不因本包升级而重启。
6. 若需回退，先停止新唯一写入者，恢复原代码和任务入口后启动。v1 state/receipt 格式未改变，正常升级不修改已有有效 state，也不需要降级数据迁移。保留已完成的新同步写入；不以旧备份覆盖前进后的数据。

本包不会自动安装任务、迁移数据、清理历史或重置身份。状态、回执、删除标记和冲突属于持久数据，不能作为旧版本构建产物删除。

## 开发与独立发行

服务端依赖固定到 `core-source.json` 记录的公共核心精确 Release npm-pack 资产，npm lock 校验归档内容，来源记录另存完整源 commit。依赖版本更新须同时更新来源记录并重跑兼容验证。源码 checkout 首次安装使用根目录 `npm ci`；独立发行工作流仅安装 `sync-server` workspace 所需依赖，不构建桌面、移动端或完整 Web 应用。

```text
npm --workspace @webobsidian/sync-server test
npx --no-install vitest run server/src/services/fileSyncEngine.test.ts server/src/services/fileSyncStandalone.test.ts
npm --workspace @webobsidian/sync-server run build
npm --workspace @webobsidian/sync-server run test:package
npm --workspace @webobsidian/sync-server run test:client
```

打包要求先提交服务端变更；默认输出 `sync-server/release/<版本>/webobsidian-sync-server-<版本>.zip`、同名 `.tar.gz` 与 `BUILD-INFO.json`。包只带运行代码、核心及说明，不含配置密钥、数据、客户端或本机绝对依赖。`.github/workflows/sync-server-release.yml` 在独立 tag 上跨 Windows/Linux、Node 22/24 执行协议、CLI 和实际解压包测试，单独发布并明确设置 `--latest=false`。

## 数据与恢复

- 单个附件最多 1 GiB，上传/下载流式处理；清单提交最大 4 MiB / 20000 个路径。
- 服务端 `state.json` 在同一次原子写入中保存清单与幂等回执；`history/` 保留旧清单，`blobs/` 保留原始版本。停止本服务后可整体备份其数据目录，不手工更换 workspaceId 或重置 revision。
- 客户端恢复目录位于应用 dataDir 的 `file-sync/<Vault路径摘要>/`，含检查点、待提交请求、待写入日志、附件缓存和 `conflicts/`。不要清空目录来“修复”冲突。
- 同步不覆盖尚未保存的编辑；沿用现有 Vault 维护租约。发生双边修改时保留两份原始文件；启用 Git 时额外生成 local/remote 分支，不切换 HEAD，不改真实暂存区。二进制不自动合并。
- Git 定时备份推送到每设备 `webobsidian-backups/<设备标识>`，避免多个设备争用一个远端分支。不会自动 pull、强推或覆盖远端历史。
- 不同步 `.git`、其他 Obsidian 配置、回收站、临时文件；只同步原生 `.obsidian/webobsidian/` 配置。拒绝 Syncthing 管理目录和符号链接/联接。
- 空目录不同步；大小写别名、文件/目录结构冲突会停止并保留本机内容，需要用户明确处理，不能通过覆盖绕过。
- 历史、回执与附件目前保留不自动回收；容量管理必须同时考虑离线客户端，不能只删除“当前清单未引用”的文件。
- 核心在启动回收死 PID 锁时使用短期 `server.lock.claim/` 排除并发回收，成功启动前即删除。若进程恰在该阶段中断而遗留 claim，先确认没有写入者，再由运维人工移除该目录；不要在服务运行时删除锁或 claim 来绕过单写者检查。
