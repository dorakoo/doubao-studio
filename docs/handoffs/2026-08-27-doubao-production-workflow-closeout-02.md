# DOUBAO-PRODUCTION-WORKFLOW-CLOSEOUT-02 合并交付记录

- 日期：2026-08-27（Asia/Shanghai）
- 工作树：`D:\豆包工作室\doubao-automation-closeout-01`
- 分支：`codex/doubao-startup-webview-recovery-01`
- 基线 HEAD：`83a328ae576a84a1094164535526d7a1fd50b30e`（执行前与 `origin/main` 一致）
- 本记录生成时状态：候选未暂存、未提交、未推送；用户已授权完成提交、合并 `main` 与推送。

## 1. 治理读取与冻结验收包

开工前已读取总架构师 `memory/INDEX.md`、`DEVELOPMENT_EFFICIENCY_GOVERNANCE.md`、仓库 `AGENTS.md`、相关最新 handoff、README、ROADMAP、DESIGN 与实际源码。仓库不存在 `docs/memory/INDEX.md`、`CURRENT.md`、`DEPENDENCIES.md`、`QUEUE.md`，按实际缺失记录。

本次冻结验收包：

1. P0-1：启动/Webview 恢复与账号前台交互连续性。
2. P0-2：上传、控件、提交、素材授权和推广弹窗的安全状态机。
3. P0-3：CSV 拖放、显式写入 CLI、额度耗尽重排和本地自然日刷新。
4. P1：分隔条性能与跨 Webview 松手体验。
5. 文档收口：重写 GitHub 首页 README，以匿名 SVG 图文完整说明项目、新特性和使用路径。

停止边界：不提交真实平台任务、不消耗额度、不读取或提交 Cookie/Token/Session，不提交用户数据与产物，不打包、不部署、不创建 Tag/Release。

## 2. 核心行为变化

- 任务在配置、上传和提交期间持有前台交互账号租约；用户查看其他账号不会破坏执行上下文。
- 参考素材与提交控件必须连续稳定；提交意图先落盘，平台结果不确定时停止而非重发。
- 素材授权由用户人工确认；确认可能触发提交时只回读同一 run 并继续绑定产物。
- 只对白名单推广弹窗自动清障，不误关登录、人机验证、额度、授权或未知弹窗。
- CSV 可通过按钮、拖放或受控 CLI 导入；CLI 复用 Core Service，数据漂移 fail-closed。
- 平台明确额度耗尽后清空当日预测剩余并改派；本机时区 00:00 刷新预测额度并重新调度。
- 分隔条使用预览线和单次状态提交，透明捕获层解决 Webview 吞掉 `mouseup`。

## 3. 实际候选文件

候选共 41 个文件：22 个 tracked 修改、19 个 untracked 新增、0 个 tracked 删除。

### tracked 修改（22）

- `AGENT_EXECUTION_PLAN.md`
- `README.md`
- `main/cli/doubaoCliEntry.ts`
- `main/ipc/accounts.ts`
- `main/ipc/tasks.ts`
- `main/main.ts`
- `main/preload.ts`
- `main/utils/videoQuota.ts`
- `package.json`
- `packages/contracts/src/dto/electron-api.ts`
- `packages/contracts/src/dto/tasks.ts`
- `src/App.tsx`
- `src/components/AccountList.tsx`
- `src/components/BrowserPanel.tsx`
- `src/components/Sidebar.tsx`
- `src/components/TaskConsole.tsx`
- `src/store/useAccountStore.ts`
- `src/store/useTaskStore.ts`
- `src/styles/global.css`
- `src/utils/doubaoBridge.ts`
- `tests/unit/real-send-recovery.test.ts`
- `tests/unit/taskService.test.ts`

### untracked 新增（19）

- `docs/assets/README-hero.svg`
- `docs/assets/README-workflow.svg`
- `docs/handoffs/2026-08-27-doubao-csv-production-experience-01.md`
- `docs/handoffs/2026-08-27-doubao-startup-webview-recovery-01.md`
- `docs/handoffs/2026-08-27-doubao-video-interaction-continuity-01.md`
- `docs/handoffs/2026-08-27-doubao-production-workflow-closeout-02.md`
- `main/utils/rendererStartup.ts`
- `src/utils/accountStartupSelection.ts`
- `src/utils/csvDrop.ts`
- `src/utils/dailyReset.ts`
- `src/utils/interactiveAccount.ts`
- `src/utils/materialAuthorization.ts`
- `src/utils/promotionalPopup.ts`
- `src/utils/quotaRecovery.ts`
- `src/utils/resizeMath.ts`
- `src/utils/uploadReadiness.ts`
- `tests/unit/csvProductionExperience.test.ts`
- `tests/unit/interactionContinuity.test.ts`
- `tests/unit/startupRecovery.test.ts`

## 4. 验证证据

- `pnpm run validate`：PASS。
- TypeScript：0 error。
- ESLint：0 error / 143 warning，未超过 149 上限。
- 工程结构：52 个 handle/invoke、3 个 on/send；Contracts 边界 PASS。
- Vitest：37 files / 869 tests，全部通过。
- Renderer build：PASS；Main build：PASS。
- README 两个 SVG 均通过 XML 解析；全部 README 本地链接存在。
- `git diff --check`：PASS。

Windows Computer Use 在本轮返回 `Sky runtime unavailable`，因此没有虚构真实桌面拖放、弹窗或平台提交验收；实现和自动化门禁通过不等于已部署或已发布。

## 5. 受保护资产与五态

- `data/**`、`release/**`、`scripts/**`、用户素材、任务数据、Cookie、Token、Session 零修改。
- 实现：完成；本地自动化验收：通过；CI：待推送后回读；人工平台验收：此前部分场景已由用户反馈，当前组合候选未执行新的真实提交；部署：未执行；发布：未执行。
- README 使用匿名账号和虚构任务的仓库内 SVG，不提交用户截图或真实账号名。

## 6. 本地裁决

PASS。候选可按用户授权创建单一提交，合并到最新 `origin/main` 并推送；推送后仍不得表述为已部署或已发布。
