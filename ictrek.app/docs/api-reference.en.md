# V-Motrix API reference

## VOS address and identity

Use the same VOS origin plus `/app/com.ictrek.v-motrix`, or the actual container alias `http://v-motrix:8080`. The package does not publish a host port; do not confuse the independent upstream Docker deployment with this VOS gateway. `/api-guide.html` provides quick navigation and a searchable, expandable same-version field reference; `/vos-api-contract.json` is its downloadable source contract.

This VOS app isolates a child runtime, settings, task database and download directory for each verified VOS identity. It is different from V-Burst's shared aria2 wrapper. Use `Authorization: Bearer <VOS access_token>` or establish the app's cookie session. VOS user-check/userinfo verifies the identity; the gateway supplies a separate private operator token to that user's child runtime. Never request or distribute that internal operator token as an Agent key. V-Scheduler model keys, provider keys, MDXP bridge-agent credentials and VOS tokens are not interchangeable. This app does not expose a personal inference API-key generator or register models with Scheduler.

For cookie login, POST `/api/vos/auth/login` with `{access_token:"..."}` **and an Origin whose host matches the request Host**. Success returns authenticated/user and a scoped HttpOnly SameSite=Strict cookie. The local session is process-memory state with a12-hour sliding expiry; restart/expiry requires login again. GET `/api/vos/auth/session` reports this local cookie session, so a valid Bearer-only client can still see authenticated=false there. Test a permitted query rather than interpreting that field as Bearer-token validation. POST `/api/vos/auth/logout` with matching Origin clears this app cookie; it is not an operation to delete user downloads.

## Native HTTP operations and errors

The complete reference includes gateway health, VOS session/login/logout, diagnostics, current-user pause-all/resume-all, plugin package staging and74 actual server command/query channels. Routes are generated from registered handlers, not every constant in the desktop protocol catalog. An absent desktop-only channel is not made available merely because its name exists in shared code. Bridge pairing/MDXP is a separate agent protocol; the VOS outer WebSocket gateway only exposes `/rpc/events`. See the separate bridge-pairing guide for independent deployments rather than treating it as an automatically published VOS API.

Outer `/healthz` returns `{ok:true}` without starting a user engine; it does not prove an actual transfer works. Protected `/rpc/*` and `/api/*` require identity. Failed identity returns401; mismatched login/logout Origin403; missing RPC channel404; proxy failure502; native handler errors commonly500 with `{error:string}`. Static SPA HTML200 is not an API response. Check HTTP status, Content-Type and the native result together. There is no universal Scheduler-style result envelope. In particular, Task Inspector Activity returns `{protocol:"motrix-rpc-v1",ok:true,value:...}` or `{protocol:"motrix-rpc-v1",ok:false,error:{code,message}}`; a failure can still use HTTP200.

Login bodies are bounded to64KiB and JSON proxy bodies to16MiB. Oversized gateway bodies can become its native error response, so do not assume every limit returns413. Plugin staging has its own5MiB Fastify limit and can return413. The native field reference reflects serialization types; runtime Zod refinements, URI validation, engine availability and filesystem policy remain authoritative.

## Calling commands and queries

POST `/rpc/query/<encoded-channel>` or `/rpc/command/<encoded-channel>` with `{args:[...positional arguments]}`. Encode the colon in channel names when constructing URLs, for example `query%3AlistTasks`. Responses are the handler's native return value, often an array, object, status or empty payload; do not assume `{result:...}` or an aria2 JSON-RPC envelope. Arguments, optional positions and shared DTO fields are expanded in the reference. Recursive types retain named references. Where a handler explicitly returns unknown, the reference says so instead of inventing fields.

Start with `query:listAllowedSaveDirs`: it returns `{paths:[{path}],defaultPath,allowCustom}`. Use the returned virtual paths. Do not send a host path or another user's directory; the gateway translates only the current user's allowed download root. `query:listTasks` returns slim task rows; `query:getTaskDetail` takes `[taskId]` and returns the full native task. DownloadTask uses numeric byte/speed/progress fields and task statuses such as queued/fetching_metadata/metadata_ready/downloading/finalizing/seeding/paused/completed/error/removed. Task ID is not the same as the engine GID.

Create a direct download through `command:createTask`, with one argument `{type:"http",uris:[...],saveDir,filename?,connections?,headers?,proxy?}`. uris is nonempty, connections1..128, headers is an array of name/value objects. BT uses type=bt, payload `{kind:"torrent-base64",base64}` or `{kind:"magnet",uri}`, selectedFiles and saveDir, with optional download/upload limits, seedRatio, displayName, existingTaskId and duplicatePolicy. The generated input schema comes from the real Zod schema; model-like guesses are not accepted. Do not send native Uint8Array/file paths through JSON when a Base64 field is required.

Creation can return outcome created/reused/rechecked/conflict with taskId/gid or conflict metadata. Save the returned identity, inspect the outcome and poll task state. Submission does not imply completion, and repeating a command is not universally idempotent. Magnet metadata resolution can require file selection before transfer. A completed BT task may still seed. Invalid or conflicting requests must not be blindly resubmitted as new downloads.

## Pause, resume, cancellation and deletion

`command:pauseTask`, `command:resumeTask` and `command:stopSeedingTask` take taskId as their positional argument. Bulk pause/resume commands take a task-ID array as one argument, so args is nested. `/api/tasks/pause-all` and resume-all affect the authenticated user's child runtime, not every VOS user.

`command:removeTask` takes one `{taskId,deleteWithFiles:boolean}` argument; `command:removeTasks` takes `{taskIds,deleteWithFiles}`. Explicit false retains local files; true requests file deletion as well. Do not substitute a raw engine GID or use file deletion as task cancellation. Check task state and native bulk results rather than treating HTTP200 as completed cleanup. Closing a browser, event socket or polling loop does not cancel transfers.

## Events, plugin uploads and separate operator APIs

`/rpc/events` is an authenticated WebSocket event stream with `{channel,args}` frames, not SSE. Reconnect using the same VOS identity/session, then refetch task state: this stream has no durable replay cursor. Browser WebSocket APIs cannot set an Authorization header; use the established same-origin app cookie. Server-side WebSocket clients may send their verified VOS Bearer header. The VOS gateway rejects other WebSocket paths.

POST `/api/plugins/uploads` uses raw `.moext` bytes with `Content-Type: application/vnd.motrix.moext` and URL-encoded `X-Motrix-File-Name`; optional `X-Motrix-File-Sha256` is checked against the server's digest.201 returns `{uploadId,fileHash}`, not an installed plugin. Default staging retention is one hour; later installation consumes the reference and still requires its approval/permissions workflow. Invalid input/quota returns400, oversized input413. Never treat a package upload as permission approval.

The child server also has operator login/status/logout for independent Docker deployments. They do not replace the outer VOS session API: the VOS gateway already injects its private operator identity. In particular, child operator logout does not clear the outer v_motrix_session. Use the VOS auth routes above. Diagnostics and settings belong to the authenticated user and can contain private configuration; do not publish them as generic health output.

## Examples

```bash
ORIGIN='https://<vos-host>:<vos-port>'
BASE="$ORIGIN/app/com.ictrek.v-motrix"
# A current VOS token authenticates directly; no client key is generated here.
curl --fail-with-body "$BASE/rpc/query/query%3AlistAllowedSaveDirs" -H "Authorization: Bearer $VOS_TOKEN" -H 'Content-Type: application/json' -d '{"args":[]}'
curl --fail-with-body "$BASE/rpc/query/query%3AlistTasks" -H "Authorization: Bearer $VOS_TOKEN" -H 'Content-Type: application/json' -d '{"args":[]}'
curl --fail-with-body "$BASE/rpc/query/query%3AgetTaskDetail" -H "Authorization: Bearer $VOS_TOKEN" -H 'Content-Type: application/json' -d '{"args":["<task-id>"]}'
# Pause one task; leave files intact.
curl --fail-with-body "$BASE/rpc/command/command%3ApauseTask" -H "Authorization: Bearer $VOS_TOKEN" -H 'Content-Type: application/json' -d '{"args":["<task-id>"]}'
```

This task updates documentation source only, for the next V-Motrix release. Existing data, profiles, identity policy and the running deployment remain unchanged.


## Operations and responses

### POST /rpc/command/command:addMagnetTask

Identity: VOSBearer / VOSSession

Native server control-plane handler, protected by the VOS gateway. Arguments are positional in args. Source: src/server/ipc/commands.ts:356. TypeScript types describe serialization shape, not all Zod refinements or engine support; the workflow guide documents those boundaries.

Request body: application/json

`object`

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `args` | array | Required |  |

Response 200 — Native method result; this is not a universal result envelope. Task Inspector Activity uses its documented protocol envelope instead.

`application/json`

`Native2`

Response default — Check HTTP status and error body; unknown channel404, invalid identity401, handler failure500. Native structured results can report a business failure even on200.

### POST /rpc/command/command:addTorrentTask

Identity: VOSBearer / VOSSession

Native server control-plane handler, protected by the VOS gateway. Arguments are positional in args. Source: src/server/ipc/commands.ts:373. TypeScript types describe serialization shape, not all Zod refinements or engine support; the workflow guide documents those boundaries.

Request body: application/json

`object`

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `args` | array | Required |  |

Response 200 — Native method result; this is not a universal result envelope. Task Inspector Activity uses its documented protocol envelope instead.

`application/json`

`Native2`

Response default — Check HTTP status and error body; unknown channel404, invalid identity401, handler failure500. Native structured results can report a business failure even on200.

### POST /rpc/command/command:reopenMagnetFileSelection

Identity: VOSBearer / VOSSession

Native server control-plane handler, protected by the VOS gateway. Arguments are positional in args. Source: src/server/ipc/commands.ts:390. TypeScript types describe serialization shape, not all Zod refinements or engine support; the workflow guide documents those boundaries.

Request body: application/json

`object`

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `args` | array | Required |  |

Response 200 — Native method result; this is not a universal result envelope. Task Inspector Activity uses its documented protocol envelope instead.

`application/json`

`Native4`

Response default — Check HTTP status and error body; unknown channel404, invalid identity401, handler failure500. Native structured results can report a business failure even on200.

### POST /rpc/command/command:createTask

Identity: VOSBearer / VOSSession

Native server control-plane handler, protected by the VOS gateway. Arguments are positional in args. Source: src/server/ipc/commands.ts:395. TypeScript types describe serialization shape, not all Zod refinements or engine support; the workflow guide documents those boundaries.

Request body: application/json

`object`

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `args` | array | Required |  |

Response 200 — Native method result; this is not a universal result envelope. Task Inspector Activity uses its documented protocol envelope instead.

`application/json`

`Native5 | Native6 | Native7`

Response default — Check HTTP status and error body; unknown channel404, invalid identity401, handler failure500. Native structured results can report a business failure even on200.

### POST /rpc/command/command:pauseTask

Identity: VOSBearer / VOSSession

Native server control-plane handler, protected by the VOS gateway. Arguments are positional in args. Source: src/server/ipc/commands.ts:531. TypeScript types describe serialization shape, not all Zod refinements or engine support; the workflow guide documents those boundaries.

Request body: application/json

`object`

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `args` | array | Required |  |

Response 200 — Native method result; this is not a universal result envelope. Task Inspector Activity uses its documented protocol envelope instead.

`application/json`

`Native9`

Response default — Check HTTP status and error body; unknown channel404, invalid identity401, handler failure500. Native structured results can report a business failure even on200.

### POST /rpc/command/command:resumeTask

Identity: VOSBearer / VOSSession

Native server control-plane handler, protected by the VOS gateway. Arguments are positional in args. Source: src/server/ipc/commands.ts:536. TypeScript types describe serialization shape, not all Zod refinements or engine support; the workflow guide documents those boundaries.

Request body: application/json

`object`

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `args` | array | Required |  |

Response 200 — Native method result; this is not a universal result envelope. Task Inspector Activity uses its documented protocol envelope instead.

`application/json`

`Native10`

Response default — Check HTTP status and error body; unknown channel404, invalid identity401, handler failure500. Native structured results can report a business failure even on200.

### POST /rpc/command/command:pauseTasks

Identity: VOSBearer / VOSSession

Native server control-plane handler, protected by the VOS gateway. Arguments are positional in args. Source: src/server/ipc/commands.ts:543. TypeScript types describe serialization shape, not all Zod refinements or engine support; the workflow guide documents those boundaries.

Request body: application/json

`object`

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `args` | array | Required |  |

Response 200 — Native method result; this is not a universal result envelope. Task Inspector Activity uses its documented protocol envelope instead.

`application/json`

`Native11`

Response default — Check HTTP status and error body; unknown channel404, invalid identity401, handler failure500. Native structured results can report a business failure even on200.

### POST /rpc/command/command:resumeTasks

Identity: VOSBearer / VOSSession

Native server control-plane handler, protected by the VOS gateway. Arguments are positional in args. Source: src/server/ipc/commands.ts:550. TypeScript types describe serialization shape, not all Zod refinements or engine support; the workflow guide documents those boundaries.

Request body: application/json

`object`

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `args` | array | Required |  |

Response 200 — Native method result; this is not a universal result envelope. Task Inspector Activity uses its documented protocol envelope instead.

`application/json`

`Native11`

Response default — Check HTTP status and error body; unknown channel404, invalid identity401, handler failure500. Native structured results can report a business failure even on200.

### POST /rpc/command/command:stopSeedingTasks

Identity: VOSBearer / VOSSession

Native server control-plane handler, protected by the VOS gateway. Arguments are positional in args. Source: src/server/ipc/commands.ts:557. TypeScript types describe serialization shape, not all Zod refinements or engine support; the workflow guide documents those boundaries.

Request body: application/json

`object`

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `args` | array | Required |  |

Response 200 — Native method result; this is not a universal result envelope. Task Inspector Activity uses its documented protocol envelope instead.

`application/json`

`Native11`

Response default — Check HTTP status and error body; unknown channel404, invalid identity401, handler failure500. Native structured results can report a business failure even on200.

### POST /rpc/command/command:reAddTasks

Identity: VOSBearer / VOSSession

Native server control-plane handler, protected by the VOS gateway. Arguments are positional in args. Source: src/server/ipc/commands.ts:566. TypeScript types describe serialization shape, not all Zod refinements or engine support; the workflow guide documents those boundaries.

Request body: application/json

`object`

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `args` | array | Required |  |

Response 200 — Native method result; this is not a universal result envelope. Task Inspector Activity uses its documented protocol envelope instead.

`application/json`

`Native11`

Response default — Check HTTP status and error body; unknown channel404, invalid identity401, handler failure500. Native structured results can report a business failure even on200.

### POST /rpc/command/command:retryTasks

Identity: VOSBearer / VOSSession

Native server control-plane handler, protected by the VOS gateway. Arguments are positional in args. Source: src/server/ipc/commands.ts:575. TypeScript types describe serialization shape, not all Zod refinements or engine support; the workflow guide documents those boundaries.

Request body: application/json

`object`

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `args` | array | Required |  |

Response 200 — Native method result; this is not a universal result envelope. Task Inspector Activity uses its documented protocol envelope instead.

`application/json`

`Native11`

Response default — Check HTTP status and error body; unknown channel404, invalid identity401, handler failure500. Native structured results can report a business failure even on200.

### POST /rpc/command/command:removeTasks

Identity: VOSBearer / VOSSession

Native server control-plane handler, protected by the VOS gateway. Arguments are positional in args. Source: src/server/ipc/commands.ts:589. TypeScript types describe serialization shape, not all Zod refinements or engine support; the workflow guide documents those boundaries.

Request body: application/json

`object`

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `args` | array | Required |  |

Response 200 — Native method result; this is not a universal result envelope. Task Inspector Activity uses its documented protocol envelope instead.

`application/json`

`Native11`

Response default — Check HTTP status and error body; unknown channel404, invalid identity401, handler failure500. Native structured results can report a business failure even on200.

### POST /rpc/command/command:stopSeedingTask

Identity: VOSBearer / VOSSession

Native server control-plane handler, protected by the VOS gateway. Arguments are positional in args. Source: src/server/ipc/commands.ts:599. TypeScript types describe serialization shape, not all Zod refinements or engine support; the workflow guide documents those boundaries.

Request body: application/json

`object`

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `args` | array | Required |  |

Response 200 — Native method result; this is not a universal result envelope. Task Inspector Activity uses its documented protocol envelope instead.

`application/json`

`Native13`

Response default — Check HTTP status and error body; unknown channel404, invalid identity401, handler failure500. Native structured results can report a business failure even on200.

### POST /rpc/command/command:reAddTask

Identity: VOSBearer / VOSSession

Native server control-plane handler, protected by the VOS gateway. Arguments are positional in args. Source: src/server/ipc/commands.ts:604. TypeScript types describe serialization shape, not all Zod refinements or engine support; the workflow guide documents those boundaries.

Request body: application/json

`object`

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `args` | array | Required |  |

Response 200 — Native method result; this is not a universal result envelope. Task Inspector Activity uses its documented protocol envelope instead.

`application/json`

`Native14`

Response default — Check HTTP status and error body; unknown channel404, invalid identity401, handler failure500. Native structured results can report a business failure even on200.

### POST /rpc/command/command:removeTask

Identity: VOSBearer / VOSSession

Native server control-plane handler, protected by the VOS gateway. Arguments are positional in args. Source: src/server/ipc/commands.ts:609. TypeScript types describe serialization shape, not all Zod refinements or engine support; the workflow guide documents those boundaries.

Request body: application/json

`object`

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `args` | array | Required |  |

Response 200 — Native method result; this is not a universal result envelope. Task Inspector Activity uses its documented protocol envelope instead.

`application/json`

`Native15`

Response default — Check HTTP status and error body; unknown channel404, invalid identity401, handler failure500. Native structured results can report a business failure even on200.

### POST /rpc/command/command:restartEngine

Identity: VOSBearer / VOSSession

Native server control-plane handler, protected by the VOS gateway. Arguments are positional in args. Source: src/server/ipc/commands.ts:616. TypeScript types describe serialization shape, not all Zod refinements or engine support; the workflow guide documents those boundaries.

Request body: application/json

`object`

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `args` | array | Optional |  |

Response 200 — Native method result; this is not a universal result envelope. Task Inspector Activity uses its documented protocol envelope instead.

`application/json`

`Native16`

Response default — Check HTTP status and error body; unknown channel404, invalid identity401, handler failure500. Native structured results can report a business failure even on200.

### POST /rpc/command/command:recoverEngine

Identity: VOSBearer / VOSSession

Native server control-plane handler, protected by the VOS gateway. Arguments are positional in args. Source: src/server/ipc/commands.ts:621. TypeScript types describe serialization shape, not all Zod refinements or engine support; the workflow guide documents those boundaries.

Request body: application/json

`object`

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `args` | array | Required |  |

Response 200 — Native method result; this is not a universal result envelope. Task Inspector Activity uses its documented protocol envelope instead.

`application/json`

`Native17`

Response default — Check HTTP status and error body; unknown channel404, invalid identity401, handler failure500. Native structured results can report a business failure even on200.

### POST /rpc/command/command:updateSettings

Identity: VOSBearer / VOSSession

Native server control-plane handler, protected by the VOS gateway. Arguments are positional in args. Source: src/server/ipc/commands.ts:625. TypeScript types describe serialization shape, not all Zod refinements or engine support; the workflow guide documents those boundaries.

Request body: application/json

`object`

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `args` | array | Required |  |

Response 200 — Native method result; this is not a universal result envelope. Task Inspector Activity uses its documented protocol envelope instead.

`application/json`

`Native21`

Response default — Check HTTP status and error body; unknown channel404, invalid identity401, handler failure500. Native structured results can report a business failure even on200.

### POST /rpc/command/command:updateGeoIPDatabase

Identity: VOSBearer / VOSSession

Native server control-plane handler, protected by the VOS gateway. Arguments are positional in args. Source: src/server/ipc/commands.ts:712. TypeScript types describe serialization shape, not all Zod refinements or engine support; the workflow guide documents those boundaries.

Request body: application/json

`object`

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `args` | array | Optional |  |

Response 200 — Native method result; this is not a universal result envelope. Task Inspector Activity uses its documented protocol envelope instead.

`application/json`

`Native22`

Response default — Check HTTP status and error body; unknown channel404, invalid identity401, handler failure500. Native structured results can report a business failure even on200.

### POST /rpc/command/command:requestDefaultTorrentHandler

Identity: VOSBearer / VOSSession

Native server control-plane handler, protected by the VOS gateway. Arguments are positional in args. Source: src/server/ipc/commands.ts:716. TypeScript types describe serialization shape, not all Zod refinements or engine support; the workflow guide documents those boundaries.

Request body: application/json

`object`

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `args` | array | Optional |  |

Response 200 — Native method result; this is not a universal result envelope. Task Inspector Activity uses its documented protocol envelope instead.

`application/json`

`Native23`

Response default — Check HTTP status and error body; unknown channel404, invalid identity401, handler failure500. Native structured results can report a business failure even on200.

### POST /rpc/command/command:syncTrackers

Identity: VOSBearer / VOSSession

Native server control-plane handler, protected by the VOS gateway. Arguments are positional in args. Source: src/server/ipc/commands.ts:718. TypeScript types describe serialization shape, not all Zod refinements or engine support; the workflow guide documents those boundaries.

Request body: application/json

`object`

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `args` | array | Optional |  |

Response 200 — Native method result; this is not a universal result envelope. Task Inspector Activity uses its documented protocol envelope instead.

`application/json`

`Native24`

Response default — Check HTTP status and error body; unknown channel404, invalid identity401, handler failure500. Native structured results can report a business failure even on200.

### POST /rpc/command/command:setTaskBtTracker

Identity: VOSBearer / VOSSession

Native server control-plane handler, protected by the VOS gateway. Arguments are positional in args. Source: src/server/ipc/commands.ts:720. TypeScript types describe serialization shape, not all Zod refinements or engine support; the workflow guide documents those boundaries.

Request body: application/json

`object`

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `args` | array | Required |  |

Response 200 — Native method result; this is not a universal result envelope. Task Inspector Activity uses its documented protocol envelope instead.

Response default — Check HTTP status and error body; unknown channel404, invalid identity401, handler failure500. Native structured results can report a business failure even on200.

### POST /rpc/command/command:syncTaskBtTracker

Identity: VOSBearer / VOSSession

Native server control-plane handler, protected by the VOS gateway. Arguments are positional in args. Source: src/server/ipc/commands.ts:733. TypeScript types describe serialization shape, not all Zod refinements or engine support; the workflow guide documents those boundaries.

Request body: application/json

`object`

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `args` | array | Required |  |

Response 200 — Native method result; this is not a universal result envelope. Task Inspector Activity uses its documented protocol envelope instead.

Response default — Check HTTP status and error body; unknown channel404, invalid identity401, handler failure500. Native structured results can report a business failure even on200.

### POST /rpc/command/command:enablePlugin

Identity: VOSBearer / VOSSession

Native server control-plane handler, protected by the VOS gateway. Arguments are positional in args. Source: src/server/ipc/commands.ts:743. TypeScript types describe serialization shape, not all Zod refinements or engine support; the workflow guide documents those boundaries.

Request body: application/json

`object`

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `args` | array | Required |  |

Response 200 — Native method result; this is not a universal result envelope. Task Inspector Activity uses its documented protocol envelope instead.

`application/json`

`Native28`

Response default — Check HTTP status and error body; unknown channel404, invalid identity401, handler failure500. Native structured results can report a business failure even on200.

### POST /rpc/command/command:disablePlugin

Identity: VOSBearer / VOSSession

Native server control-plane handler, protected by the VOS gateway. Arguments are positional in args. Source: src/server/ipc/commands.ts:760. TypeScript types describe serialization shape, not all Zod refinements or engine support; the workflow guide documents those boundaries.

Request body: application/json

`object`

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `args` | array | Required |  |

Response 200 — Native method result; this is not a universal result envelope. Task Inspector Activity uses its documented protocol envelope instead.

`application/json`

`Native29`

Response default — Check HTTP status and error body; unknown channel404, invalid identity401, handler failure500. Native structured results can report a business failure even on200.

### POST /rpc/command/command:updatePluginConfig

Identity: VOSBearer / VOSSession

Native server control-plane handler, protected by the VOS gateway. Arguments are positional in args. Source: src/server/ipc/commands.ts:774. TypeScript types describe serialization shape, not all Zod refinements or engine support; the workflow guide documents those boundaries.

Request body: application/json

`object`

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `args` | array | Required |  |

Response 200 — Native method result; this is not a universal result envelope. Task Inspector Activity uses its documented protocol envelope instead.

`application/json`

`Native30`

Response default — Check HTTP status and error body; unknown channel404, invalid identity401, handler failure500. Native structured results can report a business failure even on200.

### POST /rpc/command/command:installPlugin

Identity: VOSBearer / VOSSession

Native server control-plane handler, protected by the VOS gateway. Arguments are positional in args. Source: src/server/ipc/commands.ts:821. TypeScript types describe serialization shape, not all Zod refinements or engine support; the workflow guide documents those boundaries.

Request body: application/json

`object`

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `args` | array | Required |  |

Response 200 — Native method result; this is not a universal result envelope. Task Inspector Activity uses its documented protocol envelope instead.

`application/json`

`Native31`

Response default — Check HTTP status and error body; unknown channel404, invalid identity401, handler failure500. Native structured results can report a business failure even on200.

### POST /rpc/command/command:confirmPluginInstall

Identity: VOSBearer / VOSSession

Native server control-plane handler, protected by the VOS gateway. Arguments are positional in args. Source: src/server/ipc/commands.ts:834. TypeScript types describe serialization shape, not all Zod refinements or engine support; the workflow guide documents those boundaries.

Request body: application/json

`object`

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `args` | array | Required |  |

Response 200 — Native method result; this is not a universal result envelope. Task Inspector Activity uses its documented protocol envelope instead.

`application/json`

`Native45`

Response default — Check HTTP status and error body; unknown channel404, invalid identity401, handler failure500. Native structured results can report a business failure even on200.

### POST /rpc/command/command:cancelPluginInstall

Identity: VOSBearer / VOSSession

Native server control-plane handler, protected by the VOS gateway. Arguments are positional in args. Source: src/server/ipc/commands.ts:850. TypeScript types describe serialization shape, not all Zod refinements or engine support; the workflow guide documents those boundaries.

Request body: application/json

`object`

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `args` | array | Required |  |

Response 200 — Native method result; this is not a universal result envelope. Task Inspector Activity uses its documented protocol envelope instead.

`application/json`

`Native46`

Response default — Check HTTP status and error body; unknown channel404, invalid identity401, handler failure500. Native structured results can report a business failure even on200.

### POST /rpc/command/command:updatePluginGrants

Identity: VOSBearer / VOSSession

Native server control-plane handler, protected by the VOS gateway. Arguments are positional in args. Source: src/server/ipc/commands.ts:856. TypeScript types describe serialization shape, not all Zod refinements or engine support; the workflow guide documents those boundaries.

Request body: application/json

`object`

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `args` | array | Required |  |

Response 200 — Native method result; this is not a universal result envelope. Task Inspector Activity uses its documented protocol envelope instead.

`application/json`

`Native47`

Response default — Check HTTP status and error body; unknown channel404, invalid identity401, handler failure500. Native structured results can report a business failure even on200.

### POST /rpc/command/command:uninstallPlugin

Identity: VOSBearer / VOSSession

Native server control-plane handler, protected by the VOS gateway. Arguments are positional in args. Source: src/server/ipc/commands.ts:870. TypeScript types describe serialization shape, not all Zod refinements or engine support; the workflow guide documents those boundaries.

Request body: application/json

`object`

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `args` | array | Required |  |

Response 200 — Native method result; this is not a universal result envelope. Task Inspector Activity uses its documented protocol envelope instead.

`application/json`

`Native48`

Response default — Check HTTP status and error body; unknown channel404, invalid identity401, handler failure500. Native structured results can report a business failure even on200.

### POST /rpc/command/command:clearPluginLogs

Identity: VOSBearer / VOSSession

Native server control-plane handler, protected by the VOS gateway. Arguments are positional in args. Source: src/server/ipc/commands.ts:878. TypeScript types describe serialization shape, not all Zod refinements or engine support; the workflow guide documents those boundaries.

Request body: application/json

`object`

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `args` | array | Required |  |

Response 200 — Native method result; this is not a universal result envelope. Task Inspector Activity uses its documented protocol envelope instead.

`application/json`

`Native49`

Response default — Check HTTP status and error body; unknown channel404, invalid identity401, handler failure500. Native structured results can report a business failure even on200.

### POST /rpc/command/command:setPluginLogVerbose

Identity: VOSBearer / VOSSession

Native server control-plane handler, protected by the VOS gateway. Arguments are positional in args. Source: src/server/ipc/commands.ts:884. TypeScript types describe serialization shape, not all Zod refinements or engine support; the workflow guide documents those boundaries.

Request body: application/json

`object`

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `args` | array | Required |  |

Response 200 — Native method result; this is not a universal result envelope. Task Inspector Activity uses its documented protocol envelope instead.

`application/json`

`Native50`

Response default — Check HTTP status and error body; unknown channel404, invalid identity401, handler failure500. Native structured results can report a business failure even on200.

### POST /rpc/command/command:markNotificationRead

Identity: VOSBearer / VOSSession

Native server control-plane handler, protected by the VOS gateway. Arguments are positional in args. Source: src/server/ipc/commands.ts:892. TypeScript types describe serialization shape, not all Zod refinements or engine support; the workflow guide documents those boundaries.

Request body: application/json

`object`

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `args` | array | Required |  |

Response 200 — Native method result; this is not a universal result envelope. Task Inspector Activity uses its documented protocol envelope instead.

`application/json`

`boolean | boolean`

Response default — Check HTTP status and error body; unknown channel404, invalid identity401, handler failure500. Native structured results can report a business failure even on200.

### POST /rpc/command/command:markAllNotificationsRead

Identity: VOSBearer / VOSSession

Native server control-plane handler, protected by the VOS gateway. Arguments are positional in args. Source: src/server/ipc/commands.ts:895. TypeScript types describe serialization shape, not all Zod refinements or engine support; the workflow guide documents those boundaries.

Request body: application/json

`object`

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `args` | array | Optional |  |

Response 200 — Native method result; this is not a universal result envelope. Task Inspector Activity uses its documented protocol envelope instead.

`application/json`

`number`

Response default — Check HTTP status and error body; unknown channel404, invalid identity401, handler failure500. Native structured results can report a business failure even on200.

### POST /rpc/command/command:deleteNotification

Identity: VOSBearer / VOSSession

Native server control-plane handler, protected by the VOS gateway. Arguments are positional in args. Source: src/server/ipc/commands.ts:898. TypeScript types describe serialization shape, not all Zod refinements or engine support; the workflow guide documents those boundaries.

Request body: application/json

`object`

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `args` | array | Required |  |

Response 200 — Native method result; this is not a universal result envelope. Task Inspector Activity uses its documented protocol envelope instead.

`application/json`

`boolean | boolean`

Response default — Check HTTP status and error body; unknown channel404, invalid identity401, handler failure500. Native structured results can report a business failure even on200.

### POST /rpc/command/command:clearNotifications

Identity: VOSBearer / VOSSession

Native server control-plane handler, protected by the VOS gateway. Arguments are positional in args. Source: src/server/ipc/commands.ts:901. TypeScript types describe serialization shape, not all Zod refinements or engine support; the workflow guide documents those boundaries.

Request body: application/json

`object`

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `args` | array | Optional |  |

Response 200 — Native method result; this is not a universal result envelope. Task Inspector Activity uses its documented protocol envelope instead.

`application/json`

`number`

Response default — Check HTTP status and error body; unknown channel404, invalid identity401, handler failure500. Native structured results can report a business failure even on200.

### POST /rpc/query/query:getCliToolStatus

Identity: VOSBearer / VOSSession

Native server control-plane handler, protected by the VOS gateway. Arguments are positional in args. Source: src/server/ipc/queries.ts:143. TypeScript types describe serialization shape, not all Zod refinements or engine support; the workflow guide documents those boundaries.

Request body: application/json

`object`

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `args` | array | Optional |  |

Response 200 — Native method result; this is not a universal result envelope. Task Inspector Activity uses its documented protocol envelope instead.

`application/json`

`Native51`

Response default — Check HTTP status and error body; unknown channel404, invalid identity401, handler failure500. Native structured results can report a business failure even on200.

### POST /rpc/query/query:listTasks

Identity: VOSBearer / VOSSession

Native server control-plane handler, protected by the VOS gateway. Arguments are positional in args. Source: src/server/ipc/queries.ts:147. TypeScript types describe serialization shape, not all Zod refinements or engine support; the workflow guide documents those boundaries.

Request body: application/json

`object`

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `args` | array | Optional |  |

Response 200 — Native method result; this is not a universal result envelope. Task Inspector Activity uses its documented protocol envelope instead.

`application/json`

`array<Native53>`

Response default — Check HTTP status and error body; unknown channel404, invalid identity401, handler failure500. Native structured results can report a business failure even on200.

### POST /rpc/query/query:getTaskDetail

Identity: VOSBearer / VOSSession

Native server control-plane handler, protected by the VOS gateway. Arguments are positional in args. Source: src/server/ipc/queries.ts:152. TypeScript types describe serialization shape, not all Zod refinements or engine support; the workflow guide documents those boundaries.

Request body: application/json

`object`

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `args` | array | Required |  |

Response 200 — Native method result; this is not a universal result envelope. Task Inspector Activity uses its documented protocol envelope instead.

`application/json`

`null | Native53`

Response default — Check HTTP status and error body; unknown channel404, invalid identity401, handler failure500. Native structured results can report a business failure even on200.

### POST /rpc/query/query:getTaskPieces

Identity: VOSBearer / VOSSession

Native server control-plane handler, protected by the VOS gateway. Arguments are positional in args. Source: src/server/ipc/queries.ts:155. TypeScript types describe serialization shape, not all Zod refinements or engine support; the workflow guide documents those boundaries.

Request body: application/json

`object`

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `args` | array | Required |  |

Response 200 — Native method result; this is not a universal result envelope. Task Inspector Activity uses its documented protocol envelope instead.

`application/json`

`Native58`

Response default — Check HTTP status and error body; unknown channel404, invalid identity401, handler failure500. Native structured results can report a business failure even on200.

### POST /rpc/query/query:getTaskPeers

Identity: VOSBearer / VOSSession

Native server control-plane handler, protected by the VOS gateway. Arguments are positional in args. Source: src/server/ipc/queries.ts:160. TypeScript types describe serialization shape, not all Zod refinements or engine support; the workflow guide documents those boundaries.

Request body: application/json

`object`

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `args` | array | Required |  |

Response 200 — Native method result; this is not a universal result envelope. Task Inspector Activity uses its documented protocol envelope instead.

`application/json`

`array<Native60>`

Response default — Check HTTP status and error body; unknown channel404, invalid identity401, handler failure500. Native structured results can report a business failure even on200.

### POST /rpc/query/query:getStats

Identity: VOSBearer / VOSSession

Native server control-plane handler, protected by the VOS gateway. Arguments are positional in args. Source: src/server/ipc/queries.ts:166. TypeScript types describe serialization shape, not all Zod refinements or engine support; the workflow guide documents those boundaries.

Request body: application/json

`object`

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `args` | array | Optional |  |

Response 200 — Native method result; this is not a universal result envelope. Task Inspector Activity uses its documented protocol envelope instead.

`application/json`

`Native62`

Response default — Check HTTP status and error body; unknown channel404, invalid identity401, handler failure500. Native structured results can report a business failure even on200.

### POST /rpc/query/query:getSpeedHistory

Identity: VOSBearer / VOSSession

Native server control-plane handler, protected by the VOS gateway. Arguments are positional in args. Source: src/server/ipc/queries.ts:168. TypeScript types describe serialization shape, not all Zod refinements or engine support; the workflow guide documents those boundaries.

Request body: application/json

`object`

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `args` | array | Optional |  |

Response 200 — Native method result; this is not a universal result envelope. Task Inspector Activity uses its documented protocol envelope instead.

`application/json`

`array<Native64>`

Response default — Check HTTP status and error body; unknown channel404, invalid identity401, handler failure500. Native structured results can report a business failure even on200.

### POST /rpc/query/query:getTransferStats

Identity: VOSBearer / VOSSession

Native server control-plane handler, protected by the VOS gateway. Arguments are positional in args. Source: src/server/ipc/queries.ts:171. TypeScript types describe serialization shape, not all Zod refinements or engine support; the workflow guide documents those boundaries.

Request body: application/json

`object`

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `args` | array | Required |  |

Response 200 — Native method result; this is not a universal result envelope. Task Inspector Activity uses its documented protocol envelope instead.

`application/json`

`Native66`

Response default — Check HTTP status and error body; unknown channel404, invalid identity401, handler failure500. Native structured results can report a business failure even on200.

### POST /rpc/query/query:getTaskActivity

Identity: VOSBearer / VOSSession

Native server control-plane handler, protected by the VOS gateway. Arguments are positional in args. Source: src/server/ipc/queries.ts:174. TypeScript types describe serialization shape, not all Zod refinements or engine support; the workflow guide documents those boundaries.

Request body: application/json

`object`

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `args` | array | Required |  |

Response 200 — Native method result; this is not a universal result envelope. Task Inspector Activity uses its documented protocol envelope instead.

`application/json`

`Native71`

Response default — Check HTTP status and error body; unknown channel404, invalid identity401, handler failure500. Native structured results can report a business failure even on200.

### POST /rpc/query/query:getTaskSpeedHistory

Identity: VOSBearer / VOSSession

Native server control-plane handler, protected by the VOS gateway. Arguments are positional in args. Source: src/server/ipc/queries.ts:177. TypeScript types describe serialization shape, not all Zod refinements or engine support; the workflow guide documents those boundaries.

Request body: application/json

`object`

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `args` | array | Required |  |

Response 200 — Native method result; this is not a universal result envelope. Task Inspector Activity uses its documented protocol envelope instead.

`application/json`

`array<Native64>`

Response default — Check HTTP status and error body; unknown channel404, invalid identity401, handler failure500. Native structured results can report a business failure even on200.

### POST /rpc/query/query:getTaskInspectorActivity

Identity: VOSBearer / VOSSession

Native server control-plane handler, protected by the VOS gateway. Arguments are positional in args. Source: src/server/ipc/queries.ts:182. TypeScript types describe serialization shape, not all Zod refinements or engine support; the workflow guide documents those boundaries.

Request body: application/json

`object`

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `args` | array | Required |  |

Response 200 — Native method result; this is not a universal result envelope. Task Inspector Activity uses its documented protocol envelope instead.

`application/json`

`object | object`

Response default — Check HTTP status and error body; unknown channel404, invalid identity401, handler failure500. Native structured results can report a business failure even on200.

### POST /rpc/query/query:getEngineStatus

Identity: VOSBearer / VOSSession

Native server control-plane handler, protected by the VOS gateway. Arguments are positional in args. Source: src/server/ipc/queries.ts:185. TypeScript types describe serialization shape, not all Zod refinements or engine support; the workflow guide documents those boundaries.

Request body: application/json

`object`

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `args` | array | Optional |  |

Response 200 — Native method result; this is not a universal result envelope. Task Inspector Activity uses its documented protocol envelope instead.

`application/json`

`Native18`

Response default — Check HTTP status and error body; unknown channel404, invalid identity401, handler failure500. Native structured results can report a business failure even on200.

### POST /rpc/query/query:getEngineDiagnostics

Identity: VOSBearer / VOSSession

Native server control-plane handler, protected by the VOS gateway. Arguments are positional in args. Source: src/server/ipc/queries.ts:187. TypeScript types describe serialization shape, not all Zod refinements or engine support; the workflow guide documents those boundaries.

Request body: application/json

`object`

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `args` | array | Optional |  |

Response 200 — Native method result; this is not a universal result envelope. Task Inspector Activity uses its documented protocol envelope instead.

`application/json`

`Native75`

Response default — Check HTTP status and error body; unknown channel404, invalid identity401, handler failure500. Native structured results can report a business failure even on200.

### POST /rpc/query/query:getSettings

Identity: VOSBearer / VOSSession

Native server control-plane handler, protected by the VOS gateway. Arguments are positional in args. Source: src/server/ipc/queries.ts:189. TypeScript types describe serialization shape, not all Zod refinements or engine support; the workflow guide documents those boundaries.

Request body: application/json

`object`

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `args` | array | Optional |  |

Response 200 — Native method result; this is not a universal result envelope. Task Inspector Activity uses its documented protocol envelope instead.

`application/json`

`Native80`

Response default — Check HTTP status and error body; unknown channel404, invalid identity401, handler failure500. Native structured results can report a business failure even on200.

### POST /rpc/query/query:getGeoIPStatus

Identity: VOSBearer / VOSSession

Native server control-plane handler, protected by the VOS gateway. Arguments are positional in args. Source: src/server/ipc/queries.ts:191. TypeScript types describe serialization shape, not all Zod refinements or engine support; the workflow guide documents those boundaries.

Request body: application/json

`object`

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `args` | array | Optional |  |

Response 200 — Native method result; this is not a universal result envelope. Task Inspector Activity uses its documented protocol envelope instead.

`application/json`

`Native22`

Response default — Check HTTP status and error body; unknown channel404, invalid identity401, handler failure500. Native structured results can report a business failure even on200.

### POST /rpc/query/query:getSystemProxy

Identity: VOSBearer / VOSSession

Native server control-plane handler, protected by the VOS gateway. Arguments are positional in args. Source: src/server/ipc/queries.ts:193. TypeScript types describe serialization shape, not all Zod refinements or engine support; the workflow guide documents those boundaries.

Request body: application/json

`object`

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `args` | array | Optional |  |

Response 200 — Native method result; this is not a universal result envelope. Task Inspector Activity uses its documented protocol envelope instead.

`application/json`

`null`

Response default — Check HTTP status and error body; unknown channel404, invalid identity401, handler failure500. Native structured results can report a business failure even on200.

### POST /rpc/query/query:getLinuxDefaultAssociations

Identity: VOSBearer / VOSSession

Native server control-plane handler, protected by the VOS gateway. Arguments are positional in args. Source: src/server/ipc/queries.ts:195. TypeScript types describe serialization shape, not all Zod refinements or engine support; the workflow guide documents those boundaries.

Request body: application/json

`object`

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `args` | array | Optional |  |

Response 200 — Native method result; this is not a universal result envelope. Task Inspector Activity uses its documented protocol envelope instead.

`application/json`

`Native105`

Response default — Check HTTP status and error body; unknown channel404, invalid identity401, handler failure500. Native structured results can report a business failure even on200.

### POST /rpc/query/query:getWindowsDefaultAssociations

Identity: VOSBearer / VOSSession

Native server control-plane handler, protected by the VOS gateway. Arguments are positional in args. Source: src/server/ipc/queries.ts:204. TypeScript types describe serialization shape, not all Zod refinements or engine support; the workflow guide documents those boundaries.

Request body: application/json

`object`

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `args` | array | Optional |  |

Response 200 — Native method result; this is not a universal result envelope. Task Inspector Activity uses its documented protocol envelope instead.

`application/json`

`Native106`

Response default — Check HTTP status and error body; unknown channel404, invalid identity401, handler failure500. Native structured results can report a business failure even on200.

### POST /rpc/query/query:getTrackerList

Identity: VOSBearer / VOSSession

Native server control-plane handler, protected by the VOS gateway. Arguments are positional in args. Source: src/server/ipc/queries.ts:212. TypeScript types describe serialization shape, not all Zod refinements or engine support; the workflow guide documents those boundaries.

Request body: application/json

`object`

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `args` | array | Optional |  |

Response 200 — Native method result; this is not a universal result envelope. Task Inspector Activity uses its documented protocol envelope instead.

`application/json`

`Native107`

Response default — Check HTTP status and error body; unknown channel404, invalid identity401, handler failure500. Native structured results can report a business failure even on200.

### POST /rpc/query/query:getTrackerSources

Identity: VOSBearer / VOSSession

Native server control-plane handler, protected by the VOS gateway. Arguments are positional in args. Source: src/server/ipc/queries.ts:214. TypeScript types describe serialization shape, not all Zod refinements or engine support; the workflow guide documents those boundaries.

Request body: application/json

`object`

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `args` | array | Optional |  |

Response 200 — Native method result; this is not a universal result envelope. Task Inspector Activity uses its documented protocol envelope instead.

`application/json`

`array<Native89>`

Response default — Check HTTP status and error body; unknown channel404, invalid identity401, handler failure500. Native structured results can report a business failure even on200.

### POST /rpc/query/query:listAllowedSaveDirs

Identity: VOSBearer / VOSSession

Native server control-plane handler, protected by the VOS gateway. Arguments are positional in args. Source: src/server/ipc/queries.ts:217. TypeScript types describe serialization shape, not all Zod refinements or engine support; the workflow guide documents those boundaries.

Request body: application/json

`object`

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `args` | array | Optional |  |

Response 200 — Native method result; this is not a universal result envelope. Task Inspector Activity uses its documented protocol envelope instead.

`application/json`

`Native108`

Response default — Check HTTP status and error body; unknown channel404, invalid identity401, handler failure500. Native structured results can report a business failure even on200.

### POST /rpc/query/query:getTaskBtTracker

Identity: VOSBearer / VOSSession

Native server control-plane handler, protected by the VOS gateway. Arguments are positional in args. Source: src/server/ipc/queries.ts:226. TypeScript types describe serialization shape, not all Zod refinements or engine support; the workflow guide documents those boundaries.

Request body: application/json

`object`

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `args` | array | Required |  |

Response 200 — Native method result; this is not a universal result envelope. Task Inspector Activity uses its documented protocol envelope instead.

`application/json`

`array<string>`

Response default — Check HTTP status and error body; unknown channel404, invalid identity401, handler failure500. Native structured results can report a business failure even on200.

### POST /rpc/query/query:getFfmpegDetection

Identity: VOSBearer / VOSSession

Native server control-plane handler, protected by the VOS gateway. Arguments are positional in args. Source: src/server/ipc/queries.ts:229. TypeScript types describe serialization shape, not all Zod refinements or engine support; the workflow guide documents those boundaries.

Request body: application/json

`object`

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `args` | array | Optional |  |

Response 200 — Native method result; this is not a universal result envelope. Task Inspector Activity uses its documented protocol envelope instead.

`application/json`

`Native111`

Response default — Check HTTP status and error body; unknown channel404, invalid identity401, handler failure500. Native structured results can report a business failure even on200.

### POST /rpc/query/query:listPlugins

Identity: VOSBearer / VOSSession

Native server control-plane handler, protected by the VOS gateway. Arguments are positional in args. Source: src/server/ipc/queries.ts:231. TypeScript types describe serialization shape, not all Zod refinements or engine support; the workflow guide documents those boundaries.

Request body: application/json

`object`

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `args` | array | Optional |  |

Response 200 — Native method result; this is not a universal result envelope. Task Inspector Activity uses its documented protocol envelope instead.

`application/json`

`array<Native114>`

Response default — Check HTTP status and error body; unknown channel404, invalid identity401, handler failure500. Native structured results can report a business failure even on200.

### POST /rpc/query/query:listRegistryPlugins

Identity: VOSBearer / VOSSession

Native server control-plane handler, protected by the VOS gateway. Arguments are positional in args. Source: src/server/ipc/queries.ts:234. TypeScript types describe serialization shape, not all Zod refinements or engine support; the workflow guide documents those boundaries.

Request body: application/json

`object`

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `args` | array | Optional |  |

Response 200 — Native method result; this is not a universal result envelope. Task Inspector Activity uses its documented protocol envelope instead.

`application/json`

`array<Native116>`

Response default — Check HTTP status and error body; unknown channel404, invalid identity401, handler failure500. Native structured results can report a business failure even on200.

### POST /rpc/query/query:getRegistryPlugin

Identity: VOSBearer / VOSSession

Native server control-plane handler, protected by the VOS gateway. Arguments are positional in args. Source: src/server/ipc/queries.ts:236. TypeScript types describe serialization shape, not all Zod refinements or engine support; the workflow guide documents those boundaries.

Request body: application/json

`object`

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `args` | array | Required |  |

Response 200 — Native method result; this is not a universal result envelope. Task Inspector Activity uses its documented protocol envelope instead.

`application/json`

`null | Native116`

Response default — Check HTTP status and error body; unknown channel404, invalid identity401, handler failure500. Native structured results can report a business failure even on200.

### POST /rpc/query/query:getPluginManifest

Identity: VOSBearer / VOSSession

Native server control-plane handler, protected by the VOS gateway. Arguments are positional in args. Source: src/server/ipc/queries.ts:239. TypeScript types describe serialization shape, not all Zod refinements or engine support; the workflow guide documents those boundaries.

Request body: application/json

`object`

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `args` | array | Required |  |

Response 200 — Native method result; this is not a universal result envelope. Task Inspector Activity uses its documented protocol envelope instead.

`application/json`

`null | Native121`

Response default — Check HTTP status and error body; unknown channel404, invalid identity401, handler failure500. Native structured results can report a business failure even on200.

### POST /rpc/query/query:getPluginCommandGraph

Identity: VOSBearer / VOSSession

Native server control-plane handler, protected by the VOS gateway. Arguments are positional in args. Source: src/server/ipc/queries.ts:242. TypeScript types describe serialization shape, not all Zod refinements or engine support; the workflow guide documents those boundaries.

Request body: application/json

`object`

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `args` | array | Optional |  |

Response 200 — Native method result; this is not a universal result envelope. Task Inspector Activity uses its documented protocol envelope instead.

`application/json`

`Native126`

Response default — Check HTTP status and error body; unknown channel404, invalid identity401, handler failure500. Native structured results can report a business failure even on200.

### POST /rpc/query/query:getPluginConfig

Identity: VOSBearer / VOSSession

Native server control-plane handler, protected by the VOS gateway. Arguments are positional in args. Source: src/server/ipc/queries.ts:247. TypeScript types describe serialization shape, not all Zod refinements or engine support; the workflow guide documents those boundaries.

Request body: application/json

`object`

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `args` | array | Required |  |

Response 200 — Native method result; this is not a universal result envelope. Task Inspector Activity uses its documented protocol envelope instead.

`application/json`

`object`

Response default — Check HTTP status and error body; unknown channel404, invalid identity401, handler failure500. Native structured results can report a business failure even on200.

### POST /rpc/query/query:getPluginGrants

Identity: VOSBearer / VOSSession

Native server control-plane handler, protected by the VOS gateway. Arguments are positional in args. Source: src/server/ipc/queries.ts:250. TypeScript types describe serialization shape, not all Zod refinements or engine support; the workflow guide documents those boundaries.

Request body: application/json

`object`

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `args` | array | Required |  |

Response 200 — Native method result; this is not a universal result envelope. Task Inspector Activity uses its documented protocol envelope instead.

`application/json`

`object`

Response default — Check HTTP status and error body; unknown channel404, invalid identity401, handler failure500. Native structured results can report a business failure even on200.

### POST /rpc/query/query:listPluginGrants

Identity: VOSBearer / VOSSession

Native server control-plane handler, protected by the VOS gateway. Arguments are positional in args. Source: src/server/ipc/queries.ts:253. TypeScript types describe serialization shape, not all Zod refinements or engine support; the workflow guide documents those boundaries.

Request body: application/json

`object`

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `args` | array | Optional |  |

Response 200 — Native method result; this is not a universal result envelope. Task Inspector Activity uses its documented protocol envelope instead.

`application/json`

`object`

Response default — Check HTTP status and error body; unknown channel404, invalid identity401, handler failure500. Native structured results can report a business failure even on200.

### POST /rpc/query/query:getContributionIndex

Identity: VOSBearer / VOSSession

Native server control-plane handler, protected by the VOS gateway. Arguments are positional in args. Source: src/server/ipc/queries.ts:255. TypeScript types describe serialization shape, not all Zod refinements or engine support; the workflow guide documents those boundaries.

Request body: application/json

`object`

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `args` | array | Optional |  |

Response 200 — Native method result; this is not a universal result envelope. Task Inspector Activity uses its documented protocol envelope instead.

`application/json`

`Native128`

Response default — Check HTTP status and error body; unknown channel404, invalid identity401, handler failure500. Native structured results can report a business failure even on200.

### POST /rpc/query/query:checkPluginCompatibility

Identity: VOSBearer / VOSSession

Native server control-plane handler, protected by the VOS gateway. Arguments are positional in args. Source: src/server/ipc/queries.ts:258. TypeScript types describe serialization shape, not all Zod refinements or engine support; the workflow guide documents those boundaries.

Request body: application/json

`object`

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `args` | array | Required |  |

Response 200 — Native method result; this is not a universal result envelope. Task Inspector Activity uses its documented protocol envelope instead.

`application/json`

`Native133`

Response default — Check HTTP status and error body; unknown channel404, invalid identity401, handler failure500. Native structured results can report a business failure even on200.

### POST /rpc/query/query:getPluginHookRank

Identity: VOSBearer / VOSSession

Native server control-plane handler, protected by the VOS gateway. Arguments are positional in args. Source: src/server/ipc/queries.ts:266. TypeScript types describe serialization shape, not all Zod refinements or engine support; the workflow guide documents those boundaries.

Request body: application/json

`object`

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `args` | array | Required |  |

Response 200 — Native method result; this is not a universal result envelope. Task Inspector Activity uses its documented protocol envelope instead.

`application/json`

`null | Native135`

Response default — Check HTTP status and error body; unknown channel404, invalid identity401, handler failure500. Native structured results can report a business failure even on200.

### POST /rpc/query/query:getSpeedLimitState

Identity: VOSBearer / VOSSession

Native server control-plane handler, protected by the VOS gateway. Arguments are positional in args. Source: src/server/ipc/queries.ts:276. TypeScript types describe serialization shape, not all Zod refinements or engine support; the workflow guide documents those boundaries.

Request body: application/json

`object`

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `args` | array | Optional |  |

Response 200 — Native method result; this is not a universal result envelope. Task Inspector Activity uses its documented protocol envelope instead.

`application/json`

`Native136`

Response default — Check HTTP status and error body; unknown channel404, invalid identity401, handler failure500. Native structured results can report a business failure even on200.

### POST /rpc/query/query:listNotifications

Identity: VOSBearer / VOSSession

Native server control-plane handler, protected by the VOS gateway. Arguments are positional in args. Source: src/server/ipc/queries.ts:278. TypeScript types describe serialization shape, not all Zod refinements or engine support; the workflow guide documents those boundaries.

Request body: application/json

`object`

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `args` | array | Optional |  |

Response 200 — Native method result; this is not a universal result envelope. Task Inspector Activity uses its documented protocol envelope instead.

`application/json`

`array<Native137>`

Response default — Check HTTP status and error body; unknown channel404, invalid identity401, handler failure500. Native structured results can report a business failure even on200.

### POST /rpc/query/query:getUnreadNotificationCount

Identity: VOSBearer / VOSSession

Native server control-plane handler, protected by the VOS gateway. Arguments are positional in args. Source: src/server/ipc/queries.ts:280. TypeScript types describe serialization shape, not all Zod refinements or engine support; the workflow guide documents those boundaries.

Request body: application/json

`object`

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `args` | array | Optional |  |

Response 200 — Native method result; this is not a universal result envelope. Task Inspector Activity uses its documented protocol envelope instead.

`application/json`

`number`

Response default — Check HTTP status and error body; unknown channel404, invalid identity401, handler failure500. Native structured results can report a business failure even on200.

### GET /healthz

Identity: public operation / boundary described above

Response 200 — Outer VOS gateway health; does not start a user engine

`application/json`

`object`

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `ok` | JSON | Required |  · const=true |

Response default — VOS gateway errors are JSON error strings. Check identity401, origin403, proxy502 and runtime error500; do not infer success from SPA HTML.

### GET /api/vos/auth/session

Identity: public operation / boundary described above

Response 200 — Local cookie-session status; a Bearer-only caller may still see authenticated=false

`application/json`

`object`

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `enabled` | boolean | Required |  |
| `authenticated` | boolean | Required |  |
| `user` | object | Optional |  |
| `user.username` | string | Required |  |
| `user.namespace` | string | Required |  |
| `clientId` | string | Required |  |
| `scope` | string | Required |  |

Response default — VOS gateway errors are JSON error strings. Check identity401, origin403, proxy502 and runtime error500; do not infer success from SPA HTML.

### POST /api/vos/auth/login

Identity: public operation / boundary described above

- `header: Origin` · string · Required · Must have the same host as the HTTP Host header

Request body: application/json

`object`

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `access_token` | string | Required |  |

Response 200 — Verify VOS token and set an HttpOnly scoped session cookie; matching Origin header required

`application/json`

`object`

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `authenticated` | boolean | Required |  |
| `user` | object | Optional |  |
| `user.username` | string | Required |  |
| `user.namespace` | string | Required |  |

Response default — VOS gateway errors are JSON error strings. Check identity401, origin403, proxy502 and runtime error500; do not infer success from SPA HTML.

### POST /api/vos/auth/logout

Identity: public operation / boundary described above

- `header: Origin` · string · Required · Must have the same host as the HTTP Host header

Response 200 — Clear outer VOS cookie session; matching Origin required

`application/json`

`object`

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `authenticated` | JSON | Required |  · const=false |

Response default — VOS gateway errors are JSON error strings. Check identity401, origin403, proxy502 and runtime error500; do not infer success from SPA HTML.

### GET /api/diagnostics

Identity: VOSBearer / VOSSession

Response 200 — Current user child-runtime diagnostics, native evolving object

`application/json`

`object`

Response default — VOS gateway errors are JSON error strings. Check identity401, origin403, proxy502 and runtime error500; do not infer success from SPA HTML.

### POST /api/tasks/pause-all

Identity: VOSBearer / VOSSession

Response 200 — Current user task bulk action, not a whole-host operation

`application/json`

`object`

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `ok` | boolean | Required |  |

Response default — VOS gateway errors are JSON error strings. Check identity401, origin403, proxy502 and runtime error500; do not infer success from SPA HTML.

### POST /api/tasks/resume-all

Identity: VOSBearer / VOSSession

Response 200 — Current user task bulk action, not a whole-host operation

`application/json`

`object`

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `ok` | boolean | Required |  |

Response default — VOS gateway errors are JSON error strings. Check identity401, origin403, proxy502 and runtime error500; do not infer success from SPA HTML.

### POST /api/plugins/uploads

Identity: VOSBearer / VOSSession

- `header: X-Motrix-File-Name` · string · Required · URL-encoded .moext filename

- `header: X-Motrix-File-Sha256` · string · Optional · Optional claimed hash; the server computes and verifies the retained digest

Request body: application/vnd.motrix.moext

`string`

Response 201 — Native staged upload reference; default retention is one hour and later installation consumes it

`application/json`

`object`

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `uploadId` | string | Required |  |
| `fileHash` | string | Required |  |

Response 400 — Invalid file name/hash/package or upload quota

`application/json`

`object`

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `error` | string | Required |  |

Response 413 — Exceeds native 5 MiB body limit

## Shared data types

Field names retain their API spelling. Interpret extension metadata according to its owning service.

### Native1

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `uri` | string | Required |  |
| `selectedFiles` | array<number> | Required |  |
| `saveDir` | string | Required |  |

### Native2

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `outcome` | string  /  string  /  string | Required |  |
| `gid` | string | Required |  |
| `taskId` | string | Required |  |

### Native3

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `base64` | string | Required |  |
| `selectedFiles` | array<number> | Required |  |
| `saveDir` | string | Required |  |

### Native4

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `ok` | boolean  /  boolean | Required |  |

### Native5

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `ok` | boolean  /  boolean | Required |  |
| `outcome` | JSON | Optional | No application payload; inspect HTTP status and Content-Type. |
| `gid` | JSON | Optional | No application payload; inspect HTTP status and Content-Type. |
| `taskId` | JSON | Optional | No application payload; inspect HTTP status and Content-Type. |
| `conflict` | JSON | Optional | No application payload; inspect HTTP status and Content-Type. |

### Native6

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `outcome` | string | Required |  |
| `gid` | string | Required |  |
| `taskId` | string | Required |  |
| `ok` | JSON | Optional | No application payload; inspect HTTP status and Content-Type. |
| `conflict` | JSON | Optional | No application payload; inspect HTTP status and Content-Type. |

### Native7

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `outcome` | string | Required |  |
| `conflict` | Native8 | Required |  |
| `ok` | JSON | Optional | No application payload; inspect HTTP status and Content-Type. |
| `gid` | JSON | Optional | No application payload; inspect HTTP status and Content-Type. |
| `taskId` | JSON | Optional | No application payload; inspect HTTP status and Content-Type. |

### Native8

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `reason` | string  /  string  /  string | Required |  |
| `infoHash` | string | Required |  |
| `targetDir` | string | Required |  |
| `existingTaskId` | null  /  string | Required |  |
| `existingTaskName` | null  /  string | Required |  |
| `existingTaskStatus` | null  /  string | Required |  |
| `canCreateCopy` | boolean  /  boolean | Required |  |

### Native9

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `ok` | boolean  /  boolean | Required |  |

### Native10

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `ok` | boolean  /  boolean | Required |  |

### Native11

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `succeeded` | array<string> | Required |  |
| `failed` | array<Native12> | Required |  |

### Native12

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `taskId` | string | Required |  |
| `reason` | string | Required |  |

### Native13

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `ok` | boolean  /  boolean | Required |  |

### Native14

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `ok` | boolean  /  boolean | Required |  |

### Native15

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `ok` | boolean  /  boolean | Required |  |

### Native16

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `ok` | boolean  /  boolean | Required |  |

### Native17

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `ok` | boolean  /  boolean | Required |  |
| `previousRpcPort` | number | Required |  |
| `rpcPort` | number | Required |  |
| `status` | Native18 | Required |  |

### Native18

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `state` | string  /  string  /  string  /  string  /  string | Required |  |
| `featureReport` | null  /  Native19 | Required |  |
| `failure` | null  /  Native20 | Required |  |
| `managedPid` | null  /  number | Required |  |

### Native19

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `version` | string | Required |  |
| `features` | array<string> | Required |  |
| `hasBtSeedUnverified` | boolean  /  boolean | Required |  |
| `hasBtSaveMetadata` | boolean  /  boolean | Required |  |
| `hasMoveStorage` | boolean  /  boolean | Required |  |
| `hasSqlitePersistence` | boolean  /  boolean | Required |  |

### Native20

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `reason` | string  /  string  /  string  /  string  /  string  /  string  /  string | Required |  |
| `occurredAt` | number | Required |  |
| `technicalMessage` | null  /  string | Required |  |

### Native21

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `saved` | boolean  /  boolean | Required |  |
| `requiresRestart` | boolean  /  boolean | Required |  |
| `changedRestartKeys` | array<string> | Required |  |
| `requiresAppRestart` | boolean  /  boolean | Required |  |
| `changedAppRestartKeys` | array<string> | Required |  |

### Native22

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `enabled` | boolean  /  boolean | Required |  |
| `hasDatabase` | boolean  /  boolean | Required |  |
| `loaded` | boolean  /  boolean | Required |  |
| `lastUpdatedAt` | number | Required |  |
| `databaseVersion` | string | Required |  |
| `sizeBytes` | number | Required |  |
| `isDownloading` | boolean  /  boolean | Required |  |
| `lastError` | null  /  string | Required |  |

### Native23

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `ok` | boolean  /  boolean | Required |  |

### Native24

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `totalFetched` | number | Required |  |
| `totalHealthy` | number | Required |  |
| `totalCurated` | number | Required |  |
| `syncResult` | Native25 | Required |  |

### Native25

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `trackers` | array<string> | Required |  |
| `sourceStatus` | object | Required | Native Record<string, SourceFetchStatus> |

### Native26

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `engineGid` | string | Required |  |
| `trackers` | array<string> | Required |  |

### Native27

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `engineGid` | string | Required |  |

### Native28

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `ok` | boolean  /  boolean | Required |  |

### Native29

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `ok` | boolean  /  boolean | Required |  |

### Native30

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `ok` | boolean  /  boolean | Required |  |

### Native31

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `stagingId` | string | Required |  |
| `consent` | Native32 | Required |  |
| `committed` | boolean  /  boolean | Required |  |
| `pluginId` | string | Optional |  |

### Native32

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `manifest` | Native33 | Required |  |
| `source` | Native34 | Required |  |
| `trustSurface` | Native35 | Required |  |
| `diff` | null  /  Native40 | Required |  |
| `ffmpegRuntime` | Native44 | Required |  |

### Native33

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `id` | string | Required |  |
| `name` | string | Required |  |
| `version` | string | Required |  |
| `description` | string | Required |  |
| `author` | string | Optional |  |
| `homepage` | string | Optional |  |

### Native34

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `type` | string  /  string  /  string  /  string  /  string  /  string  /  string | Required |  |
| `url` | string | Required |  |
| `bundleSha256` | string | Required |  |
| `recordedAt` | number | Required |  |

### Native35

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `permissions` | array<Native36> | Required |  |
| `optionalPermissions` | array<Native36> | Required |  |
| `hostPermissions` | array<Native37> | Required |  |
| `invokesCommands` | array<Native38> | Required |  |
| `publicCommandsExposed` | array<Native39> | Required |  |
| `requestedHeapMB` | number | Optional |  |
| `enginesMotrix` | string | Required |  |
| `notVerified` | boolean | Required |  · const=true |

### Native36

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `name` | string | Required |  |
| `description` | string | Required |  |

### Native37

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `pattern` | string | Required |  |
| `broad` | boolean  /  boolean | Required |  |

### Native38

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `commandId` | string | Required |  |
| `calleeInstalled` | boolean  /  boolean | Required |  |
| `calleeTitle` | string | Optional |  |

### Native39

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `id` | string | Required |  |
| `title` | string | Required |  |

### Native40

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `permissionsAdded` | array<string> | Required |  |
| `optionalPermissionsAdded` | array<string> | Required |  |
| `invokesCommandsAdded` | array<string> | Required |  |
| `publicCommandsAdded` | array<string> | Required |  |
| `publicCommandsSchemaChanged` | array<string> | Required |  |
| `hostPermissionsAdded` | array<string> | Required |  |
| `requestedHeapMBIncreased` | null  /  Native41 | Required |  |
| `enginesMotrixMajorChange` | null  /  Native42 | Required |  |
| `sourceUrlChanged` | null  /  Native43 | Required |  |

### Native41

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `from` | number | Required |  |
| `to` | number | Required |  |

### Native42

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `from` | string | Required |  |
| `to` | string | Required |  |

### Native43

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `from` | string | Required |  |
| `to` | string | Required |  |

### Native44

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `available` | boolean  /  boolean | Required |  |
| `version` | string | Optional |  |
| `satisfiesRange` | boolean  /  boolean | Optional |  |
| `requiredByPlugin` | string  /  string  /  string | Required |  |

### Native45

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `ok` | boolean  /  boolean | Required |  |
| `pluginId` | string | Required |  |

### Native46

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `ok` | boolean  /  boolean | Required |  |

### Native47

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `ok` | boolean  /  boolean | Required |  |
| `grants` | object | Required | Native GrantsMap |

### Native48

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `ok` | boolean  /  boolean | Required |  |

### Native49

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `ok` | boolean  /  boolean | Required |  |

### Native50

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `ok` | boolean  /  boolean | Required |  |

### Native51

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `phase` | string  /  string  /  string  /  string  /  string  /  string  /  string | Required |  |
| `capability` | string  /  string | Required |  |
| `installCommand` | string | Required |  |
| `packageManager` | string  /  string  /  string  /  string  /  string  /  string | Required |  |
| `managerOptions` | array<Native52> | Required |  |
| `version` | null  /  string | Required |  |
| `executablePath` | null  /  string | Required |  |
| `nodeVersion` | null  /  string | Required |  |
| `reason` | null  /  string  /  string  /  string  /  string  /  string  /  string  /  string  /  string  /  string  /  string  /  string  /  string  /  string | Required |  |
| `detail` | null  /  string | Required |  |

### Native52

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `manager` | string  /  string  /  string  /  string  /  string | Required |  |
| `installCommand` | string | Required |  |
| `available` | boolean  /  boolean | Required |  |

### Native53

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `id` | string | Required |  |
| `engineTaskId` | string | Required |  |
| `name` | string | Required |  |
| `type` | string  /  string  /  string  /  string  /  string | Required |  |
| `status` | string  /  string  /  string  /  string  /  string  /  string  /  string  /  string  /  string  /  string | Required |  |
| `progress` | number | Required |  |
| `totalBytes` | number | Required |  |
| `downloadedBytes` | number | Required |  |
| `downloadSpeed` | number | Required |  |
| `uploadSpeed` | number | Required |  |
| `etaSeconds` | number | Required |  |
| `saveDir` | string | Required |  |
| `createdAt` | number | Required |  |
| `updatedAt` | number | Required |  |
| `finishedAt` | null  /  number | Required |  |
| `errorMessage` | null  /  string | Required |  |
| `uris` | array<string> | Required |  |
| `uploadedBytes` | number | Required |  |
| `uploadedBytesBaseline` | number | Required |  |
| `fileCount` | number | Required |  |
| `connections` | number | Required |  |
| `pieceLength` | number | Required |  |
| `infoHash` | null  /  string | Required |  |
| `errorCode` | null  /  string  /  string  /  string  /  string  /  string  /  string  /  string  /  string  /  string  /  string  /  string  /  string | Required |  |
| `errorDetailKey` | null  /  string | Required |  |
| `errorDetailParams` | null  /  object | Required |  |
| `diagnosisRevision` | number | Required |  |
| `metadataProgress` | number | Required |  |
| `priority` | number | Required |  |
| `category` | null  /  string | Required |  |
| `dlLimit` | number | Required |  |
| `ulLimit` | number | Required |  |
| `filename` | string | Required |  |
| `sizeWhenDone` | number | Required |  |
| `source` | string  /  string  /  string | Required |  |
| `sourceMeta` | null  /  Native54 | Required |  |
| `bt` | Native55 | Optional |  |
| `diskPath` | string | Required |  |
| `finalPath` | string | Required |  |
| `finalName` | string | Required |  |
| `transitionPhase` | string  /  string  /  string | Required |  |
| `torrentMetaPath` | null  /  string | Required |  |
| `kind` | string  /  string  /  string  /  string | Required |  |
| `instances` | array<Native56> | Required |  |

### Native54

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `kind` | string  /  string  /  string  /  string  /  string | Required |  |
| `extensionId` | string | Required |  |
| `browser` | string  /  string | Required |  |
| `sessionKey` | string | Required |  |
| `pageUrl` | string | Required |  |
| `pageTitle` | string | Required |  |
| `qualityLabel` | string | Required |  |
| `durationSec` | null  /  number | Required |  |
| `submittedAt` | number | Required |  |

### Native55

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `peers` | number | Required |  |
| `seeds` | number | Required |  |
| `ratio` | number | Required |  |
| `trackers` | array<string> | Required |  |
| `selectedFiles` | array<number> | Required |  |
| `peersInSwarm` | number | Required |  |
| `seedsInSwarm` | number | Required |  |
| `announceList` | array<array<string>> | Required |  |
| `comment` | null  /  string | Required |  |
| `isPrivate` | boolean  /  boolean | Required |  |
| `magnetUri` | null  /  string | Required |  |
| `sequentialDownload` | boolean  /  boolean | Required |  |

### Native56

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `instanceId` | string | Required |  |
| `motrixId` | string | Required |  |
| `gid` | null  /  string | Required |  |
| `phase` | string  /  string  /  string  /  string  /  string  /  string  /  string | Required |  |
| `status` | string  /  string  /  string  /  string  /  string  /  string  /  string  /  string  /  string  /  string | Required |  |
| `progress` | number | Required |  |
| `totalBytes` | number | Required |  |
| `downloadedBytes` | number | Required |  |
| `uploadedBytes` | number | Required |  |
| `diskPath` | string | Required |  |
| `transitionPhase` | string  /  string  /  string | Required |  |
| `uris` | array<string> | Required |  |
| `uriHash` | null  /  string | Required |  |
| `payload` | object | Required | Native Record<string, unknown> |
| `createdAt` | number | Required |  |
| `updatedAt` | number | Required |  |

### Native57

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `taskId` | string | Required |  |

### Native58

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `pieceLength` | number | Required |  |
| `numPieces` | number | Required |  |
| `bitfield` | string | Required |  |

### Native59

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `taskId` | string | Required |  |

### Native60

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `id` | string | Required |  |
| `ip` | string | Required |  |
| `port` | number | Required |  |
| `client` | null  /  string | Required |  |
| `clientVersion` | null  /  string | Required |  |
| `progress` | number | Required |  |
| `downSpeed` | number | Required |  |
| `upSpeed` | number | Required |  |
| `seeder` | boolean  /  boolean | Required |  |
| `amChoking` | boolean  /  boolean | Required |  |
| `peerChoking` | boolean  /  boolean | Required |  |
| `country` | null  /  Native61 | Optional |  |

### Native61

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `code` | string | Required |  |
| `name` | string | Required |  |

### Native62

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `totalDownloadSpeed` | number | Required |  |
| `totalUploadSpeed` | number | Required |  |
| `activeTasks` | number | Required |  |
| `waitingTasks` | number | Required |  |
| `stoppedTasks` | number | Required |  |

### Native63

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `limit` | number | Optional |  |

### Native64

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `t` | number | Required |  |
| `down` | number | Required |  |
| `up` | number | Required |  |

### Native65

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `dayStartMs` | number | Required |  |
| `dayEndMs` | number | Required |  |

### Native66

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `today` | Native67 | Required |  |
| `allTime` | Native68 | Required |  |
| `updatedAt` | null  /  number | Required |  |
| `accuracy` | string | Required |  · const="estimated" |

### Native67

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `downloadBytes` | string | Required |  |
| `uploadBytes` | string | Required |  |
| `totalBytes` | string | Required |  |
| `startedAt` | number | Required |  |
| `endsAt` | number | Required |  |
| `coverageStartedAt` | number | Required |  |

### Native68

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `downloadBytes` | string | Required |  |
| `uploadBytes` | string | Required |  |
| `totalBytes` | string | Required |  |
| `startedAt` | number | Required |  |
| `endsAt` | number | Optional |  |
| `coverageStartedAt` | number | Required |  |

### Native69

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `days` | array<Native70> | Required |  |

### Native70

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `dateKey` | string | Required |  |
| `fromMs` | number | Required |  |
| `toMs` | number | Required |  |

### Native71

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `generation` | string | Required |  |
| `revision` | number | Required |  |
| `coverage` | Native72 | Required |  |
| `days` | array<Native73> | Required |  |

### Native72

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `trackingStartedAt` | number | Required |  |
| `coverageGapAt` | null  /  number | Required |  |

### Native73

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `dateKey` | string | Required |  |
| `submitted` | number | Required |  |
| `downloadCompleted` | number | Required |  |
| `recoveredDownloadCompleted` | number | Required |  |

### Native74

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `taskId` | string | Required |  |
| `limit` | number | Optional |  |

### Native75

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `generatedAt` | number | Required |  |
| `binary` | Native76 | Required |  |
| `rpc` | Native77 | Required |  |
| `process` | null  /  Native78 | Required |  |
| `defaultRpc` | Native79 | Required |  |
| `suggestedRpcPort` | null  /  number | Required |  |
| `canRetry` | boolean  /  boolean | Required |  |
| `canForceTerminate` | boolean  /  boolean | Required |  |
| `canSwitchPort` | boolean  /  boolean | Required |  |
| `recommendation` | string  /  string  /  string  /  string | Required |  |
| `state` | string  /  string  /  string  /  string  /  string | Required |  |
| `featureReport` | null  /  Native19 | Required |  |
| `failure` | null  /  Native20 | Required |  |
| `managedPid` | null  /  number | Required |  |

### Native76

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `name` | string | Required |  |
| `available` | boolean  /  boolean | Required |  |
| `version` | null  /  string | Required |  |

### Native77

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `port` | number | Required |  |
| `available` | boolean  /  boolean | Required |  |
| `expectedListener` | boolean  /  boolean | Required |  |

### Native78

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `pid` | number | Required |  |
| `name` | string | Required |  |
| `executableName` | null  /  string | Required |  |
| `ownership` | string  /  string  /  string  /  string  /  string | Required |  |
| `safeToTerminate` | boolean  /  boolean | Required |  |

### Native79

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `port` | number | Required |  |
| `isCurrent` | boolean  /  boolean | Required |  |
| `available` | boolean  /  boolean | Required |  |
| `process` | null  /  Native78 | Required |  |
| `canRestore` | boolean  /  boolean | Required |  |
| `requiresTermination` | boolean  /  boolean | Required |  |

### Native80

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `version` | number | Required |  |
| `engine` | Native81 | Required |  |
| `app` | Native82 | Required |  |
| `onboarding` | Native84 | Required |  |
| `nat` | Native85 | Required |  |
| `proxy` | Native86 | Required |  |
| `plugins` | object | Required | Native PluginSettings |
| `tracker` | Native88 | Required |  |
| `geoip` | Native90 | Required |  |
| `media` | Native91 | Required |  |
| `dashboard` | Native92 | Required |  |
| `speedLimit` | Native94 | Required |  |
| `bridge` | Native104 | Required |  |
| `windowState` | object | Required | Native Record<string, WindowState> |

### Native81

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `rpcPort` | number | Required |  |
| `rpcSecret` | string | Required |  |
| `listenPort` | number | Required |  |
| `dhtListenPort` | number | Required |  |
| `dhtEnabled` | boolean  /  boolean | Required |  |
| `performanceProfile` | string  /  string  /  string  /  string  /  string | Required |  |
| `maxConcurrentDownloads` | number | Required |  |
| `maxConnectionPerServer` | number | Required |  |
| `split` | number | Required |  |
| `minSplitSize` | number | Required |  |
| `userAgent` | string | Required |  |
| `connectTimeout` | number | Required |  |
| `socketTimeout` | number | Required |  |
| `maxTries` | number | Required |  |
| `retryWait` | number | Required |  |
| `lowestSpeedLimit` | number | Required |  |
| `dnsMode` | string  /  string  /  string | Required |  |
| `btMaxPeers` | number | Required |  |
| `btEnableLpd` | boolean  /  boolean | Required |  |
| `seedRatio` | number | Required |  |
| `seedTime` | number | Required |  |
| `fileAllocation` | string  /  string  /  string  /  string | Required |  |
| `remoteTime` | boolean  /  boolean | Required |  |
| `diskCache` | number | Required |  |
| `sessionSaveInterval` | number | Required |  |
| `sqlite3Persistence` | boolean  /  boolean | Required |  |
| `sqlite3DbPath` | string | Required |  |
| `sqlite3HistoryLimit` | number | Required |  |
| `magnetResolveTimeout` | number | Required |  |

### Native82

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `launchAtStartup` | boolean  /  boolean | Required |  |
| `theme` | string  /  string  /  string | Required |  |
| `language` | string  /  string  /  string | Required |  |
| `defaultSaveDir` | string | Required |  |
| `notifyOnComplete` | boolean  /  boolean | Required |  |
| `notifyOnError` | boolean  /  boolean | Required |  |
| `autofillClipboardLinks` | boolean  /  boolean | Required |  |
| `protocols` | Native83 | Required |  |
| `runMode` | number  /  number  /  number | Required |  |
| `lightweightMode` | boolean  /  boolean | Required |  |
| `traySpeedometer` | boolean  /  boolean | Required |  |
| `magnetFileSelection` | boolean  /  boolean | Required |  |
| `browserBridgeEnabled` | boolean  /  boolean | Required |  |
| `liquidGlassEffect` | boolean  /  boolean | Required |  |
| `warnBeforeQuit` | boolean  /  boolean | Required |  |
| `checkForUpdatesOnLaunch` | boolean  /  boolean | Required |  |
| `updateChannel` | string  /  string | Required |  |

### Native83

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `magnet` | boolean  /  boolean | Required |  |

### Native84

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `disclaimerAccepted` | boolean  /  boolean | Required |  |

### Native85

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `enabled` | boolean  /  boolean | Required |  |
| `preferredProtocol` | string  /  string  /  string  /  string | Required |  |
| `mappingTtl` | number | Required |  |
| `natTypeDetectionEnabled` | boolean  /  boolean | Required |  |
| `stunServers` | array<string> | Required |  |
| `portReachabilityCheckEnabled` | boolean  /  boolean | Required |  |
| `portCheckerEndpoints` | array<string> | Required |  |
| `autoDiagnostic` | boolean  /  boolean | Required |  |
| `diagnosticIntervalSec` | number | Required |  |

### Native86

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `enabled` | boolean  /  boolean | Required |  |
| `protocol` | string  /  string  /  string | Required |  |
| `host` | string | Required |  |
| `port` | number | Required |  |
| `user` | string | Required |  |
| `password` | string | Required |  |
| `bypass` | array<string> | Required |  |
| `scopes` | Native87 | Required |  |

### Native87

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `download` | boolean  /  boolean | Required |  |
| `updateApp` | boolean  /  boolean | Required |  |
| `updateTrackers` | boolean  /  boolean | Required |  |

### Native88

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `autoSync` | boolean  /  boolean | Required |  |
| `syncIntervalHours` | number | Required |  |
| `sourcesEnabled` | boolean  /  boolean | Required |  |
| `sources` | array<Native89> | Required |  |
| `probeEnabled` | boolean  /  boolean | Required |  |
| `probeTimeoutMs` | number | Required |  |
| `healthyThresholdMs` | number | Required |  |
| `minSuccessRate` | number | Required |  |
| `maxTrackerCount` | number | Required |  |
| `blacklistEnabled` | boolean  /  boolean | Required |  |
| `blacklistSources` | array<Native89> | Required |  |

### Native89

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `id` | string | Required |  |
| `label` | string | Required |  |
| `url` | string | Required |  |
| `builtin` | boolean  /  boolean | Required |  |
| `enabled` | boolean  /  boolean | Required |  |
| `cdn` | boolean  /  boolean | Required |  |

### Native90

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `enabled` | boolean  /  boolean | Required |  |
| `source` | string  /  string  /  string  /  string | Required |  |
| `customUrl` | string | Required |  |
| `maxmindLicenseKey` | string | Required |  |
| `autoUpdate` | boolean  /  boolean | Required |  |
| `autoUpdateIntervalDays` | number | Required |  |
| `lastUpdatedAt` | number | Required |  |
| `databaseVersion` | string | Required |  |

### Native91

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `ffmpegBinaryPath` | string | Required |  |
| `ffmpegStagingMB` | number | Required |  |
| `ffmpegOpTimeoutSec` | number | Required |  |

### Native92

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `version` | number | Required |  · const=1 |
| `columns` | number | Required |  · const=4 |
| `tiles` | array<Native93> | Required |  |

### Native93

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `id` | string  /  string  /  string  /  string  /  string  /  string  /  string  /  string  /  string | Required |  |
| `enabled` | boolean  /  boolean | Required |  |
| `x` | number | Required |  |
| `y` | number | Required |  |
| `w` | number  /  number  /  number  /  number | Required |  |
| `h` | number  /  number  /  number | Required |  |

### Native94

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `base` | Native95 | Required |  |
| `alt` | Native95 | Required |  |
| `turtle` | string  /  string  /  string | Required |  |
| `auto` | Native96 | Required |  |

### Native95

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `download` | number | Required |  |
| `upload` | number | Required |  |

### Native96

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `schedule` | Native97 | Required |  |
| `videoApp` | Native98 | Required |  |
| `adaptive` | Native99 | Required |  |

### Native97

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `enabled` | boolean  /  boolean | Required |  |
| `from` | string | Required |  |
| `to` | string | Required |  |
| `days` | array<number> | Required |  |

### Native98

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `enabled` | boolean  /  boolean | Required |  |
| `processNames` | array<string> | Required |  |

### Native99

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `enabled` | boolean  /  boolean | Required |  |
| `linkDown` | number | Required |  |
| `linkUp` | number | Required |  |
| `headroomPercent` | number | Required |  |
| `speedTest` | Native100 | Required |  |

### Native100

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `providers` | array<Native101> | Required |  |
| `selectedProviderId` | string | Required |  |
| `concurrency` | number | Required |  |
| `maxDurationSec` | number | Required |  |
| `maxDataMB` | number | Required |  |

### Native101

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `id` | string | Required |  |
| `label` | string | Required |  |
| `download` | null  /  Native102 | Required |  |
| `upload` | null  /  Native103 | Required |  |

### Native102

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `url` | string | Required |  |
| `sizeParam` | string | Optional |  |

### Native103

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `url` | string | Required |  |

### Native104

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `fixedPort` | number  /  string | Required |  |
| `instanceId` | string | Required |  |

### Native105

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `supported` | boolean  /  boolean | Required |  |
| `packageKind` | null | Required |  |
| `registered` | boolean  /  boolean | Required |  |
| `canSetTorrentDefault` | boolean  /  boolean | Required |  |
| `torrent` | null | Required |  |
| `magnet` | null | Required |  |

### Native106

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `supported` | boolean  /  boolean | Required |  |
| `registered` | boolean  /  boolean | Required |  |
| `scope` | null | Required |  |
| `torrent` | boolean  /  boolean | Required |  |
| `magnet` | boolean  /  boolean | Required |  |

### Native107

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `effective` | array<string> | Required |  |
| `blacklist` | array<string> | Required |  |
| `healthMap` | object | Required | Native Record<string, TrackerHealth> |
| `sourceMap` | object | Required | Native Record<string, string[]> |
| `lastSyncAt` | null  /  number | Required |  |
| `lastProbeAt` | null  /  number | Required |  |

### Native108

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `paths` | array<Native109> | Required |  |
| `defaultPath` | string | Required |  |
| `allowCustom` | boolean  /  boolean | Required |  |

### Native109

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `path` | string | Required |  |

### Native110

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `engineGid` | string | Required |  |

### Native111

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `active` | null  /  Native112 | Required |  |
| `candidates` | array<Native113> | Required |  |

### Native112

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `path` | string | Required |  |
| `version` | string | Required |  |

### Native113

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `kind` | string  /  string  /  string  /  string | Required |  |
| `path` | null  /  string | Required |  |
| `state` | string  /  string  /  string  /  string  /  string  /  string | Required |  |
| `version` | string | Optional |  |

### Native114

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `id` | string | Required |  |
| `name` | string | Required |  |
| `version` | string | Required |  |
| `description` | string | Required |  |
| `status` | string  /  string  /  string  /  string | Required |  |
| `enabled` | boolean  /  boolean | Required |  |
| `permissions` | array<string> | Required |  |
| `optionalPermissions` | array<string> | Required |  |
| `source` | Native115 | Optional |  |
| `errorCount` | number | Required |  |
| `lastError` | string | Optional |  |

### Native115

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `type` | string  /  string  /  string  /  string  /  string  /  string  /  string  /  string  /  string | Required |  |
| `url` | string | Required |  |
| `bundleSha256` | string | Optional |  |
| `recordedAt` | number | Required |  |

### Native116

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `compatible` | boolean  /  boolean | Required |  |
| `listing` | Native117 | Required |  |
| `author` | Native118 | Required |  |
| `engines` | Native119 | Required |  |
| `id` | string | Required |  |
| `version` | string | Required |  |
| `origin` | string  /  string | Required |  |
| `categories` | array<string> | Required |  |
| `permissions` | array<string> | Required |  |
| `optionalPermissions` | array<string> | Required |  |
| `hostPermissions` | array<string> | Required |  |
| `screenshots` | array<string> | Required |  |
| `updatedAt` | string | Required |  |
| `featured` | boolean  /  boolean | Required |  |
| `package` | Native120 | Optional |  |
| `repository` | string | Optional |  |
| `homepage` | string | Optional |  |
| `icon` | string | Optional |  |

### Native117

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `defaultLocale` | string | Required |  |
| `localizations` | object | Required | Native Record<string, { [x: string]: unknown; name?: string  /  undefined; description?: string  /  undefined; features?: string[]  /  undefined; keywords?: string[]  /  undefined; }> |

### Native118

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `name` | string | Required |  |
| `url` | string | Optional |  |

### Native119

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `motrix` | string | Required |  |

### Native120

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `url` | string | Required |  |
| `sha256` | string | Required |  |
| `size` | number | Required |  |
| `signature` | string | Optional |  |

### Native121

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `manifestVersion` | number | Required |  · const=1 |
| `id` | string | Required |  |
| `name` | string | Required |  |
| `version` | string | Required |  |
| `description` | string | Required |  |
| `author` | string | Optional |  |
| `homepage` | string | Optional |  |
| `repository` | string | Optional |  |
| `license` | string | Optional |  |
| `icon` | string | Optional |  |
| `categories` | array<string> | Required |  |
| `keywords` | array<string> | Optional |  |
| `engines` | Native122 | Required |  |
| `main` | string | Required |  |
| `requestedHeapMB` | number | Optional |  |
| `permissions` | array<string> | Required |  |
| `optionalPermissions` | array<string> | Optional |  |
| `hostPermissions` | array<string> | Optional |  |
| `invokesCommands` | array<string> | Optional |  |
| `activationEvents` | array<string> | Required |  |
| `contributes` | Native123 | Required |  |
| `l10n` | string | Optional |  |

### Native122

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `motrix` | string | Required |  |
| `ffmpeg` | string | Optional |  |

### Native123

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `commands` | array<Native124> | Optional |  |
| `hooks` | object | Optional |  |
| `configuration` | Native125 | Optional |  |

### Native124

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `id` | string | Required |  |
| `title` | string | Required |  |
| `icon` | string | Optional |  |
| `public` | boolean  /  boolean | Optional |  |
| `argsSchema` | JSON | Optional | Declared native type: unknown; no narrower JSON shape is promised. |
| `resultSchema` | JSON | Optional | Declared native type: unknown; no narrower JSON shape is promised. |

### Native125

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `title` | string | Optional |  |
| `description` | string | Optional |  |
| `schema` | JSON | Required | Declared native type: unknown; no narrower JSON shape is promised. |

### Native126

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `edges` | array<Native127> | Required |  |
| `cutoff` | number | Required |  |
| `generatedAt` | number | Required |  |
| `truncated` | boolean  /  boolean | Required |  |

### Native127

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `sourcePluginId` | string | Required |  |
| `targetPluginId` | string | Required |  |
| `commandId` | string | Required |  |
| `calls` | number | Required |  |
| `lastCalledAt` | number | Required |  |

### Native128

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `commands` | array<Native129> | Required |  |
| `hooks` | array<Native130> | Required |  |
| `configurations` | array<Native131> | Required |  |

### Native129

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `pluginId` | string | Required |  |
| `commandId` | string | Required |  |
| `title` | string | Required |  |
| `public` | boolean  /  boolean | Required |  |

### Native130

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `pluginId` | string | Required |  |
| `hook` | string | Required |  |
| `role` | string  /  string  /  string  /  string  /  string | Required |  |

### Native131

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `pluginId` | string | Required |  |
| `title` | string | Optional |  |
| `schema` | JSON | Required | Declared native type: unknown; no narrower JSON shape is promised. |

### Native132

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `manifest` | Native121 | Required |  |
| `origin` | string  /  string | Optional |  |

### Native133

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `ok` | boolean  /  boolean | Required |  |
| `code` | string | Optional |  |
| `message` | string | Optional |  |

### Native134

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `pluginId` | string | Required |  |
| `hook` | string | Required |  |

### Native135

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `rank` | number | Required |  |
| `total` | number | Required |  |
| `role` | string  /  string  /  string  /  string  /  string | Required |  |

### Native136

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `turtle` | string  /  string  /  string | Required |  |
| `effective` | Native95 | Required |  |
| `activeReason` | string  /  string  /  string  /  string  /  string  /  string | Required |  |

### Native137

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| `id` | string | Required |  |
| `sourceKey` | null  /  string | Required |  |
| `kind` | string | Required |  |
| `severity` | string  /  string  /  string | Required |  |
| `titleKey` | string | Required |  |
| `titleParams` | null  /  object | Required |  |
| `bodyKey` | null  /  string | Required |  |
| `bodyParams` | null  /  object | Required |  |
| `taskId` | null  /  string | Required |  |
| `createdAt` | number | Required |  |
| `readAt` | null  /  number | Required |  |
