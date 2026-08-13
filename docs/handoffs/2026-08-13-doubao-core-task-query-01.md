# DOUBAO-CORE-TASK-QUERY-01 冻结验收包 + 实施记录

- 状态：冻结后实施（用户连续授权：提交/推送/Draft PR/CI/Ready/合并；不部署、不启动）
- 基线：`origin/main` `f869d56940f53d9e60dbf03541b6ea95a9f7d651`（PR #17 merge，含产物校验服务化）
- 工作树：`D:\豆包工作室\doubao-core-task-query-01`
- 分支：`glm/doubao-core-task-query-01`
- 治理：`D:\项目架构师\DEVELOPMENT_EFFICIENCY_GOVERNANCE.md` 已读；单开发者自审 + 总架构师复验 + 用户连续授权

## 核心目标

补完 Core 分层读路径：把 `tasks:list`、`tasks:getCompletedOutputs`、`tasks:exportDiagnostics` 任务部分迁入 TaskService 只读查询方法；IPC 不再直接读仓库；删除 `loadTasks`。本包只读、零写入。

## P0 清单

### P0-1：Core 只读查询方法

- `getTasks(): TaskServiceResult<Task[]>`：返回全部任务；read 失败 → `WRITE_ERROR`。
- `getCompletedOutputs(): TaskServiceResult<CompletedOutput[]>`：过滤 `status==='done' && outputs.length>0`，投影 `taskId/prompt/outputs/accountId/mode`（与现有 handler 完全一致）；read 失败 → `WRITE_ERROR`。
- `buildTaskDiagnostics(): TaskServiceResult<Task[]>`：脱敏任务投影（prompt→长度标记、outputs→`[产物地址 N]`、artifacts.url→`[已脱敏]`、attachments/audioAttachment→注入 basename）；read 失败 → `WRITE_ERROR`。
- 三个方法零写入、不调用 `persist`。

### P0-2：IPC 薄适配与 loadTasks 删除

- `tasks:list` / `tasks:getCompletedOutputs`：只调用 Core 查询方法；失败时抛稳定错误（不再裸抛仓库错误）。
- `tasks:exportDiagnostics`：任务部分替换为 `taskService.buildTaskDiagnostics()`，失败返回 `WRITE_ERROR`；账号/下载脱敏与写盘仍留在 IPC（既有边界）。
- `loadTasks` 函数删除（本包后无调用方）；`loadDownloadJobs` 保留。
- 路径脱敏依赖注入：`TaskServiceDependencies.basename?: (value: string) => string`，IPC 注入 `require('path').basename`；Core 默认回退为按 `\`/`/` 截取末段（纯字符串，不依赖 Node path）。Core 零 Electron/路径/仓库直连依赖。

### P0-3：专项测试与契约不变

- 新增专项测试 ≤30 块、优先参数化；IPC 接线使用源码契约检查。
- `packages/contracts/`、preload、renderer、IPC channel 名、返回形状全部不变。

## 允许修改文件（4 文件 allowlist）

- `main/core/TaskService.ts`
- `main/ipc/tasks.ts`
- `tests/unit/taskService.test.ts`
- `docs/handoffs/2026-08-13-doubao-core-task-query-01.md`

## 禁止触碰资产

- `packages/contracts/`、`main/preload.ts`、`src/`、`main/core/TaskRepository.ts`、`main/core/TaskEventStream.ts`、`main/utils/**`
- 配置文件、`package.json`、`pnpm-lock.yaml`、`.github/**`、`scripts/`、`schemas/`
- Cookie、Token、账号数据、运行数据、`.env`、`D:\豆包工作室\doubao-studio-main`

## 行为保持与明确非目标

- 三个 IPC 返回形状与过滤/脱敏语义不变；唯一行为变化：读失败时由「裸抛仓库异常」改为稳定 `WRITE_ERROR`（`tasks:list`/`getCompletedOutputs` 抛稳定错误，`exportDiagnostics` 返回稳定错误）。
- 不做 CLI/MCP/HTTP、不新增 IPC 通道、不做写路径改动、不动 `tasks:validateArtifact` 之外的其他 handler。

## 门禁

- 日常：专项 vitest（taskService/csv/taskRepository）+ 修改文件 eslint + `git diff --check`。
- 候选：`pnpm.cmd run validate`。

## 完成与停止条件

- 三个 P0 全部满足；适用门禁通过；受保护资产零修改；报告与 Git/测试事实一致；最多两轮整改。

---

# 实施记录（2026-08-13，同文件续写）

## 最终 Git 状态（未提交）

- tracked 修改：`main/core/TaskService.ts`（M）、`main/ipc/tasks.ts`（M）、`tests/unit/taskService.test.ts`（M）
- untracked 新增：`docs/handoffs/2026-08-13-doubao-core-task-query-01.md`（本文件）
- 无其他改动；未进入或修改 `D:\豆包工作室\doubao-studio-main`

## 实现要点

- `TaskService` 新增 `getTasks` / `getCompletedOutputs` / `buildTaskDiagnostics` 三个只读方法（零写入）；deps 新增可选 `basename`，默认按 `\`/`/` 截取末段。
- IPC：三个 handler 退化为薄适配；`loadTasks` 删除；TaskService 构造注入 `basename: (value) => require('path').basename(value)`。

## 测试（新增 17 块，≤30 块上限；本包用例无参数化扩展，用例数=块数）

| 分组 | 块数 | 覆盖 |
| --- | --- | --- |
| getTasks | 3 | 返回全部任务与顺序、read 失败 WRITE_ERROR、零写入 |
| getCompletedOutputs | 4 | done+产物过滤、投影字段与顺序、read 失败、零写入 |
| buildTaskDiagnostics | 8 | prompt 长度标记、attachments/audioAttachment 注入 basename、outputs/artifacts 掩码、默认 basename 截取、字段保留、read 失败、零写入 |
| IPC 源码契约 | 2 | list/getCompletedOutputs 薄适配 + loadTasks 删除 + basename 注入；exportDiagnostics 任务部分下沉 |

## 门禁结果（本会话实际执行）

| 门禁 | 结果 |
| --- | --- |
| 专项 vitest（taskService/csv/taskRepository） | 3 files / 199 pass / 0 fail |
| eslint（3 文件） | 0 error / 18 warning（与基线相同，无新增） |
| tsc main / test | 0 error |
| git diff --check | PASS |
| `pnpm.cmd run validate` | **PASS**（22 files / 695 pass / 0 fail；contracts 边界；renderer 3057 modules；main 构建） |

## 受保护资产零修改

- `packages/contracts/`、`main/preload.ts`、`src/`、`main/core/TaskRepository.ts`、`main/core/TaskEventStream.ts`、`main/utils/**`、配置文件、`pnpm-lock.yaml`、`.github/**` 未修改。
- 未触碰 Cookie、Token、账号数据、运行数据、`.env`；未进入或修改 `D:\豆包工作室\doubao-studio-main`。

## 自审裁决（单开发者自审；总架构师复验后按连续授权走 Git 链）

R0 PASS（自审）：三个 P0 全部满足；`loadTasks` 删除后 tasks.ts 只余 `loadDownloadJobs`（下载域）；三个查询 IPC 返回形状与过滤/脱敏语义不变，唯一行为变化为读失败从裸抛仓库异常改为稳定 `WRITE_ERROR`；受保护资产零修改。

## 声明

- 未部署、未启动、未创建 Tag/Release；未触碰运行目录及凭据。