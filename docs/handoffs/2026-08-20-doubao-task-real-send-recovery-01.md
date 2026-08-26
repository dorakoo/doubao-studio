# DOUBAO-TASK-REAL-SEND-RECOVERY-01（2026-08-20）——实现完成、人工验收 PASS、保持未提交态

- 声明：已读 `D:\项目架构师\memory\INDEX.md`、`DEVELOPMENT_EFFICIENCY_GOVERNANCE.md`、本仓 `AGENTS.md`，冻结验收包按提示词全文执行。
- 状态：**实现完成 + 专项/全量测试全绿 + 单账号与双账号真实人工验收 PASS；未提交、未推送、未创建 PR、未部署、未打包**（按提示词停在未提交态，等待架构师复验）。

## 基线

- 工作树：`D:\豆包工作室\doubao-public-share-media-01`；分支 `codex/doubao-public-share-media-01`；HEAD `efa646a`（= origin/main@efa646a）。
- 受保护现场（未触碰）：公开分享媒体候选 9 个修改 + 3 个新增（main/ipc/tasks.ts、preload、contracts、TaskConsole、TaskDetailModal、publicShareMedia.ts 等）+ 发送修复候选。

## 实际修改文件（本轮）

- tracked 修改：`src/components/BrowserPanel.tsx`、`src/utils/doubaoBridge.ts`（发送修复候选基础上本轮增量）
- untracked 新增：`src/utils/realSendStateMachine.ts`、`tests/unit/real-send-recovery.test.ts`
- 新增文档：`docs/handoffs/2026-08-20-doubao-task-real-send-recovery-01.md`（本文件）

## 根因与状态机设计

- 根因：`startNewConversation` 全页扫描「新对话」文本猜测点击任意控件，找不到按钮时**无证据返回成功**；页面结构变化后新对话实际未建立，任务卡死在「准备执行→创建新对话」。
- P0-1 状态机（`startNewConversation` 重写）：导航官方新会话入口 `/chat/` → 输入框可用（waitForChatReady）→ 编辑器存在且可聚焦（可写入）→ 会话无已有用户内容（新会话语义）；任一失败返回脱敏 reason（PAGE_NOT_READY / EDITOR_NOT_FOUND / EDITOR_NOT_FOCUSABLE / SESSION_NOT_EMPTY / EXECUTION_FAILED），**不再猜测/点击任何按钮**。超时参数可注入（默认 20s）。
- P0-2 真实发送：注入优先真实键盘逐字（React/Tiptap 状态同步，既有候选）；发送 = 权威控件 `#flow-end-msg-send` 原生鼠标点击（既有候选）；四次回读均未确认时**仅一次**原生 Enter 兜底（既有候选 + 本轮以 `classifySubmissionReadback` 统一回读分类：`generationStarted || promptPublished` 且 `inputCleared` 才确认，「输入框清空」单独不构成成功证据）。
- P0-3 真实回复终态（新增 `realSendStateMachine.ts` 纯逻辑 + BrowserPanel chat 分支）：完成必须同时满足 ① 提示词已进入会话区（提交确认）；② 提交后基线文本**净增长**（历史消息/欢迎语/推荐内容均落在基线内，不计为回复）；③ 稳定终态（网络明确结束且内容非空，或连续 ≥2 次采样无变化）。证据不足一律 waiting，预算耗尽失败。

## 各 P0 行为证据

- P0-1：专项 6 项（PAGE_NOT_READY / EDITOR_NOT_FOUND / EDITOR_NOT_FOCUSABLE / SESSION_NOT_EMPTY / READY / 注入代码零 `.click()` 断言）。
- P0-2：专项 5 项（回读分类表驱动：仅清空/仅生成信号/全无 → 不确认；生成+清空、发布+清空 → 确认）+ 源码断言（`submitPromptWithNativeEnter(webview)` 全文件仅 1 处调用点）。
- P0-3：专项 6 项（净增长计算、基线内欢迎语/推荐/历史不计为回复、无回复+消息数增加仍 waiting、网络结束+增长 → completed、稳定采样 → completed、变化中 → waiting、stableStreak 更新）。

## 测试命令与结果

- 专项：`pnpm test -- tests/unit/real-send-recovery.test.ts` → 16/16 通过。
- 全量：`pnpm test` → **738/738 通过**（全仓）。
- lint（修改文件）：0 errors（29 warnings 在既有基线内）；`git diff --check`：0。
- `pnpm run ts-check`：0。

## 真实账号验收（用户执行，双账号并发）

- 允许账号核对（accounts.json 只读）：`本人豆包`（09e179cb…）、`本人豆包2`（74d43661…），状态 idle 无冷却；hll2 冷却中未使用。
- 单账号：`Reply exactly: 8c5ce09dbe`（本人豆包）→ **done**。
- 双账号并发：`parallel-A-8c5ce09dbe`（本人豆包）、`parallel-B-8c5ce09dbe`（本人豆包2）→ **均 done**。
- 用户确认：未出现串号、重复发送或「仅注入即完成」；单账号与双账号链路均验证通过。
- 修复前对照（历史记录）：`Reply exactly: Q7` → `创建新对话失败`（旧实现）——本轮状态机已消除该根因。
- 证据：`%APPDATA%\doubao-studio-desktop\DoubaoStudioData\tasks.json`（只读核对，任务 2b349588… / 1022ef0b… / 47d18563…）。

## 未处理事项

- 真实验收中助手回复「精确包含唯一标识」的页面截图/文本由用户在 GUI 确认（本环境无 GUI 截图能力）；用户已确认通过。
- 代码仍未提交：按提示词停在未提交态，等待总架构师复验后决定提交/PR 流程。

## 声明

未提交、未推送、未创建 PR、未部署、未修改正式安装版；未使用未授权账号；未修改 `.env`、生产数据目录或凭据；公开分享媒体候选与其它受保护现场未被触碰。

---

## R1 严重重复提交事故整改附录（2026-08-21，supersedes 本文 P0-2 与“未重复发送”结论）

### 事故证据与根因

- 故障任务：`79e550aa-2cae-41d9-aee6-866dcc0f12a0`；账号 `2b2c4dbc-99a9-42be-8953-31ccd4f5cce4`。
- 运行数据只读核对：仅一个 `runId`（`79e550aa-2cae-41d9-aee6-866dcc0f12a0-1787247058772`）、`attempt=1`、一次“任务开始执行”和一次“用户已暂停”，排除队列重复建 run。
- 同一会话出现至少两条相同长提示词。源码链路证明：首次原生鼠标点击后仅回读约 2 秒；新版页面回读较慢时被误判为未发送，随后 `submitPromptWithNativeEnter` 再次产生真实提交。
- 次级风险：机器人验证解除后的三轮自动重建/重提，以及原生点击异常后的 `submitPrompt` 兼容回退，均可能在外部副作用已经发生后再次提交。

### R1 冻结整改与行为

- 每个 `runId` 只允许一次提交意图：发送前重新核对当前 `runId`，并先持久化 `submittedAt`；身份变化、已有提交记录或持久化回读不一致均 fail-closed，页面零点击。
- 删除 BrowserPanel 的 Enter 补发调用；删除机器人验证解除后的自动重建会话/自动重发；检测到验证立即暂停。
- 原生点击只认权威按钮 `#flow-end-msg-send`；按钮不可见、原生输入不可用、点击异常或超时均禁止回退到兼容提交。
- 首次点击后的页面回读若不确定，任务进入 `paused`，提示“请人工核对；系统未自动重发”；不再将不确定状态记为普通失败并自动继续。
- 人工重新执行仍可用，但必须由用户主动操作并产生新的 `runId`；系统不会自动消耗第二次额度。

### R1 实际文件与门禁

- tracked 修改：`src/components/BrowserPanel.tsx`、`src/utils/doubaoBridge.ts`。
- untracked 候选更新：`src/utils/realSendStateMachine.ts`、`tests/unit/real-send-recovery.test.ts`、本 handoff。
- 专项相关：4 files / **251 pass / 0 fail**。
- 全量 `pnpm run validate`：类型检查通过；ESLint **0 error / 139 warning**（低于 149 上限）；工程/契约边界通过；Vitest **27 files / 746 pass / 0 fail**；Renderer/Main 构建通过。
- `git diff --check`：通过（仅既有换行提示，无空白错误）。

### R1 状态与纪律

- 裁决：**代码整改与零发送自动门禁 PASS；真实单次视频验收尚未执行**。
- 整改期间没有创建、恢复或提交任何真实豆包任务，未额外消耗额度。
- 保持未暂存、未提交、未推送、未建 PR、未打包、未部署；既有公开分享媒体和视频配置候选全部保留。
