# DOUBAO-ACCOUNT-AVAILABILITY-01 实施与验收报告

- 日期：2026-08-24
- 工作树：`D:\豆包工作室\doubao-public-share-media-01`
- 分支：`codex/doubao-public-share-media-01`
- 基线/HEAD：`efa646a2ac51773889c509b18b0c5a5b0df7f9f4`（本包未提交）
- 状态：实现完成，自动门禁通过，本机开发版人工验收通过；未提交、未推送、未打包、未部署、未发布。

## 治理声明

已读取总架构师治理文件、本仓 `AGENTS.md`、`ROADMAP.md` 与前序
`2026-08-24-doubao-quota-scheduling-csv-dola-01.md`。本包不绕过 CAPTCHA，不自动登录，不读取 Cookie，不绕过 Dola 地区限制。

## 冻结验收包

1. P0-1：统一 `ready / action_required / login_required / unavailable / unknown` 账号可用性状态机，持久化脱敏原因、提示、时间和触发点。
2. P0-2：在软件打开、页面导航、活跃页面心跳、任务前和发送前执行只读探测；不是 `ready` 时不发送，任务进入 `waiting_verification`。
3. P0-3：账号列表展示检测状态/时间/处理提示，提供“立即检测可用性”，异常账号合并提醒，自动指派与已指派队列统一避开不可用账号。

## 核心行为与根因修正

- 只读页面证据包括 URL、可见异常/验证层、验证 iframe、可写编辑器、明确登录控件和已登录导航控件；不读取 Cookie 或密钥。
- 确认豆包匿名页也有输入框，且“登录”按钮比输入框晚渲染。修正后，Doubao 的 `ready` 必须同时看到已登录导航证据；否则保持 `unknown` 并等待复检。
- 启动后先使上次运行持久化的 `ready` 失效，再执行快速、稳定化和 15 秒最终复检，防止多 webview 并行启动时残留假可用结果。
- 活跃账号页面每 30 秒低频只读复检；任务执行期间停用该心跳，由 `pre_task / pre_submit` 门禁接管，避免并发探测干扰。
- 人机验证、登录失效、平台异常、地区限制、平台页错配和无法识别页面均 fail-closed；系统不会代解验证或自动重发。
- `waiting_verification` 任务在释放执行锁后提供“完成处理后重新执行”；重新入队时会再走账号门禁，真正的 `executing/generating` 仍禁止重试。
- 旧菜单“刷新会话”改名为“清除登录并刷新”，避免用户误触导致 Session 被清除。

## 本包涉及文件

> 当前是多包组合未提交现场；下列文件中部分同时包含前序真实发送、多视频和额度/CSV/Dola 候选改动，不能把整个 diff 都归因于本包。

### tracked 修改

- `main/core/TaskService.ts`
- `main/ipc/accounts.ts`
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
- `src/utils/schedulingScore.ts`
- `tests/unit/contracts.test.ts`
- `tests/unit/persistenceNormalization.test.ts`
- `tests/unit/schedulingScore.test.ts`
- `tests/unit/taskService.test.ts`

### untracked 新增

- `src/utils/accountAvailability.ts`
- `src/utils/queueAccountDecision.ts`
- `tests/unit/accountAvailability.test.ts`
- `tests/unit/queueAccountDecision.test.ts`
- `docs/handoffs/2026-08-24-doubao-account-availability-01.md`

无 tracked 删除。

## 门禁与真实验收

- 账号可用性专项：17/17 PASS。
- 调度/队列/自动指派相关组合：45/45 PASS。
- `pnpm run validate`：PASS；33 files / 794 tests PASS，0 fail。
- TypeScript：0 error。
- ESLint：0 error / 143 warnings，低于 149 上限。
- 工程结构、Contracts 边界、Renderer 构建、Main 构建：PASS。
- `git diff --check`：PASS。
- 开发版真实启动验收（Electron CDP 9333）：13 个隔离账号页面全部回读；结果精确为 4 个 `ready` + 9 个 `login_required`。
- 4 个实际可用账号：本人豆包、本人豆包2、hll2、hll豆包；与用户已给名单完全一致。
- 真实汇总提醒已回读：“9 个账号需要处理”，预览 4 个并标记另有 5 个；无逐账号弹窗轰炸。
- 未提交付费视频任务；无额度消耗。真实验收只更新了 `accounts.json` 中的脱敏可用性证据。

## 受保护边界与停止声明

- 未读取或修改 Cookie、Token、密码、生产数据库、release 目录或安装包。
- 未自动登录、未自动处理验证、未尝试绕过风控/地区/会员限制。
- 未新建或发送测试对话/视频，未修改现有两个已成功 QA 视频任务。
- 开发版仍在运行供用户继续验收；未对生产版执行启动、重启或部署。

## 裁决

**PASS**。账号可用性检测已在启动、页面变化、任务前和发送前形成 fail-closed 闭环；真实账号结果与用户已知现状一致。
