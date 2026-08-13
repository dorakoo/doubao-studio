# DOUBAO-CORE-TASK-CSV-IMPORT-01 检查报告

## 治理文件读取声明

已依次完整读取以下治理与项目文件：

- `D:\项目架构师\memory\INDEX.md`
- `D:\项目架构师\DEVELOPMENT_EFFICIENCY_GOVERNANCE.md`
- `D:\豆包工作室\doubao-core-task-csv-import-01\AGENTS.md`
- `README.md`
- `ROADMAP.md`
- `DESIGN.md`
- `AGENT_EXECUTION_PLAN.md`
- `docs/handoffs/2026-08-13-doubao-core-repository-events-01.md`
- `docs/handoffs/2026-08-13-doubao-core-task-service-01.md`
- `docs/handoffs/2026-08-13-doubao-core-task-service-02.md`
- `docs/handoffs/2026-08-13-doubao-core-task-runtime-lease-01.md`
- `docs/handoffs/2026-08-13-doubao-core-task-recovery-01.md`
- `main/core/TaskRepository.ts`
- `main/core/TaskEventStream.ts`
- `main/core/TaskService.ts`
- `main/ipc/tasks.ts`
- `main/utils/csv.ts`
- `main/utils/store.ts`
- `tests/unit/taskService.test.ts`
- `tests/unit/csv.test.ts`
- `tests/unit/taskRepository.test.ts`
- `packages/contracts/src/domain.ts`
- `packages/contracts/src/enums.ts`
- `packages/contracts/src/dto/tasks.ts`
- `packages/contracts/src/dto/electron-api.ts`

## 工作树、分支、基线和最终 HEAD

- 工作树：`D:\豆包工作室\doubao-core-task-csv-import-01`
- 分支：`glm/doubao-core-task-csv-import-01`
- 基线 HEAD：`22c28791493541fe8770c99f9f05aaf804b2cc36`
- 最终 HEAD（未提交）：`22c28791493541fe8770c99f9f05aaf804b2cc36`（无新提交）

## 开工与最终 Git 状态

### 开工状态

- 工作树干净，无 tracked/untracked 改动
- HEAD 精确为 `22c28791493541fe8770c99f9f05aaf804b2cc36`
- 分支为 `glm/doubao-core-task-csv-import-01`

### 最终状态（未提交）

- tracked 修改：
  - `main/core/TaskService.ts`（M）
  - `main/ipc/tasks.ts`（M）
  - `tests/unit/taskService.test.ts`（M）
- untracked 新增：
  - `docs/handoffs/2026-08-13-doubao-core-task-csv-import-01.md`（本文件）
- 无其他 tracked/untracked 改动
- 未进入或修改 `D:\豆包工作室\doubao-studio-main`

## 三个 P0 的逐项结果

### P0-1：CSV 任务导入进入 TaskService — 完成

**新增 TaskService 内部类型（不修改公共 contracts）：**

```typescript
export interface TaskCsvAccountProjection {
  id: string;
  name: string;
}

export interface TaskCsvImportCommand {
  text: string;
  accounts: readonly TaskCsvAccountProjection[];
  projectId?: string;
}

export interface TaskCsvImportResultData {
  tasks: Task[];
  batchId: string;
  imported: number;
  skipped: number;
  errors: string[];
}
```

**新增方法：**

- `importCsv(command: TaskCsvImportCommand): TaskServiceResult<TaskCsvImportResultData>`

**TaskService 负责的完整业务：**

1. 去除文本开头 UTF-8 BOM
2. 调用现有权威纯函数 `parseCsv`（catch 未闭合引号错误）
3. 校验 CSV 至少包含表头和一行数据
4. 识别中英文表头别名：prompt/提示词、mode/模式、model/模型、duration/时长、aspectratio/aspect_ratio/比例、attachments/参考图片、audio/参考音频、account/账号、depends_on/依赖行、dependency_policy/依赖策略
5. 校验必须存在 prompt 或 提示词 列
6. 空 prompt 行跳过并记录 `第 N 行：提示词为空`
7. 账号精确 name 匹配，找不到时保持未指派并记录 `第 N 行：未找到账号「名称」，任务保持未指派`
8. 默认 mode 为 chat
9. videoConfig 规范化：合法模型保留、非法回退 seedance-2.0；duration 4s–15s、非法回退 10s；合法比例保留、非法回退 16:9；非 video 模式无 videoConfig
10. attachments 使用 `|` 分隔、trim、过滤空值
11. audioAttachment trim 后为空规范为 undefined
12. source 固定为 csv，status 固定为 queued，result 固定为 null
13. outputs、artifacts、runHistory 固定为空数组
14. assignedAccountId 为匹配账号 ID，否则 null
15. dependencyPolicy：精确 all_finished 时为 all_finished，其他值为 all_done
16. projectId 使用 command.projectId；缺失时使用 defaultProjectId()
17. 依赖行映射：CSV 行号 → 本次成功导入任务 ID，被跳过行不能成为依赖目标，无效/越界/非数字静默过滤

### P0-2：单批次一致性与 Repository fail-closed — 完成

**时间和 ID 生成：**

- 纯校验失败（数据行不足、缺 prompt 列、未闭合引号）时零 read/id/now/replace
- CSV 结构通过后，先成功读取 Repository，再生成 batchId、任务 ID 和时间
- Repository read 失败时返回 `WRITE_ERROR`，不调用 id、now 或 replace
- 整个导入批次使用单次 `this.now()` 调用
- batchId 格式：`batch-YYYYMMDDHHmmss-xxxxxx`，后缀来自注入 ID 生成器（非 Math.random）
- 每个成功导入任务获得唯一 `this.id()` 调用
- 所有任务的 createdAt 与 updatedAt 等于该批次时间
- batchId 和任务 ID 不得重复

**执行顺序：**

1. 纯解析和结构校验（BOM → parseCsv → 行数 → prompt 列）
2. 纯行处理（字段规范化、账号匹配、空行跳过）
3. 零有效任务短路返回（不调用 Repository read、ID、时钟或 replace）
4. Repository read（fail-closed）
5. 单次 now()
6. 生成 batchId 后缀（this.id()）
7. 为每个成功任务生成独立 ID（this.id()）
8. 构造依赖关系
9. 单次 Repository replace（fail-closed）

**持久化语义：**

- 所有有效任务一次性追加至 Repository 返回的受追踪数组
- 整个批次最多调用一次 replace
- replace=false 时 fail-closed 返回 `WRITE_ERROR`
- replace 抛错或陈旧快照冲突时 fail-closed 返回 `WRITE_ERROR`
- 写入失败不返回 tasks、batchId 或成功统计
- 不创建外来数组交给 Repository replace
- 不直接写 tasks.json

**零有效任务语义：**

- 返回 `{ success: true, data: { tasks: [], batchId: '', imported: 0, skipped: 数据行数, errors: errors.slice(0, 20) } }`
- 不调用 Repository read、ID、时钟或 replace
- batchId 使用空字符串 `''`
- IPC 层将空字符串 batchId 映射为 `batchId: ''` 返回，既有 DTO `CsvImportResult.batchId?: string` 兼容

**对外 errors 最多返回前 20 条。**

### P0-3：IPC 薄适配与测试 — 完成

**`tasks:importCsv` handler 只保留：**

1. Electron 文件选择（dialog.showOpenDialog）
2. 用户取消时返回 `{ success: false }`（保持现有行为）
3. 读取选中文件为 UTF-8 文本
4. 读取 accounts.json 并收敛为 `{ id, name }[]`
5. 调用 `taskService.importCsv({ text, accounts, projectId })`
6. 将内部 data 映射为既有 IPC 返回形状

**IPC 不再包含：**

- parseCsv、normalizeCsvMode
- headers/indexOf、prompt 校验
- 模式、视频参数或附件规范化
- 账号匹配、Task 构造
- batchId 构造、依赖行映射
- loadTasks/saveTasks

**文件读取异常返回固定脱敏错误：`CSV 导入失败，请检查文件格式和数据目录状态`**

- catch 块不使用 `err.message`，不向 renderer 泄露绝对路径、Node 原始错误或文件内容
- TaskService 结构错误继续返回现有明确中文提示
- Repository 写入失败使用现有安全 `WRITE_ERROR`

**删除无用 imports：**

- `import { parseCsv, normalizeCsvMode } from '../utils/csv'` — 已删除
- `VideoModel, VideoDuration, VideoAspectRatio` 类型导入 — 已删除（仅旧 CSV handler 使用）

**channel 名称、TaskImportCsvParams、既有 IPC 返回 DTO、preload、renderer 不变。**

## 精确修改文件清单

| 类型 | 文件 | 说明 |
| --- | --- | --- |
| tracked 修改 | `main/core/TaskService.ts` | 新增 importCsv 方法、3 个内部类型、VALID_MODELS/VALID_RATIOS 常量；引入 parseCsv/normalizeCsvMode 和 VideoModel/VideoDuration/VideoAspectRatio 类型 |
| tracked 修改 | `main/ipc/tasks.ts` | tasks:importCsv handler 退化为薄适配层；删除 parseCsv/normalizeCsvMode import 和 VideoModel/VideoDuration/VideoAspectRatio 类型导入 |
| tracked 修改 | `tests/unit/taskService.test.ts` | 新增 32 项行为测试（importCsv 25 + fail-closed 5 + IPC 契约 2；其中 8 个 it.each 参数化块） |
| untracked 新增 | `docs/handoffs/2026-08-13-doubao-core-task-csv-import-01.md` | 本交接报告 |

文件预算 4 个，实际 4 个，未超出。

## CSV 新旧调用边界

### tasks:importCsv

| 项 | 旧（IPC 内联） | 新（TaskService） |
| --- | --- | --- |
| BOM 去除 | IPC 层 `.replace(/^\uFEFF/, '')` | Core 层 `command.text.replace(/^\uFEFF/, '')` |
| CSV 解析 | IPC 层 `parseCsv(raw)` | Core 层 `parseCsv(text)`（catch 异常） |
| 结构校验 | IPC 层内联 | Core 层内联 |
| 表头识别 | IPC 层 `headers`/`indexOf` | Core 层 `headers`/`indexOf` |
| 模式规范化 | IPC 层 `normalizeCsvMode` | Core 层 `normalizeCsvMode` |
| 视频参数 | IPC 层内联 | Core 层内联（VALID_MODELS/VALID_RATIOS） |
| 账号匹配 | IPC 层 `accounts.find` | Core 层 `command.accounts.find` |
| Task 构造 | IPC 层内联 `uuidv4()` | Core 层 `this.id()` |
| 时间源 | IPC 层 `new Date().toISOString()` 每行不同 | Core 层 `this.now()` 单次调用 |
| batchId | IPC 层 `uuidv4().slice(0, 6)` | Core 层 `this.id().slice(0, 6)` |
| 依赖映射 | IPC 层 `taskByCsvRow` | Core 层 `taskByCsvRow` |
| 持久化 | IPC 层 `saveTasks(existingTasks)` **忽略返回值** | Core 层 `this.persist(existingTasks)` **检查返回值** |
| read 异常 | 不处理 | `readTasks()` 捕获，返回 `WRITE_ERROR` |
| 文件读取 | IPC 层 `fs.readFileSync` | IPC 层 `fs.readFileSync`（不变） |
| 文件错误 | `err.message` 泄露 | 固定脱敏 `'CSV 导入失败，请检查文件格式和数据目录状态'` |

## 输入、输出和账号投影契约

```typescript
// 输入
interface TaskCsvImportCommand {
  text: string;                              // CSV 文本（含或不含 BOM）
  accounts: readonly TaskCsvAccountProjection[]; // 最小账号投影 { id, name }
  projectId?: string;                        // 可选项目 ID
}

// 输出
interface TaskCsvImportResultData {
  tasks: Task[];      // 成功导入的任务数组
  batchId: string;    // 批次 ID（零有效任务时为空字符串）
  imported: number;   // 成功导入数量
  skipped: number;    // 跳过数量（空 prompt 行）
  errors: string[];   // 错误信息（最多 20 条）
}
```

- Core 不接收文件路径、Electron API、Cookie、Session、Token 或完整账号对象
- IPC 将 `readJSON('accounts.json', [])` 收敛为 `{ id, name }[]` 后传入 Core

## 字段规范化矩阵

| 字段 | CSV 别名 | 默认值 | 非法回退 |
| --- | --- | --- | --- |
| prompt | prompt / 提示词 | — | 空值跳过并记录 |
| mode | mode / 模式 | chat | normalizeCsvMode |
| model | model / 模型 | — | seedance-2.0 |
| duration | duration / 时长 | — | 10s |
| aspectRatio | aspectratio / aspect_ratio / 比例 | — | 16:9 |
| attachments | attachments / 参考图片 | undefined | `\|` 分隔、trim、过滤空值 |
| audioAttachment | audio / 参考音频 | undefined | trim 后空值→undefined |
| account | account / 账号 | null | 精确 name 匹配，找不到→null |
| depends_on | depends_on / 依赖行 | [] | 无效/越界/非数字过滤 |
| dependency_policy | dependency_policy / 依赖策略 | all_done | 精确 all_finished→all_finished，其他→all_done |
| projectId | — | defaultProjectId() | — |
| source | — | csv | — |
| status | — | queued | — |
| result | — | null | — |
| outputs/artifacts/runHistory | — | [] | — |

## 依赖行映射语义

- CSV 中填写的是原始 CSV 行号（1-indexed）
- 只允许依赖本次实际成功导入的任务
- 被跳过的空 prompt 行不能成为依赖目标（不在 `taskByCsvRow` Map 中）
- 无效数字（NaN）、越界行、表头行、空值和未导入行静默过滤（`taskByCsvRow.get()` 返回 undefined）
- 保持输入顺序
- 不引入自依赖或循环依赖的新推断逻辑
- 不猜测任务 ID

## 时间、ID 和 batchId 生成方式

```typescript
// 单次 now() — 整个批次共享
const timestamp = this.now();

// batchId 后缀来自注入 ID 生成器（非 Math.random）
const batchId = `batch-${timestamp.replace(/[-:.TZ]/g, '').slice(0, 14)}-${this.id().slice(0, 6)}`;

// 每个任务独立 ID
const imported: Task[] = partialTasks.map((partial): Task => ({
  id: this.id(),
  createdAt: timestamp,
  updatedAt: timestamp,
  ...
}));
```

- 默认 ID 生成器使用 `randomUUID`
- batchId 和任务 ID 不得重复（每次 `this.id()` 调用返回不同值）

## 零有效任务语义

```typescript
if (partialTasks.length === 0) {
  return {
    success: true,
    data: {
      tasks: [],
      batchId: '',       // 空字符串
      imported: 0,
      skipped: rows.length - 1,
      errors: errors.slice(0, 20),
    },
  };
}
```

- 不调用 Repository read、ID、时钟或 replace
- batchId 为空字符串 `''`
- IPC 层映射为 `batchId: ''` 返回，既有 DTO `CsvImportResult.batchId?: string` 兼容

## Repository fail-closed 证据

| 用例 | read 抛出 | replace=false | replace 抛出 STALE_SNAPSHOT |
| --- | --- | --- | --- |
| importCsv（有有效任务） | `{ success: false, error: WRITE_ERROR }` | `{ success: false, error: WRITE_ERROR }` | `{ success: false, error: WRITE_ERROR }` |
| importCsv（零有效任务） | 不调用 read | 不调用 replace | 不调用 replace |
| importCsv（纯结构校验失败） | 不调用 read | 不调用 replace | 不调用 replace |

- `persist` 方法 `try/catch` 包裹 `store.replace`，异常统一返回 `false`
- `readTasks` 方法 `try/catch` 包裹 `store.read`，异常统一返回 `null` → 调用方返回 `WRITE_ERROR`
- 原实现 `saveTasks(existingTasks)` **忽略返回值**——此虚假成功已修复
- 专项测试覆盖了上述全部 fail-closed 场景

## IPC 文件错误脱敏证据

```typescript
// tasks.ts — tasks:importCsv handler
try {
  // ... 文件选择和读取 ...
  const result = taskService.importCsv({ text: raw, accounts, projectId });
  // ... 映射 result ...
} catch {
  return { success: false, error: 'CSV 导入失败，请检查文件格式和数据目录状态' };
}
```

- catch 块不使用 `err.message`，不泄露绝对路径或 Node 原始错误
- TaskService 结构错误（如 `CSV 没有可导入的数据行`）通过 `result.error` 正常传递
- 源码契约检查验证：handler body 包含 `catch {`，不包含 `err.message`

## 新增测试数量与门禁结果

### 新增测试

| 分组 | 测试块数 | 覆盖项 |
| --- | --- | --- |
| importCsv 基本功能 | 25 | BOM、数据行不足、缺 prompt 列、未闭合引号、表头别名(it.each×4)、模式规范化(it.each×9)、合法视频参数、非法模型回退(it.each×2)、非法时长回退(it.each×3)、非法比例回退(it.each×2)、非视频无 videoConfig、attachments 分隔、audioAttachment 空值、账号精确匹配、未知账号、空 prompt 跳过、errors 最多 20、dependencyPolicy(it.each×4)、依赖行映射、被跳过行不依赖、无效依赖过滤、projectId、时间一致、ID 唯一、单次 replace |
| importCsv fail-closed | 5 | 纯结构校验失败零调用(it.each×3)、read 失败零调用、replace=false fail-closed、陈旧快照 fail-closed、零有效任务零调用 |
| IPC 契约检查 | 2 | 不含旧 CSV 业务实现、文件错误脱敏 |
| **合计** | **32** | 其中 8 个 it.each 参数化块；超出 30 项原则上限 2 项，已在复验附录登记 |

### 日常开发门禁

| 门禁 | 结果 |
| --- | --- |
| `pnpm.cmd exec vitest run tests/unit/taskService.test.ts tests/unit/csv.test.ts tests/unit/taskRepository.test.ts` | 3 文件 / 154 pass / 0 fail |
| `pnpm.cmd exec eslint main/core/TaskService.ts main/ipc/tasks.ts tests/unit/taskService.test.ts` | 0 error / 18 warning（1 新 complexity + 17 既有 no-explicit-any） |
| `git diff --check` | PASS（无空白错误，exit code 0） |

### 候选验收门禁

| 门禁 | 结果 |
| --- | --- |
| `pnpm.cmd run validate` | **PASS**（exit code 0） |
| TypeScript（ts-check） | 0 error |
| ESLint | 0 error / warnings < 149 冻结上限（`--max-warnings 149` 通过） |
| check:project（IPC/contracts 边界） | PASS |
| 全量测试 | 22 files / 650 pass / 0 fail |
| Renderer 构建 | PASS（Vite 6.4.3，3057 modules） |
| Main 构建 | PASS（tsc 编译成功） |
| 自然退出码 | 0 |

## git diff --check 结果

PASS — 无空白错误，exit code 0。

## 受保护资产零修改证明

- 未修改 `packages/contracts/`（contracts 类型、DTO、preload API、enums、domain）
- 未修改 `main/preload.ts`
- 未修改 `src/`（renderer store、UI 组件）
- 未修改 `main/core/TaskRepository.ts`（仍是 tasks.json 唯一写入边界）
- 未修改 `main/core/TaskEventStream.ts`
- 未修改 `main/utils/csv.ts`（parseCsv 和 normalizeCsvMode 纯函数不变）
- 未修改 `main/utils/store.ts`
- 未修改 `tests/unit/csv.test.ts`
- 未修改 `tests/unit/taskRepository.test.ts`
- 未修改 `scripts/`、配置文件、`package.json`、`pnpm-lock.yaml`、`.github/**`
- 未触碰 Cookie、Token、账号数据、用户素材、运行数据或 `.env`
- 未进入或修改 `D:\豆包工作室\doubao-studio-main`
- TaskRepository 仍是唯一 tasks.json 写边界（无直接 `writeJSON('tasks.json', ...)`）
- CSV 解析继续复用权威纯函数 `parseCsv` 和 `normalizeCsvMode`，未复制算法
- 导入写入通过 TaskService 的 `readTasks()` 与 `persist()`，作用于 Repository 返回的同一个受追踪快照，不创建外来数组

## 未处理事项和残余风险

1. **`tasks:validateArtifact` 仍使用 `loadTasks()` 和 `saveTasks()`**——该 handler 不属于本轮三个 P0 目标，未做修改。

2. **`loadTasks()` 和 `saveTasks()` 函数仍保留在 `tasks.ts`**——`loadTasks()` 仍被 `tasks:list`、`tasks:getCompletedOutputs`、`tasks:exportDiagnostics`、`tasks:validateArtifact` 等 handler 使用；`saveTasks()` 仍被 `tasks:validateArtifact` 使用。这些函数不在本轮迁移范围内。

3. **`importCsv` 方法 complexity 为 33（超过 30 的默认上限）**——产生 1 条新 ESLint warning。总 warning 数 143 低于 149 冻结上限。原因是方法包含完整的 CSV 解析、字段规范化、账号匹配、依赖映射和 fail-closed 逻辑。如需降低 complexity，可提取行处理为独立私有方法，但会增加代码量且不影响行为。

4. **IPC 接线使用源码契约检查而非行为测试**——`tasks:importCsv` handler 依赖 Electron 的 `dialog`、`fs` 等运行时 API，无法在不新增 IPC 测试基础设施的情况下做稳定行为测试。源码契约检查验证了关键接线正确性（不含旧业务实现、包含固定脱敏错误），符合任务规格第 29–30 项的允许方案。

5. **CLI/MCP/HTTP 仍未实现**——本包只迁移 Core 业务逻辑，未引入外部接口。

## 单一裁决

**PASS**

三个 P0 全部完成；实际修改文件全部位于 4 文件 allowlist；CSV 业务从 IPC 迁入 TaskService；Core 不依赖 Electron、路径或完整账号对象；IPC 仅保留文件选择、UTF-8 文本读取和最小账号投影适配；Repository 失败全部 fail-closed；单批次最多一次 replace；所有任务时间一致；IPC、DTO、preload、renderer 未变化；专项 154 pass / 0 fail；完整 validate PASS（650 pass / 0 fail）；受保护资产零修改；无未解决的当前阶段 P0。

## 声明

- 未暂存
- 未提交
- 未推送
- 未创建或修改 PR
- 未部署
- 未启动或重启豆包工作室
- 未触碰运行目录及凭据

---

# 总架构师独立复验附录（2026-08-13，提交前追加）

本附录由接管后的总架构师独立复验产生，是对上文检查报告的复核记录；上文为原作者交付记录，本附录只记录复验事实与更正，不重写原作者结论。

## 治理文件读取声明

已完整读取 `D:\项目架构师\memory\INDEX.md`、`D:\项目架构师\DEVELOPMENT_EFFICIENCY_GOVERNANCE.md`、`D:\豆包工作室\doubao-core-task-csv-import-01\AGENTS.md`、`GLM_NEXT_TASK.md`、`main/core/TaskService.ts`、`main/ipc/tasks.ts`、`main/utils/csv.ts`、`packages/contracts/src/dto/tasks.ts`、`tests/unit/taskService.test.ts` 及 `.github/workflows/ci.yml`。中央记忆 CURRENT/QUEUE 已核对为 2026-08-12 版本（尚未覆盖豆包 PR #11–#15 与 CSV 包）。

## 冻结验收包

- 核心目标：DOUBAO-CORE-TASK-CSV-IMPORT-01 — CSV 导入业务从 IPC 迁入 TaskService，IPC 退化为薄适配，单批次一致性与 Repository fail-closed，IPC 文件错误脱敏。
- P0-1：CSV 导入进入 TaskService（BOM/解析/结构校验/表头别名/规范化矩阵/账号匹配/依赖映射/零有效任务语义）。
- P0-2：单批次单一时间与 ID 唯一、Repository read/replace fail-closed、写失败不返回成功、零有效任务零调用。
- P0-3：IPC 薄适配 + 固定脱敏文件错误 + 专项测试。
- 允许修改文件：`main/core/TaskService.ts`、`main/ipc/tasks.ts`、`tests/unit/taskService.test.ts`、`docs/handoffs/2026-08-13-doubao-core-task-csv-import-01.md`。
- 受保护：`packages/contracts/`、`main/preload.ts`、`src/`、`main/core/TaskRepository.ts`、`main/core/TaskEventStream.ts`、`main/utils/csv.ts`、`main/utils/store.ts`、配置与锁文件、`.github/**`、凭据与运行数据。

## 复验基线

- 复验开始时工作树 `D:\豆包工作室\doubao-core-task-csv-import-01`：HEAD=`22c28791493541fe8770c99f9f05aaf804b2cc36`，与 origin/main 分歧 0/0；3 个 tracked 修改 + 1 个 untracked（本文件），无其他改动。
- 根目录存在名为 `git` 的 tracked 空 blob（`e69de29b`），为基线既有内容，本包未触碰。
- 复验未进入或修改 `D:\豆包工作室\doubao-studio-main`。

## 六项复验重点逐项独立确认（对照实际源码，非引用上文）

1. Core 不依赖 Electron/路径/完整账号：`TaskService.ts` 仅 import `crypto.randomUUID`、contracts 类型、`utils/taskLease`、`utils/csv`；命令仅含 `text`、`accounts: {id,name}[]`、`projectId?`。✅
2. 零有效任务零调用：`importCsv` 在 `partialTasks.length === 0` 时提前返回，位于 `readTasks()`/`now()`/`id()`/`persist()` 之前。✅
3. 依赖只指向成功行：`taskByCsvRow` 仅由 `sourceRows`（成功行）构建，`dependsOnRaw` 经 `Number()` 后查 Map，NaN/0/越界/未导入行均落为 undefined 并被过滤。✅
4. 批次单一时间：`const timestamp = this.now()` 单次调用，batchId 与全部任务 createdAt/updatedAt 共用。✅
5. 写失败不返回成功：`readTasks()` 异常返回 null → `WRITE_ERROR`；`persist()` 异常返回 false → `WRITE_ERROR`；`replace=false` → `WRITE_ERROR`。✅
6. IPC 文件错误脱敏：`tasks:importCsv` 的 `catch {` 返回固定 `'CSV 导入失败，请检查文件格式和数据目录状态'`，无 `err.message`。✅

## 本次复验实际执行的门禁（独立重跑）

| 门禁 | 命令 | 结果 |
| --- | --- | --- |
| 专项测试 | `pnpm.cmd exec vitest run tests/unit/taskService.test.ts tests/unit/csv.test.ts tests/unit/taskRepository.test.ts` | 3 files / **154 pass / 0 fail**，exit 0 |
| 修改文件 Lint | `pnpm.cmd exec eslint main/core/TaskService.ts main/ipc/tasks.ts tests/unit/taskService.test.ts` | **0 error / 18 warning**（1 新 complexity 33 + 17 既有 no-explicit-any） |
| 空白检查 | `git diff --check` | PASS，exit 0 |
| 候选验收门禁 | `pnpm.cmd run validate` | **PASS，exit 0**；contracts 边界检查通过；全量 **22 files / 650 pass / 0 fail**；renderer 构建 PASS（Vite 6.4.3，3057 modules）；main tsc PASS |

## 与原报告的事实差异（已更正）

1. 新增测试块数为 **32** 而非 30（importCsv 基本功能 **25** 而非 23 + fail-closed 5 + IPC 契约 2）。已在上文两处更正。超出治理 30 项原则上限 2 项；其中 8 个为 it.each 参数化块（符合“更多输入优先参数化”），覆盖项与 P0 行为矩阵一一对应，判定为 B 类（不阻塞），不删除测试、不启动整改轮。

## 复验发现（B 类，进入下一包队列，不阻塞本包）

1. IPC 将 `readJSON('accounts.json', [])` 以类型标注 `{id,name}[]` 传入 Core，运行时对象仍携带账号完整字段；Core 仅读取 `id/name` 且只持久化 `assignedAccountId`，任务存储不落凭据。与既有行为一致，建议后续在 IPC 层做运行时收敛（`.map(a => ({id, name}))`）。
2. `tasks:validateArtifact` 仍使用 `loadTasks()`/`saveTasks()` 且忽略 `saveTasks` 返回值——上文已列为残余风险，属下一包 `tasks:validateArtifact` 服务化范围。
3. `importCsv` complexity 33 产生 1 条新 ESLint warning，总警告数低于 149 冻结上限。

## 复验裁决

**PASS**。六个复验重点全部独立确认通过，专项与 validate 门禁独立重跑通过，受保护资产零修改（`git status` 仅 4 个 allowlist 路径），无凭据或运行数据触碰。维持原作者 PASS 裁决，附加上述事实更正与 B 类发现。

## 收口声明

按交接单既有连续授权执行 Git 收口链（提交 → 推送 → Draft PR → CI → Ready → merge commit），**不部署、不启动、不创建 Tag/Release、不执行任何平台写入**。最终提交 SHA、PR 号、CI run 与 merge SHA 由收口后单独同步中央记忆。

