# DOUBAO-ACCEPTED-OBSERVATION-PIPELINE-01 实施交接单

- 日期：2026-09-10
- 状态：代码已实现、自动化测试通过；未人工验收、未执行真实任务、未提交、未推送、未部署
- 工作树：`D:\豆包工作室\doubao-accepted-observation-pipeline-01`
- 分支：`codex/doubao-accepted-observation-pipeline-01`
- 基线：`origin/main@dfbb7f2028bd88caf838c52f5785e3130e594e7a`
- HEAD：`dfbb7f2028bd88caf838c52f5785e3130e594e7a`（全部变更仍未暂存、未提交）

## 治理与冻结验收包

开工前已读取总架构师治理规则、中央 memory、豆包 `AGENTS.md`、README、ROADMAP、DESIGN、2026-09-08 生产使用报告、第二包 handoff 及相关源码测试。仓库没有 `docs/memory/`，未为凑数创建。

本包冻结为三个 P0：

1. 新增 `all_accepted`，不改变 `all_done` / `all_finished` 旧语义；仅“平台明确受理 + 同 run 的 observing 绑定”或历史 done 可满足。
2. 在平台受理后、触发队列前，原子写入并回读脱敏观察绑定；失败进入防重发暂停。
3. 同账号观察期间保持串行，不同账号可在受理后并行；重启/切页沿原会话只读恢复，产物完成时原子绑定 artifact ID 并收口观察。

非目标：未改页面控件就绪状态机、执行意图、local-control/下载端点、批量下载 UI 或 P1 错误码；未操作真实平台。Dola 仍未完成真实验收，不宣称可用。

## 实施结果

### P0-1：`all_accepted`

- Contracts、CSV、持久化归一化和 README/模板均识别 `all_accepted`。
- `submittedAt`、`generating` 或 `submission_uncertain` 本身均不算受理。
- 旧 `done` 任务兼容；带有效观察绑定的已受理任务即使之后观察失败，仍满足“已受理”，但该任务自身禁止重发。

### P0-2：受理观察绑定

- 新增 `acceptanceObservation`：账号、run、原会话 URL、受理时间、最小证据、轮询游标、预期产物、观察租约和 outcome。
- 不保存提示词、页面全文、素材路径、Cookie、Token 或 Session。
- BrowserPanel 只在 `classifySubmissionReadback(...) === confirmed` 后创建绑定。
- 顺序固定为：构造绑定 → 单次 `updateTaskRuntime(status=generating)` → Store 回读核对 → `setAccountAutomationState(generating)` 触发后续调度。
- 写入失败或回读不一致抛 `SubmissionSafetyPauseError`，保留提交意图并禁止自动重发。

### P0-3：恢复、串并行与产物收口

- 同账号存在 observing 任务时，调度器主动跳过该账号；其他账号仍可运行。
- Main 启动恢复和 Renderer reload 均把带有效绑定的 generating 转入 `manual_submission_observing`，清执行锁、不结束 runHistory。
- Webview 就绪后复用既有 `reconcile-task-submission` 只读路径，沿持久化原会话恢复，不新增发送链路。
- 观察租约按已有 15 秒运行快照节流续期；恢复观察时先续租。
- 观察阶段异常转入只读观察，不记普通账号失败、不开放 retry。
- `TaskService.updateStatus(done, outputs)` 使用单一时间源，在同一次 Repository replace 中生成 artifact、写 artifact ID、标记 observation completed。

## 文件清单

Tracked 修改（15）：

- `README.md`
- `examples/tasks-template.csv`
- `main/core/TaskService.ts`
- `main/utils/persistenceNormalization.ts`
- `packages/contracts/src/domain.ts`
- `packages/contracts/src/enums.ts`
- `src/components/BrowserPanel.tsx`
- `src/store/useTaskStore.ts`
- `src/utils/dependencyEval.ts`
- `src/utils/realSendStateMachine.ts`
- `tests/unit/contracts.test.ts`
- `tests/unit/dependencyEval.test.ts`
- `tests/unit/persistenceNormalization.test.ts`
- `tests/unit/real-send-recovery.test.ts`
- `tests/unit/taskService.test.ts`

Untracked 新增（3）：

- `src/utils/acceptedObservation.ts`
- `tests/unit/acceptedObservation.test.ts`
- `docs/handoffs/2026-09-10-doubao-accepted-observation-pipeline-01.md`

Tracked 删除：无。

共 18 文件，未越过冻结 allowlist 的 20% 停止线。

## 门禁证据

- 专项：6 files / 380 tests pass / 0 fail。
- TypeScript：`pnpm run ts-check` PASS。
- 修改文件 ESLint：0 error；告警均为既有类别。
- `git diff --check`：PASS（仅 Git 的 LF→CRLF 工作树提示，无空白错误）。
- 全量 `pnpm run validate`：PASS，exit code 0。
  - 全量测试：49 files / 1013 tests pass / 0 fail。
  - 全量 ESLint：0 error / 146 warnings，低于 149 上限。
  - 工程 fixture、Contracts 边界、Renderer build、Main build：PASS。

## 合并顺序与待验收

第二包 `DOUBAO-VIDEO-PAGE-READINESS-01` 仍位于独立未提交工作树，并与本包在 Contracts、BrowserPanel、持久化归一化等文件有重叠。本包后续候选提交/合并必须排在第二包之后，并人工处理冲突、重跑完整门禁；不得直接覆盖第二包实现。

真实验收需后续单独授权一次普通 5 秒视频，至少验证：不同账号 `all_accepted` 放行、同账号不放行、重启后原会话恢复、单次提交、正确产物绑定且无重复额度消耗。本轮未执行该验收。

## 纪律声明

未暂存、未提交、未推送、未创建或修改 PR；未部署、未发布、未启动或重启豆包工作室；未上传素材、未提交真实视频、未消耗额度；未触碰 Cookie、Token、账号 Session、运行数据、视频产物及其他工作树的未提交现场。

## 验收修复 R1：all_accepted 真实多账号放行
- R1 修复 all_accepted 启动/重启放行与同账号串行判定。
- 触发：前置任务已取得 `acceptanceObservation.outcome=observing`，跨账号后继仍 queued。
- 修复：启动队列评估、unknown 可用性退避复检、同账号 observing 串行。
- 门禁：pnpm run validate PASS，49 files / 1013 tests；pack PASS。
- 真实复验：跨账号后继自动 queued→executing/new_conversation；同账号后继保持 queued；随后取消，未重复提交。
