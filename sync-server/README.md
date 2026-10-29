# WebObsidian 文件同步服务

沿用 Mojian 的不可变附件 blob、精确版本 CAS 和持久化操作回执协议。原始文件字节通过 HTTP 传输，与 Git 定时备份无关。不需要为每次编辑运行 Git。

## 运行

Node.js 20+，无额外依赖：`node sync-server/server.mjs <配置文件绝对路径>`。

配置文件置于受当前账户保护的独立目录，不放进 Vault 或 Git：

```json
{
  "dataDir": "C:/Users/Meta/AppData/Local/WebObsidianSync/data",
  "host": "127.0.0.1",
  "port": 18744,
  "token": "replace-with-a-random-secret-of-at-least-32-bytes"
}
```

默认只监听回环。需要其他地址直连时，必须显式选择监听地址并检查防火墙；不得将未加密 HTTP 暴露到公网。客户端只允许私有 IP/回环 HTTP，公网必须 HTTPS。不要把访问令牌放进 URL、任务参数或日志。

## 接入已有 Sakura Web

新增专用 `/webobsidian-sync/v1/` 路由转发到回环 `18744`；保留 Mojian、Dayweave、订阅服务及其他原处理器。ROG 的 `18742` 和 `18743` 已被 Mojian 使用，不复用其端口或凭据：

```text
node sync-server/shared-gateway.mjs <原Dayweave网关模块绝对路径> <现有Mojian gateway-route.mjs绝对路径>
```

客户端地址可填写已有 Sakura Web 地址并加 `/webobsidian-sync/v1/`。按行填写多个地址，每次从第一行开始严格顺序尝试；所有地址必须指向同一数据目录和工作区身份，不切换到其他独立服务器。网关只开放 manifest、blob、commit 三类接口，不开放应用 API 或 MCP。

修改共享网关任务/监听/防火墙或启用服务属于单独部署操作。本实现没有自动更改 ROG 任务、SakuraFrpService 或 Tailscale，也不自动启用客户端同步。

## 数据与恢复

- 单个附件最多 1 GiB，上传/下载流式处理；清单提交最大 4 MiB / 20000 个路径。
- 服务端 `state.json` 在同一次原子写入中保存清单与幂等回执；`history/` 保留旧清单，`blobs/` 保留原始版本。停止本服务后可整体备份其数据目录，不手工更换 workspaceId 或重置 revision。
- 客户端恢复目录位于应用 dataDir 的 `file-sync/<Vault路径摘要>/`，含检查点、待提交请求、待写入日志、附件缓存和 `conflicts/`。不要清空目录来“修复”冲突。
- 同步不覆盖尚未保存的编辑；沿用现有 Vault 维护租约。发生双边修改时保留两份原始文件；启用 Git 时额外生成 local/remote 分支，不切换 HEAD，不改真实暂存区。二进制不自动合并。
- Git 定时备份推送到每设备 `webobsidian-backups/<设备标识>`，避免多个设备争用一个远端分支。不会自动 pull、强推或覆盖远端历史。
- 不同步 `.git`、其他 Obsidian 配置、回收站、临时文件；只同步原生 `.obsidian/webobsidian/` 配置。拒绝 Syncthing 管理目录和符号链接/联接。
- 空目录不同步；大小写别名、文件/目录结构冲突会停止并保留本机内容，需要用户明确处理，不能通过覆盖绕过。
- 历史、回执与附件目前保留不自动回收；容量管理必须同时考虑离线客户端，不能只删除“当前清单未引用”的文件。
