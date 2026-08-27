# DOUBAO-GENERATION-CONFIRMATION-CONTROL-READINESS-01 收口报告

- 日期：2026-08-27（Asia/Shanghai）
- 工作树：`D:\豆包工作室\doubao-generation-confirmation-control-readiness-01`
- 分支：`codex/doubao-generation-confirmation-control-readiness-01`
- 基线/报告生成时 HEAD：`a6d54d729f103b7fdd0ee6ec001e2c9598ae1eae`
- 状态：代码与本地自动化门禁 PASS；人工平台验收、真实任务执行、提交、推送、部署、发布均未执行。
- supersedes：`2026-08-27-doubao-generation-confirmation-and-control-readiness-report.md` 的整改建议与其中相互冲突的 C06-A 明细；原报告保留不修改。

## 1. 治理读取与冻结验收包

已读取总架构师 `memory/INDEX.md`、`DEVELOPMENT_EFFICIENCY_GOVERNANCE.md`、仓库 `AGENTS.md`、Alice 中央 `docs/memory/INDEX.md`、`CURRENT.md`、`DEPENDENCIES.md`、`QUEUE.md`，以及项目/CSV 可见性、自动化收口和本轮异常报告。豆包仓库自身不存在 `docs/memory/`，未虚构读取。

本轮只冻结一个核心目标：在不重新提交真实任务的前提下，补齐生成确认、慢加载控件诊断和提交不确定任务的安全恢复边界。

- P0-1：新增 `waiting_generation_confirmation` 独立状态；确认页只识别、不代答、不重发。
- P0-2：视频入口、模型、比例/时长组合控件、稳定回读和最终回读分阶段有界等待，输出机器可读错误码。
- P1-1：恢复动作只允许读取原账号、台账已保存的原会话 URL；禁止注入、发送、创建新对话或猜测当前会话。

非目标：不改 CSV/项目管理、额度模型、音轨和调度架构；不读取或修改 Cookie、Token、账号 Session、视频产物或真实平台任务；不自动回复“确认”。

## 2. 核心实现证据

1. Contracts、持久化规范化、任务服务、Store 与 UI 已贯通 `waiting_generation_confirmation`；证据仅保存 marker、模型、时长、比例和时间，不保存完整页面文本。
2. 平台出现“视频生成参数确认/确认后生成”等结构时，执行链释放底层锁并进入明确人工等待；同账号仍被调度保留，其他任务不能占用原会话。
3. 人工确认后的动作固定为“只读回读原会话”：确认仍存在则继续等待；确认消失但无生成回执仍继续等待；发现回执才进入 `generating` 并解析产物；15 分钟无产物回到 `paused/submission_uncertain`，始终不重发。
4. 只读恢复要求台账已有 `conversationUrl`，只使用该 URL；不会把 WebView 当前打开的其他具体会话猜作目标。旧现场缺少原会话 URL 的两个暂停任务因此继续 fail-closed。
5. 视频控件使用默认 30 秒指数退避；模型与比例/时长组合控件需连续 3 次稳定。入口、模型、组合控件、稳定回读、最终回读分别返回 `video_<stage>_not_ready`。
6. 批量暂停不会把确认等待任务降级为普通 `cancelled`；禁止重发证据和确认状态保持不变。
7. 控件慢加载失败不计为账号健康失败，避免一次页面时序问题永久排除账号。

## 3. 实际候选文件

Tracked 修改（20）：

1. `main/core/TaskService.ts`
2. `main/utils/persistenceNormalization.ts`
3. `packages/contracts/src/domain.ts`
4. `packages/contracts/src/enums.ts`
5. `src/components/BatchManagerModal.tsx`
6. `src/components/BrowserPanel.tsx`
7. `src/components/ProjectManagementModal.tsx`
8. `src/components/ProjectOverviewModal.tsx`
9. `src/components/TaskConsole.tsx`
10. `src/components/TaskDetailModal.tsx`
11. `src/components/Toolbar.tsx`
12. `src/store/useTaskStore.ts`
13. `src/types/index.ts`
14. `src/utils/autoAssignment.ts`
15. `src/utils/doubaoBridge.ts`
16. `src/utils/realSendStateMachine.ts`
17. `tests/unit/contracts.test.ts`
18. `tests/unit/persistenceNormalization.test.ts`
19. `tests/unit/taskService.test.ts`
20. `tests/unit/videoCapability.test.ts`

Untracked 新增（4，含本报告）：

1. `src/utils/generationConfirmation.ts`
2. `src/utils/videoControlReadiness.ts`
3. `tests/unit/generationControlReadiness.test.ts`
4. `docs/handoffs/2026-08-27-doubao-generation-confirmation-control-readiness-01.md`

真正 tracked 删除：0。

## 4. 测试与门禁

- 专项与相关回归：6 files / 430 pass / 0 fail。
- 新增专项：`generationControlReadiness` 18/18；另补 1 项批量暂停禁止降级行为测试。
- TypeScript：contracts/main/renderer/tests 全部通过，0 error。
- 修改文件 ESLint：0 error / 61 warning；全局 ESLint：0 error / 143 warning，低于 149 上限。
- 工程结构、IPC fixture、Contracts fixture 与边界检查：PASS。
- 全量 Vitest：39 files / 908 pass / 0 fail。
- Renderer build：PASS；Main build：PASS。
- `git diff --check`：PASS（仅 Git 行尾转换提示，无空白错误）。

## 5. 旧报告偏差与现场保护

旧异常报告同一时刻同时把 C06-A 列入“已完成 5 项”和“失败 5 项”，任务标签明细自相矛盾。可确认的总量仍为 5 done / 5 fail / 2 paused；本轮不读取或改写真实 `tasks.json`，不根据提示词猜测标签，也不篡改历史报告。后续人工验收必须以 UI 与台账再次只读回读为准。

本轮未重试 5 个失败任务，未核对或重发 2 个暂停任务，未上传素材、未提交平台生成、未消耗额度。未读取或修改 Cookie、Token、账号 Session、视频产物、用户运行数据、安装包或 release。

## 6. 状态分离与裁决

- 代码已实现：是。
- 自动化测试：通过。
- CI：未执行。
- 人工 UI/平台验收：未执行；不得由源码测试推断为已通过。
- 真实任务执行：未执行。
- Git 提交/推送：未执行。
- 部署/发布：未执行。

单一裁决：**PASS（代码与本地候选门禁）**。真实平台人工验收须使用新建、明确授权的测试任务，不能拿现有 12 项现场重试；验收前仍不得宣称已部署或生产可用。
