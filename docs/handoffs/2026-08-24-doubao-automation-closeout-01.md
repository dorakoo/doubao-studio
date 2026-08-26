# DOUBAO-AUTOMATION-CLOSEOUT-01 最终候选报告

- 日期：2026-08-24（Asia/Shanghai）
- 状态：`PASS`，未暂存、未提交、未推送、未打包、未部署、未发布
- 工作树：`D:\豆包工作室\doubao-automation-closeout-01`
- 分支：`codex/doubao-automation-closeout-01`
- 基线 / 当前 HEAD：`origin/main@346b4049b15232052fd893c415e4c32e39cb0aa4`

## 1. 治理读取与冻结边界

已读取总架构师治理规则：中央 `memory/INDEX.md`、`DEVELOPMENT_EFFICIENCY_GOVERNANCE.md`、中央 `CURRENT/QUEUE/DEPENDENCIES/ROADMAP`、本仓 `AGENTS.md`、`ROADMAP.md`，以及本组合候选的公开分享、真实发送、多视频、额度/CSV/Dola、账号可用性 handoff。

冻结验收包：把 2026-08-20 至 2026-08-24 的五条自动化整改链迁移到最新主线，人工合并 `BrowserPanel` 与 PR #26 实验直取功能的冲突，保持安全边界，完成专项、全量和 Electron 真实只读验收。禁止触碰生产版、release、安装包、凭据、Cookie、Token；禁止提交付费任务；禁止自动绕过验证码、登录、会员、地区限制和平台风控。

## 2. 合并与行为结果

1. 真实发送：提交意图先持久化，原生点击只执行一次；提交回读不确定时暂停，不自动重发；聊天终态要求提交后真实新增回复并稳定。
2. 多视频：新版视频比例/时长控件按页面实时状态检测；移除高频请求改写路径；阻断项 fail-closed；既有两个 QA 视频任务保留为完成态。
3. 额度与调度：每账号每日 6 个 5 秒单位；按视频时长换算消耗；失败账号不会永久消失，冷却与可用性共同参与自动指派；CSV 导入与 Dola 平台字段贯通。
4. 账号可用性：启动、导航、活跃页、任务前、发送前检测；`ready/action_required/login_required/unavailable/unknown` 五态；非 `ready` 不发送并进入等待处理态；验证码和登录问题只提醒用户处理。
5. 下载：公开分享解析与当前对话手动提取并存。公开分享链只读取页面公开声明的流；实验直取默认关闭、仅手动提取生效，开启必须二次确认风险。
6. 主线兼容：保留 `origin/main@346b404`（PR #26）的实验直取实现与测试，没有用旧候选覆盖主线。

## 3. 实际修改文件

### tracked 修改（26）

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
- `tests/unit/persistenceNormalization.test.ts`
- `tests/unit/schedulingScore.test.ts`
- `tests/unit/taskService.test.ts`
- `tests/unit/videoCapability.test.ts`

### untracked 新增（22，含本报告）

- `docs/handoffs/2026-08-20-doubao-public-share-media-01.md`
- `docs/handoffs/2026-08-20-doubao-task-real-send-recovery-01.md`
- `docs/handoffs/2026-08-24-doubao-account-availability-01.md`
- `docs/handoffs/2026-08-24-doubao-multi-video-acceptance-01.md`
- `docs/handoffs/2026-08-24-doubao-quota-scheduling-csv-dola-01.md`
- `docs/handoffs/2026-08-24-doubao-automation-closeout-01.md`
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

真正的 tracked 删除：0。

## 4. 自动化门禁

- 专项组合：14 files / 447 tests，全部通过。
- `pnpm run validate`：PASS。
- TypeScript：0 error。
- ESLint：0 error / 143 warnings，低于 149 上限。
- 项目结构与 Contracts 边界检查：PASS。
- 全量 Vitest：34 files / 807 tests，全部通过。
- Renderer build：PASS。
- Main build：PASS。
- `git diff --check`：PASS。

## 5. Electron 真实只读验收

- 开发版从本工作树启动，Vite `127.0.0.1:5173`、Electron CDP `9333`；IPC 全注册，无崩溃。
- 13 个账号中仅 4 个进入 `ready`：本人豆包、本人豆包2、hll豆包、hll2。
- 其余 9 个均 fail-closed：6 个 `login_required`，3 个 `unknown/待确认`；没有误放行。
- 两个既有 QA 多视频任务仍显示已完成，未删除、未重跑、未消耗新额度。
- 公开分享解析弹窗可打开和取消；没有提交 URL、没有下载。
- 实验直取存储值为未设置（关闭）；点击开关会出现风险二次确认，取消后仍关闭。
- 控制台仅有开发环境既有 Ant Design 静态 message 与 Electron CSP 警告；页面错误列表为空。

## 6. 受保护资产与停止声明

原始工作树 `D:\豆包工作室\doubao-public-share-media-01` 保持未清理、未暂存、未提交，作为迁移前证据。生产运行目录、release、安装包、用户数据、凭据、Cookie、Token 均未修改。未提交任何对话、视频或付费任务；未自动处理验证码或登录。

本候选已实现并通过本地自动化与 Electron 真实只读验收；CI、提交、推送、PR、合并、打包、部署、发布均未执行，必须继续作为独立状态处理。

## 7. 单一裁决

`PASS`：组合候选已安全迁到最新主线，冲突已收敛，门禁和真实只读验收通过。下一动作仅可在用户独立授权后逐文件暂存 48 个候选文件并创建单一候选提交。
