# DOUBAO-CORE-TASK-VALIDATE-ARTIFACT-01 冻结验收包

- 状态：冻结定稿，待总架构师/用户确认后实施
- 基线：`origin/main` `c9ea2f62ed8412607edda2d06fa55ce49f4625d0`（PR #16 merge，含 CSV 导入服务化）
- 工作树：`D:\豆包工作室\doubao-core-task-validate-artifact-01`
- 分支：`glm/doubao-core-task-validate-artifact-01`
- 治理：`D:\项目架构师\DEVELOPMENT_EFFICIENCY_GOVERNANCE.md` 已读；单开发者自审 + 总架构师验收 + 用户逐项授权

## 核心目标

把 `tasks:validateArtifact` 的产物校验业务迁入 TaskService：Core 负责任务/产物查找、四态状态机（valid/expired/invalid/unknown）、单一时间源与 Repository fail-closed 持久化；IPC 仅保留 Electron 网络探针（session/partition）的注入与结果映射。顺带消除 `saveTasks` 忽略返回值的残余风险——本包完成后 `saveTasks` 无调用方，直接删除。

## P0 清单

### P0-1：Core `validateArtifact` 纯业务方法

- 新增 `TaskService.validateArtifact(params: TaskValidateArtifactParams): Promise<TaskServiceResult<TaskValidateArtifactData>>`。
- 查找任务与产物：任务或产物不存在 → `{ success: false, error: '产物不存在' }`，零探针/零时钟/零写入。
- 探针依赖注入：`TaskServiceDependencies` 新增可选 `probeArtifact?: (artifact: TaskArtifact, assignedAccountId: string | null) => Promise<ArtifactProbeResult>`；未注入时返回 `{ success: false, error: '产物验证不可用' }`。Core 不依赖 Electron、session、partition 或 accounts.json。
- 四态判定（保持现有语义）：
  - `response` 且 statusCode 2xx（含 206）→ `valid`；401/403/404/410 → `expired`；其余 → `invalid`；`contentType`/`contentLength`/`statusCode` 落盘。
  - `timeout` → `unknown` + `error: '验证超时'`。
  - `error` → `invalid` + `error: message`。
- 单一时间源：`this.now()` 单次调用，同时用于 `validation.checkedAt` 与 `task.updatedAt`。
- 返回数据：`{ valid: state === 'valid', artifact }`；IPC 按既有 `TaskValidateArtifactResult` 形状映射（success/artifact/error）。

### P0-2：Repository fail-closed 与残余风险消除

- `readTasks()` 失败 → `WRITE_ERROR`，零探针/零时钟/零写入。
- `persist()` 失败（返回 false 或抛出，含陈旧快照/未追踪快照）→ `WRITE_ERROR`，不返回 artifact、不返回成功。
- `tasks.ts` 删除 `saveTasks` 函数（本包后无调用方）；`loadTasks` 保留（`tasks:list`、`tasks:getCompletedOutputs`、`tasks:exportDiagnostics` 仍使用）。

### P0-3：IPC 薄适配与专项测试

- `tasks:validateArtifact` handler 只保留：调用 `taskService.validateArtifact(params)`、结果形状映射、固定脱敏兜底错误 `'产物验证失败，请检查网络和数据目录状态'`（catch 不使用 `err.message`）。
- 探针函数定义在 `tasks.ts`（IPC 边界）：accounts.json partition 解析、`session.fromPartition`、15s AbortController、`Referer`/`Range: bytes=0-0`、`response.body?.cancel()`；AbortError → `timeout`，其他异常 → `error`。
- 新增专项测试 ≤30 块，优先 it.each 参数化；IPC 接线使用源码契约检查（符合既有允许方案）。

## 允许修改文件（4 文件 allowlist）

- `main/core/TaskService.ts`
- `main/ipc/tasks.ts`
- `tests/unit/taskService.test.ts`
- `docs/handoffs/2026-08-13-doubao-core-task-validate-artifact-01.md`

## 禁止触碰资产

- `packages/contracts/`（类型、DTO、preload API、enums、domain 全部零修改）
- `main/preload.ts`、`src/`（renderer）、`main/core/TaskRepository.ts`、`main/core/TaskEventStream.ts`、`main/utils/**`
- 配置文件、`package.json`、`pnpm-lock.yaml`、`.github/**`、`scripts/`、`schemas/`
- Cookie、Token、账号数据、运行数据、`.env`、`D:\豆包工作室\doubao-studio-main`

## 行为保持与明确非目标

- 四态判定语义与 IPC 返回形状不变；唯一行为变化：持久化失败由「静默忽略、仍可能返回 success」改为 fail-closed `WRITE_ERROR`。
- 网络错误消息沿用 `err.message` 透传（现有行为；产物 URL 为 renderer 已知地址，非凭据）。
- 不做自动重试、批量校验、只读查询、CLI/MCP/HTTP 接口。

## 测试计划

- 服务层（约 18–20 块，参数化优先）：四态判定（it.each×多状态码）、timeout、network error、任务/产物不存在零写入、read 失败零探针/零时钟/零写、replace=false 与陈旧快照 fail-closed、单一时间源、探针参数传递（artifact + assignedAccountId）、success 标志映射、未注入探针 fail-closed。
- IPC 源码契约（2 块）：handler 不含四态业务实现且调用 `taskService.validateArtifact(`；`saveTasks` 已删除、脱敏兜底存在。

## 门禁

- 日常开发门禁：`pnpm.cmd exec vitest run tests/unit/taskService.test.ts tests/unit/taskRepository.test.ts`、修改文件 eslint、`git diff --check`。
- 候选验收门禁：`pnpm.cmd run validate`（全量测试 + contracts 边界 + renderer/main 构建）。

## 完成与停止条件

- 三个 P0 全部满足；无未解决当前阶段 P0；适用门禁通过；受保护资产零修改；报告与 Git/测试事实一致。
- 最多两轮整改（R1/R2）；R2 后未过则缩小范围或重开根因包，禁止 R3 链。
- 不部署、不启动、不创建 Tag/Release；Git/PR/CI/合并按用户逐项授权执行。

---

# 实施记录（2026-08-13，同文件续写）

## 最终 Git 状态（未提交）

- tracked 修改：`main/core/TaskService.ts`（M）、`main/ipc/tasks.ts`（M）、`tests/unit/taskService.test.ts`（M）
- untracked 新增：`docs/handoffs/2026-08-13-doubao-core-task-validate-artifact-01.md`（本文件）
- 无其他改动；未进入或修改 `D:\豆包工作室\doubao-studio-main`

## 实现要点

- `TaskService` 新增：`TaskValidateArtifactResultData`、`ArtifactProbeResult`、`ArtifactProbe` 类型；`deps.probeArtifact` 可选注入；`async validateArtifact(params)`（查找 → 探针 → 四态判定 → 单一时钟 → 单次 replace fail-closed）。
- IPC：`createArtifactProbe()`（accounts.json partition 解析、`session.fromPartition`、15s AbortController、`Referer`/`Range: bytes=0-0`、`response.body?.cancel()`；AbortError→`timeout`、其他→`error`）；`taskService` 构造注入 `probeArtifact`；handler 退化为薄适配 + 固定脱敏兜底 `'产物验证失败，请检查网络和数据目录状态'`；`saveTasks` 函数删除（全仓无引用）。
- 行为差异（本包唯一）：持久化失败由「静默忽略、仍可能返回 success」改为 fail-closed `WRITE_ERROR`；四态判定语义与 IPC 返回形状保持。

## 测试（新增 17 块 / 28 用例，≤30 块上限）

| 分组 | 块数 | 覆盖 |
| --- | --- | --- |
| validateArtifact 基本功能 | 11 | 四态判定（it.each：valid×4 / expired×4 / invalid×6）、响应元数据落盘、timeout、网络错误、任务/产物不存在零探针零写、单一时钟、探针参数传递、单次 replace |
| validateArtifact fail-closed | 4 | read 失败零探针/零时钟/零写、replace=false、陈旧快照、未注入探针 |
| IPC 源码契约 | 2 | handler 不含四态业务实现、脱敏兜底 + `saveTasks` 已删除 |

## 门禁结果（本会话实际执行）

| 门禁 | 结果 |
| --- | --- |
| 专项 vitest（taskService/csv/taskRepository） | 3 files / 182 pass / 0 fail |
| eslint（3 文件） | 0 error / 18 warning（1 既有 complexity + 17 既有 no-explicit-any，无新增） |
| tsc main / test | 0 error |
| git diff --check | PASS |
| `pnpm.cmd run validate` | **PASS**（22 files / 678 pass / 0 fail；contracts 边界；renderer 3057 modules；main 构建） |

## 受保护资产零修改

- `packages/contracts/`、`main/preload.ts`、`src/`、`main/core/TaskRepository.ts`、`main/core/TaskEventStream.ts`、`main/utils/**`、配置文件、`pnpm-lock.yaml`、`.github/**` 未修改。
- 未触碰 Cookie、Token、账号数据、运行数据、`.env`；未进入或修改 `D:\豆包工作室\doubao-studio-main`。

## 自审裁决（单开发者自审；待总架构师复验与用户逐项授权）

R0 PASS（自审）：三个 P0 全部满足；冻结包无偏离；唯一行为变化即冻结包声明的 fail-closed 修复；专项与 validate 门禁实际执行通过。

## 声明

- 未暂存、未提交、未推送、未创建或修改 PR
- 未部署、未启动、未创建 Tag/Release
- 未触碰运行目录及凭据
