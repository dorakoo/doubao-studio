# DOUBAO-PRODUCTION-OBSERVABILITY-AND-MANUAL-HANDOFF-01 收口报告

- 日期：2026-08-28（Asia/Shanghai）
- 工作树：`D:\豆包工作室\doubao-production-observability-manual-handoff-01`
- 分支：`codex/doubao-production-observability-manual-handoff-01`
- 基线/报告生成时 HEAD：`5005c90cbfcc28bbd7dced73a94f0aa74dec88ee`
- 问题输入：`D:\豆包工作室\doubao-generation-confirmation-control-readiness-01\docs\handoffs\2026-08-28-doubao-production-observability-and-manual-handoff-report.md`
- supersedes：上述问题报告中的整改建议；原文件属于旧工作树现场，未覆盖或删除。

## 1. 治理与冻结验收包

已读取总架构师 `memory/INDEX.md`、`DEVELOPMENT_EFFICIENCY_GOVERNANCE.md`、仓库 `AGENTS.md`、Alice 中央 memory、前序确认/控件收口报告和本轮问题报告，并核对真实 Git、源码和测试。

冻结一个核心目标：让多任务视频生产在素材授权、慢加载/慢上传和人工接管后仍能安全、可观察地收口。

- P0-1：素材授权“安全确认”精确白名单自动确认；生成确认、验证码、登录、支付、额度和未知弹窗永久排除。
- P0-2：初始化低并发闸门、生成阶段并行释放、慢上传三分钟有界退避与最终精确一致性校验。
- P0-3：`manual_submission_observing` 独立状态、同账号原会话只读观察租约和安全产物绑定。
- P1-1：仅保存计数、耗时、机器码、内部 ID 和时间的结构化诊断。

非目标：不改 CSV、提示词、视频内容、音轨、额度策略或项目管理；不自动回复视频生成确认；不自动重发；不读取或保存 Cookie、Token、完整页面文本、提示词或素材绝对路径。

## 2. 核心行为

### P0-1 素材授权白名单

- 偏好设置新增“已授权素材自动确认”，默认关闭。
- 仅标题“安全确认”+“上传、使用的素材”+“充分授权”+“拒绝/确认”双按钮完整匹配时可进入候选。
- 页面含生成确认、验证码、人机验证、登录、支付、购买、订阅、额度或会员语义时一律 `blocked`。
- 自动点击还要求偏好已开启、当前 URL 与任务已保存会话完全一致、附件门禁已通过且确认按钮坐标有效。
- 点击前先持久化提交意图；只执行一次原生点击，随后回读弹窗、会话 URL 和附件数量。任何不确定结果均禁止补点发送。
- 诊断只记录 `doubao-material-authorization-v1`、检测/点击/回读时间和 outcome。

### P0-2 初始化与慢上传

- 新增进程内初始化闸门，设置允许 1–3 个初始化并发，默认 1。
- 闸门覆盖建会话、模式/参数配置、上传、注入和提交；取得平台提交回执后立即释放，生成阶段保持多账号并行。
- 等待闸门耗时与并发上限写入脱敏诊断；页面时序失败不降低账号健康。
- 图片上传预算由 30 秒扩为默认 180 秒，采用渐进退避；三次稳定采样之间存在真实间隔。
- 最终门禁要求观察数量与期望数量严格相等且无上传中标记；不足、额外素材、仍上传和不稳定分别输出机器码。

### P0-3 人工提交只读观察

- 新增 `manual_submission_observing` 状态/阶段和“我已手动提交”入口。
- 用户可粘贴具体豆包会话 URL，或在二次确认后明确采用当前右侧具体会话；系统不会自行猜测当前页。
- 只接受 `https://www.doubao.com/chat/<具体会话>`；Dola 因未完成真实验收继续 fail-closed。
- 每次声明创建独立本地 run，保存 15 分钟观察上限；同账号新任务被保留门禁阻止，但不计为健康失败或惩罚性冷却。
- 只读链同时验证任务提示词前缀、同一台账会话、平台提交/完成信号，再调用产物解析；不注入、不点击发送、不建新对话。
- 用户可暂停观察；超时或取消进入 `paused/manual_review_required`，仍禁止 retry 和重发。
- 产物唯一匹配后复用正式 `completeAutomation`，绑定产物、完成任务并按真实视频时长记一次额度。

## 3. 实际候选文件

Tracked 修改（22）：

1. `main/core/TaskService.ts`
2. `main/utils/persistenceNormalization.ts`
3. `packages/contracts/src/domain.ts`
4. `packages/contracts/src/enums.ts`
5. `src/components/BatchManagerModal.tsx`
6. `src/components/BrowserPanel.tsx`
7. `src/components/ProjectManagementModal.tsx`
8. `src/components/ProjectOverviewModal.tsx`
9. `src/components/SettingsModal.tsx`
10. `src/components/TaskConsole.tsx`
11. `src/components/TaskDetailModal.tsx`
12. `src/components/Toolbar.tsx`
13. `src/store/useTaskStore.ts`
14. `src/types/index.ts`
15. `src/utils/autoAssignment.ts`
16. `src/utils/doubaoBridge.ts`
17. `src/utils/materialAuthorization.ts`
18. `src/utils/realSendStateMachine.ts`
19. `src/utils/uploadReadiness.ts`
20. `tests/unit/contracts.test.ts`
21. `tests/unit/persistenceNormalization.test.ts`
22. `tests/unit/taskService.test.ts`

Untracked 新增（3，含本报告）：

1. `src/utils/initializationGate.ts`
2. `tests/unit/productionObservability.test.ts`
3. `docs/handoffs/2026-08-28-doubao-production-observability-and-manual-handoff-01.md`

真正 tracked 删除：0。实际 25 文件未超出冻结清单和 20% 预算。

## 4. 测试与门禁

- 新增专项：16 项；本包新增/更新行为测试合计未超过 30 项。
- 专项与相关回归：8 files / 406 pass / 0 fail。
- TypeScript：contracts/main/renderer/tests 0 error。
- 修改文件 ESLint：0 error / 66 warning。
- 全局 ESLint：0 error / 146 warning，低于 149 上限。
- 工程、IPC fixture、Contracts fixture 与边界检查：PASS。
- 全量 Vitest：40 files / 926 pass / 0 fail。
- Renderer build：PASS；Main build：PASS。
- `git diff --check`：PASS（仅 Git 行尾转换提示）。

## 5. 用户指定的唯一排队任务

用户截图证明左侧唯一排队任务对应的右侧会话已显示“你的视频生成好了”。本轮已为此场景实现正式受控入口，但未实际绑定，原因是 Windows Computer Use 在操作时返回 `unavailable`，无法安全读取 WebView 具体 URL、触发新入口或回读绑定结果。

没有凭截图猜测视频 URL，没有点击“启动”，没有直接修改 `tasks.json`，没有自动发送、重试或消耗额度。桌面控制恢复并加载本候选后，应在该任务详情选择“我已手动提交”，留空 URL 时二次确认当前右侧具体会话；系统将完成提示词/会话/完成信号/产物四重匹配后受控绑定。

## 6. 状态分离与裁决

- 代码已实现：是。
- 自动化测试：通过。
- CI：未执行。
- 人工 UI/平台验收：未执行。
- 指定任务产物绑定：未执行，受桌面控制服务不可用阻断。
- Git 提交/推送：报告生成时未执行。
- 部署/发布：未执行。

单一裁决：**PASS（代码与本地候选门禁）**。不得解释为指定任务已绑定、候选已上线或人工平台验收通过。
