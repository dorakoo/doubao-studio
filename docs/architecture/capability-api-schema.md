# Capability API Schema v1 设计文档

> **状态**：设计阶段，待 Codex 审查批准后方可实施
> **任务**：G-302 Capability API Schema 初稿
> **基线**：`9b1c28f`
> **约束**：本文件仅提供设计文档和 JSON Schema，不实施 HTTP、CLI、MCP Server，不修改业务运行逻辑

## 1. 设计目标

为外部 Agent、未来 CLI 和 MCP Server 定义稳定的 v1 公共协议。公共协议与 Electron、DOM、Webview、Cookie、Zustand、本机绝对路径和豆包内部 URL 完全解耦。

### 1.1 设计原则

1. **协议先行**：JSON Schema 是运行时协议的权威来源；G-301 的纯类型 contracts 包不隐式执行运行时校验。
2. **异步优先**：生成任务以 `submit → taskId → events/status → artifacts` 形式交互，调用方无需维持长连接等待。
3. **不透明标识**：资产输入输出统一使用不透明 ID，通过受控 API 上传、预览和下载。
4. **可扩展枚举**：所有枚举值列表均为"已知值子集"，客户端必须处理未知值。
5. **安全边界**：公共协议不暴露 DOM、Cookie、Webview、Zustand、本地绝对路径、CSS 选择器或豆包内部 URL。

## 2. Schema 清单

| Schema | `$id` | 用途 |
|--------|-------|------|
| [CapabilityManifest](../../schemas/capability/v1/capability-manifest.schema.json) | `https://doubao.studio/schemas/capability/v1/capability-manifest.schema.json` | 服务能力清单 |
| [CreateTaskRequest](../../schemas/capability/v1/create-task-request.schema.json) | `https://doubao.studio/schemas/capability/v1/create-task-request.schema.json` | 创建任务请求 |
| [TaskSnapshot](../../schemas/capability/v1/task-snapshot.schema.json) | `https://doubao.studio/schemas/capability/v1/task-snapshot.schema.json` | 任务公共视图快照 |
| [TaskEvent](../../schemas/capability/v1/task-event.schema.json) | `https://doubao.studio/schemas/capability/v1/task-event.schema.json` | 任务事件 |
| [ArtifactDescriptor](../../schemas/capability/v1/artifact-descriptor.schema.json) | `https://doubao.studio/schemas/capability/v1/artifact-descriptor.schema.json` | 产物描述符 |
| [ApiError](../../schemas/capability/v1/api-error.schema.json) | `https://doubao.studio/schemas/capability/v1/api-error.schema.json` | 统一错误响应 |

所有 Schema 使用 JSON Schema Draft 2020-12，具有稳定 `$id`、`title`、`type`、`required`、`additionalProperties: false` 和可执行 `examples`。

## 3. 协议语义详解

### 3.1 CapabilityManifest

客户端首次连接时获取服务能力清单，包含：

- `protocolVersion`：协议版本（v1 系列以 `1.` 开头）
- `serviceVersion`：豆包工作室应用版本
- `supportedModes`：支持的生成模式（chat / image / video / music）
- `models`：视频模型列表及其参数范围（时长、比例）
- `concurrencyLimit`：最大并发任务数
- `actionTypes`：支持的人工动作类型
- `optionalCapabilities`：可选能力标识（csv_import / batch_operations / webhooks 等）
- `health`：实例健康状态

### 3.2 CreateTaskRequest

创建任务的异步请求。关键语义：

1. **幂等键**：`requestId` 由客户端生成（建议 UUID v4），保留期默认 24 小时。相同 `requestId` 重复提交时返回同一任务，不创建新任务。
2. **禁止字段**：客户端不得直接指定账号、Cookie、会话 URL、partition 或本地文件路径。
3. **资产引用**：输入资产通过 `inputAssetIds` 使用不透明 ID 引用，资产通过受控上传 API 获取 ID。
4. **依赖策略**：`dependsOnTaskIds` + `dependencyPolicy` 定义前置任务依赖。
5. **异步返回**：成功只返回已接收的任务快照或任务 ID，绝不等待视频生成完成。

### 3.3 TaskSnapshot

任务的公共视图快照。与内部 `Task` 实体的关键差异：

| 内部 Task 字段 | 公共 TaskSnapshot 处理 |
|----------------|----------------------|
| `assignedAccountId` | **不暴露** — 由服务端自动调度 |
| `runtime.conversationUrl` | **不暴露** — 豆包内部页面 URL |
| `lock` | **不暴露** — 内部租约实现 |
| `partition` | **不暴露** — Session 隔离实现 |
| `result` / `outputs`（原始 URL） | **不暴露** — 通过 `artifacts` 使用不透明 ID |
| `source` | **不暴露** — 内部任务来源 |
| `batchId` | **不暴露** — 内部批次标识 |

公共快照新增：
- `progress`：进度百分比和消息
- `retry`：重试次数和可重试性
- `actionRequired`：需要人工处理时的动作指引
- `artifacts`：产物描述符列表

### 3.4 TaskEvent

任务事件采用单调递增 `sequence` 实现断线续订：

```
客户端 → 服务端: GET /tasks/events?since=42
服务端 → 客户端: [event{sequence=43}, event{sequence=44}, ...]
```

**去重语义**：
- 投递模型：至少一次（at-least-once）
- 去重依据：`eventId`（全局唯一）
- 客户端应记录已处理的 `eventId` 集合，收到重复事件时忽略

**游标语义**：
- 客户端发送上次收到的 `lastSequence` 作为 `since` 参数
- 服务端返回所有 `sequence > lastSequence` 的事件
- `sequence` 单调递增，不保证连续（可能有间隙）
- 进程重启后 `sequence` 从 0 重新开始；客户端检测到 `sequence` 回退时应重新全量同步

**事件类型**：

| eventType | 触发时机 | payload 关键字段 |
|-----------|---------|-----------------|
| `task.created` | 任务创建成功 | — |
| `task.started` | 任务开始执行 | — |
| `task.stage_changed` | 执行阶段变更 | `stage` |
| `task.progress` | 进度更新 | `percent`, `message` |
| `task.paused` | 任务暂停 | — |
| `task.resumed` | 任务恢复 | — |
| `task.cancelled` | 任务取消 | — |
| `task.failed` | 任务失败 | `error` |
| `task.done` | 任务完成 | — |
| `action_required` | 需要人工处理 | `actionType` |
| `action_resolved` | 人工处理完成 | — |
| `artifact.discovered` | 发现新产物 | `artifactId` |
| `artifact.validated` | 产物校验完成 | `artifactId` |
| `artifact.downloaded` | 产物下载完成 | `artifactId` |

### 3.5 ArtifactDescriptor

产物描述符。关键安全约束：

- **不透明 ID**：`artifactId` 不包含内部路径或 URL
- **禁止绝对路径**：不暴露 `filePath`、`saveDir`
- **禁止原始 URL**：不暴露可能含认证信息的远程地址；通过受控下载 API 获取安全代理 URL
- **过期感知**：`expiresAt` 标识产物可能过期的截止时间；`validationState` 标识当前校验状态
- **能力声明**：`downloadAvailable` 和 `previewAvailable` 声明当前是否可下载/预览

### 3.6 ApiError

统一错误响应。关键语义：

- **稳定错误码**：`code` 使用稳定枚举，不改变已有码的语义
- **可重试性**：`retryable` 标识当前错误是否可通过重试解决
- **建议等待**：`suggestedWaitMs` 为重试提供建议等待时间（如 rate_limited）
- **人工动作**：`actionRequired` 在错误需要人工干预时出现（如验证、登录失效）
- **白名单 details**：仅允许 `field`、`limit`、`current` 三个诊断字段，不包含堆栈或内部状态

### 3.7 ActionRequired 人工动作

`action_required` 覆盖以下人工动作场景：

| 类型 | 触发场景 | 恢复方式 |
|------|---------|---------|
| `robot_verification` | 豆包页面弹出机器人验证 | 用户在桌面 UI 完成验证后自动恢复 |
| `face_restriction` | 人脸限制阻断生成 | 用户调整内容后重试 |
| `membership_required` | 需要会员权限 | 用户开通会员后重试 |
| `quota_exhausted` | 每日额度用完 | 次日额度刷新后重试或更换账号 |
| `login_expired` | 账号登录态过期 | 用户在桌面 UI 重新登录后重试 |
| `user_cancelled` | 用户主动取消 | 重新提交任务 |

**恢复流程**：
1. 任务进入 `waiting_verification` 状态，附带 `actionRequired`
2. 客户端收到 `action_required` 事件，提示用户处理
3. 用户在桌面 UI 完成处理（验证、登录等）
4. 服务端检测到处理完成，发送 `action_resolved` 事件
5. 任务自动恢复执行或等待客户端调用 retry

## 4. 内部模型到公共 DTO 字段映射

### 4.1 Account → 公共视图

内部 `Account` 不直接暴露。未来通过 `AccountSummary` 提供受限视图：

| 内部 Account 字段 | 公共处理 | 原因 |
|-------------------|---------|------|
| `id` | 暴露（公共 ID） | — |
| `name` | 暴露 | — |
| `status` | 暴露 | — |
| `health.loginState` | 暴露（简要） | — |
| `health.cooldownUntil` | **不暴露** | 内部调度细节 |
| `partition` | **不暴露** | Session 隔离实现 |
| `seedanceQuota` | **不暴露** | 内部额度预测 |
| `scheduling` | **不暴露** | 内部调度配置 |
| `avatar` | **不暴露** | 可能含认证信息 |

### 4.2 Task → TaskSnapshot

见 [3.3 节](#33-tasksnapshot)。

### 4.3 TaskArtifact → ArtifactDescriptor

| 内部 TaskArtifact 字段 | 公共 ArtifactDescriptor 处理 | 原因 |
|------------------------|----------------------------|------|
| `id` | → `artifactId` | 重命名为不透明 ID |
| `url` | **不暴露** | 远程地址可能含认证信息 |
| `kind` | → `mediaType` | 重命名为公共术语 |
| `source` | 保留（诊断用） | — |
| `conversationUrl` | **不暴露** | 豆包内部页面 URL |
| `validation` | → `validationState` + `validatedAt` | 展平为公共字段 |

### 4.4 TaskErrorCode → ApiError.code

| 内部 TaskErrorCode | 公共 ApiError.code | 说明 |
|--------------------|--------------------|------|
| `cancelled` | `cancelled` | — |
| `verification` | `verification` | 附带 `actionRequired` |
| `quota_exhausted` | `quota_exhausted` | 附带 `actionRequired` + `details.limit/current` |
| `membership_required` | `membership_required` | 附带 `actionRequired` |
| `face_restricted` | `face_restricted` | 附带 `actionRequired` |
| `content_rejected` | `content_rejected` | — |
| `network` | `network` | `retryable: true` |
| `timeout` | `timeout` | `retryable: true` + `suggestedWaitMs` |
| `page_changed` | `page_changed` | — |
| `submission_failed` | `submission_failed` | — |
| `generation_failed` | `generation_failed` | — |
| `output_missing` | `output_missing` | — |
| `unknown` | `unknown` | — |
| — | `task_not_found` | 公共 API 新增 |
| — | `artifact_not_found` | 公共 API 新增 |
| — | `artifact_expired` | 公共 API 新增 |
| — | `rate_limited` | 公共 API 新增 |
| — | `service_unavailable` | 公共 API 新增 |
| — | `invalid_request` | 公共 API 新增 |

### 4.5 禁止暴露清单

以下内部字段/概念在任何公共协议中**严禁出现**：

- `Account.partition` — Session 隔离实现
- `Account.health.cooldownUntil` — 内部调度细节
- `Task.runtime.conversationUrl` — 豆包内部页面 URL
- `Task.lock` — 内部租约实现
- `DownloadJob.saveDir` / `filePath` — 本地绝对路径
- `TaskArtifact.url`（原始）— 远程地址可能含认证信息
- `LogEntry` 完整结构 — 内部诊断日志
- Cookie、Session 数据
- CSS 选择器、DOM 结构
- Webview 状态、Electron API
- Zustand Store 内部结构

## 5. 兼容性策略

### 5.1 版本化

- Schema v1 使用 `$id` 中的 `/v1/` 路径标识主版本
- 协议版本通过 `CapabilityManifest.protocolVersion` 声明
- 公共 API 遵循语义化版本：`protocolVersion` 以 `1.x.x` 形式标识 v1 系列

### 5.2 向后兼容规则

| 变更类型 | 兼容性 | 处理方式 |
|---------|--------|---------|
| 新增可选字段 | 向后兼容 | v1 内可直接新增 |
| 新增枚举值 | 向后兼容 | 客户端必须处理未知值 |
| 删除字段 | **破坏性** | 必须升主版本（v2） |
| 重命名字段 | **破坏性** | 必须升主版本 |
| 收紧类型（可选→必填） | **破坏性** | 必须升主版本 |
| 改变枚举语义 | **破坏性** | 必须升主版本 |
| 收紧 `additionalProperties` | **破坏性** | 必须升主版本 |

### 5.3 可扩展枚举策略

所有使用 `enum` 的字段在文档中明确标注"客户端必须处理未知值"。处理策略：

1. **已知值**：按定义的逻辑处理
2. **未知值**：
   - 枚举类字段（如 status、stage、eventType）：记录日志，按最保守的通用路径处理
   - 错误码：视为 `unknown`（不可重试）
   - 动作类型：视为需要人工处理，提示用户查看桌面 UI

### 5.4 幂等流程

```
客户端                          服务端
  |                               |
  | POST /tasks                   |
  | { requestId: "abc-123", ... } |
  |------------------------------>|
  |                               |--- 查找 requestId 缓存
  |                               |--- 未找到 → 创建任务
  |                               |--- 存储 requestId → taskId 映射
  |<------------------------------|
  | 200 OK { taskId, status }     |
  |                               |
  |  （网络重试）                   |
  | POST /tasks                   |
  | { requestId: "abc-123", ... } |
  |------------------------------>|
  |                               |--- 查找 requestId 缓存
  |                               |--- 找到 → 返回原 taskId
  |<------------------------------|
  | 200 OK { taskId, status }     |
```

**requestId 作用域**：
- 作用域：单个服务实例
- 保留期：默认 24 小时
- 保留期过后：相同 `requestId` 创建新任务（旧任务不受影响）
- 进程重启：`requestId` 缓存丢失，相同 `requestId` 创建新任务

## 6. 非法输入案例

### 6.1 CreateTaskRequest — 包含禁止字段

```json
{
  "requestId": "abc-123",
  "mode": "video",
  "prompt": "测试",
  "accountId": "acc_001",
  "cookie": "session=xxx"
}
```

**拒绝原因**：`additionalProperties: false`，`accountId` 和 `cookie` 不在允许字段列表中。

### 6.2 CreateTaskRequest — 缺少必填字段

```json
{
  "mode": "video",
  "prompt": "测试"
}
```

**拒绝原因**：缺少必填字段 `requestId`。

### 6.3 CreateTaskRequest — 传递本地文件路径

```json
{
  "requestId": "abc-123",
  "mode": "video",
  "prompt": "测试",
  "inputAssetIds": ["/home/user/image.png"]
}
```

**拒绝原因**：虽然 Schema 层面 `inputAssetIds` 接受任意字符串，但服务端运行时校验会拒绝以 `/` 或 `C:\` 开头的路径。资产 ID 必须通过受控上传 API 获取。此约束在文档和服务端实现中强制执行。

### 6.4 TaskSnapshot — 包含内部字段

```json
{
  "taskId": "task_001",
  "status": "generating",
  "stage": "generating",
  "mode": "video",
  "prompt": "测试",
  "retry": { "attempt": 1, "retryable": true },
  "timestamps": { "createdAt": "...", "updatedAt": "..." },
  "assignedAccountId": "acc_001",
  "conversationUrl": "https://www.doubao.com/chat/?conv=xxx"
}
```

**拒绝原因**：`additionalProperties: false`，`assignedAccountId` 和 `conversationUrl` 不在允许字段列表中。

### 6.5 ApiError — 包含堆栈信息

```json
{
  "code": "unknown",
  "message": "Error: at Object.<anonymous> (/main/ipc/tasks.ts:123:45)",
  "retryable": false,
  "stack": "Error: ...\n    at ..."
}
```

**拒绝原因**：`additionalProperties: false`，`stack` 不在允许字段列表中。`message` 不应包含堆栈或内部路径。

## 7. 兼容性矩阵

| 变更 | v1 内兼容 | 需要升 v2 |
|------|----------|----------|
| 新增可选字段到 Schema | ✅ | — |
| 新增枚举值 | ✅ | — |
| 新增 Schema 文件 | ✅ | — |
| 新增 optionalCapabilities 值 | ✅ | — |
| 删除已有字段 | — | ✅ |
| 重命名字段 | — | ✅ |
| 可选字段收紧为必填 | — | ✅ |
| 改变枚举值语义 | — | ✅ |
| 收紧 `additionalProperties` | — | ✅ |

## 8. 事件续订流程

```
客户端                              服务端
  |                                   |
  | GET /tasks/events?since=42        |
  |---------------------------------->|
  |                                   |--- 查找 sequence > 42 的事件
  |                                   |--- 事件存在 → 返回事件列表
  |<----------------------------------|
  | 200 OK [event{seq=43}, ...]       |
  |                                   |
  |  （处理事件，记录 lastSeq=50）      |
  |                                   |
  | GET /tasks/events?since=50        |
  |---------------------------------->|
  |                                   |--- 查找 sequence > 50 的事件
  |                                   |--- 无新事件 → 返回空列表
  |<----------------------------------|
  | 200 OK []                         |
  |                                   |
  |  （断线后重连）                     |
  | GET /tasks/events?since=50        |
  |---------------------------------->|
  |                                   |--- 查找 sequence > 50 的事件
  |                                   |--- 返回累积的事件（可能含重复 eventId）
  |<----------------------------------|
  | 200 OK [event{seq=51}, ...]       |
  |                                   |
  |  （客户端按 eventId 去重）          |
```

## 9. 人工动作恢复流程

```
任务执行中
    |
    v
检测到需要人工验证
    |
    v
任务状态 → waiting_verification
发送 action_required 事件
    |
    +---> 客户端收到事件
    |       |
    |       v
    |     提示用户处理
    |       |
    |       v
    |     用户在桌面 UI 完成验证
    |       |
    |       v
    |     桌面 UI 通知服务端
    |       |
    |       v
    |     服务端检测到验证完成
    |       |
    |       v
    |     发送 action_resolved 事件
    |       |
    |       v
    |     任务自动恢复执行
    |
    +---> 超时未处理
            |
            v
          任务保持 waiting_verification
          客户端可调用 retry 重新触发
```

## 10. 安全约束总结

| 约束 | 说明 |
|------|------|
| 禁止暴露 partition | Session 隔离是内部实现 |
| 禁止暴露 conversationUrl | 豆包内部页面 URL |
| 禁止暴露 saveDir / filePath | 本地绝对路径 |
| 禁止暴露原始产物 URL | 可能含认证信息 |
| 禁止暴露 Cookie / Session | 永不暴露 |
| 禁止暴露 CSS 选择器 / DOM | 内部页面适配实现 |
| 禁止暴露 Webview 状态 | 内部运行时 |
| 禁止暴露 Zustand Store | 内部状态管理 |
| 禁止暴露堆栈 / 内部路径 | 错误响应不包含 |
| 资产使用不透明 ID | 通过受控 API 上传/下载 |
| requestId 实现幂等 | 防止重复创建任务 |

## 11. 未决问题

1. **AccountSummary Schema**：当前 v1 未定义公共账号视图。G-303 CLI/MCP 映射设计时可能需要补充。
2. **资产上传 API**：`inputAssetIds` 的上传协议未在本任务中定义，留待 G-303 设计。
3. **Webhook 签名**：Webhook 作为 optionalCapabilities 声明，但签名和重放保护细节留待 G-303。
4. **Schema 运行时校验器**：未来如需运行时校验（如 AJV），应作为独立的双格式（CJS/ESM）包，不混入 G-301 的纯声明包。
5. **事件存储持久化**：`sequence` 在进程重启后从 0 开始的设计是否足够，需要在 G-303 中结合实际存储方案确认。
6. **速率限制响应**：`rate_limited` 错误码的 `suggestedWaitMs` 来源（固定值 vs Retry-After 头）待实施时确定。
