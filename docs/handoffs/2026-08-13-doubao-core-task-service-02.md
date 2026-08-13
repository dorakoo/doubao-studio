# DOUBAO-CORE-TASK-SERVICE-02 检查报告

## 已读取的治理文件

- `D:\项目架构师\memory\INDEX.md`
- `D:\项目架构师\DEVELOPMENT_EFFICIENCY_GOVERNANCE.md`
- `D:\豆包工作室\doubao-core-task-service-02\AGENTS.md`
- `README.md`
- `ROADMAP.md`
- `DESIGN.md`
- `AGENT_EXECUTION_PLAN.md`
- `docs/handoffs/2026-08-13-doubao-core-repository-events-01.md`
- `docs/handoffs/2026-08-13-doubao-core-task-service-01.md`
- `main/core/TaskRepository.ts`
- `main/core/TaskEventStream.ts`
- `main/core/TaskService.ts`
- `main/ipc/tasks.ts`
- `tests/unit/taskService.test.ts`
- `packages/contracts/src/dto/tasks.ts`（TaskAssignParams、TaskUpdateInput、TaskUpdateParams）
- `packages/contracts/src/domain.ts`（Task、TaskErrorInfo、TaskRunSnapshot）
- `packages/contracts/src/enums.ts`（TaskStatus、TaskStage）
- `packages/contracts/src/dto/electron-api.ts`（ElectronAPI preload 契约）

## 工作树、分支、基线 HEAD 和最终未提交状态

- 工作树：`D:\豆包工作室\doubao-core-task-service-02`
- 分支：`glm/doubao-core-task-service-02`
- 基线 HEAD：`9915e8c583e0d3fe317b965be6f59e6ad5a67649`
- 最终 HEAD（未提交）：`9915e8c583e0d3fe317b965be6f59e6ad5a67649`（无新提交）
- tracked 修改：
  - `main/core/TaskService.ts`（M）
  - `main/ipc/tasks.ts`（M）
  - `tests/unit/taskService.test.ts`（M）
- untracked 新增：
  - `docs/handoffs/2026-08-13-doubao-core-task-service-02.md`（本文件）
- 无其他 tracked/untracked 改动
- 未进入或修改 `D:\豆包工作室\doubao-studio-main`

## 冻结验收包三个 P0 的逐项结果

### P0-1：账号指派与任务编辑进入 TaskService — 完成

**新增 TaskService 方法：**

- `assign(params: TaskAssignParams): TaskServiceResult`
  - 找不到任务返回 `'任务不存在'`
  - `executing`、`generating`、`waiting_verification` 状态禁止重新指派，返回 `'任务正在自动化执行中，无法重新指派'`
  - 成功后更新 `assignedAccountId`
  - 成功后通过 `resetTaskForQueue` 执行与现有语义完全一致的重置（status→queued, result→null, outputs→[], errorInfo→undefined, lock→undefined, runtime stage→queued/message→等待执行/stageStartedAt+lastHeartbeatAt→timestamp, updatedAt→timestamp）
  - Repository `replace` 返回 false 或抛出陈旧快照异常时 fail-closed，返回 `'任务数据写入失败，请检查磁盘空间和数据目录权限'`

- `update(params: { taskId: string; updates: TaskUpdateInput }): TaskServiceResult<Task>`
  - 找不到任务返回 `'任务不存在'`
  - prompt trim 后为空返回 `'提示词不能为空'`
  - 正确更新 prompt（trim 后）、videoConfig、attachments、audioAttachment
  - 空 attachments 规范为 `undefined`
  - 空 audioAttachment 规范为 `undefined`
  - 成功后通过 `resetTaskForQueue` 执行重置
  - Repository `replace` 返回 false 或抛出陈旧快照异常时 fail-closed

**新增私有方法：**

- `resetTaskForQueue(task: Task, timestamp: string): void` — 将原 IPC 层的 `resetTaskForQueue` 业务语义移入 Core 边界，使用注入的 `now()` 作为唯一时间源，同一次操作时间值一致
- `readTasks(): Task[] | null` — 捕获 `store.read()` 异常，防止 read 抛错形成未处理异常

**retry 方法重构：** 复用 `resetTaskForQueue`，消除重复逻辑

### P0-2：批量暂停进入 TaskService — 完成

- `batchPause(): TaskServiceResult`
  - 只处理 `executing`、`generating`、`waiting_verification` 三种活动状态
  - 其他状态保持原样
  - 目标任务状态改为 `paused`
  - `result` 设为 `'批量暂停'`
  - `errorInfo` = `{ code: 'cancelled', message: '批量暂停', recoverable: true, detectedAt: timestamp }`
  - 存在 runtime 时：`stage: 'paused'`, `message: '批量暂停'`, `stageStartedAt` 和 `lastHeartbeatAt` 使用同一注入时间
  - `updatedAt` 使用同一注入时间
  - 不改变 `runHistory`、`artifacts`、`outputs` 或其他无关字段
  - Repository `replace` 返回 false 或抛出异常时 fail-closed
  - 无活动任务时返回 `{ success: true }` 且不写回（最小兼容方案：避免无变更的冗余写入，外部行为与原实现一致返回 success=true）
  - **修复虚假成功：** 原实现 `saveTasks(tasks)` 忽略返回值且可能抛出未处理异常；新实现通过 `persist` 捕获并 fail-closed

### P0-3：IPC 退化为薄适配层并补行为测试 — 完成

**三个 IPC handler 退化：**

- `tasks:assign` — 只调用 `taskService.assign(params)` 并返回
- `tasks:update` — 只调用 `taskService.update(params)` 并映射 `result.data` 为 `task`
- `tasks:batchPause` — 只调用 `taskService.batchPause()` 并提取 `result.success`

**channel 名称、preload API、DTO、UI 不变。**

**删除死代码：**
- `resetTaskForQueue` 函数（原 IPC 层重复实现，已由 TaskService.resetTaskForQueue 替代）
- `saveTasksOrError` 函数（已由 TaskService.persist 替代）

**IPC 不再包含三项业务状态变换的重复实现**（经源码检查确认，`resetTaskForQueue` 和 `saveTasksOrError` 已从 tasks.ts 完全删除，grep 零匹配）

## 精确修改文件清单

| 类型 | 文件 | 说明 |
| --- | --- | --- |
| tracked 修改 | `main/core/TaskService.ts` | 新增 assign、update、batchPause 方法；新增 resetTaskForQueue、readTasks 私有方法；重构 retry 复用 resetTaskForQueue；引入 WRITE_ERROR 常量 |
| tracked 修改 | `main/ipc/tasks.ts` | 三个 handler 退化为薄适配层；删除 resetTaskForQueue 和 saveTasksOrError 死代码 |
| tracked 修改 | `tests/unit/taskService.test.ts` | 新增 19 项行为测试（assign 5 + update 4 + batchPause 4 + fail-closed 6） |
| untracked 新增 | `docs/handoffs/2026-08-13-doubao-core-task-service-02.md` | 本交接报告 |

文件预算 4 个，实际 4 个，未超出。

## 账号指派、任务编辑、批量暂停的新旧调用边界

### tasks:assign

| 项 | 旧（IPC 内联） | 新（TaskService） |
| --- | --- | --- |
| 入口 | `loadTasks()` + 内联查找 | `readTasks()` + 内联查找 |
| 活动状态判断 | `task.status === 'executing' \|\| ...` | `ACTIVE.has(task.status)` |
| 重置 | IPC 层 `resetTaskForQueue(task)` 用 `new Date()` | Core `this.resetTaskForQueue(task, this.now())` |
| 持久化 | `saveTasksOrError(tasks)` 不捕获 replace 异常 | `this.persist(tasks)` 捕获 replace 异常 |
| read 异常 | 不处理，形成未处理 rejection | `readTasks()` 捕获，返回安全错误 |

### tasks:update

| 项 | 旧（IPC 内联） | 新（TaskService） |
| --- | --- | --- |
| 入口 | `loadTasks()` + 内联查找 | `readTasks()` + 内联查找 |
| prompt 校验 | IPC 内联 | Core 内联 |
| 字段规范化 | IPC 内联 | Core 内联 |
| 重置 | IPC 层 `resetTaskForQueue(task)` | Core `this.resetTaskForQueue(task, this.now())` |
| 持久化 | `saveTasksOrError(tasks)` | `this.persist(tasks)` |

### tasks:batchPause

| 项 | 旧（IPC 内联） | 新（TaskService） |
| --- | --- | --- |
| 入口 | `loadTasks()` | `readTasks()` |
| 活动状态判断 | 内联 `task.status === ...` | `ACTIVE.has(task.status)` |
| 时间源 | 循环内 `new Date().toISOString()` 每次不同 | 单次 `this.now()` 全局一致 |
| 持久化 | `saveTasks(tasks)` **忽略返回值** | `this.persist(tasks)` **检查返回值** |
| 无活动任务 | 仍调用 `saveTasks` | 跳过写入，返回 success |

## fail-closed 行为及写入失败证据

| 用例 | replace=false | replace 抛出 STALE_SNAPSHOT |
| --- | --- | --- |
| assign | `{ success: false, error: WRITE_ERROR }` | `{ success: false, error: WRITE_ERROR }` |
| update | `{ success: false, error: WRITE_ERROR }` | `{ success: false, error: WRITE_ERROR }` |
| batchPause | `{ success: false, error: WRITE_ERROR }` | `{ success: false, error: WRITE_ERROR }` |

- `persist` 方法 `try/catch` 包裹 `store.replace`，异常统一返回 `false`
- `readTasks` 方法 `try/catch` 包裹 `store.read`，异常统一返回 `null` → 调用方返回 `WRITE_ERROR`
- 原实现中 `batchPause` 调用 `saveTasks(tasks)` 忽略返回值——此虚假成功已修复
- 原实现中 `saveTasksOrError` 不捕获 `replace` 抛出的陈旧快照异常——此未处理 rejection 已修复
- 专项测试覆盖了上述 6 个 fail-closed 场景

## 新增专项测试数量和逐级门禁结果

### 新增测试

| 分组 | 浽数 | 覆盖项 |
| --- | --- | --- |
| assign | 5（含 it.each × 3 状态） | 成功+完整 reset、三种活动状态禁止、目标不存在 |
| update | 4 | 成功+字段规范化、空 prompt 拒绝、空 attachments→undefined、空 audioAttachment→undefined |
| batchPause | 4 | 只影响三种活动状态、时间一致性、无关字段不变、无活动任务不写入 |
| fail-closed | 6 | assign/update/batchPause × replace=false / stale snapshot |
| **合计** | **19** | 不超过 30 项 |

### 日常开发门禁

| 门禁 | 结果 |
| --- | --- |
| `pnpm.cmd exec vitest run tests/unit/taskService.test.ts` | 26 pass / 0 fail（7 原有 + 19 新增） |
| `pnpm.cmd exec eslint main/core/TaskService.ts main/ipc/tasks.ts tests/unit/taskService.test.ts` | 0 error / 20 warning（全部为 tasks.ts 既有 warning，非本次引入） |
| `git diff --check` | PASS（无空白错误） |

### 候选验收门禁

| 门禁 | 结果 |
| --- | --- |
| `pnpm.cmd run validate` | **PASS**（exit code 0） |
| TypeScript | 0 error |
| ESLint | 0 error / 142 warning（低于 149 冻结上限） |
| check:project（IPC/contracts 边界） | PASS |
| 全量测试 | 22 files / 546 pass / 0 fail |
| Renderer 构建 | PASS（Vite 6.4.3，3057 modules） |
| Main 构建 | PASS（tsc 编译成功） |

## git diff --check 结果

PASS — 无空白错误，exit code 0。

## 受保护资产零修改证明

- 未修改 `packages/contracts/`（contracts 类型、DTO、preload API）
- 未修改 `main/preload.ts`
- 未修改 `src/`（renderer store、UI 组件）
- 未修改 `main/core/TaskRepository.ts`（仍是 tasks.json 唯一写入边界）
- 未修改 `main/core/TaskEventStream.ts`
- 未修改 `scripts/`、配置文件、`package.json`、`pnpm-lock.yaml`
- 未触碰 Cookie、Token、账号数据、用户素材、运行数据或 `.env`
- 未进入或修改 `D:\豆包工作室\doubao-studio-main`
- TaskRepository 仍是唯一 tasks.json 写边界（无直接 `writeJSON('tasks.json', ...)`）

## 未处理事项与残余风险

1. **现有方法（create、updateStatus、delete）仍直接调用 `this.deps.store.read()` 而非 `readTasks()`**——这些方法在上一开发包（TASK-SERVICE-01）迁移时未包含 read 异常捕获。本轮未对这些方法做超出范围的重构。如后续需要统一，可在下一开发包处理。

2. **`tasks:batchPause` 的返回类型为 `{ success: boolean }`，不含 error 字段**——当写入失败时，IPC 层只能返回 `{ success: false }` 无法传递错误原因。这是 preload API 契约限制，本轮未修改 DTO。

3. **`recoverInterruptedTasks` 函数仍使用 `saveTasks(tasks)` 且不检查返回值**——该函数不属于本轮三个 P0 目标，未做修改。

4. **CLI/MCP/HTTP 仍未实现**——本包只迁移 Core 业务逻辑，未引入外部接口。

## 单一裁决

**PASS**

三个 P0 全部完成；实际修改文件全部位于 4 文件 allowlist；TaskRepository 仍是唯一 tasks.json 写边界；IPC channel、DTO 和 UI 未改变；写入失败不再产生虚假成功；专项 26 pass / 0 fail；完整 validate PASS（546 pass / 0 fail）；受保护资产零修改；无未解决的当前阶段 P0。

## 声明

- 未暂存
- 未提交
- 未推送
- 未创建或修改 PR
- 未部署
- 未启动或重启豆包工作室
- 未触碰运行目录及凭据
