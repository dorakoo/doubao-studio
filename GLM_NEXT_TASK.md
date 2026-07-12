# GLM 下一任务：G-302

当前只执行 `G-302 Capability API Schema 初稿`。这是外部 Agent 能力协议设计任务，不实现 HTTP、CLI、MCP Server，不修改业务运行逻辑。

## 基线与分支

1. 基线提交：`8ec9b07`（G-301 经 Codex 审查后的 contracts 设计）。
2. 从该提交创建独立分支 `glm/g-302-capability-schema`。
3. 开始前确认工作区干净，并阅读：
   - `ROADMAP.md` 的 Agent/平台化章节
   - `AGENT_EXECUTION_PLAN.md` 的 G-302、G-303
   - `docs/architecture/shared-types-migration.md`
   - 当前 `src/types/index.ts`、`main/preload.ts` 和任务/产物相关 IPC

## 目标

为其他 Agent、未来 CLI 和 MCP Server 定义稳定的 v1 公共协议。公共协议必须与 Electron、DOM、Webview、Cookie、Zustand、本机绝对路径和豆包内部 URL 解耦。

## 交付物

只新增或修改以下设计资产：

- `docs/architecture/capability-api-schema.md`
- `schemas/capability/v1/capability-manifest.schema.json`
- `schemas/capability/v1/create-task-request.schema.json`
- `schemas/capability/v1/task-snapshot.schema.json`
- `schemas/capability/v1/task-event.schema.json`
- `schemas/capability/v1/artifact-descriptor.schema.json`
- `schemas/capability/v1/api-error.schema.json`
- 可新增一个不依赖第三方包的 schema 结构自检脚本及测试；不要新增依赖

所有 Schema 使用 JSON Schema Draft 2020-12，具有稳定 `$id`、`title`、`type`、`required`、`additionalProperties` 策略和可执行 examples。

## 必须定义的协议语义

1. `CapabilityManifest`：协议版本、服务版本、支持的生成模式、模型、比例、时长、并发限制、人工动作类型和可选能力。
2. `CreateTaskRequest`：客户端 `requestId` 幂等键、生成模式、提示词、配置、输入资产 ID、项目 ID、可选优先级；禁止客户端直接指定账号、Cookie 或会话 URL。
3. `TaskSnapshot`：公共任务 ID、状态、阶段、进度、重试信息、时间戳、结构化错误、人工动作、产物摘要；不得直接暴露内部 `Task`。
4. `TaskEvent`：单调递增 `sequence`、事件 ID、任务 ID、时间戳、事件类型和 payload；规定断线续订 cursor 语义与至少一次投递下的去重方式。
5. `ArtifactDescriptor`：公共产物 ID、媒体类型、大小、创建/过期时间、预览/下载能力；禁止绝对路径和原始带认证 URL。
6. `ApiError`：稳定错误码、可读消息、是否可重试、建议等待时间、关联任务 ID、details 白名单。
7. 明确定义 `action_required`，至少覆盖机器人验证、人脸限制、会员限制、额度耗尽、登录失效和用户取消；说明人工处理后如何恢复或重新提交。
8. 创建任务采用异步模型：成功只返回已接收的任务快照或任务 ID，绝不等待视频生成完成。

## 兼容与安全约束

- Schema v1 新增字段默认保持向后兼容；删除、重命名、收紧类型或改变枚举语义必须升主版本。
- 对可扩展枚举说明未知值处理策略，避免 Agent 因新增状态崩溃。
- `requestId` 的作用域、保留期、重复请求响应必须明确。
- 资产输入输出统一使用不透明 ID；未来通过受控 API 上传、预览和下载。
- 禁止出现 `partition`、`conversationUrl`、`saveDir`、`filePath`、Cookie、Session、CSS selector、Webview/DOM 状态。
- 公共错误与内部错误建立映射表，但不泄露堆栈和豆包页面细节。
- JSON Schema 是运行时协议源；G-301 的纯类型 contracts 不得被改造成隐式运行时模块。

## 禁止事项

- 不实施 localhost 服务、鉴权、CLI 或 MCP tools。
- 不创建实际任务路由，不改 IPC channel，不改 Electron preload。
- 不移动现有类型，不改版本号、锁文件或 Release。
- 不引入 AJV、Zod 或其他依赖。
- 不推送、不合并。

## 验收

1. 六份 Schema 均可被标准 JSON 解析器读取，`$id` 唯一且引用可解析。
2. 每份 Schema 至少包含一个合法示例；文档至少包含非法输入案例及拒绝原因。
3. 文档提供内部模型到公共 DTO 的字段映射和明确的禁止暴露清单。
4. 文档包含兼容性矩阵、幂等流程、事件续订流程和人工动作恢复流程。
5. 执行：

```powershell
pnpm.cmd run validate
git diff --check
```

提交信息：

```text
docs(architecture): define capability api schema v1
```

交接报告必须列出基线 SHA、提交 SHA、Schema `$id` 清单、兼容性决策、未决问题和验证结果。
