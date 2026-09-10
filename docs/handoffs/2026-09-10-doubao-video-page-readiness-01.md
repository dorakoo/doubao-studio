# DOUBAO-VIDEO-PAGE-READINESS-01 实施交接单

- 日期：2026-09-10
- 状态：代码已实现、自动化测试通过；未人工验收、未执行真实任务、未提交、未推送、未部署
- 基线：`origin/main@dfbb7f2028bd88caf838c52f5785e3130e594e7a`
- 分支：`codex/doubao-video-page-readiness-01`
- 工作树：`D:\豆包工作室\doubao-video-page-readiness-01`

## 治理与冻结验收包

开工前已读取总架构师治理规则，包括中央 `memory/INDEX.md`、`DEVELOPMENT_EFFICIENCY_GOVERNANCE.md`、`ACTIVE_DEVELOPMENT_DIRECTION.md`、`CURRENT.md`、`QUEUE.md`，以及豆包仓库 `AGENTS.md`、`ROADMAP.md`、相关源码/测试和 `2026-09-08-doubao-studio-236-t01-t02-production-usage-report-r1.md`。

本包冻结为一个核心目标、三个 P0：

1. 九阶段视频页就绪链：账号、新对话、视频入口、模型、比例、时长、素材、提示词、发送控件。
2. 每阶段有界等待、连续稳定采样和脱敏诊断；禁止保存页面正文、提示词、素材绝对路径、Cookie、Token 或 Session。
3. 提交前页面变化最多恢复一次；提交不确定禁止自动重发，只有明确平台回执才进入生成中。

非目标：执行意图、依赖策略、多账号观察流水线、local-control、下载归档、真实素材上传和真实额度消费。Dola 未做真实验证，不宣称可用。

## 实现结果

- 新增统一 `VideoPageReadinessStage` 九阶段模型和版本化诊断 schema。
- 将旧 `model + composite` 探针拆为 `model + aspectRatio + duration`，连续三次稳定才通过。
- 页面结构指纹仅编码适配器版本、页面变体与三个能力位；不读取或持久化网页正文。
- `BrowserPanel` 在九个实际执行节点更新任务快照，重启后可回读当前阶段、耗时、尝试数、稳定样本、恢复次数、缺失控件和结构版本。
- 模型、比例、时长、素材、提示词和发送控件失败使用独立机器码，不再退化为笼统 `page_changed`。
- 参数配置发生已知就绪错误时，仅在提交意图产生前重新识别一次；第二次失败立即停止。
- 沿用原有不可重复副作用保护：先持久化提交意图，点击后无明确回执进入 `submission_uncertain`，不自动重发；明确回读后才进入 `generating`。
- 旧运行快照阶段与错误码继续可读，持久化归一化对新增字段执行白名单和长度限制。

## 精确文件清单

Tracked 修改（9）：

1. `main/utils/persistenceNormalization.ts`
2. `packages/contracts/src/domain.ts`
3. `packages/contracts/src/enums.ts`
4. `src/components/BrowserPanel.tsx`
5. `src/utils/doubaoBridge.ts`
6. `src/utils/videoControlReadiness.ts`
7. `tests/unit/generationControlReadiness.test.ts`
8. `tests/unit/persistenceNormalization.test.ts`
9. `tests/unit/videoCapability.test.ts`

Untracked 新增（1）：

1. `docs/handoffs/2026-09-10-doubao-video-page-readiness-01.md`

Tracked 删除：无。

## 门禁证据

- 专项：5 files / 255 pass / 0 fail。
- TypeScript：contracts、main、renderer、test 四套配置通过。
- 修改文件 ESLint：0 error / 34 warning；warning 为既有复杂度、React hook、any 等告警。
- 全量 `pnpm run validate`：PASS（exit code 0）。
  - 全量 ESLint：0 error / 147 warning，未超过 149 上限。
  - 工程/Contracts 边界：PASS。
  - 全量测试：48 files / 1012 pass / 0 fail。
  - Renderer/Main 构建：PASS。
- `git diff --check`：PASS。

## 状态与停止声明

- 代码已实现：是。
- CI：未运行。
- 人工验收：未执行。
- 真实任务执行：未执行；未上传素材、未点击平台提交、未消耗额度。
- Git：全部改动未暂存、未提交、未推送，未创建或修改 PR。
- 部署/发布：未部署、未启动或重启豆包工作室、未发布。
- 受保护资产：未修改 Cookie、Token、账号 Session、任务台账、视频产物或真实平台任务。

下一步应先由总架构师独立复验本包，再按逐项授权处理候选提交/PR；前三包全部自动化收口后，才使用一次普通 5 秒视频做真实验收。
