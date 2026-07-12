# CLI 与 MCP 映射设计

> **状态**：设计阶段，待 Codex 审查批准后方可实施
> **任务**：G-303 CLI 与 MCP 映射设计
> **基线**：`6ae3201`
> **前置**：G-301 Shared 类型迁移设计、G-302 Capability API Schema v1
> **约束**：本文件仅提供设计文档，不实施 HTTP Server、CLI、MCP Server，不修改业务运行逻辑、IPC channel、preload、Cookie、Session、Webview、DOM 或豆包内部接口

## 1. 设计目标

将 G-302 定义的 Capability API Schema v1 映射为 CLI 命令和 MCP tools，为其他 Agent 安全调用豆包工作室做准备。三个消费层共享同一套 Schema：

```
         CapabilityManifest / CreateTaskRequest / TaskSnapshot
              TaskEvent / ArtifactDescriptor / ApiError
                          |
          +---------------+---------------+
          |               |               |
      CLI 命令       MCP tools      本地 HTTP API
     (doubao-studio)   (stdio)      (localhost)
```

### 1.1 设计原则

1. **Schema 是唯一权威**：CLI 参数、MCP tool input/output 与 Schema 字段一一对应，不引入 Schema 之外的字段。
2. **异步优先**：所有生成操作映射为 `tasks create`，返回 `taskId`；不阻塞等待视频生成完成。
3. **不透明标识**：账号、资产、产物均使用不透明 ID，CLI 和 MCP 不接受本地文件路径或内部 URL。
4. **安全边界**：CLI、MCP 和本地 API 禁止返回 Cookie、Session、Webview、DOM、Zustand、本地绝对路径、豆包内部 URL 和未脱敏账号信息。
5. **开放枚举**：CLI 和 MCP 参数中涉及枚举值的字段（`mode`、`status`、`stage`、`eventType`、`code`、`mediaType`、`validationState`、`priority`、`dependencyPolicy`）均以 Schema description 中的已知值为参考，客户端必须处理未知值。

## 2. CLI 命令映射

### 2.1 命令总览

| CLI 命令 | 对应 API 语义 | Schema 请求/响应 | 说明 |
|----------|-------------|-----------------|------|
| `doubao-studio capabilities show` | `GET /capabilities` | → `CapabilityManifest` | 获取服务能力清单 |
| `doubao-studio tasks create` | `POST /tasks` | `CreateTaskRequest` → `TaskSnapshot` | 提交异步生成任务 |
| `doubao-studio tasks get <taskId>` | `GET /tasks/{taskId}` | → `TaskSnapshot` | 查询任务快照 |
| `doubao-studio tasks lookup --request-id <id>` | `GET /tasks:lookup?requestId={requestId}` | → `{ found: boolean, taskId?, snapshot? }` | 按 requestId 查询任务 |
| `doubao-studio tasks cancel <taskId>` | `POST /tasks/{taskId}:cancel` | → `TaskSnapshot` | 取消任务 |
| `doubao-studio tasks events` | `GET /tasks/events?since={n}` | → `TaskEventsResponse` | 拉取事件流 |
| `doubao-studio artifacts list --task-id <id>` | `GET /tasks/{taskId}/artifacts` | → `ArtifactDescriptor[]` | 列出任务产物 |
| `doubao-studio artifacts get <artifactId>` | `GET /artifacts/{artifactId}` | → `ArtifactDescriptor` | 获取产物描述符 |

### 2.2 capabilities show

```text
doubao-studio capabilities show [--format json|table]
```

**输出**：`CapabilityManifest`

```json
{
  "protocolVersion": "1.0.0",
  "serviceVersion": "2.1.0",
  "supportedModes": ["chat", "image", "video", "music"],
  "models": [
    {
      "modelId": "seedance-2.0",
      "label": "Seedance 2.0",
      "supportedDurations": ["5s", "10s", "15s"],
      "supportedAspectRatios": ["1:1", "3:4", "4:3", "9:16", "16:9", "21:9"]
    }
  ],
  "concurrencyLimit": 3,
  "actionTypes": ["robot_verification", "quota_exhausted", "login_expired"],
  "optionalCapabilities": ["csv_import", "batch_operations", "task_events"],
  "health": {
    "status": "healthy",
    "providerAdapters": [
      { "name": "doubao", "status": "healthy", "lastCheckedAt": "2025-07-12T10:00:00.000Z" }
    ]
  }
}
```

**字段说明**（与 `capability-manifest.schema.json` 完全一致）：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `protocolVersion` | string (`^1\.\d+\.\d+$`) | 是 | 协议版本，v1 系列以 `1.` 开头 |
| `serviceVersion` | string (`^\d+\.\d+\.\d+`) | 是 | 豆包工作室应用版本 |
| `supportedModes` | string[] | 是 | 已知值：chat, image, video, music |
| `models` | ModelCapability[] | 是 | 视频模型列表 |
| `concurrencyLimit` | integer | 是 | 最大并发任务数 |
| `actionTypes` | string[] | 是 | 已知值：robot_verification, face_restriction, membership_required, quota_exhausted, login_expired, user_cancelled |
| `optionalCapabilities` | string[] | 否 | 已知值：csv_import, batch_operations, webhooks, task_events, artifact_validation, multi_project |
| `health` | HealthStatus | 是 | 实例健康状态 |

**ModelCapability 子结构**：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `modelId` | string | 是 | 模型 ID，已知值：seedance-2.0, seedance-2.0-fast, seedance-2.0-mini |
| `label` | string | 是 | 模型显示名 |
| `supportedDurations` | string[] | 是 | 已知值：5s, 10s, 15s |
| `supportedAspectRatios` | string[] | 是 | 已知值：1:1, 3:4, 4:3, 9:16, 16:9, 21:9 |

**HealthStatus 子结构**：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `status` | string | 是 | 已知值：healthy, degraded, unavailable |
| `providerAdapters` | array | 否 | Provider 适配器状态列表 |

### 2.3 tasks create

```text
doubao-studio tasks create [options]
```

**选项**（与 `create-task-request.schema.json` 一一对应）：

| CLI 选项 | Schema 字段 | 类型 | 必填 | 说明 |
|----------|------------|------|------|------|
| `--request-id <id>` | `requestId` | string (1–128) | 是 | 幂等键，建议 UUID v4 |
| `--mode <mode>` | `mode` | string | 是 | 已知值：chat, image, video, music |
| `--prompt <text>` | `prompt` | string (1–10000) | 是 | 生成提示词 |
| `--model <id>` | `videoConfig.model` | string | mode=video 时必填 | 已知值：seedance-2.0, seedance-2.0-fast, seedance-2.0-mini |
| `--duration <val>` | `videoConfig.duration` | string | mode=video 时必填 | 已知值：5s, 10s, 15s |
| `--aspect-ratio <val>` | `videoConfig.aspectRatio` | string | mode=video 时必填 | 已知值：1:1, 3:4, 4:3, 9:16, 16:9, 21:9 |
| `--input-asset-ids <ids...>` | `inputAssetIds` | string[] (max 20) | 否 | 资产不透明 ID 列表 |
| `--project-id <id>` | `projectId` | string | 否 | 项目 ID |
| `--priority <val>` | `priority` | string | 否 | 已知值：low, normal, high。默认 normal |
| `--depends-on <ids...>` | `dependsOnTaskIds` | string[] | 否 | 前置任务 ID 列表 |
| `--dependency-policy <val>` | `dependencyPolicy` | string | 否 | 已知值：all_done, all_finished。默认 all_done |

**条件约束**（与 Schema `allOf` 一致）：
- `mode` 为 `video` 时，`--model`、`--duration`、`--aspect-ratio` 三者均必填。
- `mode` 非 `video` 时，禁止传递 `--model`、`--duration`、`--aspect-ratio`。

**输出**：`TaskSnapshot`

```json
{
  "taskId": "task_550e8400",
  "status": "queued",
  "stage": "queued",
  "mode": "video",
  "prompt": "一只猫在月光下奔跑，电影质感",
  "videoConfig": { "model": "seedance-2.0", "duration": "15s", "aspectRatio": "16:9" },
  "retry": { "attempt": 0, "maxAttempts": 3, "retryable": true },
  "timestamps": { "createdAt": "2025-07-12T10:00:00.000Z", "updatedAt": "2025-07-12T10:00:00.000Z" }
}
```

**禁止选项**（Schema `additionalProperties: false` 在 JSON 层面约束；CLI 参数解析器必须显式拒绝以下选项）：
- 不接受 `--account-id`、`--cookie`、`--partition`、`--conversation-url`、`--save-dir`、`--file-path`
- 不接受本地文件路径作为 `--input-asset-ids` 的值（以 `/` 或 `C:\` 开头的值被服务端运行时拒绝）
- **实施要求**：CLI 参数解析器必须对未知选项报错退出（`invalid_request`），不得静默忽略；HTTP/MCP 层必须通过公共 DTO 白名单序列化请求和响应，不得将内部对象直接 JSON 序列化后返回（见 [§7.5](#75-响应序列化与参数校验要求)）

### 2.4 tasks get

```text
doubao-studio tasks get <taskId> [--format json|table]
```

**参数**：

| 参数 | 说明 |
|------|------|
| `taskId` | 公共任务 ID |

**输出**：`TaskSnapshot`

**TaskSnapshot 完整字段**（与 `task-snapshot.schema.json` 一致）：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `taskId` | string | 是 | 公共任务 ID |
| `status` | string | 是 | 已知值：queued, executing, generating, waiting_verification, paused, done, fail, cancelled |
| `stage` | string | 是 | 已知值：queued, preparing_account, new_conversation, switching_mode, configuring, uploading_assets, injecting_prompt, submitting, waiting_verification, generating, extracting_outputs, completed, paused, failed, cancelled |
| `mode` | string | 是 | 已知值：chat, image, video, music |
| `prompt` | string | 是 | 生成提示词 |
| `videoConfig` | object | 否 | mode=video 时存在 |
| `progress` | object | 否 | `percent` (0–100), `message` |
| `retry` | object | 是 | `attempt`, `maxAttempts`, `retryable` |
| `timestamps` | object | 是 | `createdAt`, `updatedAt`, `startedAt?`, `finishedAt?` |
| `error` | ApiError | 否 | status 为 fail 或存在错误时出现 |
| `actionRequired` | object | 否 | `type`, `message`, `resolutionUrl?`, `retryable` |
| `artifacts` | ArtifactDescriptor[] | 否 | 已发现的产物摘要 |
| `projectId` | string | 否 | 所属项目 ID |

**禁止字段**（Schema `additionalProperties: false` 在 JSON 校验层面约束；服务端必须通过公共 DTO 白名单序列化响应，见 [§7.5](#75-响应序列化与参数校验要求)）：
- `assignedAccountId`、`lock`、`conversationUrl`、`partition`、`saveDir`、`filePath`、`batchId`、`source`

### 2.5 tasks lookup --request-id

```text
doubao-studio tasks lookup --request-id <requestId>
```

**选项**：

| CLI 选项 | 说明 |
|----------|------|
| `--request-id <id>` | 客户端原始 requestId，不要求事先知道 taskId |

**输出**：查找结果

```json
// found: true 时
{ "found": true, "taskId": "task_550e8400", "snapshot": { "taskId": "task_550e8400", "status": "generating", ... } }

// found: false 时
{ "found": false }
```

### 2.5.1 tasks lookup 风险声明

> **关键风险**：服务重启后 `requestId` → `taskId` 映射可能丢失。此时查询返回 `found: false`，**不代表历史任务一定未执行**。

客户端行为规则：

1. 提交 `tasks create` 后如果响应丢失，**必须先**调用 `tasks lookup --request-id` 核对任务。
2. 收到 `found: true` 时，按返回的 `taskId` 继续跟踪。
3. 收到 `found: false` 时，**不得盲目重提**。`found: false` 只表示当前进程不持有该 requestId 映射，不保证原任务未创建或未执行。
4. 客户端只有在**明确接受进程重启造成的重复风险**时，才能重新提交。
5. CLI 和 MCP 层面必须在帮助文本和 tool description 中记录该语义，不得将 `found: false` 语义降级为"安全可重提"。

### 2.6 tasks cancel

```text
doubao-studio tasks cancel <taskId>
```

**参数**：

| 参数 | 说明 |
|------|------|
| `taskId` | 公共任务 ID |

**输出**：`TaskSnapshot`（`status` 为 `cancelled` 或仍为当前非终态状态，后续通过事件收到 `cancelled`）

**取消语义**：

| 任务当前状态 | 取消行为 | 结果 status |
|-------------|---------|-------------|
| `queued` | 直接移出队列 | `cancelled` |
| `executing` / `generating` | 发送中断信号，等待当前步骤安全终止 | 返回时仍为 `executing`/`generating`，异步完成后投递 `task.cancelled` 事件，最终 status 变为 `cancelled` |
| `waiting_verification` | 标记取消，人工动作不再阻塞 | `cancelled` |
| `paused` | 直接标记取消 | `cancelled` |
| `done` / `fail` / `cancelled` | 返回当前快照，不改变状态 | 原状态不变 |

**幂等性**：对已处于终态（`done`/`fail`/`cancelled`）的任务重复调用 cancel 不产生错误，返回当前快照。

**错误码**：

| 场景 | ApiError.code | retryable |
|------|-------------|-----------|
| taskId 不存在 | `task_not_found` | false |
| 服务不可用 | `service_unavailable` | true |
| 请求格式错误 | `invalid_request` | false |

### 2.7 tasks events

```text
doubao-studio tasks events [--since <sequence>] [--task-id <taskId>] [--follow] [--timeout <ms>]
```

**选项**：

| CLI 选项 | 说明 |
|----------|------|
| `--since <n>` | 上次收到的 `lastSequence`，返回所有 `sequence > n` 的事件。默认 0 |
| `--task-id <id>` | 可选，只返回指定任务的事件 |
| `--follow` | 持续轮询模式，有新事件时输出 |
| `--timeout <ms>` | 单次轮询超时（毫秒），超时返回空列表 |

**输出**：`TaskEventsResponse`（事件响应包络，Schema：[`task-events-response.schema.json`](../../schemas/capability/v1/task-events-response.schema.json)）

```json
{
  "serviceInstanceId": "inst_abc123",
  "events": [
    {
      "sequence": 42,
      "eventId": "evt_550e8400-e29b-41d4-a716-446655440000",
      "taskId": "task_abc123",
      "timestamp": "2025-07-12T10:30:00.000Z",
      "eventType": "task.stage_changed",
      "payload": { "stage": "generating", "percent": 50 }
    }
  ]
}
```

**响应包络字段**：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `serviceInstanceId` | string | 是 | 当前服务实例标识。服务重启后此值改变，客户端据此检测重启（见 [§6.3](#63-事件-sequence-重启语义)） |
| `events` | TaskEvent[] | 是 | 事件列表，可能为空数组 |

> **设计说明**：`TaskEvent` Schema（`task-event.schema.json`）本身不包含 `serviceInstanceId`；该标识仅出现在事件响应包络中。这是为了避免修改已有 Schema（G-302 冻结的 v1 Schema 不新增字段语义），同时让客户端能可靠检测服务重启。

**TaskEvent 完整字段**（与 `task-event.schema.json` 一致）：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `sequence` | integer (≥0) | 是 | 单调递增序列号，续订游标 |
| `eventId` | string | 是 | 全局唯一事件 ID，用于去重 |
| `taskId` | string | 是 | 关联任务 ID |
| `timestamp` | string (date-time) | 是 | 事件产生时间 |
| `eventType` | string | 是 | 已知值见下表 |
| `payload` | object | 否 | 结构取决于 eventType |

**已知 eventType 值**：

| eventType | payload 关键字段 |
|-----------|-----------------|
| `task.created` | — |
| `task.started` | — |
| `task.stage_changed` | `stage` |
| `task.progress` | `percent`, `message` |
| `task.paused` | — |
| `task.resumed` | — |
| `task.cancelled` | — |
| `task.failed` | `error` (ApiError) |
| `task.done` | — |
| `action_required` | `actionType` |
| `action_resolved` | — |
| `artifact.discovered` | `artifactId` |
| `artifact.validated` | `artifactId` |
| `artifact.downloaded` | `artifactId` |

**去重语义**：
- 投递模型：至少一次（at-least-once）
- 去重依据：`eventId`（全局唯一）
- 客户端应记录已处理的 `eventId` 集合，收到重复事件时忽略

### 2.8 artifacts list

```text
doubao-studio artifacts list --task-id <taskId> [--format json|table]
```

**选项**：

| CLI 选项 | 说明 |
|----------|------|
| `--task-id <id>` | 必填，目标任务 ID |

**输出**：`ArtifactDescriptor[]`

### 2.9 artifacts get

```text
doubao-studio artifacts get <artifactId> [--format json|table]
```

**参数**：

| 参数 | 说明 |
|------|------|
| `artifactId` | 公共产物 ID（不透明标识） |

**输出**：`ArtifactDescriptor`

**ArtifactDescriptor 完整字段**（与 `artifact-descriptor.schema.json` 一致）：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `artifactId` | string | 是 | 不透明产物 ID |
| `taskId` | string | 是 | 所属任务 ID |
| `mediaType` | string | 是 | 已知值：image, video, audio, file |
| `mimeType` | string | 否 | MIME 类型 |
| `sizeBytes` | integer (≥0) | 否 | 文件大小（字节） |
| `createdAt` | string (date-time) | 是 | 产物发现时间 |
| `expiresAt` | string (date-time) | 否 | 过期时间 |
| `validationState` | string | 是 | 已知值：unknown, valid, expired, invalid |
| `validatedAt` | string (date-time) | 否 | 最近校验时间 |
| `downloadAvailable` | boolean | 是 | 是否可下载 |
| `previewAvailable` | boolean | 是 | 是否可预览 |
| `source` | string | 否 | 已知值：network, page, manual。客户端不应依赖此字段做逻辑判断 |

**禁止字段**（Schema `additionalProperties: false` 在 JSON 校验层面约束；服务端必须通过公共 DTO 白名单序列化响应，见 [§7.5](#75-响应序列化与参数校验要求)）：
- `url`、`filePath`、`saveDir`、`conversationUrl`、`partition`

## 3. MCP Tools 映射

### 3.1 MCP tool 总览

| MCP tool name | 对应 CLI 命令 | 请求 Schema | 响应 Schema |
|---------------|-------------|------------|------------|
| `capabilities_show` | `capabilities show` | — | `CapabilityManifest` |
| `tasks_create` | `tasks create` | `CreateTaskRequest` | `TaskSnapshot` |
| `tasks_get` | `tasks get` | `{ taskId: string }` | `TaskSnapshot` |
| `tasks_lookup` | `tasks lookup --request-id` | `{ requestId: string }` | `{ found: boolean, taskId?: string, snapshot?: TaskSnapshot }` |
| `tasks_cancel` | `tasks cancel` | `{ taskId: string }` | `TaskSnapshot` |
| `tasks_events` | `tasks events` | `{ since?: integer, taskId?: string }` | `{ serviceInstanceId: string, events: TaskEvent[] }` |
| `artifacts_list` | `artifacts list` | `{ taskId: string }` | `ArtifactDescriptor[]` |
| `artifacts_get` | `artifacts get` | `{ artifactId: string }` | `ArtifactDescriptor` |

### 3.2 capabilities_show

```json
{
  "name": "capabilities_show",
  "description": "获取豆包工作室服务能力清单，包括支持的生成模式、视频模型、参数范围、并发限制和健康状态。客户端应在首次连接时调用此工具。",
  "inputSchema": {
    "type": "object",
    "properties": {},
    "additionalProperties": false
  }
}
```

**输出**：`CapabilityManifest`（见 §2.2）

### 3.3 tasks_create

```json
{
  "name": "tasks_create",
  "description": "提交异步生成任务。返回已接收的任务快照，不等待生成完成。使用 requestId 实现幂等：相同 requestId 在当前服务进程生命周期内重复提交返回同一任务。进程重启后 requestId 缓存丢失，客户端应先通过 tasks_lookup 查询。禁止指定账号、Cookie、会话 URL 或本地文件路径。",
  "inputSchema": {
    "$ref": "https://doubao.studio/schemas/capability/v1/create-task-request.schema.json"
  }
}
```

**inputSchema 字段**（与 `create-task-request.schema.json` 完全一致）：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `requestId` | string (1–128) | 是 | 客户端生成的幂等键，建议 UUID v4 |
| `mode` | string | 是 | 已知值：chat, image, video, music |
| `prompt` | string (1–10000) | 是 | 生成提示词 |
| `videoConfig` | object | mode=video 时必填 | `{ model, duration, aspectRatio }` |
| `inputAssetIds` | string[] (max 20) | 否 | 资产不透明 ID 列表 |
| `projectId` | string | 否 | 项目 ID |
| `priority` | string | 否 | 已知值：low, normal, high。默认 normal |
| `dependsOnTaskIds` | string[] | 否 | 前置任务 ID 列表 |
| `dependencyPolicy` | string | 否 | 已知值：all_done, all_finished。默认 all_done |

**条件约束**：`mode` 为 `video` 时 `videoConfig` 必填；非 `video` 时禁止 `videoConfig`。

**输出**：`TaskSnapshot`

**错误码**：

| 场景 | ApiError.code | retryable |
|------|-------------|-----------|
| 缺少必填字段 / 包含禁止字段 | `invalid_request` | false |
| 依赖任务不存在 | `task_not_found` | false |
| 并发已达上限 | `rate_limited` | true |
| 服务不可用 | `service_unavailable` | true |

### 3.4 tasks_get

```json
{
  "name": "tasks_get",
  "description": "查询任务公共视图快照，包含状态、阶段、进度、重试信息和产物摘要。",
  "inputSchema": {
    "type": "object",
    "required": ["taskId"],
    "additionalProperties": false,
    "properties": {
      "taskId": {
        "type": "string",
        "minLength": 1,
        "description": "公共任务 ID。"
      }
    }
  }
}
```

**输出**：`TaskSnapshot`

**错误码**：

| 场景 | ApiError.code | retryable |
|------|-------------|-----------|
| taskId 不存在 | `task_not_found` | false |

### 3.5 tasks_lookup

```json
{
  "name": "tasks_lookup",
  "description": "按 requestId 查询任务，用于处理"提交成功但响应丢失"的场景。查询键为客户端原始 requestId，不要求事先知道 taskId。注意：服务重启后映射可能丢失，found=false 不代表历史任务一定未执行，客户端不得盲目重提。",
  "inputSchema": {
    "type": "object",
    "required": ["requestId"],
    "additionalProperties": false,
    "properties": {
      "requestId": {
        "type": "string",
        "minLength": 1,
        "maxLength": 128,
        "description": "客户端创建任务时使用的原始 requestId。"
      }
    }
  }
}
```

**输出**：

```json
// found: true
{ "found": true, "taskId": "task_550e8400", "snapshot": { ... TaskSnapshot ... } }

// found: false
{ "found": false }
```

**风险声明**：见 [§2.5.1](#251-tasks-lookup-风险声明)。

### 3.6 tasks_cancel

```json
{
  "name": "tasks_cancel",
  "description": "取消任务。对已处于终态（done/fail/cancelled）的任务重复调用不产生错误，返回当前快照。",
  "inputSchema": {
    "type": "object",
    "required": ["taskId"],
    "additionalProperties": false,
    "properties": {
      "taskId": {
        "type": "string",
        "minLength": 1,
        "description": "公共任务 ID。"
      }
    }
  }
}
```

**输出**：`TaskSnapshot`

**取消语义**：见 [§2.6](#26-tasks-cancel)

### 3.7 tasks_events

```json
{
  "name": "tasks_events",
  "description": "拉取任务事件流。使用 since 参数实现断线续订：发送上次收到的 lastSequence，返回所有 sequence > lastSequence 的事件。响应包络包含 serviceInstanceId，客户端据此检测服务重启并重新同步。至少一次投递语义下，客户端通过 eventId 去重。",
  "inputSchema": {
    "type": "object",
    "additionalProperties": false,
    "properties": {
      "since": {
        "type": "integer",
        "minimum": 0,
        "default": 0,
        "description": "上次收到的 lastSequence。返回所有 sequence > since 的事件。默认 0。"
      },
      "taskId": {
        "type": "string",
        "description": "可选，只返回指定任务的事件。"
      }
    }
  }
}
```

**输出**：`TaskEventsResponse`（含 `serviceInstanceId` 和 `events`，见 [§2.7](#27-tasks-events)）

**去重语义**：见 [§2.7](#27-tasks-events)

### 3.8 artifacts_list

```json
{
  "name": "artifacts_list",
  "description": "列出指定任务的产物描述符列表。产物使用不透明 ID，不暴露原始 URL 或本地路径。",
  "inputSchema": {
    "type": "object",
    "required": ["taskId"],
    "additionalProperties": false,
    "properties": {
      "taskId": {
        "type": "string",
        "minLength": 1,
        "description": "目标任务 ID。"
      }
    }
  }
}
```

**输出**：`ArtifactDescriptor[]`

### 3.9 artifacts_get

```json
{
  "name": "artifacts_get",
  "description": "获取单个产物描述符。包含校验状态、可下载性和可预览性声明，但不返回原始 URL 或本地路径。",
  "inputSchema": {
    "type": "object",
    "required": ["artifactId"],
    "additionalProperties": false,
    "properties": {
      "artifactId": {
        "type": "string",
        "minLength": 1,
        "description": "公共产物 ID（不透明标识）。"
      }
    }
  }
}
```

**输出**：`ArtifactDescriptor`

**错误码**：

| 场景 | ApiError.code | retryable |
|------|-------------|-----------|
| artifactId 不存在 | `artifact_not_found` | false |
| 产物已过期 | `artifact_expired` | false |

## 4. 幂等与取消语义

### 4.1 幂等流程

```
客户端                              服务端
  |                                   |
  | tasks_create                      |
  | { requestId: "abc-123", ... }     |
  |---------------------------------->|
  |                                   |--- 查找 requestId 缓存
  |                                   |--- 未找到 → 创建任务
  |                                   |--- 存储 requestId → taskId 映射
  |<----------------------------------|
  | TaskSnapshot { taskId, status }   |
  |                                   |
  |  （网络重试，相同 requestId）       |
  | tasks_create                      |
  | { requestId: "abc-123", ... }     |
  |---------------------------------->|
  |                                   |--- 查找 requestId 缓存
  |                                   |--- 找到 → 返回原 taskId
  |<----------------------------------|
  | TaskSnapshot { taskId, status }   |
```

**requestId 作用域**：
- 作用域：当前服务进程生命周期
- 进程重启：`requestId` 缓存丢失，相同 `requestId` 可能创建新任务
- 客户端重试建议：响应丢失或进程重启后，先调用 `tasks_lookup` 查询；只有明确得到 `found: false` 且接受进程重启造成的重复风险时才重新提交
- 不承诺跨进程重启的幂等性

### 4.2 取消流程

```
客户端                              服务端
  |                                   |
  | tasks_cancel { taskId }           |
  |---------------------------------->|
  |                                   |--- 查找任务
  |                                   |--- 任务存在且非终态:
  |                                   |      发送中断信号
  |                                   |      等待当前步骤安全终止
  |                                   |      更新 status → cancelled
  |                                   |      投递 task.cancelled 事件
  |                                   |--- 任务已终态:
  |                                   |      不改变状态
  |<----------------------------------|
  | TaskSnapshot { status }           |
```

**取消与事件的交互**：
- 取消成功后，客户端通过 `tasks_events` 可收到 `task.cancelled` 事件
- 正在执行中的任务取消为异步操作：`tasks_cancel` 返回时 status 仍为 `executing`/`generating`，后续通过事件收到 `task.cancelled`，最终 status 变为 `cancelled`
- 客户端不应假设 cancel 返回后立即进入 `cancelled` 终态

## 5. 错误码映射

### 5.1 统一错误响应

所有 CLI 命令和 MCP tools 在出错时返回 `ApiError`（与 `api-error.schema.json` 一致）：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `code` | string | 是 | 稳定错误码 |
| `message` | string | 是 | 人类可读错误描述，不含堆栈或内部路径 |
| `retryable` | boolean | 是 | 是否可通过重试解决 |
| `suggestedWaitMs` | integer (≥0) | 否 | 建议重试等待时间（retryable=true 时有意义） |
| `taskId` | string | 否 | 关联任务 ID |
| `actionRequired` | object | 否 | 人工动作指引 |
| `details` | object | 否 | 白名单诊断字段：`field`、`limit`、`current` |

### 5.2 已知错误码

| code | retryable | 说明 | 常见场景 |
|------|-----------|------|---------|
| `cancelled` | false | 任务已取消 | 任务被取消后操作 |
| `verification` | false | 需要人工验证 | 附带 `actionRequired` |
| `quota_exhausted` | false | 额度用完 | 附带 `actionRequired` + `details.limit/current` |
| `membership_required` | false | 需要会员 | 附带 `actionRequired` |
| `face_restricted` | false | 人脸限制 | 附带 `actionRequired` |
| `content_rejected` | false | 内容被拒绝 | — |
| `network` | true | 网络错误 | — |
| `timeout` | true | 超时 | 附带 `suggestedWaitMs` |
| `page_changed` | false | 页面结构变更 | — |
| `submission_failed` | false | 提交失败 | — |
| `generation_failed` | false | 生成失败 | — |
| `output_missing` | false | 产物缺失 | — |
| `task_not_found` | false | 任务不存在 | `tasks get`/`tasks cancel` 的 taskId 无效 |
| `artifact_not_found` | false | 产物不存在 | `artifacts get` 的 artifactId 无效 |
| `artifact_expired` | false | 产物已过期 | 产物超过 `expiresAt` |
| `rate_limited` | true | 速率受限 | 附带 `suggestedWaitMs` |
| `service_unavailable` | true | 服务不可用 | — |
| `invalid_request` | false | 请求格式错误 | 附带 `details.field` |
| `unknown` | false | 未知错误 | 客户端必须处理未知 code |

### 5.3 ActionRequired 人工动作

`actionRequired`（定义在 `task-snapshot.schema.json#/$defs/ActionRequired`）覆盖以下场景：

| type | 触发场景 | retryable | 恢复方式 |
|------|---------|-----------|---------|
| `robot_verification` | 豆包页面弹出机器人验证 | true | 用户在桌面 UI 完成验证后自动恢复 |
| `face_restriction` | 人脸限制阻断生成 | false | 用户调整内容后重试 |
| `membership_required` | 需要会员权限 | false | 用户开通会员后重试 |
| `quota_exhausted` | 每日额度用完 | true | 次日额度刷新后重试或更换账号 |
| `login_expired` | 账号登录态过期 | true | 用户在桌面 UI 重新登录后重试 |
| `user_cancelled` | 用户主动取消 | false | 重新提交任务 |

## 6. 协议缺口分析

G-302 在 §11 未决问题中列出了以下缺口。本节给出 G-303 的处理决策。

### 6.1 AccountSummary 脱敏只读视图

**当前状态**：G-302 §4.1 定义了 `Account` → 公共视图的映射规则，但未创建 `AccountSummary` Schema。

**G-303 决策**：**延后实施**。

理由：
1. CLI 和 MCP 首批命令（§2.1）不包含账号管理命令（`accounts list` 等），因为账号管理是桌面 UI 的内部职责。
2. `tasks create` 的 Schema 通过 `additionalProperties: false` 在 JSON 校验层面禁止客户端指定 `accountId`；CLI 参数解析器和 HTTP/MCP 层也必须显式拒绝该参数（见 [§7.5](#75-响应序列化与参数校验要求)），服务端自动调度。
3. `CapabilityManifest.health` 已提供 `providerAdapters` 健康状态，Agent 无需直接查看账号列表。

**未来设计建议**（不在本任务实现）：
- 新增 `schemas/capability/v1/account-summary.schema.json`
- 字段仅包含：`accountId`（不透明 ID）、`name`、`status`（已知值：idle, busy, error）、`loginState`（已知值：logged_in, logged_out, expired）
- 禁止暴露：`partition`、`health.cooldownUntil`、`seedanceQuota`、`scheduling`、`avatar`
- 通过 `GET /accounts` 返回 `AccountSummary[]`，通过 `GET /accounts/{accountId}` 返回单个 `AccountSummary`
- CLI 映射：`doubao-studio accounts list`、`doubao-studio accounts show <accountId>`
- MCP 映射：`accounts_list`、`accounts_show`

### 6.2 inputAssetIds 资产上传流程

**当前状态**：G-302 §3.2 声明"资产通过受控上传 API 获取 ID"，但未定义上传协议。

**G-303 决策**：**延后实施，定义设计方向**。

理由：
1. 首批 CLI/MCP 命令不包含 `assets upload`，因为首批任务聚焦文本到视频/图片/音乐生成，不依赖参考素材。
2. `inputAssetIds` 在 Schema 中为可选字段，首批可空。

**未来设计建议**（不在本任务实现）：
- 新增 `POST /assets` 上传端点，接受 `multipart/form-data` 或二进制流
- 返回 `{ assetId: string, mediaType: string, mimeType: string, sizeBytes: integer }`
- `assetId` 为不透明 ID，不包含文件名或路径
- 服务端拒绝以 `/` 或 `C:\` 开头的值作为 assetId（运行时校验，非 Schema 层面）
- CLI 映射：`doubao-studio assets upload <file> --media-type <type>`
- MCP 映射：`assets_upload`（inputSchema 接受 base64 编码字节流或受控 URI）
- 安全约束：上传文件存储在内部受控目录，不暴露存储路径给客户端

### 6.3 事件 sequence 重启语义

**当前状态**：G-302 §3.4 定义了 sequence 单调递增和进程重启后从 0 重新开始的设计。

**G-303 决策**：**确认 sequence 从 0 重启的设计，引入 `serviceInstanceId` 解决重启检测问题**。

#### 6.3.1 问题分析

G-302 原始设计中，客户端通过 `since=lastSequence` 拉取事件，服务端返回 `sequence > since` 的事件。但服务重启后 sequence 从 0 重新开始，服务端仍按 `sequence > since` 过滤时会直接返回空集——客户端根本看不到序号回退，无法检测重启。

#### 6.3.2 解决方案：响应包络携带 serviceInstanceId

事件响应使用包络格式（见 [§2.7](#27-tasks-events)），包含 `serviceInstanceId` 字段：

```json
{ "serviceInstanceId": "inst_abc123", "events": [ ... ] }
```

- `serviceInstanceId` 在服务进程启动时生成（建议 UUID v4），进程生命周期内不变。
- 服务重启后 `serviceInstanceId` 改变，客户端据此可靠检测重启。
- 该标识仅在事件响应包络中出现，不修改 `TaskEvent` Schema 本身（G-302 冻结的 v1 Schema 不新增字段）。

#### 6.3.3 客户端应对策略

1. **正常续订**：客户端记录 `lastSequence` 和 `serviceInstanceId`，每次调用 `tasks_events --since <lastSequence>`。
2. **检测重启**：客户端比较响应中的 `serviceInstanceId` 与本地记录值。如果不一致，判定服务端已重启。
3. **重启恢复**：
   - 客户端清空本地 `lastSequence`，从 0 重新拉取
   - 通过 `eventId` 集合去重已处理过的事件
   - 如果客户端没有保留 `eventId` 集合，则接受可能的重复事件
4. **间隙容忍**：sequence 不保证连续（可能有间隙），客户端只关注 `sequence > since` 的事件。
5. **空事件集处理**：空 `events` 数组不等于重启——只有 `serviceInstanceId` 变化才表示重启。

#### 6.3.4 CLI `--follow` 模式的重启处理

- `--follow` 模式下 CLI 内部维护 `lastSequence`、`serviceInstanceId` 和 `eventId` 集合
- 检测到 `serviceInstanceId` 变化时，输出警告 `# Warning: service instance changed, re-synchronizing from sequence 0`，然后从 0 重新拉取

#### 6.3.5 备选方案（未采用）

- **持久化单调序号**：将 sequence 持久化到磁盘，重启后继续递增。优点是客户端无需检测重启；缺点是引入持久化依赖和写入放大，与当前 JSON 存储模型不匹配。未来迁移到 SQLite（ROADMAP 3.0）后可重新评估。
- **eventEpoch**：在响应中携带单调递增的 epoch 号。语义与 `serviceInstanceId` 等价，但 `serviceInstanceId` 更直观且无需维护额外计数器。

### 6.4 Webhook 签名与重放保护

**当前状态**：G-302 将 Webhook 列为 `optionalCapabilities` 值之一，但签名和重放保护细节留待 G-303。

**G-303 决策**：**延后实施，定义设计方向**。

理由：
1. Webhook 属于 ROADMAP 2.4 工作流与融合能力阶段，当前 Wave 3 不实现。
2. `optionalCapabilities` 中已声明 `webhooks` 标识，客户端可通过 `capabilities show` 检测是否支持。

**未来设计建议**（不在本任务实现）：
- Webhook 注册：`POST /webhooks`，body 包含 `{ url, secret, eventTypes[] }`
- 签名方案：HMAC-SHA256，签名字段为 `timestamp + "." + body`
- 请求头：`X-Doubao-Signature: t=<timestamp>,v1=<hex_signature>`
- 重放保护：签名中包含时间戳，服务端拒绝 `|当前时间 - timestamp| > 5min` 的请求
- 投递模型：至少一次，附带 `deliveryId` 供客户端去重
- 重试策略：指数退避（1s, 5s, 30s, 2min, 10min），最多 5 次
- 死信：超过最大重试后记录到死信队列，可通过 `GET /webhooks/{id}/dead-letter` 查询

## 7. 鉴权与最小权限边界

### 7.1 三层访问模型

```
┌─────────────────────────────────────────────────┐
│              本地 HTTP API (localhost)            │
│  监听: 127.0.0.1:<port>，默认不监听局域网         │
│  认证: Bearer Token (本地生成，绑定桌面实例)       │
│  审计: 所有写操作记录来源、requestId 和时间戳       │
├─────────────────────────────────────────────────┤
│              CLI (doubao-studio)                  │
│  认证: 读取本地配置文件中的 Token                 │
│  传输: 通过 localhost HTTP API 调用              │
│  审计: 继承 HTTP API 层                           │
├─────────────────────────────────────────────────┤
│              MCP Server (stdio)                   │
│  认证: 由 MCP 客户端配置传入 Token                │
│  传输: stdio JSON-RPC → localhost HTTP API       │
│  审计: 继承 HTTP API 层                           │
└─────────────────────────────────────────────────┘
```

### 7.2 Token 与权限

- **Token 生成**：桌面实例首次启动时生成随机 Token，存储在 `userData` 目录下的配置文件中。
- **Token 存储安全（平台特定）**：
  - **Windows**（主要平台）：使用 Windows ACL 限制配置文件仅当前用户可读写；优先使用 DPAPI（`CryptProtectData`）加密 Token 明文，不以明文存储。
  - **macOS / Linux**：配置文件权限设为 `0600`（仅所有者可读写）。
- **Token 范围**：所有 Token 具有相同权限（v1 不做细粒度角色划分）。
- **Token 轮换**：未来通过桌面 UI 提供 Token 重置功能；重置后旧 Token 立即失效。
- **远程访问**：v1 默认禁止非 localhost 访问。未来远程访问需额外配置 TLS、强认证和速率限制（ROADMAP 3.0）。

### 7.3 禁止返回的信息

以下信息在任何 CLI 输出、MCP tool 返回值和 HTTP API 响应中**严禁出现**：

| 禁止项 | 原因 |
|--------|------|
| Cookie / Session 数据 | 永不暴露 |
| `Account.partition` | Session 隔离实现细节 |
| `Account.health.cooldownUntil` | 内部调度细节 |
| `Account.seedanceQuota` | 内部额度预测 |
| `Account.scheduling` | 内部调度配置 |
| `Account.avatar` | 可能含认证信息 |
| `Task.runtime.conversationUrl` | 豆包内部页面 URL |
| `Task.lock` | 内部租约实现 |
| `Task.assignedAccountId` | 内部调度结果，Agent 不应直接操作 |
| `Task.source` | 内部任务来源 |
| `Task.batchId` | 内部批次标识 |
| `DownloadJob.saveDir` / `filePath` | 本地绝对路径 |
| `TaskArtifact.url`（原始） | 远程地址可能含认证信息 |
| `LogEntry` 完整结构 | 内部诊断日志 |
| CSS 选择器 / DOM 结构 | 内部页面适配实现 |
| Webview 状态 / Electron API | 内部运行时 |
| Zustand Store 内部结构 | 内部状态管理 |
| 堆栈 / 内部路径 | 错误响应不包含 |
| 豆包内部 URL | 包括 conversation URL、API 端点等 |

### 7.4 审计日志

所有写操作（`tasks create`、`tasks cancel`）必须记录：

| 审计字段 | 说明 |
|---------|------|
| `timestamp` | 操作时间 |
| `source` | 调用来源：`cli` / `mcp` / `http` |
| `requestId` | 客户端幂等键 |
| `taskId` | 关联任务 ID |
| `action` | 操作类型：`create` / `cancel` |
| `result` | 结果：`success` / `error` |
| `errorCode` | 失败时的 ApiError.code |

审计日志存储在内部目录，不通过公共 API 暴露。

### 7.5 响应序列化与参数校验要求

Schema 的 `additionalProperties: false` 仅约束已送入 JSON Schema 校验器的对象，不能自动约束 CLI 参数解析器，也不能自动过滤服务端内部对象的序列化输出。为确保安全边界不被绕过，各层必须显式实施以下措施：

#### 7.5.1 CLI 参数校验

- CLI 参数解析器必须维护与 Schema 字段对应的白名单选项表。
- 未知选项（不在白名单中的 `--flag`）必须报错退出，返回 `invalid_request` 错误，不得静默忽略。
- 必填选项缺失时报错退出。
- `mode` 为 `video` 时校验 `--model`/`--duration`/`--aspect-ratio` 三者均存在；非 `video` 时拒绝三者。
- `--input-asset-ids` 的值如以 `/` 或 `C:\` 开头，CLI 层面即拒绝，不等服务端运行时校验。

#### 7.5.2 HTTP / MCP 响应序列化

- 服务端不得将内部领域对象（`Task`、`Account`、`TaskArtifact`、`DownloadJob` 等）直接 `JSON.stringify` 后返回。
- 必须通过显式的公共 DTO 映射函数（如 `Task → TaskSnapshot`、`Account → AccountSummary`）进行白名单字段提取后序列化。
- 映射函数必须显式列出允许的字段，禁止使用 spread/`Object.assign` 从内部对象复制全部属性。
- 序列化后的响应应通过 Schema 校验（如 AJV）做运行时验证，确保不泄露内部字段。
- 错误响应同理：`ApiError.message` 不得包含堆栈、内部路径或豆包页面细节。

#### 7.5.3 请求校验

- HTTP/MCP 层收到请求后，必须通过 Schema 校验请求体，拒绝 `additionalProperties: false` 以外的字段。
- 校验失败时返回 `invalid_request` 错误，`details.field` 指明非法字段名。
- 校验必须在业务逻辑执行前完成，不得先执行后校验。

## 8. 未来实施顺序与兼容性规则

### 8.1 实施顺序

```text
当前: G-303 设计文档 (本文件)
  ↓
Step 1: 本地 HTTP API (localhost)
  - 实现 GET /capabilities、POST /tasks、GET /tasks/{id} 等 RESTful 端点
  - 实现 Token 认证和审计日志
  - 复用 G-302 Schema 做请求/响应校验
  ↓
Step 2: CLI (doubao-studio)
  - 基于 HTTP API 实现 CLI 命令
  - 支持 --format json|table 输出
  - 支持 --follow 事件流模式
  ↓
Step 3: MCP Server (stdio)
  - 基于 HTTP API 实现 MCP tools
  - 通过 stdio JSON-RPC 与 MCP 客户端通信
  ↓
Step 4: 资产上传 API (POST /assets)
  - 实现 inputAssetIds 的上传流程
  ↓
Step 5: AccountSummary 只读视图
  - 新增 account-summary.schema.json
  - 实现 accounts list/show 端点和命令
  ↓
Step 6: Webhook 签名与重放保护
  - 实现 Webhook 注册、签名、投递和死信
```

**前提条件**：
- Step 1–3 需要 Core 分层（ROADMAP 2.1）完成，HTTP API 复用 Core Service 而非直接操作数据文件。
- Step 4–6 可在 Step 1–3 稳定后独立推进。

### 8.2 兼容性规则

| 变更类型 | v1 内兼容 | 需要升 v2 | 说明 |
|---------|----------|----------|------|
| 新增 CLI 命令 | ✅ | — | 如 `doubao-studio accounts list` |
| 新增 MCP tool | ✅ | — | 如 `accounts_list` |
| 新增可选字段到 Schema | ✅ | — | 如 `CreateTaskRequest` 新增可选字段 |
| 新增枚举值 | ✅ | — | 客户端必须处理未知值 |
| 新增 Schema 文件 | ✅ | — | 如 `account-summary.schema.json` |
| 新增 `optionalCapabilities` 值 | ✅ | — | 客户端不应假设能力一定存在 |
| 删除已有 CLI 命令 | — | ✅ | 破坏性 |
| 删除已有 MCP tool | — | ✅ | 破坏性 |
| 删除已有 Schema 字段 | — | ✅ | 破坏性 |
| 重命名 CLI 命令或 MCP tool | — | ✅ | 破坏性 |
| 重命名 Schema 字段 | — | ✅ | 破坏性 |
| 可选字段收紧为必填 | — | ✅ | 破坏性 |
| 改变枚举值语义 | — | ✅ | 破坏性 |
| 收紧 `additionalProperties` | — | ✅ | 破坏性 |
| 改变 CLI 选项的默认值 | ✅（附迁移说明） | — | 需在文档中记录 |

### 8.3 CLI 与 MCP 的命名一致性规则

1. **CLI 命令名**使用空格分隔的子命令（如 `tasks create`），**MCP tool name** 使用下划线连接（如 `tasks_create`）。
2. **CLI 选项**使用 `--kebab-case`（如 `--request-id`），**MCP inputSchema 字段**使用 `camelCase`（如 `requestId`），与 Schema 字段名一致。
3. **CLI 位置参数**对应 MCP inputSchema 的必填字段（如 `tasks get <taskId>` → `{ taskId }`）。
4. 新增命令或 tool 时，必须同时在本文档的 CLI 命令表（§2.1）和 MCP tool 总览表（§3.1）中登记。

### 8.4 Schema 引用规则

MCP tool 的 `inputSchema` 优先引用已有 Schema：
- `tasks_create` 的 `inputSchema` 直接 `$ref` 引用 `create-task-request.schema.json`
- 其他 tool 的 `inputSchema` 如与已有 Schema 字段重叠，使用与 Schema 相同的字段名、类型和约束
- 不在 MCP tool 中引入 Schema 之外的字段

## 9. CLI / MCP / Schema 字段一致性检查清单

以下清单用于验证三层的字段名称完全一致。

### 9.1 CreateTaskRequest 字段

| Schema 字段 | CLI 选项 | MCP inputSchema 字段 | 一致 |
|-------------|---------|---------------------|------|
| `requestId` | `--request-id` | `requestId` | ✅ |
| `mode` | `--mode` | `mode` | ✅ |
| `prompt` | `--prompt` | `prompt` | ✅ |
| `videoConfig.model` | `--model` | `videoConfig.model` | ✅ |
| `videoConfig.duration` | `--duration` | `videoConfig.duration` | ✅ |
| `videoConfig.aspectRatio` | `--aspect-ratio` | `videoConfig.aspectRatio` | ✅ |
| `inputAssetIds` | `--input-asset-ids` | `inputAssetIds` | ✅ |
| `projectId` | `--project-id` | `projectId` | ✅ |
| `priority` | `--priority` | `priority` | ✅ |
| `dependsOnTaskIds` | `--depends-on` | `dependsOnTaskIds` | ✅ |
| `dependencyPolicy` | `--dependency-policy` | `dependencyPolicy` | ✅ |

### 9.2 TaskSnapshot 字段

| Schema 字段 | CLI 输出字段 | MCP 返回字段 | 一致 |
|-------------|-------------|-------------|------|
| `taskId` | `taskId` | `taskId` | ✅ |
| `status` | `status` | `status` | ✅ |
| `stage` | `stage` | `stage` | ✅ |
| `mode` | `mode` | `mode` | ✅ |
| `prompt` | `prompt` | `prompt` | ✅ |
| `videoConfig` | `videoConfig` | `videoConfig` | ✅ |
| `progress` | `progress` | `progress` | ✅ |
| `retry` | `retry` | `retry` | ✅ |
| `timestamps` | `timestamps` | `timestamps` | ✅ |
| `error` | `error` | `error` | ✅ |
| `actionRequired` | `actionRequired` | `actionRequired` | ✅ |
| `artifacts` | `artifacts` | `artifacts` | ✅ |
| `projectId` | `projectId` | `projectId` | ✅ |

### 9.3 TaskEvent 字段

| Schema 字段 | CLI 输出字段 | MCP 返回字段 | 一致 |
|-------------|-------------|-------------|------|
| `sequence` | `sequence` | `sequence` | ✅ |
| `eventId` | `eventId` | `eventId` | ✅ |
| `taskId` | `taskId` | `taskId` | ✅ |
| `timestamp` | `timestamp` | `timestamp` | ✅ |
| `eventType` | `eventType` | `eventType` | ✅ |
| `payload` | `payload` | `payload` | ✅ |

### 9.4 ArtifactDescriptor 字段

| Schema 字段 | CLI 输出字段 | MCP 返回字段 | 一致 |
|-------------|-------------|-------------|------|
| `artifactId` | `artifactId` | `artifactId` | ✅ |
| `taskId` | `taskId` | `taskId` | ✅ |
| `mediaType` | `mediaType` | `mediaType` | ✅ |
| `mimeType` | `mimeType` | `mimeType` | ✅ |
| `sizeBytes` | `sizeBytes` | `sizeBytes` | ✅ |
| `createdAt` | `createdAt` | `createdAt` | ✅ |
| `expiresAt` | `expiresAt` | `expiresAt` | ✅ |
| `validationState` | `validationState` | `validationState` | ✅ |
| `validatedAt` | `validatedAt` | `validatedAt` | ✅ |
| `downloadAvailable` | `downloadAvailable` | `downloadAvailable` | ✅ |
| `previewAvailable` | `previewAvailable` | `previewAvailable` | ✅ |
| `source` | `source` | `source` | ✅ |

### 9.5 ApiError 字段

| Schema 字段 | CLI 错误输出 | MCP 错误返回 | 一致 |
|-------------|-------------|-------------|------|
| `code` | `code` | `code` | ✅ |
| `message` | `message` | `message` | ✅ |
| `retryable` | `retryable` | `retryable` | ✅ |
| `suggestedWaitMs` | `suggestedWaitMs` | `suggestedWaitMs` | ✅ |
| `taskId` | `taskId` | `taskId` | ✅ |
| `actionRequired` | `actionRequired` | `actionRequired` | ✅ |
| `details` | `details` | `details` | ✅ |

## 10. 威胁模型摘要

> 本节为设计层面的威胁分析，不实现安全代码。详细实施安全方案由 Codex 在未来任务中负责。

| 威胁 | 影响 | 缓解措施 |
|------|------|---------|
| 任意文件读取 | Agent 通过资产上传或下载获取本机任意文件 | 资产 ID 不透明，服务端校验 ID 来源；下载只返回受控代理 URL，不返回原始路径 |
| Cookie / Session 泄露 | Agent 获取豆包账号凭证 | Schema `additionalProperties: false` 在 JSON 校验层面约束；服务端必须通过公共 DTO 白名单序列化响应（[§7.5](#75-响应序列化与参数校验要求)）；CLI/MCP 映射不暴露 `partition` |
| 任意 JavaScript 注入 | Agent 向 Webview 注入恶意脚本 | CLI/MCP 只通过 Schema 校验的参数提交任务，不接受 JS 代码或选择器 |
| 本地路径泄露 | Agent 推断本机文件结构 | 所有响应禁止包含 `saveDir`/`filePath`/绝对路径；错误消息不含堆栈 |
| 豆包内部 URL 泄露 | Agent 获取豆包页面或 API 地址 | Schema 禁止返回 `conversationUrl`；产物通过不透明 ID 和受控代理访问 |
| Token 泄露 | 未授权方调用本地 API | Windows 使用 ACL + DPAPI 加密存储（[§7.2](#72-token-与权限)）；macOS/Linux 使用 0600 权限；默认只监听 localhost；远程访问需额外 TLS 和认证 |
| 重放攻击 | Agent 重放旧请求 | 写操作使用 `requestId` 幂等键；未来 Webhook 使用 HMAC 签名 + 时间戳 |
| 账号信息泄露 | Agent 获取未脱敏账号信息 | `AccountSummary`（未来）仅暴露 `id`/`name`/`status`/`loginState`；禁止暴露 `avatar`/`partition`/`seedanceQuota`/`scheduling` |
| 速率滥用 | Agent 高频提交任务耗尽额度 | `rate_limited` 错误码 + `suggestedWaitMs`；服务端实施速率限制 |

## 11. ROADMAP 对齐说明

本设计与 `ROADMAP.md` §2.3 Agent 接入层的对应关系：

| ROADMAP 要求 | G-303 处理 |
|-------------|-----------|
| CLI 首批命令：health、accounts list、tasks create/get/cancel/retry、artifacts list/download | 本任务定义 tasks create/get/cancel、artifacts list/get；health 映射为 `capabilities show`；accounts list 和 retry 延后（见 §6.1） |
| MCP Server 工具：list_accounts、create_generation_task、get_task、cancel_task、retry_task、list_artifacts、download_artifact、subscribe_task_events | 本任务定义 `tasks_create`/`tasks_get`/`tasks_cancel`/`artifacts_list`/`artifacts_get`/`tasks_events`/`capabilities_show`/`tasks_lookup`；list_accounts、retry_task、download_artifact 延后 |
| 事件流或游标轮询 | `tasks events --since` + `--follow` 实现游标轮询（§2.7） |
| requestId 幂等键 | 全链路覆盖（§4.1） |
| 人工验证建模为 action_required | `ActionRequired` 结构覆盖 6 种类型（§5.3） |
| 素材导入协议 | 延后设计方向（§6.2） |
| capability discovery | `capabilities show` 命令（§2.2） |
| OpenAPI/JSON Schema | G-302 已提供 JSON Schema v1；OpenAPI 待 HTTP API 实施时生成 |

**与 ROADMAP 的差异说明**：
- ROADMAP 列出的 `retry_task` 在 G-303 中未映射为独立命令。取消后重新提交使用 `tasks create` + 新 `requestId` 即可实现重试语义，避免引入与 cancel 语义冲突的独立 retry 命令。如未来需要原地重试（保持同一 taskId），再增加 `tasks retry` 命令。
- ROADMAP 列出的 `download_artifact` 在 G-303 中映射为 `artifacts get`（返回 `ArtifactDescriptor`）。实际下载端点（返回二进制流）属于 HTTP API 实施范畴，不在本设计文档中定义。CLI `artifacts get` 只返回描述符，不直接下载文件。

## 12. 不涉及清单

本任务**不实现**以下内容：

- ❌ HTTP Server / RESTful 端点
- ❌ CLI 可执行程序
- ❌ MCP Server 运行时
- ❌ `src/utils/doubaoBridge.ts` 修改
- ❌ `src/components/BrowserPanel.tsx` 修改
- ❌ Electron 主进程业务逻辑修改
- ❌ IPC channel 修改
- ❌ preload 修改
- ❌ `package.json` 或锁文件修改
- ❌ Cookie / Session / Webview / DOM 操作
- ❌ 豆包内部接口调用
- ❌ 视频 URL 或下载链路修改
- ❌ 运行时代码变更

本任务**只产出**：

- ✅ `docs/architecture/cli-mcp-mapping.md`（本文件）
- ✅ 可选：`tests/unit/capabilitySchema.test.ts` 自检补充（如有 Schema 变更）
