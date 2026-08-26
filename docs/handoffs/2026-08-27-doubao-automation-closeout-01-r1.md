# DOUBAO-AUTOMATION-CLOSEOUT-01-R1 最终合并验收记录

- 日期：2026-08-27（Asia/Shanghai）
- 工作树：`D:\豆包工作室\doubao-automation-closeout-01`
- 分支：`codex/doubao-automation-closeout-01`
- 基线：`origin/main@346b4049b15232052fd893c415e4c32e39cb0aa4`
- 状态：本地候选验收 PASS；本记录生成时尚未提交、推送、创建 PR、合并、打包、部署或发布。
- supersedes：`2026-08-24-doubao-automation-closeout-01.md` 中的 48 文件、807 测试和当时的候选状态；历史文件保留不改。

## 治理读取与冻结验收包

已重新读取中央 `memory/INDEX.md`、`DEVELOPMENT_EFFICIENCY_GOVERNANCE.md`、本仓 `AGENTS.md`、组合候选与视频控件相关 handoff，并核对真实 Git、远端主线、工作树、测试和 Electron 页面。该工作树没有 `docs/memory/`，因此不存在可读取的项目 memory 文件。

本次冻结为一个核心目标：复验并收口 2026-08-20 至 2026-08-27 的豆包自动化组合候选。

- P0-1：候选文件、凭据与受保护资产边界准确，无未知文件混入。
- P0-2：真实发送、账号可用性、额度/调度、CSV/Dola、公开媒体、视频控件慢加载整改通过本地门禁和无提交真实回读。
- P0-3：用户授权后创建单一候选提交，推送、建立 PR、等待 CI，通过后合并；部署、打包和发布不在本次范围。

禁止事项：不修改或读取凭据、Cookie、Token、用户运行数据；不提交对话或视频任务；不消耗额度；不打包、不部署、不启动或重启生产版。

## 核心行为证据

1. 真实发送只允许每个 run 一次副作用；提交意图先持久化，结果不确定时暂停而非自动重发。
2. 多行/中文提示词禁止裸 Enter 逐段发送；发送前必须精确回读完整提示词。
3. 每账号每日 6 个 5 秒单位；失败、冷却、登录/验证状态参与指派但不永久删除账号。
4. CSV 保留完整提示词与视频配置；Dola 平台字段贯通，平台不匹配时 fail-closed。
5. 视频入口、权威参数控件和精确模型选项使用有界轮询；入口失败不得继续配置、上传或发送。
6. 2026-08-26/27 无提交真实复验在约 1.68 秒后回读 `Seedance 2.0 Fast` 与 `自动 · 10s`；没有提示词、上传、发送、生成或额度消耗。
7. 公开分享与当前对话媒体提取保持人工触发；实验直取默认关闭并要求风险二次确认。

## 实际候选文件

本记录加入后共 53 文件：28 个 tracked 修改、25 个 untracked 新增、0 个 tracked 删除。

### tracked 修改（28）

- `main/core/TaskService.ts`
- `main/ipc/accounts.ts`
- `main/ipc/tasks.ts`
- `main/preload.ts`
- `main/utils/persistenceNormalization.ts`
- `packages/contracts/src/domain.ts`
- `packages/contracts/src/dto/accounts.ts`
- `packages/contracts/src/dto/electron-api.ts`
- `packages/contracts/src/dto/tasks.ts`
- `packages/contracts/src/enums.ts`
- `packages/contracts/src/index.ts`
- `src/components/AccountList.tsx`
- `src/components/BrowserPanel.tsx`
- `src/components/TaskConsole.tsx`
- `src/components/TaskDetailModal.tsx`
- `src/store/useAccountStore.ts`
- `src/store/useTaskStore.ts`
- `src/types/index.ts`
- `src/utils/doubaoBridge.ts`
- `src/utils/schedulingScore.ts`
- `src/utils/videoCapability.ts`
- `tests/unit/contracts.test.ts`
- `tests/unit/csv.test.ts`
- `tests/unit/persistenceNormalization.test.ts`
- `tests/unit/schedulingScore.test.ts`
- `tests/unit/taskService.test.ts`
- `tests/unit/videoArtifactIntegration.test.ts`
- `tests/unit/videoCapability.test.ts`

### untracked 新增（25）

- `docs/handoffs/2026-08-20-doubao-public-share-media-01.md`
- `docs/handoffs/2026-08-20-doubao-task-real-send-recovery-01.md`
- `docs/handoffs/2026-08-24-doubao-account-availability-01.md`
- `docs/handoffs/2026-08-24-doubao-automation-closeout-01.md`
- `docs/handoffs/2026-08-24-doubao-multi-video-acceptance-01.md`
- `docs/handoffs/2026-08-24-doubao-quota-scheduling-csv-dola-01.md`
- `docs/handoffs/2026-08-24-doubao-submission-reconciliation-01.md`
- `docs/handoffs/2026-08-24-doubao-video-control-adapter-01.md`
- `docs/handoffs/2026-08-27-doubao-automation-closeout-01-r1.md`
- `main/utils/publicShareMedia.ts`
- `main/utils/videoQuota.ts`
- `src/utils/accountAssignment.ts`
- `src/utils/accountAvailability.ts`
- `src/utils/autoAssignment.ts`
- `src/utils/queueAccountDecision.ts`
- `src/utils/realSendStateMachine.ts`
- `src/utils/videoQuota.ts`
- `tests/unit/accountAssignment.test.ts`
- `tests/unit/accountAvailability.test.ts`
- `tests/unit/autoAssignment.test.ts`
- `tests/unit/mainVideoQuota.test.ts`
- `tests/unit/publicShareMedia.test.ts`
- `tests/unit/queueAccountDecision.test.ts`
- `tests/unit/real-send-recovery.test.ts`
- `tests/unit/videoQuota.test.ts`

## 本地门禁

- `pnpm run validate` 各阶段通过；最终增补轮询测试后又分别重跑全量测试、TypeScript、Lint、diff-check 与 Renderer/Main build。
- TypeScript：0 error。
- ESLint：0 error / 143 warning，低于 149 上限。
- 项目结构、IPC 与 Contracts 边界检查：PASS。
- Vitest：34 files / 835 tests，全部通过。
- `videoCapability` 专项：71/71。
- Renderer build：PASS；Main build：PASS。
- `git diff --check`：PASS。
- 候选敏感字扫描：未发现凭据、Token、Cookie 或生产数据。

## 受保护资产与状态分离

未修改生产运行目录、release、安装包、用户数据、凭据、Cookie 或 Token。没有提交真实对话/视频任务，没有上传素材，没有消耗额度。实现与本地测试已通过；CI、合并状态将在 Git 链执行后以 GitHub 实际证据补充。打包、部署、发布均不属于本次授权范围。

## 本地裁决

PASS。候选与最新 `origin/main@346b404` 对齐，无已知 P0 阻断，可进入用户已授权的提交、PR CI 与合并链。
