# DOUBAO-CORE-TASK-RECOVERY-01 检查报告

## 已读取的治理文件

- `D:\项目架构师\memory\INDEX.md`
- `D:\项目架构师\DEVELOPMENT_EFFICIENCY_GOVERNANCE.md`
- `D:\豆包工作室\doubao-core-task-recovery-01\AGENTS.md`
- `README.md`
- `ROADMAP.md`
- `DESIGN.md`
- `AGENT_EXECUTION_PLAN.md`
- `docs/handoffs/2026-08-13-doubao-core-repository-events-01.md`
- `docs/handoffs/2026-08-13-doubao-core-task-service-01.md`
- `docs/handoffs/2026-08-13-doubao-core-task-service-02.md`
- `docs/handoffs/2026-08-13-doubao-core-task-runtime-lease-01.md`
- `main/core/TaskRepository.ts`
- `main/core/TaskEventStream.ts`
- `main/core/TaskService.ts`
- `main/ipc/tasks.ts`
- `main/main.ts`
- `main/ipc/lifecycle.ts`
- `tests/unit/taskService.test.ts`
- `tests/unit/taskRepository.test.ts`
- `tests/unit/ipcLifecycle.test.ts`
- `packages/contracts/src/domain.ts`
- `packages/contracts/src/enums.ts`
- `packages/contracts/src/dto/tasks.ts`

## 工作树、分支、基线 HEAD 和最终 HEAD

- 工作树：`D:\豆包工作室\doubao-core-task-recovery-01`
- 分支：`glm/doubao-core-task-recovery-01`
- 基线 HEAD：`9b6ad9ba0bd49548cdeeec0907f00e7407ea9e2f`
- 最终 HEAD（未提交）：`9b6ad9ba0bd49548cdeeec0907f00e7407ea9e2f`（无新提交）

## 开工及最终 Git 状态

### 开工状态

- 工作树干净，无 tracked/untracked 改动
- HEAD 精确为 `9b6ad9ba0bd49548cdeeec0907f00e7407ea9e2f`
- 分支为 `glm/doubao-core-task-recovery-01`

### 最终状态（未提交）

- tracked 修改：
  - `main/core/TaskService.ts`（M）
  - `main/ipc/tasks.ts`（M）
  - `tests/unit/taskService.test.ts`（M）
- untracked 新增：
  - `docs/handoffs/2026-08-13-doubao-core-task-recovery-01.md`（本文件）
- 无其他 tracked/untracked 改动
- 未进入或修改 `D:\豆包工作室\doubao-studio-main`

## 三个 P0 的逐项结果

### P0-1：启动时中断任务恢复进入 TaskService — 完成

**新增 TaskService 方法：**

- `recoverInterruptedTasks(): TaskServiceResult<TaskRecoverySummary>`
  - `readTasks()` 读取任务，read 异常返回 `null` 时 fail-closed，返回 `WRITE_ERROR`
  - 使用 `this.now()` 获取单一批次时间 `timestamp`，整个恢复批次只调用一次
  - 遍历所有任务：
    - 非活动任务（非 executing/generating/waiting_verification）：
      - 只清除遗留 lock（如有），标记 `changed = true`，`clearedLocks++`
      - 无 lock 时完全不变
    - 活动任务：
      - `status` → `paused`
      - `result` → `'程序上次退出时任务仍在运行，可重新执行'`
      - `errorInfo` → `{ code: 'cancelled', message: task.result, recoverable: true, detectedAt: timestamp }`
      - 存在 runtime 时：保留其他 runtime 字段，`stage: 'paused'`, `message: '程序重启，任务已安全暂停'`, `stageStartedAt/lastHeartbeatAt` 使用同一 `timestamp`
      - `updatedAt` → `timestamp`
      - 清除 lock（如有），`clearedLocks++`
      - 查找与 `runtime.runId` 相同且无 `finishedAt` 的 runHistory 记录：
        - 找到时：`finishedAt/finalStage/outcome/errorCode/durationMs` 使用同一 `timestamp` 和 `Math.max(0, ...)` 收敛
        - 未找到时不创建新记录
        - 不改写已 finished 的记录
        - 不改写非当前 runId 的记录
      - `recoveredTasks++`，`changed = true`
  - 无变化时返回 `{ success: true, data: { recoveredTasks: 0, clearedLocks: 0 } }`，不调用 `persist()`
  - 有变化时只调用一次 `persist()`，返回 false 或抛出异常时 fail-closed
  - 返回 `{ success: true, data: { recoveredTasks, clearedLocks } }`

**新增类型（定义在 TaskService.ts 内）：**

```typescript
export interface TaskRecoverySummary {
  recoveredTasks: number;
  clearedLocks: number;
}
```

- 未修改公共 contracts（`packages/contracts/`）

### P0-2：启动接线必须 fail-closed — 完成

**删除 main/ipc/tasks.ts 中的本地 `recoverInterruptedTasks()` 函数。**

**registerTaskIPC() 通过 TaskService 执行恢复：**

```typescript
export function registerTaskIPC(): () => void {
  const dispose = replaceIpcHandlers(ipcMain, TASK_IPC_CHANNELS);
  const recoveryResult = taskService.recoverInterruptedTasks();
  if (!recoveryResult.success) {
    dispose();
    throw new Error('任务恢复失败，请检查数据目录和磁盘状态');
  }
  // 在任何新下载开始前，仅恢复上次进程遗留的下载状态。
  loadDownloadJobs();
  writeJSON('schema.json', { version: 6, appVersion: '2.0.0', updatedAt: new Date().toISOString() });
  // ... handler 注册
```

- 先建立当前 IPC 注册批次的 disposer
- 调用 TaskService 恢复
- 恢复成功后才继续下载恢复、schema 写入和 handler 注册
- 恢复失败时：
  - 调用当前批次 disposer，清理该注册批次的 ownership
  - 抛出固定脱敏错误 `'任务恢复失败，请检查数据目录和磁盘状态'`
  - 不继续注册 handlers
  - 不继续执行下载恢复或 schema 写入
  - 不把内部 Repository 异常、磁盘路径或用户数据内容写入错误
- `registerTaskIPC()` 的公开签名仍保持 `(): () => void`
- 不新增 IPC channel
- 不修改 preload 或 renderer
- 不修改 `main/main.ts`
- 不修改 `main/ipc/lifecycle.ts`

### P0-3：统一前序 TaskService read fail-closed — 完成

将以下四个方法的 `this.deps.store.read()` 统一改为 `this.readTasks()` + null 检查：

| 方法 | 旧调用 | 新调用 |
| --- | --- | --- |
| `create` | `this.deps.store.read()` | `this.readTasks()` + `if (!tasks) return WRITE_ERROR` |
| `updateStatus` | `this.deps.store.read()` | `this.readTasks()` + `if (!tasks) return WRITE_ERROR` |
| `delete` | `this.deps.store.read()` | `this.readTasks()` + `if (!tasks) return WRITE_ERROR` |
| `retry` | `this.deps.store.read()` | `this.readTasks()` + `if (!tasks) return WRITE_ERROR` |

- 正常业务行为、返回形状和用户提示不变
- read 失败统一返回安全的 `WRITE_ERROR`
- read 异常不逃逸为未处理 IPC rejection
- read 失败不调用 `replace`
- read 失败不生成 ID、时间、产物或修改外部状态
- `create` 特别处理：空 prompts 校验仍在读取前完成（无副作用）；read 失败时不调用 `id()` 或 `now()`
- Repository `replace` 失败仍保持现有 fail-closed 语义
- 未修改 assign/update/batchPause/updateRuntime/lease 等其他方法

## 精确修改文件清单

| 类型 | 文件 | 说明 |
| --- | --- | --- |
| tracked 修改 | `main/core/TaskService.ts` | 新增 TaskRecoverySummary 接口和 recoverInterruptedTasks 方法；create/updateStatus/delete/retry 四个方法改用 readTasks() |
| tracked 修改 | `main/ipc/tasks.ts` | 删除本地 recoverInterruptedTasks 函数；registerTaskIPC 改为通过 taskService 执行恢复，失败时调用 disposer 并抛稳定错误 |
| tracked 修改 | `tests/unit/taskService.test.ts` | 新增 21 项行为测试（恢复 14 + read fail-closed 5 + IPC 契约 2） |
| untracked 新增 | `docs/handoffs/2026-08-13-doubao-core-task-recovery-01.md` | 本交接报告 |

文件预算 4 个，实际 4 个，未超出。

## 启动恢复的新旧边界

| 项 | 旧（IPC 内联） | 新（TaskService） |
| --- | --- | --- |
| 入口 | `loadTasks()` 直接调用 `taskRepository.read()` | `readTasks()` 捕获 read 异常 |
| 时间源 | `new Date().toISOString()` | `this.now()` 单次调用，全批次共享 |
| 持久化 | `saveTasks(tasks)` **忽略返回值** | `this.persist(tasks)` **检查返回值** |
| read 异常 | 不处理，形成未处理 rejection | `readTasks()` 捕获，返回 `WRITE_ERROR` |
| replace 异常 | 不处理 | `persist()` 捕获，返回 `WRITE_ERROR` |
| 无变化时 | 仍检查 `changed`，但 `saveTasks` 不检查返回值 | 跳过写入，返回 success |
| 摘要 | 无 | 返回 `{ recoveredTasks, clearedLocks }` |

## 活动与非活动任务恢复矩阵

| 任务类型 | status 变化 | result | errorInfo | runtime | lock | runHistory | updatedAt |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 活动（executing/generating/waiting_verification） | → paused | 设为恢复消息 | code:'cancelled', recoverable:true, detectedAt:批次时间 | 保留其他字段，stage:'paused', message/message:'程序重启...', stageStartedAt/lastHeartbeatAt:批次时间 | 清除 | 当前 runId 未结束记录收口 | 批次时间 |
| 非活动 + 有 lock | 不变 | 不变 | 不变 | 不变 | 清除 | 不变 | 不变 |
| 非活动 + 无 lock | 不变 | 不变 | 不变 | 不变 | 不变 | 不变 | 不变 |

## runHistory 收口语义

- 只查找与当前 `task.runtime.runId` 相同且尚无 `finishedAt` 的记录
- 找到时：`finishedAt` = 批次时间，`finalStage: 'paused'`，`outcome: 'paused'`，`errorCode: 'cancelled'`，`durationMs = Math.max(0, 批次时间 - startedAt)`
- 已结束的记录不改写
- 非当前 runId 的记录不改写
- 不创建新的 runHistory 记录
- 没有 runtime 时不查找或创建历史记录

## 同一批次时间证明

```typescript
const timestamp = this.now();  // 整个恢复批次只调用一次
// 所有恢复任务的以下字段全部引用同一 timestamp：
// - errorInfo.detectedAt
// - runtime.stageStartedAt
// - runtime.lastHeartbeatAt
// - task.updatedAt
// - runHistory.finishedAt（如有）
```

测试验证：`多任务恢复只执行一次 replace 且同一批次时间严格一致` 测试中，3 个活动任务的 15 个时间字段全部相同，`Set(allTimes).size === 1`。

## 无变化零写入及多任务单次 replace 证据

| 场景 | writeCount | 说明 |
| --- | --- | --- |
| 无活动任务且无 lock | 0 | `changed` 为 false，跳过 `persist()` |
| 1 个活动任务 | 1 | `changed` 为 true，调用一次 `persist()` |
| 3 个活动任务 | 1 | 只调用一次 `persist()`，所有任务在同一个数组中一次性写回 |

## Repository read/replace 失败的 fail-closed 证据

| 用例 | read 抛出 | replace=false | replace 抛出 STALE_SNAPSHOT |
| --- | --- | --- | --- |
| recoverInterruptedTasks | `{ success: false, error: WRITE_ERROR }` | `{ success: false, error: WRITE_ERROR }` | `{ success: false, error: WRITE_ERROR }` |

- `persist` 方法 `try/catch` 包裹 `store.replace`，异常统一返回 `false`
- `readTasks` 方法 `try/catch` 包裹 `store.read`，异常统一返回 `null` → 调用方返回 `WRITE_ERROR`
- 原实现中 `recoverInterruptedTasks` 调用 `saveTasks(tasks)` **忽略返回值**——此虚假成功已修复
- 专项测试覆盖了上述 3 个 fail-closed 场景

## registerTaskIPC 失败清理和停止初始化证据

源码契约检查验证：

1. `tasks.ts` 不再包含 `function recoverInterruptedTasks(` 定义（grep 零匹配）
2. `tasks.ts` 包含 `taskService.recoverInterruptedTasks()` 调用
3. 恢复调用位置在 `loadDownloadJobs()` 和 `writeJSON('schema.json'` 之前
4. 恢复失败时 `dispose()` 在 `throw` 之前调用
5. `loadDownloadJobs()` 和 `writeJSON('schema.json'` 在 `throw` 之后（不会执行）

**原因说明**：`registerTaskIPC` 依赖 Electron 的 `ipcMain`、`dialog`、`session` 等运行时 API，无法在不新增 IPC 测试基础设施的情况下做稳定行为测试。因此使用最小源码契约检查验证接线正确性，符合任务规格第 24-25 项的允许方案。

## create/updateStatus/delete/retry read 失败证据

| 方法 | read 抛出 | replace 调用次数 | id 调用次数 | now 调用次数 |
| --- | --- | --- | --- | --- |
| create | `{ success: false, error: WRITE_ERROR }` | 0 | 0 | 0 |
| updateStatus | `{ success: false, error: WRITE_ERROR }` | 0 | N/A | N/A |
| delete | `{ success: false, error: WRITE_ERROR }` | 0 | N/A | N/A |
| retry | `{ success: false, error: WRITE_ERROR }` | 0 | N/A | N/A |

- 专项测试使用 `it.each` 覆盖四个方法的 read 失败场景
- `create` 特别验证：read 失败时 `id` 和 `now` 的 mock 函数均未被调用

## 新增测试数量及逐级门禁结果

### 新增测试

| 分组 | 测试块数 | 展开用例数 | 覆盖项 |
| --- | --- | --- | --- |
| recoverInterruptedTasks | 10 | 14 | 三种活动状态恢复（it.each×3）、非活动任务 lock 清除、runHistory 收口/已 finished/非当前 runId/无 runtime、未来 startedAt durationMs=0、无变化零写入、多任务单次 replace+时间一致、read/replace=false/stale fail-closed（it.each×3） |
| read fail-closed（前序方法） | 2 | 5 | create/updateStatus/delete/retry read 抛错（it.each×4）、create read 失败 id/now 调用次数 |
| IPC 接线源码契约检查 | 2 | 2 | tasks.ts 无本地恢复函数、registerTaskIPC fail-closed 接线 |
| **合计** | **14** | **21** | 不超过 25 项 |

### 日常开发门禁

| 门禁 | 结果 |
| --- | --- |
| `pnpm.cmd exec vitest run tests/unit/taskService.test.ts tests/unit/taskRepository.test.ts tests/unit/ipcLifecycle.test.ts` | 3 文件 / 88 pass / 0 fail |
| `pnpm.cmd exec eslint main/core/TaskService.ts main/ipc/tasks.ts tests/unit/taskService.test.ts` | 0 error / 19 warning（全部为 tasks.ts 既有 warning，TaskService.ts 0 warning） |
| `git diff --check` | PASS（无空白错误，exit code 0） |

### 候选验收门禁

| 门禁 | 结果 |
| --- | --- |
| `pnpm.cmd run validate` | **PASS**（exit code 0） |
| TypeScript（ts-check） | 0 error |
| ESLint | 0 error / warning 低于 149 冻结上限（`--max-warnings 149` 通过） |
| check:project（IPC/contracts 边界） | PASS |
| 全量测试 | 22 files / 598 pass / 0 fail |
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
- 未修改 `main/main.ts`
- 未修改 `main/ipc/lifecycle.ts`
- 未修改 `tests/unit/taskRepository.test.ts`
- 未修改 `tests/unit/ipcLifecycle.test.ts`
- 未修改 `main/utils/taskLease.ts`（租约算法纯函数不变）
- 未修改 `scripts/`、配置文件、`package.json`、`pnpm-lock.yaml`
- 未触碰 Cookie、Token、账号数据、用户素材、运行数据或 `.env`
- 未进入或修改 `D:\豆包工作室\doubao-studio-main`
- TaskRepository 仍是唯一 tasks.json 写边界（无直接 `writeJSON('tasks.json', ...)`）
- 恢复通过 TaskService 的 `readTasks()` 与 `persist()`，不绕过 Repository
- 恢复变更对 Repository 返回的同一个受追踪快照执行，不创建外来数组交给 `replace`

## 未处理事项和残余风险

1. **`tasks:importCsv` 和 `tasks:validateArtifact` 仍使用 `loadTasks()` 和 `saveTasks()`**——这两个 handler 不属于本轮三个 P0 目标，未做修改。如后续需要统一，可在下一开发包处理。

2. **`loadTasks()` 和 `saveTasks()` 函数仍保留在 `tasks.ts`**——`loadTasks()` 仍被 `tasks:list`、`tasks:getCompletedOutputs`、`tasks:exportDiagnostics`、`tasks:importCsv`、`tasks:validateArtifact` 等 handler 使用；`saveTasks()` 仍被 `tasks:importCsv` 和 `tasks:validateArtifact` 使用。这些函数不在本轮迁移范围内。

3. **IPC 接线使用源码契约检查而非行为测试**——`registerTaskIPC` 依赖 Electron 运行时 API，无法在不新增 IPC 测试基础设施的情况下做稳定行为测试。源码契约检查验证了关键接线正确性，但未模拟运行时恢复失败的实际抛出和清理行为。

4. **CLI/MCP/HTTP 仍未实现**——本包只迁移 Core 业务逻辑，未引入外部接口。

5. **恢复错误消息与 TaskService 返回错误不同**——TaskService 返回 `WRITE_ERROR`（`'任务数据写入失败，请检查磁盘空间和数据目录权限'`），IPC 层抛出 `'任务恢复失败，请检查数据目录和磁盘状态'`。这是有意设计：IPC 层不暴露 TaskService 内部错误消息，使用独立的稳定错误。

## 单一裁决

**PASS**

三个 P0 全部完成；实际修改文件全部位于 4 文件 allowlist；启动恢复业务已从 IPC 迁入 TaskService；恢复失败阻止 IPC 注册批次继续初始化并调用 disposer；无变化时不写回；有变化时只写回一次；所有恢复时间字段来自同一批次时间；前序四个方法 read 异常全部 fail-closed；TaskRepository 仍为唯一 tasks.json 写入边界；IPC、DTO、preload、renderer 未变化；专项 88 pass / 0 fail；完整 validate PASS（598 pass / 0 fail）；受保护资产零修改；无未解决的当前阶段 P0。

## 声明

- 未暂存
- 未提交
- 未推送
- 未创建或修改 PR
- 未部署
- 未启动或重启豆包工作室
- 未触碰运行目录及凭据
