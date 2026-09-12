# DOUBAO-STATUS-DOWNLOAD-CLOSEOUT-01 R2 实施交接单

- 日期：2026-09-12
- 阶段：R2（修复 R1 复验确认的 3 项 P0 与 1 项 P1；使用最后整改轮次）
- 状态：代码已实现、自动化门禁通过、候选免安装包打包通过；未人工验收、未执行真实任务、未提交、未推送、未创建 PR、未合并、未安装、未部署、未发布
- 权威基线：`origin/main@f461a7fb9fcefcf35050de5a4459bd1b94f897b3`（v2.3.7）
- 分支：`codex/doubao-status-download-closeout-01`
- 工作树：`D:\豆包工作室\doubao-status-download-closeout-01`
- 最终状态：全部改动未暂存、未提交的已验证候选
- **本交接单 supersedes**：`docs/handoffs/2026-09-12-doubao-status-download-closeout-01-r1.md`（R1），并间接 supersedes R0 交接单

## 治理声明

开工前已读取 `D:\项目架构师\memory\INDEX.md`、`D:\项目架构师\DEVELOPMENT_EFFICIENCY_GOVERNANCE.md`、本仓库 `AGENTS.md`、总架构师包 D 提示词、R0 与 R1 交接单，并核对分支、HEAD、工作树与 `origin/main` 一致（均为 `f461a7f`）。

R2 冻结包：只处理总架构师 R1 复验已确认的 4 项阻塞，不附带新功能。按 `DEVELOPMENT_EFFICIENCY_GOVERNANCE.md` §4，R2 为本包最后一次整改轮次；若 R2 后仍存在 P0，必须停止局部补丁，由总架构师在“缩小范围 / 拆独立开发包 / 明确接受风险并延期”之间选择处置。

## R1 复验阻断的处置结果

| 复验发现 | R1 问题 | R2 处置 | 结果 |
| --- | --- | --- | --- |
| P0-1 依赖阻断永久卡死 | 阻断写成 `status='fail'`，调度器只扫 `queued`，重试入口又拒绝依赖错误 | 阻断**不再写 fail**：保持 `queued` + `errorInfo` 结构化原因 + `blockedByTaskIds`；恢复时一次写入原子转回 `queued` 并清除阻断；调度器每次扫描都会重新评估，并在前序进入终态时触发复检 | PASS |
| P0-2 回读校验字段互串 + 假“保持原状态” | `status` 恒参与比较；未传 `errorInfo` 被当作“期望清空”；写盘已成功后声称已回滚 | 按字段独立判定（只有显式请求的字段才校验，显式清空才要求为空）；漂移时返回权威回读状态 + 并发冲突原因，Renderer 以落盘事实为准 | PASS |
| P0-3 下载门禁可被空归属绕过 | `projectId`/`batchId` 可选，空值被过滤成 `0 项目 0 批次` 反而通过；零产物任务可放行；Toolbar 接受无范围裸数组事件 | 归属改为必填且必须非空；每项必须有至少一个非空产物；要求项目数与批次数**精确等于 1**；无归属旧事件 fail-closed 拒绝 | PASS |
| P1 非法裁决时间被伪造 | 历史 `decidedAt` 缺失/非法时回退为 `now` | 缺失或非法时**整体丢弃**该历史裁决，绝不生成新时间 | PASS |

## 实现明细

### P0-1 依赖阻断可恢复（不再永久卡死）

`src/store/useTaskStore.ts`：

- `markDependencyBlock()`：写入 `status: 'queued'` + 结构化错误码 + `blockedByTaskIds`（去重稳定排序），**不再写 `fail`**；状态不是 `queued` 时拒绝写入；已处于相同阻断态时幂等返回，不重复写盘。
- `clearDependencyBlock()`：一次写入原子完成 `status: 'queued'` + `result: ''` + `errorInfo: null` + `blockedByTaskIds: []`；无历史阻断时不写盘（幂等）。
- `processQueue()` 依赖分支重写为三分支，且阻断分支**必须 `continue`**，绝不再落到启动逻辑：
  - `ready`：有历史阻断则先 `await clearDependencyBlock()`，失败则 `continue`（保持原状态）；
  - `waiting`：合法等待不写失败；旧阻断已不成立时清除陈旧证据后继续本轮判定；
  - `missing` / `failed` / `invalid`：`await markDependencyBlock()` 写入阻断原因，然后 `continue`。
- 新增 `scheduleDependencyRecheck()` + `dependencyRecheckDelayMs`：保证“没有其他调度触发”时也有一个有界、幂等（同一时刻只排一个定时器）的重新评估机会；`completeAutomation` / `failAutomation` 收尾时额外触发一次，使前置进入终态后后继立即被重新评估。
- 启动路径保持不变：阻断任务处于 `fail` 的场景已不存在；`startAutomation` 仍要求 `status === 'queued'` 且依赖评估为 `ready`。

`README.md` 与界面：阻断任务保持排队并留在调度队列，界面用独立「依赖阻断」标签区分（不再依赖 `status === 'fail'`）。`taskStats`、`BatchManagerModal`、`TaskConsole` 的阻断识别统一改为按结构化错误码判定。

### P0-2 回读校验字段独立 + 权威状态

`main/core/TaskService.ts`：

- 新增 `isTaskServiceFailure()` 类型守卫；`TaskServiceResult` 失败分支允许携带权威任务。
- 新增 `buildRuntimeVerification()`：只有显式请求的字段才进入校验对象——`status` 仅在传入时校验；`blockedByTaskIds` 传入时校验（空数组归一化为 `null` 以匹配落盘的 `undefined`）；`errorInfo` 传入时校验（`null` 表示期望清空）。未请求的字段完全不参与比较，修复“清 A 误判 B”。
- 写盘成功后回读；漂移时返回 `{ success: false, error: '任务状态已被并发修改，已返回权威回读状态', task: <权威落盘任务> }`，不再声称“已保持原状态”。
- `main/ipc/tasks.ts` 的 `tasks:updateRuntime` 在失败分支如实透传权威任务。
- `src/store/useTaskStore.ts` 的 `updateTaskRuntime()` 按服务端同一口径逐字段校验：写盘**确实失败且无回读结果**时界面保持原状态；写盘已发生但请求字段不一致时，界面同步权威落盘状态并显示冲突错误，返回 `false`（不视为成功、不启动）。

`tests/unit/dependencyQueueBehavior.test.ts` 的 mock 重写为真实内存仓库（主进程落盘与 Renderer store 分离），否则回读语义无法被真实验证。

### P0-3 下载门禁精确放行

`src/utils/downloadSelection.ts`：

- `BatchDownloadOutput.projectId` / `batchId` 由可选改为**必填非空**；`BatchOutputLike` 同步收紧。
- 新增 `hasOwnership()` 与 `effectiveArtifacts()`（过滤空串/非字符串产物）。
- `buildBatchDownloadRequest()` 放行条件全部满足才通过：每项归属非空 → 每项至少一个有效产物 → `projectCount === 1 && batchCount === 1`。任一不满足返回 `ok: false` 且 `outputs: []`。
- `readDownloadSelection()` 增加 `invalidCount`；`downloadEnabled = taskCount > 0 && invalidCount === 0`，按钮不再只看“选了东西”。
- `buildBatchDownloadPayload()` 改为 `flatMap`：非空批次、`done`、有有效产物三者同时满足才成为候选，消除非空断言。
- `src/components/OutputPreviewModal.tsx`：`OutputItem` 直接复用 `BatchDownloadOutput`（归属必填），下载仍只经 `createDownloadIntent()` 唯一入口。
- `src/components/Toolbar.tsx`：`batch-download-outputs` 事件只接受带非空 `projectName` 与 `batchId` 的 `{ outputs, scopeSummary }`；裸数组或缺失摘要一律拒绝并提示，不打开预览。

### P1 不伪造裁决时间

`main/utils/persistenceNormalization.ts` 的 `normalizeQualityVerdict()`：

- 移除 `now` 回退；`decidedAt` 不是合法 ISO 时间时**整体丢弃**该裁决（`undefined`），交由 `changed` 标记驱动盘面清理。
- 合法历史裁决保留原始 `decidedAt`，不被当前时间覆盖。

## 必测行为测试对应关系

| 总架构师要求 | 测试（`tests/unit/statusDownloadCloseoutR2Behavior.test.ts`，18 项） |
| --- | --- |
| 依赖阻断提供持久化、幂等的重新评估入口 | 「依赖阻断保持 queued 并被调度器重新评估，而不是写成 fail」「阻断刷新是幂等的：重复评估不会重复写盘」「重新评估入口是持久化的：应用重启后从盘面恢复仍可恢复阻断任务」 |
| 前置失败 → 重试成功 → 后继自动恢复 | 「前置失败 → 重试成功 → 后继自动恢复并放行」（第 1 轮阻断 → 前序恢复为 done → 第 2 轮自动清阻断并放行） |
| 回读严格区分“未请求校验”与“请求清空” | 「清除阻断不会误判未请求的 errorInfo」「清除 errorInfo 不会误判未请求的 blockedByTaskIds」 |
| 并发漂移返回权威状态或 CAS 冲突，禁止宣称已回滚 | 「并发漂移返回权威落盘状态与冲突原因，不声称已回滚」「Renderer 收到并发冲突时同步权威状态并拒绝视为成功」「写盘真实失败且无回读结果时，界面保持写入前原状态」 |
| 下载每项有非空项目/批次/产物，且项目数=批次数=1 | 「归属完整且单项目单批次时放行」「项目或批次缺失/空串时整体拒绝，不会退化成 0 项目 0 批次而误放行」「零可下载产物的任务不允许占位放行」「读写选择读数同时暴露无效项数量，按钮据此禁用」 |
| 拒绝无归属旧事件 | 「无归属旧事件被拒绝：Toolbar 只接受带真实范围摘要的事件」 |
| 非法或缺失 `decidedAt` 不得补当前时间 | 「缺失或非法 decidedAt 的裁决整体丢弃，不补当前时间」「合法历史裁决保留原始时间」「非法时间裁决被丢弃时会标记 changed」 |

既有测试同步更新为 R2 语义（未删除覆盖）：`statusDownloadCloseout.test.ts` 增加“清除 A 不误判 B”“漂移返回权威状态”“回读一致返回真实落盘任务”“缺失/非法 `decidedAt` 整体丢弃”；`dependencyQueueBehavior.test.ts` 断言阻断保持 `queued`、恢复写入为原子转回 `queued`。

## 精确文件清单

Tracked 修改（22）：

1. `README.md`
2. `main/core/TaskService.ts`
3. `main/ipc/tasks.ts`
4. `main/preload.ts`
5. `main/utils/persistenceNormalization.ts`
6. `packages/contracts/src/domain.ts`
7. `packages/contracts/src/dto/electron-api.ts`
8. `packages/contracts/src/dto/tasks.ts`
9. `packages/contracts/src/enums.ts`
10. `packages/contracts/src/index.ts`
11. `src/components/BatchManagerModal.tsx`
12. `src/components/OutputPreviewModal.tsx`
13. `src/components/TaskConsole.tsx`
14. `src/components/TaskDetailModal.tsx`
15. `src/components/Toolbar.tsx`
16. `src/store/useTaskStore.ts`
17. `src/types/index.ts`
18. `src/utils/dependencyEval.ts`
19. `src/utils/downloadSelection.ts`（R0 新增，仍未跟踪）
20. `src/utils/taskStats.ts`（R0 新增，仍未跟踪）
21. `tests/unit/acceptedObservation.test.ts`
22. `tests/unit/dependencyEval.test.ts`

Untracked 新增（6）：

1. `docs/handoffs/2026-09-12-doubao-status-download-closeout-01.md`（R0）
2. `docs/handoffs/2026-09-12-doubao-status-download-closeout-01-r1.md`（R1，已标注被 R2 supersedes）
3. `docs/handoffs/2026-09-12-doubao-status-download-closeout-01-r2.md`（本文件）
4. `tests/unit/dependencyQueueBehavior.test.ts`
5. `tests/unit/statusDownloadCloseout.test.ts`
6. `tests/unit/statusDownloadCloseoutR1Behavior.test.ts`
7. `tests/unit/statusDownloadCloseoutR2Behavior.test.ts`（R2 新增，18 tests）

> 注：上表 R2 相对 R1 新增修改 2 个 tracked 文件（`README.md` 已在 R1 计入；R2 新增的是 `TaskConsole.tsx` 的语义调整与测试文件更新），未新增 tracked 删除。

真正 tracked 删除：无。以上路径均未暂存；`git diff --cached` 为空。

## 门禁证据（实际执行，最终代码状态）

| 命令 | 结果 |
| --- | --- |
| `pnpm run validate` | PASS，exit code 0。53 files / 1103 tests passed / 0 failed。TypeScript 四套（contracts、main、renderer、test）0 error。ESLint 0 error / 149 warning，等于改动前基线 149，未新增 warning（R2 过程中一度新增 3 条，已通过拆出 `buildRuntimeVerification()`、删除未使用变量/导入与多余断言消除）。工程结构、Contracts 边界、Renderer build、Main build 全部 PASS。 |
| `pnpm run pack` | PASS，exit code 0。`release\win-unpacked` 候选生成成功；签名仍跳过（既有技术债）。 |
| `git diff --check` | PASS，exit code 0（仅 LF→CRLF 工作树提示）。 |

专项（日常门禁）：

- `tests/unit/statusDownloadCloseoutR2Behavior.test.ts`：18 tests PASS。
- `tests/unit/statusDownloadCloseoutR1Behavior.test.ts`：22 tests PASS。
- `tests/unit/statusDownloadCloseout.test.ts`：20 tests PASS。
- `tests/unit/dependencyQueueBehavior.test.ts`：7 tests PASS。
- `tests/unit/dependencyEval.test.ts`：30 tests PASS。

### R2 自查中发现并修正的自身缺陷（如实记录）

1. 依赖分支首次改写时 `markDependencyBlock` 成功后未 `continue`，导致阻断任务继续走到启动判定（被 `dependencyQueueBehavior` 的既有断言捕获后修正）。
2. `updateRuntime` 校验对象最初恒设置 `status: params.status`，使“只清阻断”的请求也去校验未请求的 `status`；且 `normalizeBlockedByTaskIds([]) ?? null` 得到 `[]` 而非 `null`。两处均为 R2 引入，已修正并有对应测试。
3. Renderer 侧最初把 `before` 状态与 patch 混合比较，与主进程口径不一致导致误判“回读不一致”；已改为与 `TaskService` 同口径的逐字段校验。
4. R1 交接单第 86–91 行的文件清单与 R0 报告偏差已在 R1 交接单中标注，R2 清单以其为准。

## 受保护行为回归证据

`dependencyQueueBehavior.test.ts`（R0/R1 保留，R2 复跑通过）与 `statusDownloadCloseoutR1/R2Behavior.test.ts` 使用真实 store 行为覆盖：

1. 启动加载后队列评估：跨账号 `all_accepted` 后继自动放行，同账号阻塞。
2. 前置 `waiting_generation_confirmation` 且持有有效受理绑定：跨账号放行、同账号阻塞。
3. 同账号 `observing` 存在时后继不启动（断言具体启动任务集合）。
4. `availability=unknown` 有界退避复检最多 30 次；恢复 `ready` 后只启动非 `hold` 任务。
5. 外部注入 `executionIntent='hold'` 的任务在启动加载、依赖阻断、availability 复检恢复后均不启动。
6. 未指派任务不会因依赖变化被自动启动。
7. 依赖阻断不触发 `processQueue` 之外的重试、不更新账号额度/健康/冷却。
8. 人工质量裁决不触发队列、自动化、重试、额度或平台动作。
9. `submission_uncertain` 禁止自动重发路径未改动（`real-send-recovery.test.ts` 31 tests 全通过）。

Dola 仍为未完成真实端到端验收状态，本次未改动其任何语义，也未宣称可用。

## 真实平台零写入证明

- 未启动正式豆包工作室，未打开真实账号页面，未上传素材、未提交或下载真实视频、未消耗额度。
- 全部测试读取内存数据或 mock；未读取生产 `accounts.json`、`tasks.json`、`downloads.json`、Cookie 或 Session。
- `pnpm run pack` 仅构建与打包，不启动正式实例。
- 未修改 A/B/C 工作树；`git stash list` 中无本次残留条目。

## 状态分离

| 项目 | 状态 |
| --- | --- |
| 代码实现 | 已实现 |
| 自动化测试 | 已执行并通过 |
| 人工验收 | 未执行 |
| 真实任务执行 | 未执行 |
| 提交 | 未执行 |
| 推送 | 未执行 |
| PR | 未创建 |
| 合并 | 未执行 |
| 安装 | 未执行 |
| 部署 | 未执行 |
| 发布 | 未执行 |

## 与 A/B/C 的合并冲突预期

- A `DOUBAO-EXECUTION-INTENT-SAFETY-01`：与 R2 在 `TaskUpdateRuntimeParams`、`preload.updateRuntime`、`useTaskStore.startAutomation/processQueue`、`TaskService.updateRuntime`、持久化归一化重叠。合并时必须同时保留 A 的 `hold/armed` 调度门禁与 R2 的回读校验、阻断保持 `queued` 与恢复串行语义。
- B `DOUBAO-TASK-CONVERSATION-LOCATOR-R2-01`：与 R2 在 `TaskConsole.tsx` 相邻（B 改任务卡双击、R2 改状态标签/统计与批量下载入口），需人工合并。
- C `DOUBAO-LOCAL-CONTROL-ARTIFACT-01`：与 R2 在 `main/ipc/tasks.ts`、`main/preload.ts`、`packages/contracts/src/dto/*`、`electron-api.ts` 重叠；必须同时保留 C 的账号/指派/产物/下载接口与 R2 的 `setQualityVerdict`、`blockedByTaskIds` 参数与权威回读语义。
- 集成顺序建议：A → B → C → D，D 最后合入后重跑 `pnpm run validate`、`pnpm run pack` 与受保护行为测试。

## 未处理事项与技术债

- ESLint warning 仍顶在基线上限 149；`TaskService.importCsv`、`TaskDetailModal`、`processQueue`、`normalizeRuntime` 的高复杂度属既有趋势，应作为独立维护任务拆函数，不得借功能整改夹带。
- 依赖复检定时器为固定 3 秒周期（有界、幂等、同一时刻仅一个），未做退避；如需更精细的调度策略应作为独立任务评估。
- Dola 未完成真实端到端验收，不得宣称可用。
- 代码签名与自定义图标仍为独立技术债（`pack` 已确认跳过签名）。
- 本包未修改下载目录、下载台账或真实产物。

## 结论

R2 已关闭总架构师 R1 复验确认的 3 项 P0 与 1 项 P1，并在最终代码状态下通过 `pnpm run validate`、`pnpm run pack`、`git diff --check`，停在独立工作树**未暂存、未提交**的已验证候选，等待总架构师复验。

按 `DEVELOPMENT_EFFICIENCY_GOVERNANCE.md` §4，R2 为本包最后一次整改轮次；若复验仍判定存在本包范围内的 P0，请勿再启动 R3 局部补丁，应在“缩小交付范围 / 拆为新的独立开发包 / 明确接受风险并延期”之间选择处置。未创建 `v2.3.8`，未推送、未建 PR、未合并、未安装、未部署、未发布。
