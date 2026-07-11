# Doubao Studio 升级路线图

本文定义 2.0 之后的工程、产品和生态演进顺序。核心目标不是继续扩充单体桌面界面，而是把现有的账号、任务、调度、自动化和产物能力沉淀为可组合的平台能力，使桌面 UI、CLI、第三方 Agent 和未来服务端共享同一套执行内核。

具体任务分工、文件所有权和 Agent 交接规范见 [`AGENT_EXECUTION_PLAN.md`](./AGENT_EXECUTION_PLAN.md)。

## 目标架构

```text
Desktop UI / CLI / MCP Server / HTTP API / Third-party Agent
                         |
                 Versioned Capability API
                         |
        Task Service / Scheduler / Artifact Service
                         |
             Automation Runtime + Event Bus
                         |
              Provider Adapter Contract
                         |
        Doubao Adapter / Future Provider Adapters
                         |
           Browser Runtime / Session / Storage
```

### 架构原则

1. **能力与界面分离**：React 只展示状态和发出命令，不承载任务执行流程。
2. **单一执行入口**：手动操作、CSV、工作流、CLI 和 Agent 调用都提交同一种任务命令。
3. **协议先行**：任务、事件、错误和产物使用带版本号的共享 Schema，不直接暴露内部 Zustand 状态。
4. **异步优先**：生成任务以 `submit -> taskId -> events/status -> artifacts` 形式交互，调用方无需维持长连接等待。
5. **适配器隔离**：豆包页面变化只影响 Provider Adapter，不扩散到调度、存储和外部 API。
6. **默认本地安全**：外部接口默认仅监听 localhost，使用访问令牌、能力授权和审计日志。
7. **可恢复和幂等**：每条写命令携带 `requestId`，重复请求不创建重复任务；进程重启后可恢复状态。

## 版本路线

### 2.0.x 稳定性基线

目标：先让现有桌面生产流程具备可重构的可靠基础。

- 修正所有 IPC 注册边界，禁止模块导入时注册处理器或访问 `app.getPath()`。
- 账号删除采用明确策略：有关联任务时拒绝删除，或由用户确认解绑；禁止产生孤儿引用。
- 重试、重新指派、批量恢复全部进入统一调度器，不允许绕过依赖检查。
- 任务锁改为短租约加心跳续期，支持过期接管和明确的 owner 校验。
- 主进程增加单实例锁、未捕获异常记录和优雅退出流程。
- 账号重命名查重；列表读取仅在规范化数据发生变化时写盘。
- 修复 Webview 轮询定时器清理、下载状态写入放大和产物临时文件残留。
- 恢复 ESLint，并将类型检查、Lint、工程规则、单元测试和构建纳入统一 CI。

**退出标准**：核心流程连续运行 24 小时无重复执行；程序异常退出后任务可恢复；所有数据引用通过完整性检查。

### 2.1 Core 分层

目标：把业务逻辑从 UI、IPC 和网页组件中抽离。

- 新建 `shared/`：统一 Task、Account、Artifact、Error、Event 和 API DTO 类型。
- 新建 `core/`：TaskService、AccountService、Scheduler、ArtifactService、SettingsService。
- 新建 `runtime/`：AutomationRuntime、BrowserRuntime、SessionManager 和任务租约管理。
- Zustand Store 降为 UI projection，只订阅事件并调用服务，不再决定执行流程。
- Electron IPC 改为薄适配层：参数校验、调用 Core、返回标准结果。
- 将 JSON 存储封装为 Repository 接口，并由单一写入协调器串行处理读改写，避免桌面 UI、CLI 和 Agent 并发覆盖数据。
- 引入运行事件模型：`task.created`、`task.started`、`task.stage_changed`、`task.failed`、`artifact.discovered` 等。
- 明确单一所有者进程：桌面、CLI 和 Agent 客户端只能通过 Core/API 提交命令，不得直接读写数据文件。

**退出标准**：调度器和任务生命周期可在不启动 React 的情况下运行单元测试；主进程与渲染进程不再重复定义领域类型。

### 2.2 Automation SDK 与适配器

目标：把豆包自动化变成可测试、可替换的 Provider 能力。

- 定义 `ProviderAdapter` 接口：健康检查、创建会话、配置模式、上传素材、提交、检测阻断、轮询状态、提取产物。
- 将 `doubaoBridge.ts` 按能力拆分，禁止继续增长单个巨型脚本文件。
- 选择器、文本特征和网络规则进入可签名、可回滚的适配规则包。
- 增加页面 Fixture 和契约测试，豆包页面变更时能够定位具体失效能力。
- 每个自动化步骤返回结构化结果、耗时、证据和标准错误码。
- 支持 dry-run、自检和录制诊断，不提交真实生成任务也能验证适配器。

**退出标准**：Provider Adapter 可独立运行自检；页面适配失败不会导致任务长期无状态等待。

### 2.3 Agent 接入层

目标：让其他 Agent 通过稳定协议调用项目能力，而不是控制桌面 UI。

- 提供 `doubao-studio` CLI，首批命令：`health`、`accounts list`、`tasks create/get/cancel/retry`、`artifacts list/download`。
- 提供本地守护进程，使用版本化 JSON-RPC 或 HTTP API，共享桌面实例中的 Session 与调度器。
- 提供 MCP Server，将稳定能力暴露为工具：
  - `list_accounts`
  - `create_generation_task`
  - `get_task`
  - `cancel_task`
  - `retry_task`
  - `list_artifacts`
  - `download_artifact`
  - `subscribe_task_events`
- 为长任务提供事件流或游标轮询，Agent 不需要等待单次调用返回最终视频。
- 所有写操作支持 `requestId` 幂等键、调用来源、超时和取消信号。
- 把人工验证、登录失效和会员限制建模为 `action_required`，提供可查询的处理说明和显式恢复命令。
- 提供素材导入协议，将调用方文件、字节流或受控 URI 转成内部 Asset ID，禁止外部 Agent 直接传任意本地路径。
- 增加 capability discovery，调用方可查询当前版本支持的模型、比例、时长和适配器健康度。
- 生成 OpenAPI/JSON Schema 和最小 SDK，优先支持 TypeScript 与 Python。

**退出标准**：一个无桌面 UI 知识的 Agent 能完成“提交视频任务、观察进度、处理验证状态、获取产物”的完整闭环。

### 2.4 工作流与融合能力

目标：让项目成为可嵌入其他自动化系统的内容生产节点。

- 工作流升级为正式 DAG：输入输出端口、变量映射、条件分支、并发上限和失败策略。
- 支持 Webhook：任务完成、失败、需要人工验证、额度耗尽和产物下载完成。
- Webhook 具备签名、重放保护、投递 ID、指数退避和死信记录。
- 支持导入导出可移植 Workflow Manifest，不包含账号密钥和机器本地路径。
- 建立 Artifact URI 与元数据规范，支持本地文件、对象存储和第三方资产库。
- 增加插件清单、权限声明、版本约束和隔离执行；插件不能直接访问任意 Electron API。
- 为 n8n、Coze、Dify、LangGraph 等提供示例连接器，连接器只依赖公共 API。

**退出标准**：外部编排器可以把豆包工作室作为异步生产节点使用，升级桌面 UI 不破坏连接器。

### 3.0 平台化

目标：在安全边界清晰的前提下支持远程、多节点和团队协作。

- SQLite 正式替代 JSON 作为主存储，提供事务、迁移、索引和分页查询。
- Controller 与 Worker 分离；浏览器执行节点可注册、上报心跳和领取租约任务。
- 支持团队项目、角色权限、配额策略和完整审计日志。
- 支持远程 API，但必须配置 TLS、强认证、速率限制和密钥轮换。
- 建立扩展市场前先完成插件签名、沙箱、权限提示和兼容性测试。

## 公共能力协议

Agent 接入前必须稳定以下对象，建议使用 TypeScript 定义并生成 JSON Schema：

- `CapabilityManifest`：服务版本、Provider、模型、参数范围和健康状态。
- `CreateTaskRequest`：模式、提示词、素材引用、生成参数、项目、依赖和幂等键。
- `TaskSnapshot`：状态、阶段、进度、错误、运行次数和时间戳。
- `TaskEvent`：单调递增序号、事件类型、任务 ID、运行 ID 和载荷。
- `ArtifactDescriptor`：类型、来源、校验状态、下载方式、过期时间和内容摘要。
- `ApiError`：稳定错误码、可否重试、建议等待时间和人工处理指引。

内部 DOM、Cookie、Webview 引用、本地 Store 结构和远程原始下载地址不得成为公共协议的一部分。

## 测试与发布门槛

- 单元测试：调度、依赖 DAG、租约、额度、错误分类、幂等和数据迁移。
- 契约测试：Core Service、Provider Adapter、IPC、CLI、HTTP/MCP 工具输入输出。
- 集成测试：使用模拟 Provider 完成提交、等待、失败、取消和产物流程。
- 冒烟测试：真实账号仅运行低成本自检，不在 CI 中执行付费生成。
- 每次发布包含 Schema 版本、迁移说明、兼容矩阵和回滚方案。
- 公共 API 遵循语义化版本；破坏性修改只能进入新的 API 主版本。

## 当前优先队列

1. 完成 2.0.x 稳定性基线和回归测试。
2. 抽取共享类型与 Core Service，停止继续向组件和 IPC 堆业务逻辑。
3. 建立任务事件总线和 Repository 边界。
4. 拆分 `doubaoBridge.ts` 并定义 ProviderAdapter 契约。
5. 交付 CLI 作为第一种外部调用方式，验证公共能力设计。
6. 在 CLI 协议稳定后交付本地 API 与 MCP Server。
7. 最后建设可视化 DAG、连接器和远程 Worker，避免过早分布式化。

## 暂缓事项

- 在 Core 分层完成前，不建设大量新的 UI 页面。
- 在本地 API 权限模型完成前，不开放局域网或公网监听。
- 在 ProviderAdapter 契约稳定前，不同时接入多个网页平台。
- 在 SQLite 迁移与事件模型稳定前，不建设团队云同步。
- 不向第三方 Agent 暴露通用 JavaScript 注入、Cookie 读取或任意文件访问能力。
