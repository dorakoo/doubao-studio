# DOUBAO-UI-CAPABILITY-REFRESH-01 交接报告

## 治理与冻结范围

已完整读取中央记忆入口、开发效率治理、中央 CURRENT/DEPENDENCIES/QUEUE/ROADMAP、项目 AGENTS.md、README、ROADMAP、DESIGN、AGENT_EXECUTION_PLAN、GLM_NEXT_TASK 和相关源码/测试。

本包只有一个核心目标和三个 P0：新 UI 只读能力快照、Provider Adapter/选择器适配、会员门槛 fail-closed。没有 P1。未扩展到 Core/CLI/G-302、Alice Agent 或真实生成。

## 基线

- 仓库：`D:\豆包工作室\doubao-studio-main`
- 分支：`glm/g-405-persistence-normalization`
- HEAD：`850bfbf030a3e8ffa8a8a6927d9ffe6fb2be199e`（本任务未提交）
- 现存 `AGENTS.md` 修改保持不变，未覆盖、恢复或暂存。

## P0 结果

### P0-1 新 UI 只读能力快照

- 新增纯函数能力观察器，记录 `observed_at`、账户层级、页面 URL、适配器版本和 observed/partial/unknown 状态。
- 只读识别新主入口、Seedance/Seedream 模型、4–15 秒、视频/图片比例和会员动作文字。
- 缺失或歧义返回 unknown，不猜价格、倍率、免费权益或账户资格。
- Adapter self-check 将机器可读快照写入报告项；整个过程只读取 DOM，不点击生成、购买或升级。

### P0-2 Adapter 与配置适配

- Adapter 版本升至 `2.0.0-20260731`，更新时长、新入口和会员弹窗识别。
- 增加 Seedance 2.5，视频时长类型、IPC CSV 校验、持久化归一化和 UI 选择范围统一为 4–15 秒。
- 默认时长由 15 秒改为 10 秒。模型倍率只显示“页面实时显示”，不固化截图倍率。
- 视频 DOM 配置仅选择页面可见选项；dry-run 结果固定 `finalSubmit=false`。

### P0-3 会员门槛 fail-closed

- 11–15 秒只有页面实时明确 `selectable` 才可继续；出现会员动作或缺少证据均阻断。
- BrowserPanel 已删除手动 15 秒开关、页面加载注入和自动任务请求改写调用。
- 历史导出入口固定返回 false，不访问 Webview；行为测试证明不能重新启用。
- 阻断发生在提示词提交、额度扣减和产物轮询前。

## 实际业务/测试修改文件（12 个）

1. `src/automation/doubaoCapability.ts`（新增）
2. `src/automation/doubaoAdapter.ts`
3. `src/utils/videoCapability.ts`
4. `src/utils/doubaoBridge.ts`
5. `src/components/BrowserPanel.tsx`
6. `src/components/TaskConsole.tsx`
7. `src/types/index.ts`
8. `packages/contracts/src/enums.ts`
9. `main/ipc/tasks.ts`
10. `main/utils/persistenceNormalization.ts`
11. `tests/unit/videoCapability.test.ts`
12. 本 handoff

中央安排阶段已经存在的 `GLM_NEXT_TASK.md`、`ROADMAP.md`、优先级 handoff 和受保护 `AGENTS.md` 不属于本功能包改动。

## 验证

- 新增专项测试：8 项（总文件 46/46 pass）。
- 相关回归：6 文件，224/224 pass。
- `pnpm.cmd run ts-check`：通过。
- 全局 Lint：0 error，145 warning，低于仓库冻结上限 149。
- `pnpm.cmd run validate`：退出码 0；15 文件、487 测试全部通过；工程结构、contracts 边界和生产构建通过。
- `git diff --check`：无本任务空白错误，仅 Git 的 CRLF 转换警告。

## 能力证据边界

用户截图于 2026-07-31 观察到当前账户视频 4–15 秒、11–15 秒出现会员购买窗口、新模型/比例/入口。该事实只作为带时间与账户上下文的适配输入，不是平台永久规则。本任务没有登录或控制真实豆包页面，因此没有伪造“真实页面已人工冒烟通过”。

## 安全声明与状态

- 未真实生成视频或图片，未消耗额度。
- 未购买会员，未点击支付/升级，未绕过会员限制。
- 未读取或输出 Cookie、Token、签名、`.env`、支付信息或账号隐私。
- 未修改 Alice Agent、ERP、Discord Workspace 或 PR #21 工作副本。
- 已实现：是；已测试：是；已提交：否；已推送：否；已部署：否；已发布：否。

## 分流事项

- 历史请求改写实现的物理删除可作为后续独立清理包；当前生产调用面和启用入口已移除并固定拒绝。
- 真实页面手工 dry-run/selector 冒烟需用户后续单独授权并在不点击最终生成的前提下执行。
- Seedream 具体生成参数写入、风格/模板自动选择和倍率展示属于 NEXT，不进入本冻结包。

## R1 最小整改

总架构师复核发现 dry-run 在 11–15 秒且会员可用性为 unknown 时仍可能返回 ready。R1 只修改原 P0-3 的纯函数与既有测试：11–15 秒现在只有显式 `selectable` 才返回 ready，`unknown` 和 `action_required` 均返回 `membership_required`。参数化测试覆盖 unknown/selectable；相关回归 224/224、TypeScript、任务文件 Lint 和 diff-check 全部通过。未增加文件或功能范围。完整 validate 的 487 项结果产生于 R1 前；按治理规则本次最小整改未重复运行候选级全量门禁。
