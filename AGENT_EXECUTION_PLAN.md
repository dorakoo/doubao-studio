# Agent 协作执行计划

本文用于统筹 GLM、Codex 及后续 Agent 的工程工作。`ROADMAP.md` 负责描述产品方向，本文负责规定近期任务顺序、文件所有权、验收标准和交接方式。

## 当前基线

- 当前版本：`2.0.0`
- 当前分支：`main`
- 当前工作区存在未提交的 2.0.x 加固改动。
- 在当前改动形成基线提交前，其他 Agent 只允许审查，不允许直接修改同一工作区。
- 新任务应从最新基线提交创建独立分支或独立 worktree，禁止多个 Agent 共用一个脏工作区。

## 协作职责

### GLM

适合负责边界明确、可静态验证的任务：

- Electron 主进程生命周期和 IPC 整理。
- 账号、项目和任务的数据一致性校验。
- 类型统一、Lint、测试基线和工程检查脚本。
- 文档、Schema、API 契约初稿和静态代码审查。

### Codex

负责运行时行为和最终集成：

- Webview、DOM 注入、视频生成和产物提取链路。
- 调度竞态、任务取消、人工验证恢复和真实页面兼容。
- 合并 GLM 提交、处理跨模块冲突并执行完整回归。
- 对外 CLI、MCP 和本地 API 的最终安全审查。

### 共享约束

- 一个任务只能有一个代码所有者。
- 一个提交只解决一个任务包，不夹带格式化或无关重构。
- 未经明确授权，不修改版本号、不创建 Tag/Release、不推送远端。
- 不提交 `dist/`、`release/`、运行数据、Cookie、Token、诊断日志或用户素材。
- 不删除或覆盖来源不明的本地改动。
- 修改公共类型、IPC channel 或持久化结构时必须附兼容说明。

## 执行流水线

```text
基线冻结
  -> P0 数据与生命周期修复
  -> 回归测试基线
  -> Shared/Core 分层
  -> Provider Adapter 契约
  -> CLI 验证公共 API
  -> MCP/HTTP 接入
```

任何阶段未达到退出标准，不启动下一阶段的大范围重构。

## Wave 0：基线冻结

### C-000 当前改动集成

**所有者**：Codex  
**状态**：待用户确认提交  
**目标**：审计并提交当前 2.0.x 防御性加固，形成所有 Agent 共用的起点。

验收：

- `pnpm.cmd run validate`
- `git diff --check`
- 记录基线 Commit SHA
- 向 GLM 提供 SHA，要求其从该提交创建分支

## Wave 1：GLM 稳定性任务

以下任务默认串行执行。每项均使用独立提交，完成后先交给 Codex 审查，不直接推送或发布。

### G-101 IPC 注册边界修复

**优先级**：P0  
**依赖**：C-000  
**允许修改**：`main/ipc/tasks.ts`  
**禁止修改**：业务行为、channel 名称、preload API、下载算法

目标：

- 将 `tasks:readFileAsBase64` 之后的顶层 IPC handler 全部移入 `registerTaskIPC()`。
- 将 `settingsPath` 的求值移到应用 ready 后的注册流程。
- 确保 `registerTaskIPC()` 是该模块唯一的 IPC 注册入口。
- 保持所有 channel 和返回结构不变。

验收：

- 模块 import 不执行 `ipcMain.handle()` 或 `app.getPath()`。
- 工程检查仍识别全部 IPC channel。
- `pnpm.cmd run validate` 通过。
- 提交建议：`fix(ipc): register task handlers after app ready`

### G-102 账号数据一致性

**优先级**：P0  
**依赖**：C-000  
**允许修改**：`main/ipc/accounts.ts`  
**可读取**：`main/ipc/tasks.ts`、`main/utils/store.ts`

目标：

- 删除账号前读取任务数据；存在任何关联任务时拒绝删除并返回数量。
- 不自动删除任务，不静默迁移任务。
- 账号新增和重命名拒绝空名称，并使用 trim 后的名称查重。
- 所有写操作检查 `saveAccounts()` 返回值，写入失败不得返回成功。
- `accounts:list` 只在默认字段确实发生补全或日期额度发生重置时写盘。

验收：

- 删除有关联任务的账号不会改变账号、任务或 Session。
- 重名和空名称有明确错误。
- 连续调用 `accounts:list` 不产生无意义写盘。
- `pnpm.cmd run validate` 通过。
- 提交建议：`fix(accounts): enforce persistence and reference integrity`

### G-103 重试统一进入调度器

**优先级**：P0  
**依赖**：C-000；不得与调度器修改并行  
**允许修改**：`src/store/useTaskStore.ts`

目标：

- `retryTask()` 成功后只调用 `processQueue()`，不得直接调用 `startAutomation()`。
- 保留账号繁忙、调度暂停、额度、健康状态和依赖策略的统一判断。
- 检查其他重跑入口，列出但不要顺手重构不相关代码。

验收：

- 前置依赖未完成时，重试任务不会启动。
- `all_finished` 和 `all_done` 行为保持现有定义。
- 多次点击重试不会产生重复运行。
- `pnpm.cmd run validate` 通过。
- 提交建议：`fix(scheduler): route retries through the queue`

### G-104 主进程生命周期兜底

**优先级**：P0  
**依赖**：G-101  
**允许修改**：`main/main.ts`，必要时新增一个 `main/utils/` 下的日志辅助文件

目标：

- 使用 `app.requestSingleInstanceLock()` 防止两个实例同时写数据。
- 第二实例启动时聚焦并恢复已有主窗口。
- 记录 `uncaughtException` 和 `unhandledRejection`，日志写入失败时退回 stderr。
- 增加退出阶段保护，不在应用退出过程中创建新窗口或重新调度任务。
- 不吞掉致命错误；记录后按明确策略退出。

验收：

- 第二实例不会创建第二套窗口和任务执行器。
- 人工触发未处理 Promise 拒绝时可获得可定位日志。
- Windows 正常关闭流程不出现重复初始化。
- `pnpm.cmd run validate` 通过。
- 提交建议：`fix(main): guard process lifecycle and single instance`

### G-105 Webview 定时器生命周期

**优先级**：P1  
**依赖**：当前 `BrowserPanel.tsx` 改动已合入基线  
**允许修改**：`src/components/BrowserPanel.tsx`

目标：

- 跟踪创建 Webview 时产生的 interval 和 timeout。
- 账号删除、Webview 销毁、组件卸载时统一清理。
- 不改变页面注入、生成等待和产物提取行为。

验收：

- 组件卸载后不再有创建 Webview 的轮询回调。
- 账号快速增删不会创建重复 Webview。
- `pnpm.cmd run validate` 通过。
- 提交建议：`fix(webview): clean up creation timers`

## Wave 2：GLM 工程质量任务

### G-201 工程检查增强

**依赖**：Wave 1 完成  
**允许修改**：`scripts/check-project.mjs`、测试 Fixture

- 同时检查 `ipcMain.handle` 与 `ipcMain.on` 重复注册。
- 对照主进程注册 channel、preload 暴露调用和 renderer 类型声明。
- 对动态 channel 或明确单向事件提供白名单，避免脆弱正则误报。
- 检查模块顶层 IPC 注册和 `app.getPath()` 调用。

退出标准：故意加入重复 channel、漏暴露 channel 和顶层注册时检查脚本必须失败。

### G-202 ESLint 与基础测试

**依赖**：G-201  
**允许修改**：Lint/测试配置、`package.json`、`pnpm-lock.yaml`、新测试文件  
**禁止修改**：为消除告警而批量改写业务代码

- 使用 ESLint flat config 与 TypeScript/React 规则。
- 初期规则以阻断真实错误为主，不一次性清理所有存量风格问题。
- 引入适合当前 TypeScript 工程的测试运行器。
- `validate` 顺序固定为类型检查、Lint、工程检查、测试、构建。

退出标准：CI 和本地 Windows 环境使用同一命令通过；测试失败会返回非零退出码。

### G-203 纯逻辑回归测试

**依赖**：G-202  
**允许修改**：测试文件，以及为可测试性抽出的无副作用 helper  
**禁止修改**：任务 UI、真实 Webview 自动化

首批覆盖：

- CSV 解析、字段规范化和非法输入。
- 版本比较。
- 错误分类。
- 依赖 DAG：缺失、自依赖、循环、`all_done`、`all_finished`。
- 账号调度评分、额度耗尽和冷却状态。
- JSON 备份读取与写入失败语义。

退出标准：关键分支有断言；测试不依赖真实豆包账号和网络。

## Wave 3：平台化设计任务

此阶段 GLM 先提交设计和契约，Codex 审查通过后再实施，不允许直接进行全仓搬迁。

### G-301 Shared 类型清单与迁移图

- 盘点 `src/types/index.ts`、`main/ipc/tasks.ts`、`main/preload.ts`、`src/types/electron.d.ts` 的重复类型。
- 输出字段差异矩阵、导入方向和无循环依赖的目录方案。
- 定义迁移批次，每批必须能独立编译。
- 先提交设计文档，不直接移动代码。

### G-302 Capability API Schema 初稿

- 为 `CapabilityManifest`、`CreateTaskRequest`、`TaskSnapshot`、`TaskEvent`、`ArtifactDescriptor`、`ApiError` 编写 JSON Schema 初稿。
- 明确必填字段、枚举、版本、幂等键和向后兼容策略。
- 禁止暴露 DOM、Cookie、Webview、Zustand 或本地绝对路径。

### G-303 CLI 与 MCP 映射设计

- 将公共 Schema 映射为 CLI 命令和 MCP tools。
- 所有生成操作采用异步任务模型，不让单次调用等待视频生成结束。
- 定义 Agent 遇到人工验证、额度耗尽、会员限制和产物过期时的结构化响应。
- 完成威胁模型：localhost 监听、Token、权限范围、审计、任意文件读取和注入风险。

## 文件所有权矩阵

| 文件或目录 | 默认所有者 | 说明 |
| --- | --- | --- |
| `main/ipc/accounts.ts` | GLM | G-102 完成前保持单一所有者 |
| `main/ipc/tasks.ts` | GLM/Codex 串行 | G-101 后由 Codex 集成下载与任务运行改动 |
| `main/main.ts` | GLM | 生命周期任务完成后交 Codex 复核 |
| `src/store/useTaskStore.ts` | Codex | GLM 仅执行已批准的 G-103 小改动 |
| `src/components/BrowserPanel.tsx` | Codex | GLM 仅执行定时器清理，不改自动化行为 |
| `src/utils/doubaoBridge.ts` | Codex | 涉及真实页面行为，禁止并行修改 |
| `scripts/`、Lint、测试配置 | GLM | 不得降低现有校验强度 |
| `shared/`、`core/`、外部 API | 先设计后定所有者 | 契约评审通过后实施 |

## GLM 单任务指令模板

将下面内容与具体任务包一起交给 GLM：

```text
从基线提交 <SHA> 创建独立分支，只执行任务 <ID>。
严格遵守 AGENT_EXECUTION_PLAN.md 的允许/禁止修改范围。
开始前先读取相关代码和 git status，不覆盖现有改动。
不要修改版本号、Release、README 或无关格式。
完成后运行 pnpm.cmd run validate 和 git diff --check。
不要自行推送。最终返回：问题根因、修改文件、行为变化、验证结果、残余风险、提交 SHA。
```

## 交接报告格式

每个 Agent 完成任务后必须提供：

```text
任务 ID：
基线 SHA：
提交 SHA：
修改文件：
根因：
行为变化：
验证命令及结果：
未验证内容：
兼容性/迁移影响：
残余风险：
```

## 集成验收

Codex 合并每个 GLM 提交前执行：

1. 检查提交是否超出文件所有权和任务范围。
2. 审查错误路径、持久化失败和异步竞态。
3. 执行 `pnpm.cmd run validate` 与 `git diff --check`。
4. 对账号、任务、下载或 Webview 改动执行对应手工冒烟测试。
5. 合并后记录最终 SHA，并更新本文任务状态。

任何 Agent 的“检查通过”都不能替代最终集成验收。
