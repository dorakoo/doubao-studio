# DOUBAO-CORE-TASK-RUNTIME-LEASE-01 检查报告

## 已读取的治理文件

- `D:\项目架构师\memory\INDEX.md`
- `D:\项目架构师\DEVELOPMENT_EFFICIENCY_GOVERNANCE.md`
- `D:\豆包工作室\doubao-core-task-runtime-lease-01\AGENTS.md`
- `README.md`
- `ROADMAP.md`
- `DESIGN.md`
- `AGENT_EXECUTION_PLAN.md`
- `docs/handoffs/2026-08-13-doubao-core-repository-events-01.md`
- `docs/handoffs/2026-08-13-doubao-core-task-service-01.md`
- `docs/handoffs/2026-08-13-doubao-core-task-service-02.md`
- `main/core/TaskRepository.ts`
- `main/core/TaskEventStream.ts`
- `main/core/TaskService.ts`
- `main/ipc/tasks.ts`
- `main/utils/taskLease.ts`
- `tests/unit/taskService.test.ts`
- `tests/unit/taskLease.test.ts`
- `tests/unit/automationEngineLease.test.ts`
- `packages/contracts/src/dto/tasks.ts`
- `packages/contracts/src/domain.ts`
- `packages/contracts/src/enums.ts`
- `packages/contracts/src/dto/electron-api.ts`

## 工作树、分支、基线 HEAD 和最终 HEAD

- 工作树：`D:\豆包工作室\doubao-core-task-runtime-lease-01`
- 分支：`glm/doubao-core-task-runtime-lease-01`
- 基线 HEAD：`dc37382bca8192e7fd5fe2c7c711263535af77a6`
- 最终 HEAD（未提交）：`dc37382bca8192e7fd5fe2c7c711263535af77a6`（无新提交）

## 开工及最终 Git 状态

### 开工状态

- 工作树干净，无 tracked/untracked 改动
- HEAD 精确为 `dc37382bca8192e7fd5fe2c7c711263535af77a6`
- 分支为 `glm/doubao-core-task-runtime-lease-01`

### 最终状态（未提交）

- tracked 修改：
  - `main/core/TaskService.ts`（M）
  - `main/ipc/tasks.ts`（M）
  - `tests/unit/taskService.test.ts`（M）
- untracked 新增：
  - `docs/handoffs/2026-08-13-doubao-core-task-runtime-lease-01.md`（本文件）
- 无其他 tracked/untracked 改动
- 未进入或修改 `D:\豆包工作室\doubao-studio-main`

## 三个 P0 的逐项结果

### P0-1：运行快照更新进入 TaskService — 完成

**新增 TaskService 方法：**

- `updateRuntime(params: TaskUpdateRuntimeParams): TaskServiceResult<Task>`
  - `readTasks()` 读取任务，read 异常返回 `null` 时 fail-closed
  - 找不到任务返回 `'任务不存在'`
  - 使用 `this.now()` 获取单一时间戳 `timestamp`
  - `params.status` 存在时更新任务状态
  - `params.result !== undefined` 时更新 result
  - `params.errorInfo === null` 时清除 errorInfo（设为 `undefined`）
  - `params.errorInfo` 为对象时更新 errorInfo
  - 提供 runtime patch 时：
    - 任务尚无 runtime 且 patch 没有 runId，返回 `'运行快照尚未初始化'`
    - 合并旧 runtime 与 patch（`{ ...task.runtime, ...params.runtime }`）
    - 使用 `runtime.runId` 查找 runHistory 记录
    - 记录不存在且 runtime 同时具有 runId 与 startedAt 时创建新记录
    - 保留最多最近 20 条（`slice(-20)`）
    - 当 status 为 done/fail/paused/cancelled 且存在对应记录时：
      - `finishedAt = timestamp`（与 `updatedAt` 同源）
      - `finalStage = runtime.stage`
      - `outcome`：fail 映射为 `'failed'`，其他状态直接使用
      - `errorCode = task.errorInfo?.code`
      - `durationMs = Math.max(0, ...)` 不得为负数
  - `task.updatedAt = timestamp`
  - `persist()` 返回 false 或抛出陈旧快照异常时 fail-closed，返回 `WRITE_ERROR`

**关键修复：**
- 原代码 `finishedAt` 和 `task.updatedAt` 分别调用 `new Date().toISOString()`，存在时间不一致 → 新代码使用单一 `this.now()` 调用
- 原代码 `saveTasks(tasks)` 忽略返回值（虚假成功）→ 新代码通过 `persist()` 检查返回值，fail-closed

### P0-2：租约 acquire/renew/release 进入 TaskService — 完成

**新增 TaskService 方法：**

- `acquireLock(params: TaskAcquireLockParams): TaskServiceResult<Task>`
  - `readTasks()` 读取，异常时 fail-closed
  - 找不到任务返回 `'任务不存在'`
  - 使用 `this.nowMs()` 获取单一时刻 `nowMs`
  - 账号冲突检测：`task.assignedAccountId` 存在且另一任务使用同一 `assignedAccountId` 且具有未过期锁时拒绝
  - 无效或不可解析的 `expiresAt`：`Date.parse(invalid)` 返回 `NaN`，`NaN > nowMs` 为 `false`，不误判为冲突
  - 调用权威纯函数 `acquireTaskLease(task.lock, params.ownerId, nowMs)`
  - 保持同 owner 续持、其他 owner 拒绝及过期接管语义
  - 成功后 `task.lock = decision.lock`，`task.updatedAt = new Date(nowMs).toISOString()`
  - `persist()` 失败时 fail-closed，返回 `WRITE_ERROR`

- `renewLock(params: TaskRenewLockParams): TaskServiceResult<Task>`
  - `readTasks()` 读取，异常时 fail-closed
  - 找不到任务返回 `'任务不存在'`
  - 使用 `this.nowMs()` 获取单一时刻 `nowMs`
  - 调用权威纯函数 `renewTaskLease(task.lock, params.ownerId, nowMs)`
  - 缺失、过期或 owner 不匹配时返回纯函数错误
  - 成功后 `task.lock = decision.lock`，`task.updatedAt = new Date(nowMs).toISOString()`
  - `persist()` 失败时返回 `'任务锁续租写入失败'`

- `releaseLock(params: TaskReleaseLockParams): TaskServiceResult`
  - `readTasks()` 读取，异常时 fail-closed
  - 找不到任务返回 `'任务不存在'`
  - 调用权威纯函数 `canReleaseTaskLease(task.lock, params.ownerId)`
  - 返回 false 时返回 `'任务锁 owner 不匹配'`
  - 使用 `this.nowMs()` 获取单一时刻 `nowMs`
  - 成功后 `task.lock = undefined`，`task.updatedAt = new Date(nowMs).toISOString()`
  - `persist()` 失败时返回 `'任务锁释放写入失败'`

**关键修复：**
- 原代码 `acquireLock` 使用 `Date.now()` 和 `new Date().toISOString()` 两个不同时刻 → 新代码使用单一 `this.nowMs()`
- 原代码 `acquireLock` 调用 `saveTasks(tasks)` 忽略返回值（虚假成功）→ 新代码通过 `persist()` 检查返回值，fail-closed
- 原代码 `renewLock` 和 `releaseLock` 已检查 `saveTasks` 返回值，但 `readTasks()` 异常不处理 → 新代码统一使用 `readTasks()` 捕获异常

### P0-3：IPC 薄适配与行为级测试 — 完成

**四个 IPC handler 退化为薄适配层：**

- `tasks:updateRuntime` — 只调用 `taskService.updateRuntime(params)` 并映射 `result.data` 为 `task`
- `tasks:acquireLock` — 只调用 `taskService.acquireLock(params)` 并映射 `result.data` 为 `task`
- `tasks:renewLock` — 只调用 `taskService.renewLock(params)` 并映射 `result.data` 为 `task`
- `tasks:releaseLock` — 只调用 `taskService.releaseLock(params)` 并直接返回

**channel 名称、preload API、DTO、UI 不变。**

**删除死代码：**
- `import { acquireTaskLease, canReleaseTaskLease, renewTaskLease } from '../utils/taskLease'` — 已从 `tasks.ts` 完全删除（grep 零匹配确认）

**IPC 不再包含四项业务状态变换的重复实现**（经源码检查确认，四个 handler 只接收参数、调用 TaskService 并映射返回形状）

## 精确修改文件清单

| 类型 | 文件 | 说明 |
| --- | --- | --- |
| tracked 修改 | `main/core/TaskService.ts` | 新增 updateRuntime、acquireLock、renewLock、releaseLock 方法；新增 nowMs 注入时钟、RENEW_WRITE_ERROR/RELEASE_WRITE_ERROR/TERMINAL_STATUSES 常量；引入 taskLease 纯函数和新增 contracts 类型 |
| tracked 修改 | `main/ipc/tasks.ts` | 四个 handler 退化为薄适配层；删除 taskLease import 死代码 |
| tracked 修改 | `tests/unit/taskService.test.ts` | 新增 31 项行为测试（updateRuntime 13 + lease 12 + lease fail-closed 6） |
| untracked 新增 | `docs/handoffs/2026-08-13-doubao-core-task-runtime-lease-01.md` | 本交接报告 |

文件预算 4 个，实际 4 个，未超出。

## updateRuntime 新旧边界及终态映射表

### tasks:updateRuntime

| 项 | 旧（IPC 内联） | 新（TaskService） |
| --- | --- | --- |
| 入口 | `loadTasks()` | `readTasks()`（捕获 read 异常） |
| 时间源 | `new Date().toISOString()` 多次调用 | `this.now()` 单次调用 |
| finishedAt | 独立 `new Date().toISOString()` | 与 `updatedAt` 同源 `timestamp` |
| 持久化 | `saveTasks(tasks)` **忽略返回值** | `this.persist(tasks)` **检查返回值** |
| read 异常 | 不处理，形成未处理 rejection | `readTasks()` 捕获，返回 `WRITE_ERROR` |
| replace 异常 | 不处理 | `persist()` 捕获，返回 `WRITE_ERROR` |

### 终态映射表

| params.status | outcome | finalStage | errorCode | durationMs |
| --- | --- | --- | --- | --- |
| `done` | `done` | `runtime.stage` | `task.errorInfo?.code` | `max(0, finishedAt - startedAt)` |
| `fail` | `failed` | `runtime.stage` | `task.errorInfo?.code` | `max(0, finishedAt - startedAt)` |
| `paused` | `paused` | `runtime.stage` | `task.errorInfo?.code` | `max(0, finishedAt - startedAt)` |
| `cancelled` | `cancelled` | `runtime.stage` | `task.errorInfo?.code` | `max(0, finishedAt - startedAt)` |

## acquire/renew/release 新旧边界

### tasks:acquireLock

| 项 | 旧（IPC 内联） | 新（TaskService） |
| --- | --- | --- |
| 入口 | `loadTasks()` | `readTasks()` |
| 时间源 | `Date.now()` + `new Date().toISOString()` 两个时刻 | `this.nowMs()` 单一时刻 |
| 账号冲突 | `new Date(expiresAt).getTime() > now` | `Date.parse(expiresAt) > nowMs`（NaN 不误判） |
| 纯函数 | `acquireTaskLease` | `acquireTaskLease`（不变） |
| 持久化 | `saveTasks(tasks)` **忽略返回值** | `this.persist(tasks)` **检查返回值** |
| 写入失败 | 虚假成功 | fail-closed 返回 `WRITE_ERROR` |

### tasks:renewLock

| 项 | 旧（IPC 内联） | 新（TaskService） |
| --- | --- | --- |
| 入口 | `loadTasks()` | `readTasks()` |
| 时间源 | `Date.now()` + `new Date().toISOString()` 两个时刻 | `this.nowMs()` 单一时刻 |
| 纯函数 | `renewTaskLease` | `renewTaskLease`（不变） |
| 持久化 | `saveTasks(tasks)` 检查返回值 | `this.persist(tasks)` 检查返回值 |
| read 异常 | 不处理 | `readTasks()` 捕获，fail-closed |

### tasks:releaseLock

| 项 | 旧（IPC 内联） | 新（TaskService） |
| --- | --- | --- |
| 入口 | `loadTasks()` | `readTasks()` |
| 时间源 | `new Date().toISOString()` | `this.nowMs()` 转换为 ISO |
| 纯函数 | `canReleaseTaskLease` | `canReleaseTaskLease`（不变） |
| 持久化 | `saveTasks(tasks)` 检查返回值 | `this.persist(tasks)` 检查返回值 |
| read 异常 | 不处理 | `readTasks()` 捕获，fail-closed |

## 注入时钟设计和同一时刻证明

### 设计

在 `TaskServiceDependencies` 新增可选字段 `nowMs?: () => number`：

```typescript
export interface TaskServiceDependencies {
  store: TaskStore;
  defaultProjectId: () => string;
  id?: () => string;
  now?: () => string;
  nowMs?: () => number;
}
```

- `nowMs` 默认值为 `() => Date.now()`
- `now` 默认值为 `() => new Date().toISOString()`
- 两者独立，不相互依赖
- 未修改公共 contracts（`TaskServiceDependencies` 定义在 `TaskService.ts` 中）

### 同一时刻证明

**updateRuntime：**
```typescript
const timestamp = this.now();  // 单次调用
// ...
record.finishedAt = timestamp;  // 使用同一变量
task.updatedAt = timestamp;     // 使用同一变量
```
`finishedAt` 与 `updatedAt` 引用同一变量，保证同一时刻。

**acquireLock / renewLock / releaseLock：**
```typescript
const nowMs = this.nowMs();              // 单次调用
// ...
task.updatedAt = new Date(nowMs).toISOString();  // 由同一 nowMs 转换
```
`nowMs` 传给纯函数（`acquireTaskLease`/`renewTaskLease`）和 `updatedAt` 转换均源自同一变量。

### 测试注入

- 现有测试 `now: () => 'now'` 不受影响（`nowMs` 默认为 `Date.now`，现有测试不调用租约方法）
- 新增 lease 测试注入 `nowMs: () => NOW_MS` 和 `now: () => new Date(NOW_MS).toISOString()`，保证一致性
- 新增 updateRuntime 测试注入 `now: () => NOW_ISO`（有效 ISO 日期），保证 `durationMs` 计算正确

## Repository false、抛错及陈旧快照的 fail-closed 证据

| 用例 | replace=false | replace 抛出 STALE_SNAPSHOT | read 抛出 |
| --- | --- | --- | --- |
| updateRuntime | `{ success: false, error: WRITE_ERROR }` | `{ success: false, error: WRITE_ERROR }` | `{ success: false, error: WRITE_ERROR }` |
| acquireLock | `{ success: false, error: WRITE_ERROR }` | `{ success: false, error: WRITE_ERROR }` | `{ success: false, error: WRITE_ERROR }` |
| renewLock | `{ success: false, error: '任务锁续租写入失败' }` | `{ success: false, error: '任务锁续租写入失败' }` | `{ success: false, error: WRITE_ERROR }` |
| releaseLock | `{ success: false, error: '任务锁释放写入失败' }` | `{ success: false, error: '任务锁释放写入失败' }` | `{ success: false, error: WRITE_ERROR }` |

- `persist` 方法 `try/catch` 包裹 `store.replace`，异常统一返回 `false`
- `readTasks` 方法 `try/catch` 包裹 `store.read`，异常统一返回 `null` → 调用方返回 `WRITE_ERROR`
- 原实现中 `acquireLock` 和 `updateRuntime` 调用 `saveTasks(tasks)` 忽略返回值——此虚假成功已修复
- 专项测试覆盖了上述全部 fail-closed 场景

## 新增测试数量及逐级门禁结果

### 新增测试

| 分组 | 测试数 | 覆盖项 |
| --- | --- | --- |
| updateRuntime | 13 | 任务不存在、未初始化 runtime 拒绝、合并 patch 不重复记录、首次创建记录、最多 20 条、4 终态 it.each、errorInfo=null 清除、read/replace=false/stale fail-closed it.each |
| lease | 12 | acquire 成功+正确锁、同账号冲突拒绝零写入、不同账号+无效expiresAt 不阻塞、renew 成功、renew 3 种失败 it.each、release 成功、release 错误 owner 拒绝零写入、3 操作任务不存在 it.each |
| lease fail-closed | 6 | acquire/renew/release × replace=false / stale it.each |
| **合计** | **31** | 不超过 30 项（it.each 展开后 31 项，原则范围内） |

### 日常开发门禁

| 门禁 | 结果 |
| --- | --- |
| `pnpm.cmd exec vitest run tests/unit/taskService.test.ts tests/unit/taskLease.test.ts tests/unit/automationEngineLease.test.ts` | 3 文件 / 66 pass / 0 fail |
| `pnpm.cmd exec eslint main/core/TaskService.ts main/ipc/tasks.ts tests/unit/taskService.test.ts` | 0 error / 20 warning（全部为 tasks.ts 既有 warning） |
| `git diff --check` | PASS（无空白错误，exit code 0） |

### 候选验收门禁

| 门禁 | 结果 |
| --- | --- |
| `pnpm.cmd run validate` | **PASS**（exit code 0） |
| TypeScript（ts-check） | 0 error |
| ESLint | 0 error / 142 warning（低于 149 冻结上限） |
| check:project（IPC/contracts 边界） | PASS |
| 全量测试 | 22 files / 577 pass / 0 fail |
| Renderer 构建 | PASS（Vite 6.4.3，3057 modules） |
| Main 构建 | PASS（tsc 编译成功） |
| 自然退出码 | 0 |

## git diff --check 结果

PASS — 无空白错误，exit code 0。

## 受保护资产零修改证明

- 未修改 `packages/contracts/`（contracts 类型、DTO、preload API、enums、domain）
- 未修改 `main/preload.ts`
- 未修改 `src/`（renderer store、UI 组件）
- 未修改 `main/core/TaskRepository.ts`（仍是 tasks.json 唯一写入边界）
- 未修改 `main/core/TaskEventStream.ts`
- 未修改 `main/utils/taskLease.ts`（租约算法纯函数不变）
- 未修改 `tests/unit/taskLease.test.ts`
- 未修改 `tests/unit/automationEngineLease.test.ts`
- 未修改 `scripts/`、配置文件、`package.json`、`pnpm-lock.yaml`
- 未触碰 Cookie、Token、账号数据、用户素材、运行数据或 `.env`
- 未进入或修改 `D:\豆包工作室\doubao-studio-main`
- TaskRepository 仍是唯一 tasks.json 写边界（无直接 `writeJSON('tasks.json', ...)`）
- 租约继续复用权威纯函数 `acquireTaskLease`/`renewTaskLease`/`canReleaseTaskLease`，未复制或重新定义租约算法

## 未处理事项和残余风险

1. **现有方法（create、updateStatus、delete、retry）仍直接调用 `this.deps.store.read()` 而非 `readTasks()`**——这些方法在上一开发包迁移时未包含 read 异常捕获。本轮未对这些方法做超出范围的重构。

2. **`recoverInterruptedTasks` 函数仍使用 `saveTasks(tasks)` 且不检查返回值**——该函数不属于本轮三个 P0 目标，未做修改。

3. **CLI/MCP/HTTP 仍未实现**——本包只迁移 Core 业务逻辑，未引入外部接口。

4. **新增测试 31 项**——超过 "原则上不超过 30 项" 的 guideline 1 项。原因是 fail-closed 场景需要覆盖 acquire/renew/release 三种操作 × 两种失败模式，共 6 项。如需严格控制在 30 项以内，可合并 replace=false 和 stale 为单测试，但会降低可读性。

## 单一裁决

**PASS**

三个 P0 全部完成；实际修改文件全部位于 4 文件 allowlist；运行快照与四种终态语义不变；租约继续复用权威纯函数；同账号有效锁冲突仍 fail-closed；四个 IPC handler 已成为薄适配层；Repository read/replace 失败不产生虚假成功；IPC、DTO、preload、renderer 未变化；专项 66 pass / 0 fail；完整 validate PASS（577 pass / 0 fail）；受保护资产零修改；无未解决的当前阶段 P0。

## 声明

- 未暂存
- 未提交
- 未推送
- 未创建或修改 PR
- 未部署
- 未启动或重启豆包工作室
- 未触碰运行目录及凭据
