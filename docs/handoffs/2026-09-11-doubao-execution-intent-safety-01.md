# DOUBAO-EXECUTION-INTENT-SAFETY-01 实施交接单

- 日期：2026-09-11
- 状态：代码已实现、自动化门禁通过、候选免安装包打包通过；未人工验收、未执行真实任务、未提交、未推送、未部署
- 基线：`origin/main@f461a7fb9fcefcf35050de5a4459bd1b94f897b3`（v2.3.7）
- 分支：`codex/doubao-execution-intent-safety-01`
- 工作树：`D:\豆包工作室\doubao-execution-intent-safety-01`

## 冻结目标

1. 将账号指派与执行授权彻底分离。
2. 新增可持久化的任务执行意图 `hold | armed`，历史 queued 默认 hold。
3. `processQueue()` 只处理显式 `armed` 且满足依赖、账号、额度、租约和锁门禁的任务。
4. 单任务启动、批量恢复/重试、CSV 明确导入后执行、本机控制 start 才允许 arm。
5. 指派、CSV 导入、编辑保存本身不得触发队列、页面导航、提示词注入或平台请求。
6. Repository 写入失败保持原状态；防重发与 observing 串行语义不回归。

## 实现结果

- Contracts 新增 `TaskExecutionIntent`，`Task` 增加可选 `executionIntent`；`TaskAddParams`、`TaskUpdateRuntimeParams` 支持受控传递执行意图；`TaskAssignParams`、preload `tasks.assign`、`useTaskStore.assignTask` 不公开执行意图，所有 assign 永远落为 hold。
- `TaskService`：
  - `create`、`importCsv` 默认 `hold`；
  - `assign` 永远落为 `hold`，不接受外部执行意图；内部已授权改派由 assign → armTasks 两步完成；
  - `update` 编辑后重置为 `hold`；
  - `retry` 视为明确重新执行，重置为 `armed`；
  - `updateRuntime` 支持持久化 `executionIntent`。
- `useTaskStore`：
  - `assignTask` 不再调用 `processQueue`，直接以主进程返回的任务替换本地状态；
  - `armTasks` 显式批量持久化 `armed` 后再触发队列；
  - `startAutomation` 在真正进入依赖/账号/页面动作前先持久化并回读 `armed`，失败则保持 hold；
  - `processQueue` 和 `getNextTaskForAccount` 只筛选 `armed`；
  - CSV 导入不再自动入队。
- UI：
  - “自动指派”与“导入后执行”拆成两个独立、默认关闭的开关；
  - 只有明确勾选“导入后执行”才 arm 已指派导入任务；
  - 编辑提示词并重跑会显式 arm，并检查 armTasks 返回值；失败不显示成功；
  - 拖放提示同步说明未明确启动不会执行。
- `BrowserPanel`：
  - 额度耗尽后的自动改派改为 assign → armTasks 两步；assign 或 arm 失败均保持 hold、停止继续调度并显示真实错误；
  - 活动任务重启重排后重新 arm，并检查 armTasks 返回值，失败不显示成功。

## 精确文件清单

Tracked 修改（15）：

1. `main/core/TaskService.ts`
2. `main/ipc/tasks.ts`
3. `main/preload.ts`
4. `main/utils/persistenceNormalization.ts`
5. `packages/contracts/src/domain.ts`
6. `packages/contracts/src/dto/electron-api.ts`
7. `packages/contracts/src/dto/tasks.ts`
8. `packages/contracts/src/enums.ts`
9. `packages/contracts/src/index.ts`
10. `src/components/BrowserPanel.tsx`
11. `src/components/TaskConsole.tsx`
12. `src/store/useTaskStore.ts`
13. `src/types/index.ts`
14. `tests/unit/persistenceNormalization.test.ts`
15. `tests/unit/taskService.test.ts`

Untracked 新增（2）：

1. `tests/unit/executionIntentSafety.test.ts`
2. `docs/handoffs/2026-09-11-doubao-execution-intent-safety-01.md`

Tracked 删除：无。

## 门禁证据

- `pnpm run validate`：PASS，exit code 0。
  - 全量测试：50 files / 1041 tests pass / 0 fail。
  - TypeScript：PASS。
  - ESLint：0 error / 147 warning，不超过 v2.3.7 基线 147。
  - 工程结构、Contracts 边界、Renderer build、Main build：PASS。
- `pnpm run pack`：PASS，Windows 免安装包生成成功。
- `git diff --check`：PASS。
- 新增行为测试覆盖：
  - `assignTask` 只持久化指派，不调用 `processQueue` / `startAutomation`；
  - `armTasks` 先持久化 `armed` 再调度；
  - 启动加载后的队列评估：持久化任务加载后，跨账号 `all_accepted` 后继自动放行；
  - 前序处于 `waiting_generation_confirmation` 且持有有效 observing 绑定时，同账号后继阻塞；
  - availability `unknown` 有界退避复检，最多 30 次后停止，不启动任何任务；恢复 ready 后只启动 armed；
  - hold 任务在上述所有调度事件中均不得启动；
  - arm 写入失败时 `startAutomation` 保持 hold 且不进入账号动作；
  - 归一化缺失字段默认 hold、显式 armed 保留、非法值回退 hold；
  - `TaskService` create / assign / update / retry / importCsv 执行意图契约。

## 受保护资产与真实写入

- 未执行真实视频、未上传素材、未消耗平台额度。
- 未读取、输出、修改或提交 Cookie、Token、账号 Session、完整提示词、素材绝对路径、真实任务台账、下载台账或视频产物。
- 未启动或重启正式豆包工作室；本包未启动候选 UI 做人工验收。

## 偏差与剩余风险

- `retry` 被定义为“用户明确重新执行”，因此会置为 `armed`；这与“单任务启动/批量启动/本机 start”同属显式授权语义，最终报告应说明。
- “编辑提示词并重跑”和额度耗尽后的内部自动改派都改为显式调用 `armTasks`；assign 本身永远只落为 hold，且 arm 失败会显示真实错误并保持 hold。
- 历史 queued 任务首次归一化会写入 `executionIntent=hold`，`changed=true` 属预期迁移。
- 未做真实平台点击与人工界面验收；后续由更高层验收决定是否补 UI 行为验收。

## 停止声明

- 代码已实现：是。
- 自动化测试：是。
- 人工验收：未执行。
- 真实任务执行：未执行。
- 提交/推送/PR/合并/安装/部署/发布：未执行。
- 不自行发布 2.3.8。
- Dola 仍未验证。
