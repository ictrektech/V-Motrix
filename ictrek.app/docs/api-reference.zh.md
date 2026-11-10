# V-Motrix API 详细参考

## VOS 地址与身份

使用现有 VOS 地址加 `/app/com.ictrek.v-motrix`，容器实际别名为 `http://v-motrix:8080`。包中未映射宿主机端口，不要与独立 Docker 部署混淆。`/api-guide.html` 提供快速目录、搜索和可展开的同版本字段；`/vos-api-contract.json` 为可下载的原始契约。

V-Motrix 为每个已验证的 VOS 用户隔离子运行实例、设置、任务库和下载目录，与 V-Burst 的共享 aria2 包装层不同。外部调用使用 `Authorization: Bearer <VOS access_token>`，或先建立本应用 cookie 会话。VOS user-check/userinfo 核验身份后，网关为该用户的子服务注入另一份私有 operator token，不能把内部 token 发给 Agent。V-Scheduler 模型 Key、厂商 Key、MDXP agent 凭据和 VOS token 不可混用；本应用不生成个人推理 Key，也不向调度器注册模型。

cookie 登录使用 POST `/api/vos/auth/login`，正文 `{access_token:"..."}`，且必须提供与请求 Host 同主机的 Origin。成功返回 authenticated/user 和限定应用路径的 HttpOnly、SameSite=Strict cookie。会话位于进程内存，滑动有效期12小时，过期或重启后重新登录。GET `/api/vos/auth/session` 只报告这个本地 cookie 会话，因此合法的纯 Bearer 调用也可能看到 authenticated=false，不能用它判断 Bearer 是否有效。POST `/api/vos/auth/logout` 需同源 Origin，清除本应用 cookie，不删除用户下载。

## HTTP 接口与错误

完整参考覆盖网关健康、VOS 会话/登录/退出、诊断、当前用户全部暂停/恢复、插件暂存，以及74个**实际注册**的服务端命令/查询。目录从处理器生成，不能把桌面协议常量中每个名称都当成 VOS 可调用接口。Bridge 配对/MDXP 是另一套 agent 协议；VOS 外层只开放 `/rpc/events` WebSocket，不能把独立部署的 bridge 文档当成已发布 VOS 接口。

外层 `/healthz` 无需身份，返回 `{ok:true}`，但不启动用户引擎，也不证明下载正常。`/rpc/*` 和 `/api/*` 必须有身份。身份失败401、登录/退出 Origin 不符403、未知 RPC channel404、代理失败502、处理器错误常为500 `{error:string}`。静态 SPA 的 HTML200 不是 API 成功。必须同时检查状态、Content-Type 与原生返回，不存在统一的 Scheduler 结果封装。Task Inspector Activity 特例返回 `{protocol:"motrix-rpc-v1",ok:true,value:...}` 或 `{protocol:"motrix-rpc-v1",ok:false,error:{code,message}}`，业务失败仍可为 HTTP200。

登录正文限64KiB，JSON 代理正文限16MiB；超限可能返回网关原生错误，不能假定全是413。插件暂存另有5MiB限制，可返回413。字段参考描述序列化结构，运行时 Zod 细化校验、URI规则、引擎能力和目录权限仍然生效。

## 命令、查询与创建下载

向 `/rpc/query/<编码channel>` 或 `/rpc/command/<编码channel>` POST `{args:[...位置参数]}`；构造 URL 时可把冒号编码为 `%3A`。返回是处理器原生数组、对象、状态或空正文，不是统一 `{result:...}`，也不是 aria2 JSON-RPC。完整参考展开各参数的顺序、可选性和 DTO；递归类型保留引用。原生确实声明 unknown 的结果会明确标注，不伪造字段。

先调用 `query:listAllowedSaveDirs` 获取 `{paths:[{path}],defaultPath,allowCustom}`，只使用返回的虚拟目录。不要提交宿主机路径或其他用户目录。`query:listTasks` 返回精简任务行，`query:getTaskDetail` 的 args 为 `[taskId]`，返回完整任务。DownloadTask 的字节、速度、进度是数值，不是原生 aria2 的数值字符串；状态包括 queued/fetching_metadata/metadata_ready/downloading/finalizing/seeding/paused/completed/error/removed。应用任务 ID 与引擎 GID 不同。

创建下载使用 `command:createTask`，第一个参数为 `{type:"http",uris:[...],saveDir,filename?,connections?,headers?,proxy?}`；uris非空，connections为1..128，headers为 name/value 对象数组。BT 使用 type=bt、payload `{kind:"torrent-base64",base64}` 或 `{kind:"magnet",uri}`、selectedFiles和saveDir，另有下载/上传上限、seedRatio、displayName、existingTaskId、duplicatePolicy。生成的输入结构直接来自实际 Zod schema。JSON 调用不能把原生 Uint8Array 或服务器路径替代应使用的 Base64 字段。

创建可能返回 outcome=created/reused/rechecked/conflict，附 taskId/gid 或冲突信息。保存身份并轮询状态，提交不等于完成，重复命令也不普遍幂等。磁链解析后可能还需选择文件才能开始下载，BT完成后可能继续做种；冲突或不确定的请求不能盲目作为新下载重发。

## 暂停、取消与删除

pauseTask/resumeTask/stopSeedingTask 的位置参数为 taskId。批量暂停/恢复的参数是一个任务 ID 数组，因此 args 要再嵌套一层。`/api/tasks/pause-all`、resume-all 仅影响该身份的子实例，不是整台 VOS 所有用户。

removeTask 参数为 `{taskId,deleteWithFiles:boolean}`；removeTasks 为 `{taskIds,deleteWithFiles}`。false保留本地文件，true还请求删除文件；不要用原生 GID 替代 taskId，或把文件删除当成取消。应检查任务状态和批量逐项返回，不能将 HTTP200 当成清理已完成。关闭页面、事件连接或轮询不会停止下载。

## 事件、插件和独立 operator 接口

`/rpc/events` 是带身份的 WebSocket，帧为 `{channel,args}`，不是 SSE。不提供持久化重放游标；重连后重新查询任务。浏览器 WebSocket 不能设置 Authorization 头，应使用同源应用 cookie；服务端客户端可携带 VOS Bearer。外层拒绝其他 WebSocket 路径。

插件暂存 POST `/api/plugins/uploads` 使用原始 `.moext` 字节，Content-Type=application/vnd.motrix.moext，X-Motrix-File-Name为 URL 编码文件名；可选 X-Motrix-File-Sha256 会与服务端计算的摘要比对。201返回 `{uploadId,fileHash}`，不是已安装插件。默认保留1小时，后续安装消费引用，并且仍需确认与权限流程。格式/摘要/配额错误400，正文超限413，上传不等于批准插件。

子服务还有供独立 Docker 部署使用的 operator 登录/状态/退出接口，不能替代外层 VOS 会话接口。网关已注入内部 operator 身份；对子服务退出不会清除外层 v_motrix_session，应使用前面的 VOS auth 路由。诊断与设置可能包含该用户的私有配置，不能公开当成普通健康输出。

## 可复制示例

```bash
ORIGIN='https://<vos-host>:<vos-port>'
BASE="$ORIGIN/app/com.ictrek.v-motrix"
# 使用当前 VOS token；这里不生成推理 Key。
curl --fail-with-body "$BASE/rpc/query/query%3AlistAllowedSaveDirs" -H "Authorization: Bearer $VOS_TOKEN" -H 'Content-Type: application/json' -d '{"args":[]}'
curl --fail-with-body "$BASE/rpc/query/query%3AlistTasks" -H "Authorization: Bearer $VOS_TOKEN" -H 'Content-Type: application/json' -d '{"args":[]}'
curl --fail-with-body "$BASE/rpc/query/query%3AgetTaskDetail" -H "Authorization: Bearer $VOS_TOKEN" -H 'Content-Type: application/json' -d '{"args":["<task-id>"]}'
curl --fail-with-body "$BASE/rpc/command/command%3ApauseTask" -H "Authorization: Bearer $VOS_TOKEN" -H 'Content-Type: application/json' -d '{"args":["<task-id>"]}'
```

本轮只更新文档代码，随 V-Motrix 下次发版进入安装界面，不改现有数据、profile、身份策略或运行部署。


## 完整接口与返回

### POST /rpc/command/command:addMagnetTask

身份：VOSBearer / VOSSession

Native server control-plane handler, protected by the VOS gateway. Arguments are positional in args. Source: src/server/ipc/commands.ts:356. TypeScript types describe serialization shape, not all Zod refinements or engine support; the workflow guide documents those boundaries.

请求体：application/json

`object`

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `args` | array | 必填 |  |

响应 200 — Native method result; this is not a universal result envelope. Task Inspector Activity uses its documented protocol envelope instead.

`application/json`

`Native2`

响应 default — Check HTTP status and error body; unknown channel404, invalid identity401, handler failure500. Native structured results can report a business failure even on200.

### POST /rpc/command/command:addTorrentTask

身份：VOSBearer / VOSSession

Native server control-plane handler, protected by the VOS gateway. Arguments are positional in args. Source: src/server/ipc/commands.ts:373. TypeScript types describe serialization shape, not all Zod refinements or engine support; the workflow guide documents those boundaries.

请求体：application/json

`object`

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `args` | array | 必填 |  |

响应 200 — Native method result; this is not a universal result envelope. Task Inspector Activity uses its documented protocol envelope instead.

`application/json`

`Native2`

响应 default — Check HTTP status and error body; unknown channel404, invalid identity401, handler failure500. Native structured results can report a business failure even on200.

### POST /rpc/command/command:reopenMagnetFileSelection

身份：VOSBearer / VOSSession

Native server control-plane handler, protected by the VOS gateway. Arguments are positional in args. Source: src/server/ipc/commands.ts:390. TypeScript types describe serialization shape, not all Zod refinements or engine support; the workflow guide documents those boundaries.

请求体：application/json

`object`

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `args` | array | 必填 |  |

响应 200 — Native method result; this is not a universal result envelope. Task Inspector Activity uses its documented protocol envelope instead.

`application/json`

`Native4`

响应 default — Check HTTP status and error body; unknown channel404, invalid identity401, handler failure500. Native structured results can report a business failure even on200.

### POST /rpc/command/command:createTask

身份：VOSBearer / VOSSession

Native server control-plane handler, protected by the VOS gateway. Arguments are positional in args. Source: src/server/ipc/commands.ts:395. TypeScript types describe serialization shape, not all Zod refinements or engine support; the workflow guide documents those boundaries.

请求体：application/json

`object`

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `args` | array | 必填 |  |

响应 200 — Native method result; this is not a universal result envelope. Task Inspector Activity uses its documented protocol envelope instead.

`application/json`

`Native5 | Native6 | Native7`

响应 default — Check HTTP status and error body; unknown channel404, invalid identity401, handler failure500. Native structured results can report a business failure even on200.

### POST /rpc/command/command:pauseTask

身份：VOSBearer / VOSSession

Native server control-plane handler, protected by the VOS gateway. Arguments are positional in args. Source: src/server/ipc/commands.ts:531. TypeScript types describe serialization shape, not all Zod refinements or engine support; the workflow guide documents those boundaries.

请求体：application/json

`object`

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `args` | array | 必填 |  |

响应 200 — Native method result; this is not a universal result envelope. Task Inspector Activity uses its documented protocol envelope instead.

`application/json`

`Native9`

响应 default — Check HTTP status and error body; unknown channel404, invalid identity401, handler failure500. Native structured results can report a business failure even on200.

### POST /rpc/command/command:resumeTask

身份：VOSBearer / VOSSession

Native server control-plane handler, protected by the VOS gateway. Arguments are positional in args. Source: src/server/ipc/commands.ts:536. TypeScript types describe serialization shape, not all Zod refinements or engine support; the workflow guide documents those boundaries.

请求体：application/json

`object`

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `args` | array | 必填 |  |

响应 200 — Native method result; this is not a universal result envelope. Task Inspector Activity uses its documented protocol envelope instead.

`application/json`

`Native10`

响应 default — Check HTTP status and error body; unknown channel404, invalid identity401, handler failure500. Native structured results can report a business failure even on200.

### POST /rpc/command/command:pauseTasks

身份：VOSBearer / VOSSession

Native server control-plane handler, protected by the VOS gateway. Arguments are positional in args. Source: src/server/ipc/commands.ts:543. TypeScript types describe serialization shape, not all Zod refinements or engine support; the workflow guide documents those boundaries.

请求体：application/json

`object`

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `args` | array | 必填 |  |

响应 200 — Native method result; this is not a universal result envelope. Task Inspector Activity uses its documented protocol envelope instead.

`application/json`

`Native11`

响应 default — Check HTTP status and error body; unknown channel404, invalid identity401, handler failure500. Native structured results can report a business failure even on200.

### POST /rpc/command/command:resumeTasks

身份：VOSBearer / VOSSession

Native server control-plane handler, protected by the VOS gateway. Arguments are positional in args. Source: src/server/ipc/commands.ts:550. TypeScript types describe serialization shape, not all Zod refinements or engine support; the workflow guide documents those boundaries.

请求体：application/json

`object`

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `args` | array | 必填 |  |

响应 200 — Native method result; this is not a universal result envelope. Task Inspector Activity uses its documented protocol envelope instead.

`application/json`

`Native11`

响应 default — Check HTTP status and error body; unknown channel404, invalid identity401, handler failure500. Native structured results can report a business failure even on200.

### POST /rpc/command/command:stopSeedingTasks

身份：VOSBearer / VOSSession

Native server control-plane handler, protected by the VOS gateway. Arguments are positional in args. Source: src/server/ipc/commands.ts:557. TypeScript types describe serialization shape, not all Zod refinements or engine support; the workflow guide documents those boundaries.

请求体：application/json

`object`

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `args` | array | 必填 |  |

响应 200 — Native method result; this is not a universal result envelope. Task Inspector Activity uses its documented protocol envelope instead.

`application/json`

`Native11`

响应 default — Check HTTP status and error body; unknown channel404, invalid identity401, handler failure500. Native structured results can report a business failure even on200.

### POST /rpc/command/command:reAddTasks

身份：VOSBearer / VOSSession

Native server control-plane handler, protected by the VOS gateway. Arguments are positional in args. Source: src/server/ipc/commands.ts:566. TypeScript types describe serialization shape, not all Zod refinements or engine support; the workflow guide documents those boundaries.

请求体：application/json

`object`

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `args` | array | 必填 |  |

响应 200 — Native method result; this is not a universal result envelope. Task Inspector Activity uses its documented protocol envelope instead.

`application/json`

`Native11`

响应 default — Check HTTP status and error body; unknown channel404, invalid identity401, handler failure500. Native structured results can report a business failure even on200.

### POST /rpc/command/command:retryTasks

身份：VOSBearer / VOSSession

Native server control-plane handler, protected by the VOS gateway. Arguments are positional in args. Source: src/server/ipc/commands.ts:575. TypeScript types describe serialization shape, not all Zod refinements or engine support; the workflow guide documents those boundaries.

请求体：application/json

`object`

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `args` | array | 必填 |  |

响应 200 — Native method result; this is not a universal result envelope. Task Inspector Activity uses its documented protocol envelope instead.

`application/json`

`Native11`

响应 default — Check HTTP status and error body; unknown channel404, invalid identity401, handler failure500. Native structured results can report a business failure even on200.

### POST /rpc/command/command:removeTasks

身份：VOSBearer / VOSSession

Native server control-plane handler, protected by the VOS gateway. Arguments are positional in args. Source: src/server/ipc/commands.ts:589. TypeScript types describe serialization shape, not all Zod refinements or engine support; the workflow guide documents those boundaries.

请求体：application/json

`object`

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `args` | array | 必填 |  |

响应 200 — Native method result; this is not a universal result envelope. Task Inspector Activity uses its documented protocol envelope instead.

`application/json`

`Native11`

响应 default — Check HTTP status and error body; unknown channel404, invalid identity401, handler failure500. Native structured results can report a business failure even on200.

### POST /rpc/command/command:stopSeedingTask

身份：VOSBearer / VOSSession

Native server control-plane handler, protected by the VOS gateway. Arguments are positional in args. Source: src/server/ipc/commands.ts:599. TypeScript types describe serialization shape, not all Zod refinements or engine support; the workflow guide documents those boundaries.

请求体：application/json

`object`

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `args` | array | 必填 |  |

响应 200 — Native method result; this is not a universal result envelope. Task Inspector Activity uses its documented protocol envelope instead.

`application/json`

`Native13`

响应 default — Check HTTP status and error body; unknown channel404, invalid identity401, handler failure500. Native structured results can report a business failure even on200.

### POST /rpc/command/command:reAddTask

身份：VOSBearer / VOSSession

Native server control-plane handler, protected by the VOS gateway. Arguments are positional in args. Source: src/server/ipc/commands.ts:604. TypeScript types describe serialization shape, not all Zod refinements or engine support; the workflow guide documents those boundaries.

请求体：application/json

`object`

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `args` | array | 必填 |  |

响应 200 — Native method result; this is not a universal result envelope. Task Inspector Activity uses its documented protocol envelope instead.

`application/json`

`Native14`

响应 default — Check HTTP status and error body; unknown channel404, invalid identity401, handler failure500. Native structured results can report a business failure even on200.

### POST /rpc/command/command:removeTask

身份：VOSBearer / VOSSession

Native server control-plane handler, protected by the VOS gateway. Arguments are positional in args. Source: src/server/ipc/commands.ts:609. TypeScript types describe serialization shape, not all Zod refinements or engine support; the workflow guide documents those boundaries.

请求体：application/json

`object`

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `args` | array | 必填 |  |

响应 200 — Native method result; this is not a universal result envelope. Task Inspector Activity uses its documented protocol envelope instead.

`application/json`

`Native15`

响应 default — Check HTTP status and error body; unknown channel404, invalid identity401, handler failure500. Native structured results can report a business failure even on200.

### POST /rpc/command/command:restartEngine

身份：VOSBearer / VOSSession

Native server control-plane handler, protected by the VOS gateway. Arguments are positional in args. Source: src/server/ipc/commands.ts:616. TypeScript types describe serialization shape, not all Zod refinements or engine support; the workflow guide documents those boundaries.

请求体：application/json

`object`

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `args` | array | 可选 |  |

响应 200 — Native method result; this is not a universal result envelope. Task Inspector Activity uses its documented protocol envelope instead.

`application/json`

`Native16`

响应 default — Check HTTP status and error body; unknown channel404, invalid identity401, handler failure500. Native structured results can report a business failure even on200.

### POST /rpc/command/command:recoverEngine

身份：VOSBearer / VOSSession

Native server control-plane handler, protected by the VOS gateway. Arguments are positional in args. Source: src/server/ipc/commands.ts:621. TypeScript types describe serialization shape, not all Zod refinements or engine support; the workflow guide documents those boundaries.

请求体：application/json

`object`

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `args` | array | 必填 |  |

响应 200 — Native method result; this is not a universal result envelope. Task Inspector Activity uses its documented protocol envelope instead.

`application/json`

`Native17`

响应 default — Check HTTP status and error body; unknown channel404, invalid identity401, handler failure500. Native structured results can report a business failure even on200.

### POST /rpc/command/command:updateSettings

身份：VOSBearer / VOSSession

Native server control-plane handler, protected by the VOS gateway. Arguments are positional in args. Source: src/server/ipc/commands.ts:625. TypeScript types describe serialization shape, not all Zod refinements or engine support; the workflow guide documents those boundaries.

请求体：application/json

`object`

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `args` | array | 必填 |  |

响应 200 — Native method result; this is not a universal result envelope. Task Inspector Activity uses its documented protocol envelope instead.

`application/json`

`Native21`

响应 default — Check HTTP status and error body; unknown channel404, invalid identity401, handler failure500. Native structured results can report a business failure even on200.

### POST /rpc/command/command:updateGeoIPDatabase

身份：VOSBearer / VOSSession

Native server control-plane handler, protected by the VOS gateway. Arguments are positional in args. Source: src/server/ipc/commands.ts:712. TypeScript types describe serialization shape, not all Zod refinements or engine support; the workflow guide documents those boundaries.

请求体：application/json

`object`

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `args` | array | 可选 |  |

响应 200 — Native method result; this is not a universal result envelope. Task Inspector Activity uses its documented protocol envelope instead.

`application/json`

`Native22`

响应 default — Check HTTP status and error body; unknown channel404, invalid identity401, handler failure500. Native structured results can report a business failure even on200.

### POST /rpc/command/command:requestDefaultTorrentHandler

身份：VOSBearer / VOSSession

Native server control-plane handler, protected by the VOS gateway. Arguments are positional in args. Source: src/server/ipc/commands.ts:716. TypeScript types describe serialization shape, not all Zod refinements or engine support; the workflow guide documents those boundaries.

请求体：application/json

`object`

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `args` | array | 可选 |  |

响应 200 — Native method result; this is not a universal result envelope. Task Inspector Activity uses its documented protocol envelope instead.

`application/json`

`Native23`

响应 default — Check HTTP status and error body; unknown channel404, invalid identity401, handler failure500. Native structured results can report a business failure even on200.

### POST /rpc/command/command:syncTrackers

身份：VOSBearer / VOSSession

Native server control-plane handler, protected by the VOS gateway. Arguments are positional in args. Source: src/server/ipc/commands.ts:718. TypeScript types describe serialization shape, not all Zod refinements or engine support; the workflow guide documents those boundaries.

请求体：application/json

`object`

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `args` | array | 可选 |  |

响应 200 — Native method result; this is not a universal result envelope. Task Inspector Activity uses its documented protocol envelope instead.

`application/json`

`Native24`

响应 default — Check HTTP status and error body; unknown channel404, invalid identity401, handler failure500. Native structured results can report a business failure even on200.

### POST /rpc/command/command:setTaskBtTracker

身份：VOSBearer / VOSSession

Native server control-plane handler, protected by the VOS gateway. Arguments are positional in args. Source: src/server/ipc/commands.ts:720. TypeScript types describe serialization shape, not all Zod refinements or engine support; the workflow guide documents those boundaries.

请求体：application/json

`object`

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `args` | array | 必填 |  |

响应 200 — Native method result; this is not a universal result envelope. Task Inspector Activity uses its documented protocol envelope instead.

响应 default — Check HTTP status and error body; unknown channel404, invalid identity401, handler failure500. Native structured results can report a business failure even on200.

### POST /rpc/command/command:syncTaskBtTracker

身份：VOSBearer / VOSSession

Native server control-plane handler, protected by the VOS gateway. Arguments are positional in args. Source: src/server/ipc/commands.ts:733. TypeScript types describe serialization shape, not all Zod refinements or engine support; the workflow guide documents those boundaries.

请求体：application/json

`object`

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `args` | array | 必填 |  |

响应 200 — Native method result; this is not a universal result envelope. Task Inspector Activity uses its documented protocol envelope instead.

响应 default — Check HTTP status and error body; unknown channel404, invalid identity401, handler failure500. Native structured results can report a business failure even on200.

### POST /rpc/command/command:enablePlugin

身份：VOSBearer / VOSSession

Native server control-plane handler, protected by the VOS gateway. Arguments are positional in args. Source: src/server/ipc/commands.ts:743. TypeScript types describe serialization shape, not all Zod refinements or engine support; the workflow guide documents those boundaries.

请求体：application/json

`object`

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `args` | array | 必填 |  |

响应 200 — Native method result; this is not a universal result envelope. Task Inspector Activity uses its documented protocol envelope instead.

`application/json`

`Native28`

响应 default — Check HTTP status and error body; unknown channel404, invalid identity401, handler failure500. Native structured results can report a business failure even on200.

### POST /rpc/command/command:disablePlugin

身份：VOSBearer / VOSSession

Native server control-plane handler, protected by the VOS gateway. Arguments are positional in args. Source: src/server/ipc/commands.ts:760. TypeScript types describe serialization shape, not all Zod refinements or engine support; the workflow guide documents those boundaries.

请求体：application/json

`object`

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `args` | array | 必填 |  |

响应 200 — Native method result; this is not a universal result envelope. Task Inspector Activity uses its documented protocol envelope instead.

`application/json`

`Native29`

响应 default — Check HTTP status and error body; unknown channel404, invalid identity401, handler failure500. Native structured results can report a business failure even on200.

### POST /rpc/command/command:updatePluginConfig

身份：VOSBearer / VOSSession

Native server control-plane handler, protected by the VOS gateway. Arguments are positional in args. Source: src/server/ipc/commands.ts:774. TypeScript types describe serialization shape, not all Zod refinements or engine support; the workflow guide documents those boundaries.

请求体：application/json

`object`

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `args` | array | 必填 |  |

响应 200 — Native method result; this is not a universal result envelope. Task Inspector Activity uses its documented protocol envelope instead.

`application/json`

`Native30`

响应 default — Check HTTP status and error body; unknown channel404, invalid identity401, handler failure500. Native structured results can report a business failure even on200.

### POST /rpc/command/command:installPlugin

身份：VOSBearer / VOSSession

Native server control-plane handler, protected by the VOS gateway. Arguments are positional in args. Source: src/server/ipc/commands.ts:821. TypeScript types describe serialization shape, not all Zod refinements or engine support; the workflow guide documents those boundaries.

请求体：application/json

`object`

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `args` | array | 必填 |  |

响应 200 — Native method result; this is not a universal result envelope. Task Inspector Activity uses its documented protocol envelope instead.

`application/json`

`Native31`

响应 default — Check HTTP status and error body; unknown channel404, invalid identity401, handler failure500. Native structured results can report a business failure even on200.

### POST /rpc/command/command:confirmPluginInstall

身份：VOSBearer / VOSSession

Native server control-plane handler, protected by the VOS gateway. Arguments are positional in args. Source: src/server/ipc/commands.ts:834. TypeScript types describe serialization shape, not all Zod refinements or engine support; the workflow guide documents those boundaries.

请求体：application/json

`object`

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `args` | array | 必填 |  |

响应 200 — Native method result; this is not a universal result envelope. Task Inspector Activity uses its documented protocol envelope instead.

`application/json`

`Native45`

响应 default — Check HTTP status and error body; unknown channel404, invalid identity401, handler failure500. Native structured results can report a business failure even on200.

### POST /rpc/command/command:cancelPluginInstall

身份：VOSBearer / VOSSession

Native server control-plane handler, protected by the VOS gateway. Arguments are positional in args. Source: src/server/ipc/commands.ts:850. TypeScript types describe serialization shape, not all Zod refinements or engine support; the workflow guide documents those boundaries.

请求体：application/json

`object`

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `args` | array | 必填 |  |

响应 200 — Native method result; this is not a universal result envelope. Task Inspector Activity uses its documented protocol envelope instead.

`application/json`

`Native46`

响应 default — Check HTTP status and error body; unknown channel404, invalid identity401, handler failure500. Native structured results can report a business failure even on200.

### POST /rpc/command/command:updatePluginGrants

身份：VOSBearer / VOSSession

Native server control-plane handler, protected by the VOS gateway. Arguments are positional in args. Source: src/server/ipc/commands.ts:856. TypeScript types describe serialization shape, not all Zod refinements or engine support; the workflow guide documents those boundaries.

请求体：application/json

`object`

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `args` | array | 必填 |  |

响应 200 — Native method result; this is not a universal result envelope. Task Inspector Activity uses its documented protocol envelope instead.

`application/json`

`Native47`

响应 default — Check HTTP status and error body; unknown channel404, invalid identity401, handler failure500. Native structured results can report a business failure even on200.

### POST /rpc/command/command:uninstallPlugin

身份：VOSBearer / VOSSession

Native server control-plane handler, protected by the VOS gateway. Arguments are positional in args. Source: src/server/ipc/commands.ts:870. TypeScript types describe serialization shape, not all Zod refinements or engine support; the workflow guide documents those boundaries.

请求体：application/json

`object`

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `args` | array | 必填 |  |

响应 200 — Native method result; this is not a universal result envelope. Task Inspector Activity uses its documented protocol envelope instead.

`application/json`

`Native48`

响应 default — Check HTTP status and error body; unknown channel404, invalid identity401, handler failure500. Native structured results can report a business failure even on200.

### POST /rpc/command/command:clearPluginLogs

身份：VOSBearer / VOSSession

Native server control-plane handler, protected by the VOS gateway. Arguments are positional in args. Source: src/server/ipc/commands.ts:878. TypeScript types describe serialization shape, not all Zod refinements or engine support; the workflow guide documents those boundaries.

请求体：application/json

`object`

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `args` | array | 必填 |  |

响应 200 — Native method result; this is not a universal result envelope. Task Inspector Activity uses its documented protocol envelope instead.

`application/json`

`Native49`

响应 default — Check HTTP status and error body; unknown channel404, invalid identity401, handler failure500. Native structured results can report a business failure even on200.

### POST /rpc/command/command:setPluginLogVerbose

身份：VOSBearer / VOSSession

Native server control-plane handler, protected by the VOS gateway. Arguments are positional in args. Source: src/server/ipc/commands.ts:884. TypeScript types describe serialization shape, not all Zod refinements or engine support; the workflow guide documents those boundaries.

请求体：application/json

`object`

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `args` | array | 必填 |  |

响应 200 — Native method result; this is not a universal result envelope. Task Inspector Activity uses its documented protocol envelope instead.

`application/json`

`Native50`

响应 default — Check HTTP status and error body; unknown channel404, invalid identity401, handler failure500. Native structured results can report a business failure even on200.

### POST /rpc/command/command:markNotificationRead

身份：VOSBearer / VOSSession

Native server control-plane handler, protected by the VOS gateway. Arguments are positional in args. Source: src/server/ipc/commands.ts:892. TypeScript types describe serialization shape, not all Zod refinements or engine support; the workflow guide documents those boundaries.

请求体：application/json

`object`

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `args` | array | 必填 |  |

响应 200 — Native method result; this is not a universal result envelope. Task Inspector Activity uses its documented protocol envelope instead.

`application/json`

`boolean | boolean`

响应 default — Check HTTP status and error body; unknown channel404, invalid identity401, handler failure500. Native structured results can report a business failure even on200.

### POST /rpc/command/command:markAllNotificationsRead

身份：VOSBearer / VOSSession

Native server control-plane handler, protected by the VOS gateway. Arguments are positional in args. Source: src/server/ipc/commands.ts:895. TypeScript types describe serialization shape, not all Zod refinements or engine support; the workflow guide documents those boundaries.

请求体：application/json

`object`

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `args` | array | 可选 |  |

响应 200 — Native method result; this is not a universal result envelope. Task Inspector Activity uses its documented protocol envelope instead.

`application/json`

`number`

响应 default — Check HTTP status and error body; unknown channel404, invalid identity401, handler failure500. Native structured results can report a business failure even on200.

### POST /rpc/command/command:deleteNotification

身份：VOSBearer / VOSSession

Native server control-plane handler, protected by the VOS gateway. Arguments are positional in args. Source: src/server/ipc/commands.ts:898. TypeScript types describe serialization shape, not all Zod refinements or engine support; the workflow guide documents those boundaries.

请求体：application/json

`object`

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `args` | array | 必填 |  |

响应 200 — Native method result; this is not a universal result envelope. Task Inspector Activity uses its documented protocol envelope instead.

`application/json`

`boolean | boolean`

响应 default — Check HTTP status and error body; unknown channel404, invalid identity401, handler failure500. Native structured results can report a business failure even on200.

### POST /rpc/command/command:clearNotifications

身份：VOSBearer / VOSSession

Native server control-plane handler, protected by the VOS gateway. Arguments are positional in args. Source: src/server/ipc/commands.ts:901. TypeScript types describe serialization shape, not all Zod refinements or engine support; the workflow guide documents those boundaries.

请求体：application/json

`object`

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `args` | array | 可选 |  |

响应 200 — Native method result; this is not a universal result envelope. Task Inspector Activity uses its documented protocol envelope instead.

`application/json`

`number`

响应 default — Check HTTP status and error body; unknown channel404, invalid identity401, handler failure500. Native structured results can report a business failure even on200.

### POST /rpc/query/query:getCliToolStatus

身份：VOSBearer / VOSSession

Native server control-plane handler, protected by the VOS gateway. Arguments are positional in args. Source: src/server/ipc/queries.ts:143. TypeScript types describe serialization shape, not all Zod refinements or engine support; the workflow guide documents those boundaries.

请求体：application/json

`object`

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `args` | array | 可选 |  |

响应 200 — Native method result; this is not a universal result envelope. Task Inspector Activity uses its documented protocol envelope instead.

`application/json`

`Native51`

响应 default — Check HTTP status and error body; unknown channel404, invalid identity401, handler failure500. Native structured results can report a business failure even on200.

### POST /rpc/query/query:listTasks

身份：VOSBearer / VOSSession

Native server control-plane handler, protected by the VOS gateway. Arguments are positional in args. Source: src/server/ipc/queries.ts:147. TypeScript types describe serialization shape, not all Zod refinements or engine support; the workflow guide documents those boundaries.

请求体：application/json

`object`

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `args` | array | 可选 |  |

响应 200 — Native method result; this is not a universal result envelope. Task Inspector Activity uses its documented protocol envelope instead.

`application/json`

`array<Native53>`

响应 default — Check HTTP status and error body; unknown channel404, invalid identity401, handler failure500. Native structured results can report a business failure even on200.

### POST /rpc/query/query:getTaskDetail

身份：VOSBearer / VOSSession

Native server control-plane handler, protected by the VOS gateway. Arguments are positional in args. Source: src/server/ipc/queries.ts:152. TypeScript types describe serialization shape, not all Zod refinements or engine support; the workflow guide documents those boundaries.

请求体：application/json

`object`

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `args` | array | 必填 |  |

响应 200 — Native method result; this is not a universal result envelope. Task Inspector Activity uses its documented protocol envelope instead.

`application/json`

`null | Native53`

响应 default — Check HTTP status and error body; unknown channel404, invalid identity401, handler failure500. Native structured results can report a business failure even on200.

### POST /rpc/query/query:getTaskPieces

身份：VOSBearer / VOSSession

Native server control-plane handler, protected by the VOS gateway. Arguments are positional in args. Source: src/server/ipc/queries.ts:155. TypeScript types describe serialization shape, not all Zod refinements or engine support; the workflow guide documents those boundaries.

请求体：application/json

`object`

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `args` | array | 必填 |  |

响应 200 — Native method result; this is not a universal result envelope. Task Inspector Activity uses its documented protocol envelope instead.

`application/json`

`Native58`

响应 default — Check HTTP status and error body; unknown channel404, invalid identity401, handler failure500. Native structured results can report a business failure even on200.

### POST /rpc/query/query:getTaskPeers

身份：VOSBearer / VOSSession

Native server control-plane handler, protected by the VOS gateway. Arguments are positional in args. Source: src/server/ipc/queries.ts:160. TypeScript types describe serialization shape, not all Zod refinements or engine support; the workflow guide documents those boundaries.

请求体：application/json

`object`

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `args` | array | 必填 |  |

响应 200 — Native method result; this is not a universal result envelope. Task Inspector Activity uses its documented protocol envelope instead.

`application/json`

`array<Native60>`

响应 default — Check HTTP status and error body; unknown channel404, invalid identity401, handler failure500. Native structured results can report a business failure even on200.

### POST /rpc/query/query:getStats

身份：VOSBearer / VOSSession

Native server control-plane handler, protected by the VOS gateway. Arguments are positional in args. Source: src/server/ipc/queries.ts:166. TypeScript types describe serialization shape, not all Zod refinements or engine support; the workflow guide documents those boundaries.

请求体：application/json

`object`

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `args` | array | 可选 |  |

响应 200 — Native method result; this is not a universal result envelope. Task Inspector Activity uses its documented protocol envelope instead.

`application/json`

`Native62`

响应 default — Check HTTP status and error body; unknown channel404, invalid identity401, handler failure500. Native structured results can report a business failure even on200.

### POST /rpc/query/query:getSpeedHistory

身份：VOSBearer / VOSSession

Native server control-plane handler, protected by the VOS gateway. Arguments are positional in args. Source: src/server/ipc/queries.ts:168. TypeScript types describe serialization shape, not all Zod refinements or engine support; the workflow guide documents those boundaries.

请求体：application/json

`object`

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `args` | array | 可选 |  |

响应 200 — Native method result; this is not a universal result envelope. Task Inspector Activity uses its documented protocol envelope instead.

`application/json`

`array<Native64>`

响应 default — Check HTTP status and error body; unknown channel404, invalid identity401, handler failure500. Native structured results can report a business failure even on200.

### POST /rpc/query/query:getTransferStats

身份：VOSBearer / VOSSession

Native server control-plane handler, protected by the VOS gateway. Arguments are positional in args. Source: src/server/ipc/queries.ts:171. TypeScript types describe serialization shape, not all Zod refinements or engine support; the workflow guide documents those boundaries.

请求体：application/json

`object`

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `args` | array | 必填 |  |

响应 200 — Native method result; this is not a universal result envelope. Task Inspector Activity uses its documented protocol envelope instead.

`application/json`

`Native66`

响应 default — Check HTTP status and error body; unknown channel404, invalid identity401, handler failure500. Native structured results can report a business failure even on200.

### POST /rpc/query/query:getTaskActivity

身份：VOSBearer / VOSSession

Native server control-plane handler, protected by the VOS gateway. Arguments are positional in args. Source: src/server/ipc/queries.ts:174. TypeScript types describe serialization shape, not all Zod refinements or engine support; the workflow guide documents those boundaries.

请求体：application/json

`object`

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `args` | array | 必填 |  |

响应 200 — Native method result; this is not a universal result envelope. Task Inspector Activity uses its documented protocol envelope instead.

`application/json`

`Native71`

响应 default — Check HTTP status and error body; unknown channel404, invalid identity401, handler failure500. Native structured results can report a business failure even on200.

### POST /rpc/query/query:getTaskSpeedHistory

身份：VOSBearer / VOSSession

Native server control-plane handler, protected by the VOS gateway. Arguments are positional in args. Source: src/server/ipc/queries.ts:177. TypeScript types describe serialization shape, not all Zod refinements or engine support; the workflow guide documents those boundaries.

请求体：application/json

`object`

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `args` | array | 必填 |  |

响应 200 — Native method result; this is not a universal result envelope. Task Inspector Activity uses its documented protocol envelope instead.

`application/json`

`array<Native64>`

响应 default — Check HTTP status and error body; unknown channel404, invalid identity401, handler failure500. Native structured results can report a business failure even on200.

### POST /rpc/query/query:getTaskInspectorActivity

身份：VOSBearer / VOSSession

Native server control-plane handler, protected by the VOS gateway. Arguments are positional in args. Source: src/server/ipc/queries.ts:182. TypeScript types describe serialization shape, not all Zod refinements or engine support; the workflow guide documents those boundaries.

请求体：application/json

`object`

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `args` | array | 必填 |  |

响应 200 — Native method result; this is not a universal result envelope. Task Inspector Activity uses its documented protocol envelope instead.

`application/json`

`object | object`

响应 default — Check HTTP status and error body; unknown channel404, invalid identity401, handler failure500. Native structured results can report a business failure even on200.

### POST /rpc/query/query:getEngineStatus

身份：VOSBearer / VOSSession

Native server control-plane handler, protected by the VOS gateway. Arguments are positional in args. Source: src/server/ipc/queries.ts:185. TypeScript types describe serialization shape, not all Zod refinements or engine support; the workflow guide documents those boundaries.

请求体：application/json

`object`

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `args` | array | 可选 |  |

响应 200 — Native method result; this is not a universal result envelope. Task Inspector Activity uses its documented protocol envelope instead.

`application/json`

`Native18`

响应 default — Check HTTP status and error body; unknown channel404, invalid identity401, handler failure500. Native structured results can report a business failure even on200.

### POST /rpc/query/query:getEngineDiagnostics

身份：VOSBearer / VOSSession

Native server control-plane handler, protected by the VOS gateway. Arguments are positional in args. Source: src/server/ipc/queries.ts:187. TypeScript types describe serialization shape, not all Zod refinements or engine support; the workflow guide documents those boundaries.

请求体：application/json

`object`

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `args` | array | 可选 |  |

响应 200 — Native method result; this is not a universal result envelope. Task Inspector Activity uses its documented protocol envelope instead.

`application/json`

`Native75`

响应 default — Check HTTP status and error body; unknown channel404, invalid identity401, handler failure500. Native structured results can report a business failure even on200.

### POST /rpc/query/query:getSettings

身份：VOSBearer / VOSSession

Native server control-plane handler, protected by the VOS gateway. Arguments are positional in args. Source: src/server/ipc/queries.ts:189. TypeScript types describe serialization shape, not all Zod refinements or engine support; the workflow guide documents those boundaries.

请求体：application/json

`object`

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `args` | array | 可选 |  |

响应 200 — Native method result; this is not a universal result envelope. Task Inspector Activity uses its documented protocol envelope instead.

`application/json`

`Native80`

响应 default — Check HTTP status and error body; unknown channel404, invalid identity401, handler failure500. Native structured results can report a business failure even on200.

### POST /rpc/query/query:getGeoIPStatus

身份：VOSBearer / VOSSession

Native server control-plane handler, protected by the VOS gateway. Arguments are positional in args. Source: src/server/ipc/queries.ts:191. TypeScript types describe serialization shape, not all Zod refinements or engine support; the workflow guide documents those boundaries.

请求体：application/json

`object`

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `args` | array | 可选 |  |

响应 200 — Native method result; this is not a universal result envelope. Task Inspector Activity uses its documented protocol envelope instead.

`application/json`

`Native22`

响应 default — Check HTTP status and error body; unknown channel404, invalid identity401, handler failure500. Native structured results can report a business failure even on200.

### POST /rpc/query/query:getSystemProxy

身份：VOSBearer / VOSSession

Native server control-plane handler, protected by the VOS gateway. Arguments are positional in args. Source: src/server/ipc/queries.ts:193. TypeScript types describe serialization shape, not all Zod refinements or engine support; the workflow guide documents those boundaries.

请求体：application/json

`object`

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `args` | array | 可选 |  |

响应 200 — Native method result; this is not a universal result envelope. Task Inspector Activity uses its documented protocol envelope instead.

`application/json`

`null`

响应 default — Check HTTP status and error body; unknown channel404, invalid identity401, handler failure500. Native structured results can report a business failure even on200.

### POST /rpc/query/query:getLinuxDefaultAssociations

身份：VOSBearer / VOSSession

Native server control-plane handler, protected by the VOS gateway. Arguments are positional in args. Source: src/server/ipc/queries.ts:195. TypeScript types describe serialization shape, not all Zod refinements or engine support; the workflow guide documents those boundaries.

请求体：application/json

`object`

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `args` | array | 可选 |  |

响应 200 — Native method result; this is not a universal result envelope. Task Inspector Activity uses its documented protocol envelope instead.

`application/json`

`Native105`

响应 default — Check HTTP status and error body; unknown channel404, invalid identity401, handler failure500. Native structured results can report a business failure even on200.

### POST /rpc/query/query:getWindowsDefaultAssociations

身份：VOSBearer / VOSSession

Native server control-plane handler, protected by the VOS gateway. Arguments are positional in args. Source: src/server/ipc/queries.ts:204. TypeScript types describe serialization shape, not all Zod refinements or engine support; the workflow guide documents those boundaries.

请求体：application/json

`object`

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `args` | array | 可选 |  |

响应 200 — Native method result; this is not a universal result envelope. Task Inspector Activity uses its documented protocol envelope instead.

`application/json`

`Native106`

响应 default — Check HTTP status and error body; unknown channel404, invalid identity401, handler failure500. Native structured results can report a business failure even on200.

### POST /rpc/query/query:getTrackerList

身份：VOSBearer / VOSSession

Native server control-plane handler, protected by the VOS gateway. Arguments are positional in args. Source: src/server/ipc/queries.ts:212. TypeScript types describe serialization shape, not all Zod refinements or engine support; the workflow guide documents those boundaries.

请求体：application/json

`object`

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `args` | array | 可选 |  |

响应 200 — Native method result; this is not a universal result envelope. Task Inspector Activity uses its documented protocol envelope instead.

`application/json`

`Native107`

响应 default — Check HTTP status and error body; unknown channel404, invalid identity401, handler failure500. Native structured results can report a business failure even on200.

### POST /rpc/query/query:getTrackerSources

身份：VOSBearer / VOSSession

Native server control-plane handler, protected by the VOS gateway. Arguments are positional in args. Source: src/server/ipc/queries.ts:214. TypeScript types describe serialization shape, not all Zod refinements or engine support; the workflow guide documents those boundaries.

请求体：application/json

`object`

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `args` | array | 可选 |  |

响应 200 — Native method result; this is not a universal result envelope. Task Inspector Activity uses its documented protocol envelope instead.

`application/json`

`array<Native89>`

响应 default — Check HTTP status and error body; unknown channel404, invalid identity401, handler failure500. Native structured results can report a business failure even on200.

### POST /rpc/query/query:listAllowedSaveDirs

身份：VOSBearer / VOSSession

Native server control-plane handler, protected by the VOS gateway. Arguments are positional in args. Source: src/server/ipc/queries.ts:217. TypeScript types describe serialization shape, not all Zod refinements or engine support; the workflow guide documents those boundaries.

请求体：application/json

`object`

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `args` | array | 可选 |  |

响应 200 — Native method result; this is not a universal result envelope. Task Inspector Activity uses its documented protocol envelope instead.

`application/json`

`Native108`

响应 default — Check HTTP status and error body; unknown channel404, invalid identity401, handler failure500. Native structured results can report a business failure even on200.

### POST /rpc/query/query:getTaskBtTracker

身份：VOSBearer / VOSSession

Native server control-plane handler, protected by the VOS gateway. Arguments are positional in args. Source: src/server/ipc/queries.ts:226. TypeScript types describe serialization shape, not all Zod refinements or engine support; the workflow guide documents those boundaries.

请求体：application/json

`object`

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `args` | array | 必填 |  |

响应 200 — Native method result; this is not a universal result envelope. Task Inspector Activity uses its documented protocol envelope instead.

`application/json`

`array<string>`

响应 default — Check HTTP status and error body; unknown channel404, invalid identity401, handler failure500. Native structured results can report a business failure even on200.

### POST /rpc/query/query:getFfmpegDetection

身份：VOSBearer / VOSSession

Native server control-plane handler, protected by the VOS gateway. Arguments are positional in args. Source: src/server/ipc/queries.ts:229. TypeScript types describe serialization shape, not all Zod refinements or engine support; the workflow guide documents those boundaries.

请求体：application/json

`object`

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `args` | array | 可选 |  |

响应 200 — Native method result; this is not a universal result envelope. Task Inspector Activity uses its documented protocol envelope instead.

`application/json`

`Native111`

响应 default — Check HTTP status and error body; unknown channel404, invalid identity401, handler failure500. Native structured results can report a business failure even on200.

### POST /rpc/query/query:listPlugins

身份：VOSBearer / VOSSession

Native server control-plane handler, protected by the VOS gateway. Arguments are positional in args. Source: src/server/ipc/queries.ts:231. TypeScript types describe serialization shape, not all Zod refinements or engine support; the workflow guide documents those boundaries.

请求体：application/json

`object`

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `args` | array | 可选 |  |

响应 200 — Native method result; this is not a universal result envelope. Task Inspector Activity uses its documented protocol envelope instead.

`application/json`

`array<Native114>`

响应 default — Check HTTP status and error body; unknown channel404, invalid identity401, handler failure500. Native structured results can report a business failure even on200.

### POST /rpc/query/query:listRegistryPlugins

身份：VOSBearer / VOSSession

Native server control-plane handler, protected by the VOS gateway. Arguments are positional in args. Source: src/server/ipc/queries.ts:234. TypeScript types describe serialization shape, not all Zod refinements or engine support; the workflow guide documents those boundaries.

请求体：application/json

`object`

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `args` | array | 可选 |  |

响应 200 — Native method result; this is not a universal result envelope. Task Inspector Activity uses its documented protocol envelope instead.

`application/json`

`array<Native116>`

响应 default — Check HTTP status and error body; unknown channel404, invalid identity401, handler failure500. Native structured results can report a business failure even on200.

### POST /rpc/query/query:getRegistryPlugin

身份：VOSBearer / VOSSession

Native server control-plane handler, protected by the VOS gateway. Arguments are positional in args. Source: src/server/ipc/queries.ts:236. TypeScript types describe serialization shape, not all Zod refinements or engine support; the workflow guide documents those boundaries.

请求体：application/json

`object`

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `args` | array | 必填 |  |

响应 200 — Native method result; this is not a universal result envelope. Task Inspector Activity uses its documented protocol envelope instead.

`application/json`

`null | Native116`

响应 default — Check HTTP status and error body; unknown channel404, invalid identity401, handler failure500. Native structured results can report a business failure even on200.

### POST /rpc/query/query:getPluginManifest

身份：VOSBearer / VOSSession

Native server control-plane handler, protected by the VOS gateway. Arguments are positional in args. Source: src/server/ipc/queries.ts:239. TypeScript types describe serialization shape, not all Zod refinements or engine support; the workflow guide documents those boundaries.

请求体：application/json

`object`

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `args` | array | 必填 |  |

响应 200 — Native method result; this is not a universal result envelope. Task Inspector Activity uses its documented protocol envelope instead.

`application/json`

`null | Native121`

响应 default — Check HTTP status and error body; unknown channel404, invalid identity401, handler failure500. Native structured results can report a business failure even on200.

### POST /rpc/query/query:getPluginCommandGraph

身份：VOSBearer / VOSSession

Native server control-plane handler, protected by the VOS gateway. Arguments are positional in args. Source: src/server/ipc/queries.ts:242. TypeScript types describe serialization shape, not all Zod refinements or engine support; the workflow guide documents those boundaries.

请求体：application/json

`object`

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `args` | array | 可选 |  |

响应 200 — Native method result; this is not a universal result envelope. Task Inspector Activity uses its documented protocol envelope instead.

`application/json`

`Native126`

响应 default — Check HTTP status and error body; unknown channel404, invalid identity401, handler failure500. Native structured results can report a business failure even on200.

### POST /rpc/query/query:getPluginConfig

身份：VOSBearer / VOSSession

Native server control-plane handler, protected by the VOS gateway. Arguments are positional in args. Source: src/server/ipc/queries.ts:247. TypeScript types describe serialization shape, not all Zod refinements or engine support; the workflow guide documents those boundaries.

请求体：application/json

`object`

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `args` | array | 必填 |  |

响应 200 — Native method result; this is not a universal result envelope. Task Inspector Activity uses its documented protocol envelope instead.

`application/json`

`object`

响应 default — Check HTTP status and error body; unknown channel404, invalid identity401, handler failure500. Native structured results can report a business failure even on200.

### POST /rpc/query/query:getPluginGrants

身份：VOSBearer / VOSSession

Native server control-plane handler, protected by the VOS gateway. Arguments are positional in args. Source: src/server/ipc/queries.ts:250. TypeScript types describe serialization shape, not all Zod refinements or engine support; the workflow guide documents those boundaries.

请求体：application/json

`object`

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `args` | array | 必填 |  |

响应 200 — Native method result; this is not a universal result envelope. Task Inspector Activity uses its documented protocol envelope instead.

`application/json`

`object`

响应 default — Check HTTP status and error body; unknown channel404, invalid identity401, handler failure500. Native structured results can report a business failure even on200.

### POST /rpc/query/query:listPluginGrants

身份：VOSBearer / VOSSession

Native server control-plane handler, protected by the VOS gateway. Arguments are positional in args. Source: src/server/ipc/queries.ts:253. TypeScript types describe serialization shape, not all Zod refinements or engine support; the workflow guide documents those boundaries.

请求体：application/json

`object`

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `args` | array | 可选 |  |

响应 200 — Native method result; this is not a universal result envelope. Task Inspector Activity uses its documented protocol envelope instead.

`application/json`

`object`

响应 default — Check HTTP status and error body; unknown channel404, invalid identity401, handler failure500. Native structured results can report a business failure even on200.

### POST /rpc/query/query:getContributionIndex

身份：VOSBearer / VOSSession

Native server control-plane handler, protected by the VOS gateway. Arguments are positional in args. Source: src/server/ipc/queries.ts:255. TypeScript types describe serialization shape, not all Zod refinements or engine support; the workflow guide documents those boundaries.

请求体：application/json

`object`

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `args` | array | 可选 |  |

响应 200 — Native method result; this is not a universal result envelope. Task Inspector Activity uses its documented protocol envelope instead.

`application/json`

`Native128`

响应 default — Check HTTP status and error body; unknown channel404, invalid identity401, handler failure500. Native structured results can report a business failure even on200.

### POST /rpc/query/query:checkPluginCompatibility

身份：VOSBearer / VOSSession

Native server control-plane handler, protected by the VOS gateway. Arguments are positional in args. Source: src/server/ipc/queries.ts:258. TypeScript types describe serialization shape, not all Zod refinements or engine support; the workflow guide documents those boundaries.

请求体：application/json

`object`

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `args` | array | 必填 |  |

响应 200 — Native method result; this is not a universal result envelope. Task Inspector Activity uses its documented protocol envelope instead.

`application/json`

`Native133`

响应 default — Check HTTP status and error body; unknown channel404, invalid identity401, handler failure500. Native structured results can report a business failure even on200.

### POST /rpc/query/query:getPluginHookRank

身份：VOSBearer / VOSSession

Native server control-plane handler, protected by the VOS gateway. Arguments are positional in args. Source: src/server/ipc/queries.ts:266. TypeScript types describe serialization shape, not all Zod refinements or engine support; the workflow guide documents those boundaries.

请求体：application/json

`object`

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `args` | array | 必填 |  |

响应 200 — Native method result; this is not a universal result envelope. Task Inspector Activity uses its documented protocol envelope instead.

`application/json`

`null | Native135`

响应 default — Check HTTP status and error body; unknown channel404, invalid identity401, handler failure500. Native structured results can report a business failure even on200.

### POST /rpc/query/query:getSpeedLimitState

身份：VOSBearer / VOSSession

Native server control-plane handler, protected by the VOS gateway. Arguments are positional in args. Source: src/server/ipc/queries.ts:276. TypeScript types describe serialization shape, not all Zod refinements or engine support; the workflow guide documents those boundaries.

请求体：application/json

`object`

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `args` | array | 可选 |  |

响应 200 — Native method result; this is not a universal result envelope. Task Inspector Activity uses its documented protocol envelope instead.

`application/json`

`Native136`

响应 default — Check HTTP status and error body; unknown channel404, invalid identity401, handler failure500. Native structured results can report a business failure even on200.

### POST /rpc/query/query:listNotifications

身份：VOSBearer / VOSSession

Native server control-plane handler, protected by the VOS gateway. Arguments are positional in args. Source: src/server/ipc/queries.ts:278. TypeScript types describe serialization shape, not all Zod refinements or engine support; the workflow guide documents those boundaries.

请求体：application/json

`object`

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `args` | array | 可选 |  |

响应 200 — Native method result; this is not a universal result envelope. Task Inspector Activity uses its documented protocol envelope instead.

`application/json`

`array<Native137>`

响应 default — Check HTTP status and error body; unknown channel404, invalid identity401, handler failure500. Native structured results can report a business failure even on200.

### POST /rpc/query/query:getUnreadNotificationCount

身份：VOSBearer / VOSSession

Native server control-plane handler, protected by the VOS gateway. Arguments are positional in args. Source: src/server/ipc/queries.ts:280. TypeScript types describe serialization shape, not all Zod refinements or engine support; the workflow guide documents those boundaries.

请求体：application/json

`object`

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `args` | array | 可选 |  |

响应 200 — Native method result; this is not a universal result envelope. Task Inspector Activity uses its documented protocol envelope instead.

`application/json`

`number`

响应 default — Check HTTP status and error body; unknown channel404, invalid identity401, handler failure500. Native structured results can report a business failure even on200.

### GET /healthz

身份：公开接口 / 按文中调用边界

响应 200 — Outer VOS gateway health; does not start a user engine

`application/json`

`object`

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `ok` | JSON | 必填 |  · const=true |

响应 default — VOS gateway errors are JSON error strings. Check identity401, origin403, proxy502 and runtime error500; do not infer success from SPA HTML.

### GET /api/vos/auth/session

身份：公开接口 / 按文中调用边界

响应 200 — Local cookie-session status; a Bearer-only caller may still see authenticated=false

`application/json`

`object`

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `enabled` | boolean | 必填 |  |
| `authenticated` | boolean | 必填 |  |
| `user` | object | 可选 |  |
| `user.username` | string | 必填 |  |
| `user.namespace` | string | 必填 |  |
| `clientId` | string | 必填 |  |
| `scope` | string | 必填 |  |

响应 default — VOS gateway errors are JSON error strings. Check identity401, origin403, proxy502 and runtime error500; do not infer success from SPA HTML.

### POST /api/vos/auth/login

身份：公开接口 / 按文中调用边界

- `header: Origin` · string · 必填 · Must have the same host as the HTTP Host header

请求体：application/json

`object`

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `access_token` | string | 必填 |  |

响应 200 — Verify VOS token and set an HttpOnly scoped session cookie; matching Origin header required

`application/json`

`object`

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `authenticated` | boolean | 必填 |  |
| `user` | object | 可选 |  |
| `user.username` | string | 必填 |  |
| `user.namespace` | string | 必填 |  |

响应 default — VOS gateway errors are JSON error strings. Check identity401, origin403, proxy502 and runtime error500; do not infer success from SPA HTML.

### POST /api/vos/auth/logout

身份：公开接口 / 按文中调用边界

- `header: Origin` · string · 必填 · Must have the same host as the HTTP Host header

响应 200 — Clear outer VOS cookie session; matching Origin required

`application/json`

`object`

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `authenticated` | JSON | 必填 |  · const=false |

响应 default — VOS gateway errors are JSON error strings. Check identity401, origin403, proxy502 and runtime error500; do not infer success from SPA HTML.

### GET /api/diagnostics

身份：VOSBearer / VOSSession

响应 200 — Current user child-runtime diagnostics, native evolving object

`application/json`

`object`

响应 default — VOS gateway errors are JSON error strings. Check identity401, origin403, proxy502 and runtime error500; do not infer success from SPA HTML.

### POST /api/tasks/pause-all

身份：VOSBearer / VOSSession

响应 200 — Current user task bulk action, not a whole-host operation

`application/json`

`object`

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `ok` | boolean | 必填 |  |

响应 default — VOS gateway errors are JSON error strings. Check identity401, origin403, proxy502 and runtime error500; do not infer success from SPA HTML.

### POST /api/tasks/resume-all

身份：VOSBearer / VOSSession

响应 200 — Current user task bulk action, not a whole-host operation

`application/json`

`object`

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `ok` | boolean | 必填 |  |

响应 default — VOS gateway errors are JSON error strings. Check identity401, origin403, proxy502 and runtime error500; do not infer success from SPA HTML.

### POST /api/plugins/uploads

身份：VOSBearer / VOSSession

- `header: X-Motrix-File-Name` · string · 必填 · URL-encoded .moext filename

- `header: X-Motrix-File-Sha256` · string · 可选 · Optional claimed hash; the server computes and verifies the retained digest

请求体：application/vnd.motrix.moext

`string`

响应 201 — Native staged upload reference; default retention is one hour and later installation consumes it

`application/json`

`object`

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `uploadId` | string | 必填 |  |
| `fileHash` | string | 必填 |  |

响应 400 — Invalid file name/hash/package or upload quota

`application/json`

`object`

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `error` | string | 必填 |  |

响应 413 — Exceeds native 5 MiB body limit

## 共享数据结构

字段保持 API 的原始拼写；JSON 任意扩展字段按其所属服务说明解释。

### Native1

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `uri` | string | 必填 |  |
| `selectedFiles` | array<number> | 必填 |  |
| `saveDir` | string | 必填 |  |

### Native2

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `outcome` | string  /  string  /  string | 必填 |  |
| `gid` | string | 必填 |  |
| `taskId` | string | 必填 |  |

### Native3

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `base64` | string | 必填 |  |
| `selectedFiles` | array<number> | 必填 |  |
| `saveDir` | string | 必填 |  |

### Native4

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `ok` | boolean  /  boolean | 必填 |  |

### Native5

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `ok` | boolean  /  boolean | 必填 |  |
| `outcome` | JSON | 可选 | No application payload; inspect HTTP status and Content-Type. |
| `gid` | JSON | 可选 | No application payload; inspect HTTP status and Content-Type. |
| `taskId` | JSON | 可选 | No application payload; inspect HTTP status and Content-Type. |
| `conflict` | JSON | 可选 | No application payload; inspect HTTP status and Content-Type. |

### Native6

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `outcome` | string | 必填 |  |
| `gid` | string | 必填 |  |
| `taskId` | string | 必填 |  |
| `ok` | JSON | 可选 | No application payload; inspect HTTP status and Content-Type. |
| `conflict` | JSON | 可选 | No application payload; inspect HTTP status and Content-Type. |

### Native7

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `outcome` | string | 必填 |  |
| `conflict` | Native8 | 必填 |  |
| `ok` | JSON | 可选 | No application payload; inspect HTTP status and Content-Type. |
| `gid` | JSON | 可选 | No application payload; inspect HTTP status and Content-Type. |
| `taskId` | JSON | 可选 | No application payload; inspect HTTP status and Content-Type. |

### Native8

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `reason` | string  /  string  /  string | 必填 |  |
| `infoHash` | string | 必填 |  |
| `targetDir` | string | 必填 |  |
| `existingTaskId` | null  /  string | 必填 |  |
| `existingTaskName` | null  /  string | 必填 |  |
| `existingTaskStatus` | null  /  string | 必填 |  |
| `canCreateCopy` | boolean  /  boolean | 必填 |  |

### Native9

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `ok` | boolean  /  boolean | 必填 |  |

### Native10

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `ok` | boolean  /  boolean | 必填 |  |

### Native11

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `succeeded` | array<string> | 必填 |  |
| `failed` | array<Native12> | 必填 |  |

### Native12

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `taskId` | string | 必填 |  |
| `reason` | string | 必填 |  |

### Native13

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `ok` | boolean  /  boolean | 必填 |  |

### Native14

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `ok` | boolean  /  boolean | 必填 |  |

### Native15

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `ok` | boolean  /  boolean | 必填 |  |

### Native16

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `ok` | boolean  /  boolean | 必填 |  |

### Native17

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `ok` | boolean  /  boolean | 必填 |  |
| `previousRpcPort` | number | 必填 |  |
| `rpcPort` | number | 必填 |  |
| `status` | Native18 | 必填 |  |

### Native18

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `state` | string  /  string  /  string  /  string  /  string | 必填 |  |
| `featureReport` | null  /  Native19 | 必填 |  |
| `failure` | null  /  Native20 | 必填 |  |
| `managedPid` | null  /  number | 必填 |  |

### Native19

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `version` | string | 必填 |  |
| `features` | array<string> | 必填 |  |
| `hasBtSeedUnverified` | boolean  /  boolean | 必填 |  |
| `hasBtSaveMetadata` | boolean  /  boolean | 必填 |  |
| `hasMoveStorage` | boolean  /  boolean | 必填 |  |
| `hasSqlitePersistence` | boolean  /  boolean | 必填 |  |

### Native20

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `reason` | string  /  string  /  string  /  string  /  string  /  string  /  string | 必填 |  |
| `occurredAt` | number | 必填 |  |
| `technicalMessage` | null  /  string | 必填 |  |

### Native21

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `saved` | boolean  /  boolean | 必填 |  |
| `requiresRestart` | boolean  /  boolean | 必填 |  |
| `changedRestartKeys` | array<string> | 必填 |  |
| `requiresAppRestart` | boolean  /  boolean | 必填 |  |
| `changedAppRestartKeys` | array<string> | 必填 |  |

### Native22

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `enabled` | boolean  /  boolean | 必填 |  |
| `hasDatabase` | boolean  /  boolean | 必填 |  |
| `loaded` | boolean  /  boolean | 必填 |  |
| `lastUpdatedAt` | number | 必填 |  |
| `databaseVersion` | string | 必填 |  |
| `sizeBytes` | number | 必填 |  |
| `isDownloading` | boolean  /  boolean | 必填 |  |
| `lastError` | null  /  string | 必填 |  |

### Native23

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `ok` | boolean  /  boolean | 必填 |  |

### Native24

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `totalFetched` | number | 必填 |  |
| `totalHealthy` | number | 必填 |  |
| `totalCurated` | number | 必填 |  |
| `syncResult` | Native25 | 必填 |  |

### Native25

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `trackers` | array<string> | 必填 |  |
| `sourceStatus` | object | 必填 | Native Record<string, SourceFetchStatus> |

### Native26

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `engineGid` | string | 必填 |  |
| `trackers` | array<string> | 必填 |  |

### Native27

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `engineGid` | string | 必填 |  |

### Native28

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `ok` | boolean  /  boolean | 必填 |  |

### Native29

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `ok` | boolean  /  boolean | 必填 |  |

### Native30

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `ok` | boolean  /  boolean | 必填 |  |

### Native31

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `stagingId` | string | 必填 |  |
| `consent` | Native32 | 必填 |  |
| `committed` | boolean  /  boolean | 必填 |  |
| `pluginId` | string | 可选 |  |

### Native32

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `manifest` | Native33 | 必填 |  |
| `source` | Native34 | 必填 |  |
| `trustSurface` | Native35 | 必填 |  |
| `diff` | null  /  Native40 | 必填 |  |
| `ffmpegRuntime` | Native44 | 必填 |  |

### Native33

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `id` | string | 必填 |  |
| `name` | string | 必填 |  |
| `version` | string | 必填 |  |
| `description` | string | 必填 |  |
| `author` | string | 可选 |  |
| `homepage` | string | 可选 |  |

### Native34

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `type` | string  /  string  /  string  /  string  /  string  /  string  /  string | 必填 |  |
| `url` | string | 必填 |  |
| `bundleSha256` | string | 必填 |  |
| `recordedAt` | number | 必填 |  |

### Native35

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `permissions` | array<Native36> | 必填 |  |
| `optionalPermissions` | array<Native36> | 必填 |  |
| `hostPermissions` | array<Native37> | 必填 |  |
| `invokesCommands` | array<Native38> | 必填 |  |
| `publicCommandsExposed` | array<Native39> | 必填 |  |
| `requestedHeapMB` | number | 可选 |  |
| `enginesMotrix` | string | 必填 |  |
| `notVerified` | boolean | 必填 |  · const=true |

### Native36

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `name` | string | 必填 |  |
| `description` | string | 必填 |  |

### Native37

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `pattern` | string | 必填 |  |
| `broad` | boolean  /  boolean | 必填 |  |

### Native38

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `commandId` | string | 必填 |  |
| `calleeInstalled` | boolean  /  boolean | 必填 |  |
| `calleeTitle` | string | 可选 |  |

### Native39

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `id` | string | 必填 |  |
| `title` | string | 必填 |  |

### Native40

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `permissionsAdded` | array<string> | 必填 |  |
| `optionalPermissionsAdded` | array<string> | 必填 |  |
| `invokesCommandsAdded` | array<string> | 必填 |  |
| `publicCommandsAdded` | array<string> | 必填 |  |
| `publicCommandsSchemaChanged` | array<string> | 必填 |  |
| `hostPermissionsAdded` | array<string> | 必填 |  |
| `requestedHeapMBIncreased` | null  /  Native41 | 必填 |  |
| `enginesMotrixMajorChange` | null  /  Native42 | 必填 |  |
| `sourceUrlChanged` | null  /  Native43 | 必填 |  |

### Native41

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `from` | number | 必填 |  |
| `to` | number | 必填 |  |

### Native42

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `from` | string | 必填 |  |
| `to` | string | 必填 |  |

### Native43

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `from` | string | 必填 |  |
| `to` | string | 必填 |  |

### Native44

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `available` | boolean  /  boolean | 必填 |  |
| `version` | string | 可选 |  |
| `satisfiesRange` | boolean  /  boolean | 可选 |  |
| `requiredByPlugin` | string  /  string  /  string | 必填 |  |

### Native45

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `ok` | boolean  /  boolean | 必填 |  |
| `pluginId` | string | 必填 |  |

### Native46

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `ok` | boolean  /  boolean | 必填 |  |

### Native47

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `ok` | boolean  /  boolean | 必填 |  |
| `grants` | object | 必填 | Native GrantsMap |

### Native48

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `ok` | boolean  /  boolean | 必填 |  |

### Native49

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `ok` | boolean  /  boolean | 必填 |  |

### Native50

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `ok` | boolean  /  boolean | 必填 |  |

### Native51

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `phase` | string  /  string  /  string  /  string  /  string  /  string  /  string | 必填 |  |
| `capability` | string  /  string | 必填 |  |
| `installCommand` | string | 必填 |  |
| `packageManager` | string  /  string  /  string  /  string  /  string  /  string | 必填 |  |
| `managerOptions` | array<Native52> | 必填 |  |
| `version` | null  /  string | 必填 |  |
| `executablePath` | null  /  string | 必填 |  |
| `nodeVersion` | null  /  string | 必填 |  |
| `reason` | null  /  string  /  string  /  string  /  string  /  string  /  string  /  string  /  string  /  string  /  string  /  string  /  string  /  string | 必填 |  |
| `detail` | null  /  string | 必填 |  |

### Native52

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `manager` | string  /  string  /  string  /  string  /  string | 必填 |  |
| `installCommand` | string | 必填 |  |
| `available` | boolean  /  boolean | 必填 |  |

### Native53

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `id` | string | 必填 |  |
| `engineTaskId` | string | 必填 |  |
| `name` | string | 必填 |  |
| `type` | string  /  string  /  string  /  string  /  string | 必填 |  |
| `status` | string  /  string  /  string  /  string  /  string  /  string  /  string  /  string  /  string  /  string | 必填 |  |
| `progress` | number | 必填 |  |
| `totalBytes` | number | 必填 |  |
| `downloadedBytes` | number | 必填 |  |
| `downloadSpeed` | number | 必填 |  |
| `uploadSpeed` | number | 必填 |  |
| `etaSeconds` | number | 必填 |  |
| `saveDir` | string | 必填 |  |
| `createdAt` | number | 必填 |  |
| `updatedAt` | number | 必填 |  |
| `finishedAt` | null  /  number | 必填 |  |
| `errorMessage` | null  /  string | 必填 |  |
| `uris` | array<string> | 必填 |  |
| `uploadedBytes` | number | 必填 |  |
| `uploadedBytesBaseline` | number | 必填 |  |
| `fileCount` | number | 必填 |  |
| `connections` | number | 必填 |  |
| `pieceLength` | number | 必填 |  |
| `infoHash` | null  /  string | 必填 |  |
| `errorCode` | null  /  string  /  string  /  string  /  string  /  string  /  string  /  string  /  string  /  string  /  string  /  string  /  string | 必填 |  |
| `errorDetailKey` | null  /  string | 必填 |  |
| `errorDetailParams` | null  /  object | 必填 |  |
| `diagnosisRevision` | number | 必填 |  |
| `metadataProgress` | number | 必填 |  |
| `priority` | number | 必填 |  |
| `category` | null  /  string | 必填 |  |
| `dlLimit` | number | 必填 |  |
| `ulLimit` | number | 必填 |  |
| `filename` | string | 必填 |  |
| `sizeWhenDone` | number | 必填 |  |
| `source` | string  /  string  /  string | 必填 |  |
| `sourceMeta` | null  /  Native54 | 必填 |  |
| `bt` | Native55 | 可选 |  |
| `diskPath` | string | 必填 |  |
| `finalPath` | string | 必填 |  |
| `finalName` | string | 必填 |  |
| `transitionPhase` | string  /  string  /  string | 必填 |  |
| `torrentMetaPath` | null  /  string | 必填 |  |
| `kind` | string  /  string  /  string  /  string | 必填 |  |
| `instances` | array<Native56> | 必填 |  |

### Native54

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `kind` | string  /  string  /  string  /  string  /  string | 必填 |  |
| `extensionId` | string | 必填 |  |
| `browser` | string  /  string | 必填 |  |
| `sessionKey` | string | 必填 |  |
| `pageUrl` | string | 必填 |  |
| `pageTitle` | string | 必填 |  |
| `qualityLabel` | string | 必填 |  |
| `durationSec` | null  /  number | 必填 |  |
| `submittedAt` | number | 必填 |  |

### Native55

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `peers` | number | 必填 |  |
| `seeds` | number | 必填 |  |
| `ratio` | number | 必填 |  |
| `trackers` | array<string> | 必填 |  |
| `selectedFiles` | array<number> | 必填 |  |
| `peersInSwarm` | number | 必填 |  |
| `seedsInSwarm` | number | 必填 |  |
| `announceList` | array<array<string>> | 必填 |  |
| `comment` | null  /  string | 必填 |  |
| `isPrivate` | boolean  /  boolean | 必填 |  |
| `magnetUri` | null  /  string | 必填 |  |
| `sequentialDownload` | boolean  /  boolean | 必填 |  |

### Native56

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `instanceId` | string | 必填 |  |
| `motrixId` | string | 必填 |  |
| `gid` | null  /  string | 必填 |  |
| `phase` | string  /  string  /  string  /  string  /  string  /  string  /  string | 必填 |  |
| `status` | string  /  string  /  string  /  string  /  string  /  string  /  string  /  string  /  string  /  string | 必填 |  |
| `progress` | number | 必填 |  |
| `totalBytes` | number | 必填 |  |
| `downloadedBytes` | number | 必填 |  |
| `uploadedBytes` | number | 必填 |  |
| `diskPath` | string | 必填 |  |
| `transitionPhase` | string  /  string  /  string | 必填 |  |
| `uris` | array<string> | 必填 |  |
| `uriHash` | null  /  string | 必填 |  |
| `payload` | object | 必填 | Native Record<string, unknown> |
| `createdAt` | number | 必填 |  |
| `updatedAt` | number | 必填 |  |

### Native57

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `taskId` | string | 必填 |  |

### Native58

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `pieceLength` | number | 必填 |  |
| `numPieces` | number | 必填 |  |
| `bitfield` | string | 必填 |  |

### Native59

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `taskId` | string | 必填 |  |

### Native60

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `id` | string | 必填 |  |
| `ip` | string | 必填 |  |
| `port` | number | 必填 |  |
| `client` | null  /  string | 必填 |  |
| `clientVersion` | null  /  string | 必填 |  |
| `progress` | number | 必填 |  |
| `downSpeed` | number | 必填 |  |
| `upSpeed` | number | 必填 |  |
| `seeder` | boolean  /  boolean | 必填 |  |
| `amChoking` | boolean  /  boolean | 必填 |  |
| `peerChoking` | boolean  /  boolean | 必填 |  |
| `country` | null  /  Native61 | 可选 |  |

### Native61

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `code` | string | 必填 |  |
| `name` | string | 必填 |  |

### Native62

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `totalDownloadSpeed` | number | 必填 |  |
| `totalUploadSpeed` | number | 必填 |  |
| `activeTasks` | number | 必填 |  |
| `waitingTasks` | number | 必填 |  |
| `stoppedTasks` | number | 必填 |  |

### Native63

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `limit` | number | 可选 |  |

### Native64

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `t` | number | 必填 |  |
| `down` | number | 必填 |  |
| `up` | number | 必填 |  |

### Native65

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `dayStartMs` | number | 必填 |  |
| `dayEndMs` | number | 必填 |  |

### Native66

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `today` | Native67 | 必填 |  |
| `allTime` | Native68 | 必填 |  |
| `updatedAt` | null  /  number | 必填 |  |
| `accuracy` | string | 必填 |  · const="estimated" |

### Native67

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `downloadBytes` | string | 必填 |  |
| `uploadBytes` | string | 必填 |  |
| `totalBytes` | string | 必填 |  |
| `startedAt` | number | 必填 |  |
| `endsAt` | number | 必填 |  |
| `coverageStartedAt` | number | 必填 |  |

### Native68

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `downloadBytes` | string | 必填 |  |
| `uploadBytes` | string | 必填 |  |
| `totalBytes` | string | 必填 |  |
| `startedAt` | number | 必填 |  |
| `endsAt` | number | 可选 |  |
| `coverageStartedAt` | number | 必填 |  |

### Native69

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `days` | array<Native70> | 必填 |  |

### Native70

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `dateKey` | string | 必填 |  |
| `fromMs` | number | 必填 |  |
| `toMs` | number | 必填 |  |

### Native71

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `generation` | string | 必填 |  |
| `revision` | number | 必填 |  |
| `coverage` | Native72 | 必填 |  |
| `days` | array<Native73> | 必填 |  |

### Native72

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `trackingStartedAt` | number | 必填 |  |
| `coverageGapAt` | null  /  number | 必填 |  |

### Native73

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `dateKey` | string | 必填 |  |
| `submitted` | number | 必填 |  |
| `downloadCompleted` | number | 必填 |  |
| `recoveredDownloadCompleted` | number | 必填 |  |

### Native74

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `taskId` | string | 必填 |  |
| `limit` | number | 可选 |  |

### Native75

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `generatedAt` | number | 必填 |  |
| `binary` | Native76 | 必填 |  |
| `rpc` | Native77 | 必填 |  |
| `process` | null  /  Native78 | 必填 |  |
| `defaultRpc` | Native79 | 必填 |  |
| `suggestedRpcPort` | null  /  number | 必填 |  |
| `canRetry` | boolean  /  boolean | 必填 |  |
| `canForceTerminate` | boolean  /  boolean | 必填 |  |
| `canSwitchPort` | boolean  /  boolean | 必填 |  |
| `recommendation` | string  /  string  /  string  /  string | 必填 |  |
| `state` | string  /  string  /  string  /  string  /  string | 必填 |  |
| `featureReport` | null  /  Native19 | 必填 |  |
| `failure` | null  /  Native20 | 必填 |  |
| `managedPid` | null  /  number | 必填 |  |

### Native76

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `name` | string | 必填 |  |
| `available` | boolean  /  boolean | 必填 |  |
| `version` | null  /  string | 必填 |  |

### Native77

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `port` | number | 必填 |  |
| `available` | boolean  /  boolean | 必填 |  |
| `expectedListener` | boolean  /  boolean | 必填 |  |

### Native78

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `pid` | number | 必填 |  |
| `name` | string | 必填 |  |
| `executableName` | null  /  string | 必填 |  |
| `ownership` | string  /  string  /  string  /  string  /  string | 必填 |  |
| `safeToTerminate` | boolean  /  boolean | 必填 |  |

### Native79

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `port` | number | 必填 |  |
| `isCurrent` | boolean  /  boolean | 必填 |  |
| `available` | boolean  /  boolean | 必填 |  |
| `process` | null  /  Native78 | 必填 |  |
| `canRestore` | boolean  /  boolean | 必填 |  |
| `requiresTermination` | boolean  /  boolean | 必填 |  |

### Native80

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `version` | number | 必填 |  |
| `engine` | Native81 | 必填 |  |
| `app` | Native82 | 必填 |  |
| `onboarding` | Native84 | 必填 |  |
| `nat` | Native85 | 必填 |  |
| `proxy` | Native86 | 必填 |  |
| `plugins` | object | 必填 | Native PluginSettings |
| `tracker` | Native88 | 必填 |  |
| `geoip` | Native90 | 必填 |  |
| `media` | Native91 | 必填 |  |
| `dashboard` | Native92 | 必填 |  |
| `speedLimit` | Native94 | 必填 |  |
| `bridge` | Native104 | 必填 |  |
| `windowState` | object | 必填 | Native Record<string, WindowState> |

### Native81

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `rpcPort` | number | 必填 |  |
| `rpcSecret` | string | 必填 |  |
| `listenPort` | number | 必填 |  |
| `dhtListenPort` | number | 必填 |  |
| `dhtEnabled` | boolean  /  boolean | 必填 |  |
| `performanceProfile` | string  /  string  /  string  /  string  /  string | 必填 |  |
| `maxConcurrentDownloads` | number | 必填 |  |
| `maxConnectionPerServer` | number | 必填 |  |
| `split` | number | 必填 |  |
| `minSplitSize` | number | 必填 |  |
| `userAgent` | string | 必填 |  |
| `connectTimeout` | number | 必填 |  |
| `socketTimeout` | number | 必填 |  |
| `maxTries` | number | 必填 |  |
| `retryWait` | number | 必填 |  |
| `lowestSpeedLimit` | number | 必填 |  |
| `dnsMode` | string  /  string  /  string | 必填 |  |
| `btMaxPeers` | number | 必填 |  |
| `btEnableLpd` | boolean  /  boolean | 必填 |  |
| `seedRatio` | number | 必填 |  |
| `seedTime` | number | 必填 |  |
| `fileAllocation` | string  /  string  /  string  /  string | 必填 |  |
| `remoteTime` | boolean  /  boolean | 必填 |  |
| `diskCache` | number | 必填 |  |
| `sessionSaveInterval` | number | 必填 |  |
| `sqlite3Persistence` | boolean  /  boolean | 必填 |  |
| `sqlite3DbPath` | string | 必填 |  |
| `sqlite3HistoryLimit` | number | 必填 |  |
| `magnetResolveTimeout` | number | 必填 |  |

### Native82

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `launchAtStartup` | boolean  /  boolean | 必填 |  |
| `theme` | string  /  string  /  string | 必填 |  |
| `language` | string  /  string  /  string | 必填 |  |
| `defaultSaveDir` | string | 必填 |  |
| `notifyOnComplete` | boolean  /  boolean | 必填 |  |
| `notifyOnError` | boolean  /  boolean | 必填 |  |
| `autofillClipboardLinks` | boolean  /  boolean | 必填 |  |
| `protocols` | Native83 | 必填 |  |
| `runMode` | number  /  number  /  number | 必填 |  |
| `lightweightMode` | boolean  /  boolean | 必填 |  |
| `traySpeedometer` | boolean  /  boolean | 必填 |  |
| `magnetFileSelection` | boolean  /  boolean | 必填 |  |
| `browserBridgeEnabled` | boolean  /  boolean | 必填 |  |
| `liquidGlassEffect` | boolean  /  boolean | 必填 |  |
| `warnBeforeQuit` | boolean  /  boolean | 必填 |  |
| `checkForUpdatesOnLaunch` | boolean  /  boolean | 必填 |  |
| `updateChannel` | string  /  string | 必填 |  |

### Native83

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `magnet` | boolean  /  boolean | 必填 |  |

### Native84

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `disclaimerAccepted` | boolean  /  boolean | 必填 |  |

### Native85

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `enabled` | boolean  /  boolean | 必填 |  |
| `preferredProtocol` | string  /  string  /  string  /  string | 必填 |  |
| `mappingTtl` | number | 必填 |  |
| `natTypeDetectionEnabled` | boolean  /  boolean | 必填 |  |
| `stunServers` | array<string> | 必填 |  |
| `portReachabilityCheckEnabled` | boolean  /  boolean | 必填 |  |
| `portCheckerEndpoints` | array<string> | 必填 |  |
| `autoDiagnostic` | boolean  /  boolean | 必填 |  |
| `diagnosticIntervalSec` | number | 必填 |  |

### Native86

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `enabled` | boolean  /  boolean | 必填 |  |
| `protocol` | string  /  string  /  string | 必填 |  |
| `host` | string | 必填 |  |
| `port` | number | 必填 |  |
| `user` | string | 必填 |  |
| `password` | string | 必填 |  |
| `bypass` | array<string> | 必填 |  |
| `scopes` | Native87 | 必填 |  |

### Native87

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `download` | boolean  /  boolean | 必填 |  |
| `updateApp` | boolean  /  boolean | 必填 |  |
| `updateTrackers` | boolean  /  boolean | 必填 |  |

### Native88

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `autoSync` | boolean  /  boolean | 必填 |  |
| `syncIntervalHours` | number | 必填 |  |
| `sourcesEnabled` | boolean  /  boolean | 必填 |  |
| `sources` | array<Native89> | 必填 |  |
| `probeEnabled` | boolean  /  boolean | 必填 |  |
| `probeTimeoutMs` | number | 必填 |  |
| `healthyThresholdMs` | number | 必填 |  |
| `minSuccessRate` | number | 必填 |  |
| `maxTrackerCount` | number | 必填 |  |
| `blacklistEnabled` | boolean  /  boolean | 必填 |  |
| `blacklistSources` | array<Native89> | 必填 |  |

### Native89

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `id` | string | 必填 |  |
| `label` | string | 必填 |  |
| `url` | string | 必填 |  |
| `builtin` | boolean  /  boolean | 必填 |  |
| `enabled` | boolean  /  boolean | 必填 |  |
| `cdn` | boolean  /  boolean | 必填 |  |

### Native90

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `enabled` | boolean  /  boolean | 必填 |  |
| `source` | string  /  string  /  string  /  string | 必填 |  |
| `customUrl` | string | 必填 |  |
| `maxmindLicenseKey` | string | 必填 |  |
| `autoUpdate` | boolean  /  boolean | 必填 |  |
| `autoUpdateIntervalDays` | number | 必填 |  |
| `lastUpdatedAt` | number | 必填 |  |
| `databaseVersion` | string | 必填 |  |

### Native91

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `ffmpegBinaryPath` | string | 必填 |  |
| `ffmpegStagingMB` | number | 必填 |  |
| `ffmpegOpTimeoutSec` | number | 必填 |  |

### Native92

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `version` | number | 必填 |  · const=1 |
| `columns` | number | 必填 |  · const=4 |
| `tiles` | array<Native93> | 必填 |  |

### Native93

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `id` | string  /  string  /  string  /  string  /  string  /  string  /  string  /  string  /  string | 必填 |  |
| `enabled` | boolean  /  boolean | 必填 |  |
| `x` | number | 必填 |  |
| `y` | number | 必填 |  |
| `w` | number  /  number  /  number  /  number | 必填 |  |
| `h` | number  /  number  /  number | 必填 |  |

### Native94

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `base` | Native95 | 必填 |  |
| `alt` | Native95 | 必填 |  |
| `turtle` | string  /  string  /  string | 必填 |  |
| `auto` | Native96 | 必填 |  |

### Native95

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `download` | number | 必填 |  |
| `upload` | number | 必填 |  |

### Native96

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `schedule` | Native97 | 必填 |  |
| `videoApp` | Native98 | 必填 |  |
| `adaptive` | Native99 | 必填 |  |

### Native97

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `enabled` | boolean  /  boolean | 必填 |  |
| `from` | string | 必填 |  |
| `to` | string | 必填 |  |
| `days` | array<number> | 必填 |  |

### Native98

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `enabled` | boolean  /  boolean | 必填 |  |
| `processNames` | array<string> | 必填 |  |

### Native99

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `enabled` | boolean  /  boolean | 必填 |  |
| `linkDown` | number | 必填 |  |
| `linkUp` | number | 必填 |  |
| `headroomPercent` | number | 必填 |  |
| `speedTest` | Native100 | 必填 |  |

### Native100

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `providers` | array<Native101> | 必填 |  |
| `selectedProviderId` | string | 必填 |  |
| `concurrency` | number | 必填 |  |
| `maxDurationSec` | number | 必填 |  |
| `maxDataMB` | number | 必填 |  |

### Native101

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `id` | string | 必填 |  |
| `label` | string | 必填 |  |
| `download` | null  /  Native102 | 必填 |  |
| `upload` | null  /  Native103 | 必填 |  |

### Native102

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `url` | string | 必填 |  |
| `sizeParam` | string | 可选 |  |

### Native103

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `url` | string | 必填 |  |

### Native104

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `fixedPort` | number  /  string | 必填 |  |
| `instanceId` | string | 必填 |  |

### Native105

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `supported` | boolean  /  boolean | 必填 |  |
| `packageKind` | null | 必填 |  |
| `registered` | boolean  /  boolean | 必填 |  |
| `canSetTorrentDefault` | boolean  /  boolean | 必填 |  |
| `torrent` | null | 必填 |  |
| `magnet` | null | 必填 |  |

### Native106

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `supported` | boolean  /  boolean | 必填 |  |
| `registered` | boolean  /  boolean | 必填 |  |
| `scope` | null | 必填 |  |
| `torrent` | boolean  /  boolean | 必填 |  |
| `magnet` | boolean  /  boolean | 必填 |  |

### Native107

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `effective` | array<string> | 必填 |  |
| `blacklist` | array<string> | 必填 |  |
| `healthMap` | object | 必填 | Native Record<string, TrackerHealth> |
| `sourceMap` | object | 必填 | Native Record<string, string[]> |
| `lastSyncAt` | null  /  number | 必填 |  |
| `lastProbeAt` | null  /  number | 必填 |  |

### Native108

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `paths` | array<Native109> | 必填 |  |
| `defaultPath` | string | 必填 |  |
| `allowCustom` | boolean  /  boolean | 必填 |  |

### Native109

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `path` | string | 必填 |  |

### Native110

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `engineGid` | string | 必填 |  |

### Native111

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `active` | null  /  Native112 | 必填 |  |
| `candidates` | array<Native113> | 必填 |  |

### Native112

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `path` | string | 必填 |  |
| `version` | string | 必填 |  |

### Native113

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `kind` | string  /  string  /  string  /  string | 必填 |  |
| `path` | null  /  string | 必填 |  |
| `state` | string  /  string  /  string  /  string  /  string  /  string | 必填 |  |
| `version` | string | 可选 |  |

### Native114

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `id` | string | 必填 |  |
| `name` | string | 必填 |  |
| `version` | string | 必填 |  |
| `description` | string | 必填 |  |
| `status` | string  /  string  /  string  /  string | 必填 |  |
| `enabled` | boolean  /  boolean | 必填 |  |
| `permissions` | array<string> | 必填 |  |
| `optionalPermissions` | array<string> | 必填 |  |
| `source` | Native115 | 可选 |  |
| `errorCount` | number | 必填 |  |
| `lastError` | string | 可选 |  |

### Native115

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `type` | string  /  string  /  string  /  string  /  string  /  string  /  string  /  string  /  string | 必填 |  |
| `url` | string | 必填 |  |
| `bundleSha256` | string | 可选 |  |
| `recordedAt` | number | 必填 |  |

### Native116

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `compatible` | boolean  /  boolean | 必填 |  |
| `listing` | Native117 | 必填 |  |
| `author` | Native118 | 必填 |  |
| `engines` | Native119 | 必填 |  |
| `id` | string | 必填 |  |
| `version` | string | 必填 |  |
| `origin` | string  /  string | 必填 |  |
| `categories` | array<string> | 必填 |  |
| `permissions` | array<string> | 必填 |  |
| `optionalPermissions` | array<string> | 必填 |  |
| `hostPermissions` | array<string> | 必填 |  |
| `screenshots` | array<string> | 必填 |  |
| `updatedAt` | string | 必填 |  |
| `featured` | boolean  /  boolean | 必填 |  |
| `package` | Native120 | 可选 |  |
| `repository` | string | 可选 |  |
| `homepage` | string | 可选 |  |
| `icon` | string | 可选 |  |

### Native117

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `defaultLocale` | string | 必填 |  |
| `localizations` | object | 必填 | Native Record<string, { [x: string]: unknown; name?: string  /  undefined; description?: string  /  undefined; features?: string[]  /  undefined; keywords?: string[]  /  undefined; }> |

### Native118

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `name` | string | 必填 |  |
| `url` | string | 可选 |  |

### Native119

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `motrix` | string | 必填 |  |

### Native120

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `url` | string | 必填 |  |
| `sha256` | string | 必填 |  |
| `size` | number | 必填 |  |
| `signature` | string | 可选 |  |

### Native121

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `manifestVersion` | number | 必填 |  · const=1 |
| `id` | string | 必填 |  |
| `name` | string | 必填 |  |
| `version` | string | 必填 |  |
| `description` | string | 必填 |  |
| `author` | string | 可选 |  |
| `homepage` | string | 可选 |  |
| `repository` | string | 可选 |  |
| `license` | string | 可选 |  |
| `icon` | string | 可选 |  |
| `categories` | array<string> | 必填 |  |
| `keywords` | array<string> | 可选 |  |
| `engines` | Native122 | 必填 |  |
| `main` | string | 必填 |  |
| `requestedHeapMB` | number | 可选 |  |
| `permissions` | array<string> | 必填 |  |
| `optionalPermissions` | array<string> | 可选 |  |
| `hostPermissions` | array<string> | 可选 |  |
| `invokesCommands` | array<string> | 可选 |  |
| `activationEvents` | array<string> | 必填 |  |
| `contributes` | Native123 | 必填 |  |
| `l10n` | string | 可选 |  |

### Native122

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `motrix` | string | 必填 |  |
| `ffmpeg` | string | 可选 |  |

### Native123

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `commands` | array<Native124> | 可选 |  |
| `hooks` | object | 可选 |  |
| `configuration` | Native125 | 可选 |  |

### Native124

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `id` | string | 必填 |  |
| `title` | string | 必填 |  |
| `icon` | string | 可选 |  |
| `public` | boolean  /  boolean | 可选 |  |
| `argsSchema` | JSON | 可选 | Declared native type: unknown; no narrower JSON shape is promised. |
| `resultSchema` | JSON | 可选 | Declared native type: unknown; no narrower JSON shape is promised. |

### Native125

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `title` | string | 可选 |  |
| `description` | string | 可选 |  |
| `schema` | JSON | 必填 | Declared native type: unknown; no narrower JSON shape is promised. |

### Native126

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `edges` | array<Native127> | 必填 |  |
| `cutoff` | number | 必填 |  |
| `generatedAt` | number | 必填 |  |
| `truncated` | boolean  /  boolean | 必填 |  |

### Native127

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `sourcePluginId` | string | 必填 |  |
| `targetPluginId` | string | 必填 |  |
| `commandId` | string | 必填 |  |
| `calls` | number | 必填 |  |
| `lastCalledAt` | number | 必填 |  |

### Native128

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `commands` | array<Native129> | 必填 |  |
| `hooks` | array<Native130> | 必填 |  |
| `configurations` | array<Native131> | 必填 |  |

### Native129

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `pluginId` | string | 必填 |  |
| `commandId` | string | 必填 |  |
| `title` | string | 必填 |  |
| `public` | boolean  /  boolean | 必填 |  |

### Native130

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `pluginId` | string | 必填 |  |
| `hook` | string | 必填 |  |
| `role` | string  /  string  /  string  /  string  /  string | 必填 |  |

### Native131

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `pluginId` | string | 必填 |  |
| `title` | string | 可选 |  |
| `schema` | JSON | 必填 | Declared native type: unknown; no narrower JSON shape is promised. |

### Native132

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `manifest` | Native121 | 必填 |  |
| `origin` | string  /  string | 可选 |  |

### Native133

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `ok` | boolean  /  boolean | 必填 |  |
| `code` | string | 可选 |  |
| `message` | string | 可选 |  |

### Native134

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `pluginId` | string | 必填 |  |
| `hook` | string | 必填 |  |

### Native135

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `rank` | number | 必填 |  |
| `total` | number | 必填 |  |
| `role` | string  /  string  /  string  /  string  /  string | 必填 |  |

### Native136

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `turtle` | string  /  string  /  string | 必填 |  |
| `effective` | Native95 | 必填 |  |
| `activeReason` | string  /  string  /  string  /  string  /  string  /  string | 必填 |  |

### Native137

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| `id` | string | 必填 |  |
| `sourceKey` | null  /  string | 必填 |  |
| `kind` | string | 必填 |  |
| `severity` | string  /  string  /  string | 必填 |  |
| `titleKey` | string | 必填 |  |
| `titleParams` | null  /  object | 必填 |  |
| `bodyKey` | null  /  string | 必填 |  |
| `bodyParams` | null  /  object | 必填 |  |
| `taskId` | null  /  string | 必填 |  |
| `createdAt` | number | 必填 |  |
| `readAt` | null  /  number | 必填 |  |
