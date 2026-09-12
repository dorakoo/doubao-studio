# DOUBAO-STATUS-DOWNLOAD-CLOSEOUT-01 实施交接单

- 日期：2026-09-12
- 状态：代码已实现、自动化门禁通过、候选免安装包打包通过；未人工验收、未执行真实任务、未提交、未推送、未部署、未发布
- 权威基线：`origin/main@f461a7fb9fcefcf35050de5a4459bd1b94f897b3`（v2.3.7）
- 分支：`codex/doubao-status-download-closeout-01`
- 工作树：`D:\豆包工作室\doubao-status-download-closeout-01`
- 最终状态：未暂存、未提交的已验证候选

## 冻结目标与结果

| 项 | 结果 |
| --- | --- |
| P0-1 依赖错误语义与持久化 | PASS |
| P0-2 三种依赖策略保持精确 | PASS |
| P0-3 批量下载安全默认值 | PASS |
| P1-1 结构化人工质量裁决 | PASS |

## 实现结果

### P0-1 依赖错误语义与持久化

- 新增 `dependency_failed`、`dependency_missing`、`dependency_cycle` 结构化错误码。
- `Task` 新增 `blockedByTaskIds?: string[]`；`TaskUpdateRuntimeParams` 支持通过 Core/Repository 写入或清空。
- `evaluateDependencies` 返回 `code` 与 `blockedByTaskIds`：
  - 缺失依赖优先返回 `dependency_missing`；
  - 自依赖/循环返回 `dependency_cycle`；
  - `all_done` 前序失败/取消返回 `dependency_failed`；
  - `all_accepted` 前序终止且无有效受理绑定时返回 `dependency_failed`。
- `blockedByTaskIds` 去重、trim、稳定字典序排序；空数组表示清除历史阻断。
- `useTaskStore.processQueue()` 使用真实错误码与阻断 ID 写回主进程，不再统一写 `generation_failed`。
- 依赖阻断路径不调用账号失败、健康冷却、额度消耗或重试路径；等待中的合法依赖继续保留 queued。
- 任务恢复 ready 时清空历史阻断；清理写入失败则停止启动。
- 兼容保护：若任务存在外部注入的 `executionIntent='hold'`，依赖评估前直接跳过，不启动、不写失败。

### P0-2 策略精确性

- `all_done`：全部 done 才 ready；fail/cancelled 使用 dependency_failed。
- `all_accepted`：所有前序 `hasPlatformAcceptance` 才 ready；`waiting_generation_confirmation` 且绑定时仍可放行；
  fail/cancelled 但已有有效观察绑定仍视为已受理。
- `all_finished`：任意终态 ready，前序失败不转成 dependency_failed。
- 缺失和循环优先于策略等待/失败判定。

### P0-3 批量下载安全

- `OutputPreviewModal` 每次打开默认全不选。
- `BatchManagerModal` 固定按当前项目 + 用户选择的具体批次生成候选，不显示其他项目、批次或历史任务。
- 全局与任务控制台批量下载入口都先进入批次选择，不再直接加载全部历史产物。
- 跨项目/跨批次混合选择存在防御性二次确认，文案显示项目/批次/任务/产物数量。
- 预览按钮紧邻显示项目、批次、任务、产物数量；空选择禁用下载。
- 新增 `src/utils/downloadSelection.ts`，下载范围构建与初始选择为可测纯函数。
- 单任务、单产物下载链路未改动。

### P1-1 人工质量裁决

- Contracts 新增 `QualityVerdictStatus`、`QualityRejectionTag`、`QualityVerdict`，`Task` 新增可选 `qualityVerdict`。
- 六类稳定机器标签：`product_structure`、`material`、`aspect_ratio`、`character_consistency`、`audio`、`bgm`；界面映射中文。
- `TaskService.setQualityVerdict` 通过 Repository 写入并回读；拒收多选去重、稳定排序；无有效标签 fail-closed。
- `tasks:setQualityVerdict` IPC、preload 与 `useTaskStore.setQualityVerdict` 已接线。
- `TaskDetailModal` 增加人工质量裁决区，支持“标记合格”和“标记拒收”；写入失败显示真实错误且不显示成功。
- 质量裁决只记录人工判断，不触发队列、自动化、重试、额度或平台动作。

## 精确文件清单

Tracked 修改（18）：

1. `main/core/TaskService.ts`
2. `main/ipc/tasks.ts`
3. `main/preload.ts`
4. `main/utils/persistenceNormalization.ts`
5. `packages/contracts/src/domain.ts`
6. `packages/contracts/src/dto/electron-api.ts`
7. `packages/contracts/src/dto/tasks.ts`
8. `packages/contracts/src/enums.ts`
9. `packages/contracts/src/index.ts`
10. `src/components/BatchManagerModal.tsx`
11. `src/components/OutputPreviewModal.tsx`
12. `src/components/TaskConsole.tsx`
13. `src/components/TaskDetailModal.tsx`
14. `src/components/Toolbar.tsx`
15. `src/store/useTaskStore.ts`
16. `src/types/index.ts`
17. `src/utils/dependencyEval.ts`
18. `tests/unit/dependencyEval.test.ts`

Untracked 新增（4）：

1. `src/utils/downloadSelection.ts`
2. `tests/unit/dependencyQueueBehavior.test.ts`
3. `tests/unit/statusDownloadCloseout.test.ts`
4. `docs/handoffs/2026-09-12-doubao-status-download-closeout-01.md`

真正 tracked 删除：无。

## 门禁证据

- 日常/专项：
  - `tests/unit/dependencyEval.test.ts`：30 tests PASS。
  - `tests/unit/statusDownloadCloseout.test.ts`：9 tests PASS。
  - `tests/unit/dependencyQueueBehavior.test.ts`：5 tests PASS。
- 候选：
  - `pnpm run validate`：PASS，exit code 0。
    - 全量测试：51 files / 1050 tests pass / 0 fail。
    - TypeScript：PASS（contracts、main、renderer、test 四套）。
    - ESLint：0 error / 147 warning，不超过正式基线 147。
    - 工程结构、Contracts 边界、Renderer build、Main build：PASS。
  - `pnpm run pack`：PASS，Windows win-unpacked 候选生成成功。
  - `git diff --check`：PASS，仅有 LF→CRLF 工作树提示。

## 受保护行为回归证据

`tests/unit/dependencyQueueBehavior.test.ts` 使用真实 store 行为覆盖：

1. 启动加载后队列评估：持久化任务加载后，跨账号 `all_accepted` 后继自动放行。
2. 前序 `waiting_generation_confirmation` 且持有有效 observing 绑定时，跨账号放行、同账号阻塞。
3. availability unknown 有界退避复检最多 30 次；恢复 ready 后只启动非 hold 任务。
4. 外部注入 `executionIntent='hold'` 的任务在启动加载、依赖阻断、availability 复检恢复后均不启动。
5. 恢复 ready 的旧阻断任务先清空 `blockedByTaskIds` 再启动。
6. 人工质量裁决不会触发 `processQueue`、`startAutomation`、账号失败/额度更新。

## 真实平台零写入证明

- 未启动正式豆包工作室，未打开真实账号页面，未上传素材、未提交或下载真实视频、未消耗额度。
- 所有测试读取 mock 数据或内存数据；未读取生产 `accounts.json`、`tasks.json`、`downloads.json`、Cookie 或 Session。
- `pnpm run pack` 仅构建和打包，不启动正式实例。

## 状态分离

- 代码已实现：是。
- 自动化测试：是。
- 人工验收：未执行。
- 真实任务执行：未执行。
- 提交：未执行。
- 推送：未执行。
- PR：未创建。
- 合并：未执行。
- 安装：未执行。
- 部署：未执行。
- 发布：未执行。

## 与 A/B/C 的合并冲突预期

- A `DOUBAO-EXECUTION-INTENT-SAFETY-01`：
  - 与 D 在 `TaskUpdateRuntimeParams`、`preload` updateRuntime、`useTaskStore.startAutomation/processQueue`、`TaskService.updateRuntime`、持久化归一化重叠。
  - 合并时必须保留 A 的 `hold/armed` 调度门禁，同时保留 D 的 dependency code、`blockedByTaskIds` 清理和恢复语义。
- B `DOUBAO-TASK-CONVERSATION-LOCATOR-R2-01`：
  - 与 D 在 `TaskConsole.tsx` 有相邻改动；B 改任务卡双击，D 改批量下载入口，需人工合并。
- C `DOUBAO-LOCAL-CONTROL-ARTIFACT-01`：
  - 与 D 在 `main/ipc/tasks.ts`、`main/preload.ts`、`packages/contracts/src/dto/*` 和 `electron-api.ts` 有重叠。
  - 合并时必须同时保留 C 的账号/指派/产物/下载接口与 D 的 `setQualityVerdict`、`blockedByTaskIds` 参数。
- 集成顺序建议：A → B → C → D；D 最后合入后重跑 `pnpm run validate`、`pnpm run pack` 和受保护行为测试。

## 剩余技术债

- Dola 仍未完成真实端到端验收，不得宣称可用。
- 代码签名和自定义图标仍为独立技术债。
- 本包未修改下载目录、下载台账或真实产物。

## 结论

包 D 已完成代码实现、行为测试、全量门禁和候选打包，停在独立工作树未暂存、未提交状态，等待总架构师复验与后续明确授权。
