# Shared 类型迁移设计

> **状态**：设计阶段，待 Codex 审查批准后方可实施
> **基线**：`79af341`（Wave 2 审查合入后）
> **任务**：G-301 Shared 类型清单与迁移图
> **约束**：本文件仅提供设计文档，不创建目录、不移动代码、不修改配置

## 1. 重复类型与字段差异矩阵

下表盘点 `src/types/index.ts`（渲染进程）、`main/ipc/*.ts`（主进程）、`main/preload.ts`（预加载）和 `main/utils/csv.ts` 中存在的类型重复与字段差异。

### 1.1 枚举/联合类型

| 类型名 | 渲染进程 (`src/types/index.ts`) | 主进程定义位置 | preload.ts | 差异说明 |
|--------|-------------------------------|---------------|------------|---------|
| `GenerationMode` | L52: `'chat' \| 'image' \| 'video' \| 'music'` | `tasks.ts` L15（同）、`accounts.ts` L66（local，同） | L30（同） | 4 处定义，值完全一致 |
| `AccountStatus` | L7: `'idle' \| 'busy' \| 'error'` | `accounts.ts` L14（同） | —（inline `status: 'idle' \| 'busy' \| 'error'`） | 2 处命名定义 + 1 处内联 |
| `TaskStatus` | L123-131: 8 个状态 | `tasks.ts` L26-34（同） | L36（inline in Task.status） | 3 处，值完全一致 |
| `TaskStage` | L133-148: 15 个阶段 | `tasks.ts` L36-40（同） | — | 2 处，值完全一致 |
| `VideoModel` | L55 | `tasks.ts` L18（同） | — | 2 处，值完全一致 |
| `VideoDuration` | L58 | `tasks.ts` L21（同） | — | 2 处，值完全一致 |
| `VideoAspectRatio` | L61 | `tasks.ts` L24（同） | — | 2 处，值完全一致 |
| `TaskErrorCode` | L150-163: 13 个码 | —（主进程未定义） | — | **仅渲染进程**，主进程 `TaskErrorInfo.code` 使用 `string` |
| `CsvGenerationMode` | — | `csv.ts` L6（同值但改名） | — | G-204 抽取时为避免跨模块依赖从 `tasks.ts` 导入而独立定义 |

### 1.2 接口/对象类型

| 接口名 | 渲染进程 | 主进程 | preload.ts | 关键字段差异 |
|--------|---------|--------|------------|------------|
| `Account` | L30-49 | `accounts.ts` L17-53 | L11-28 | **preload 缺少** `scheduling`、`health` 详细类型（`any`）；**主进程** `health.lastErrorCode` 为 `string`，渲染进程为 `TaskErrorCode` |
| `AccountHealth` | L17-27（命名接口） | `accounts.ts` L34-44（inline） | —（`any`） | `lastErrorCode`: `TaskErrorCode` vs `string` |
| `SeedanceQuota` | L9-15（命名接口） | `accounts.ts` L27-33（inline in Account） | L18-24（inline in Account） | 结构一致，主进程和 preload 内联未提取命名接口 |
| `Account.scheduling` | L41-46（inline in Account） | `accounts.ts` L45-50（inline in Account） | — | 结构一致 |
| `Task` | L253-287 | `tasks.ts` L119-156 | L32-47 | **preload 缺少** `artifacts`、`runHistory`、`lock`、`batchId`、`source`、`dependsOnTaskIds`、`dependencyPolicy`、`projectId`；`videoConfig?`、`runtime?`、`errorInfo?` 均为 `any` |
| `TaskErrorInfo` | L165-170: `code: TaskErrorCode` | `tasks.ts` L42-47: `code: string` | —（`any`） | **类型不兼容**：`string` 比 `TaskErrorCode` 宽，编译器无法保证主进程返回的错误码属于已知枚举 |
| `TaskRunSnapshot` | L182-199 | `tasks.ts` L49-66 | —（`any`） | 结构一致 |
| `TaskRunRecord` | L201-210 | `tasks.ts` L68-77 | — | 结构一致，`errorCode` 均为 `string` |
| `TaskLock` | L212-216 | `tasks.ts` L79-83 | — | 完全一致 |
| `TaskArtifact` | L218-234 | `tasks.ts` L85-101 | — | 完全一致 |
| `DownloadJob` | L236-250 | `tasks.ts` L103-117 | — | 完全一致 |
| `Project` | L172-180 | `projects.ts` L5-13 | — | 完全一致 |
| `LogEntry` | — | `system.ts` L6（inline，未导出） | — | **仅主进程**，渲染进程 `electron.d.ts` L131 内联了等价结构但未引用此类型 |
| `CsvImportResult` | L297-305 | — | — | **仅渲染进程**，主进程 IPC handler 返回结构与此匹配但未导入此类型 |
| `AdapterSelfCheckItem` | L307-312 | — | — | **仅渲染进程** |
| `AdapterSelfCheckReport` | L314-320 | — | — | **仅渲染进程** |
| `AdapterRuleBundle` | L322-332 | — | — | **仅渲染进程** |

### 1.3 常量/映射

| 常量名 | 渲染进程 | 主进程 | 说明 |
|--------|---------|--------|------|
| `DEFAULT_VIDEO_CONFIG` | L64-68 | — | 仅渲染进程，含 `as` 类型断言 |
| `VIDEO_MODEL_LABELS` | L71-75 | — | 仅渲染进程，UI 展示用 |
| `VIDEO_MODEL_COST` | L78-82 | — | 仅渲染进程，UI 展示用 |
| `GENERATION_MODE_CONFIG` | L85-120 | — | 仅渲染进程，UI 展示用 |
| `TASK_STATUS_CONFIG` | L335-344 | — | 仅渲染进程，UI 展示用 |
| `TASK_STAGE_LABELS` | L346-362 | — | 仅渲染进程，UI 展示用 |
| `ACCOUNT_STATUS_CONFIG` | L365-369 | — | 仅渲染进程，UI 展示用 |
| `AUTO_STATE_DISPLAY` | L372-379 | — | 仅渲染进程，UI 展示用 |

### 1.4 ElectronAPI 契约

| 位置 | 文件 | 问题 |
|------|------|------|
| 类型声明 | `src/types/electron.d.ts` L59-146: `ElectronAPI` 接口 | 完整类型化 |
| 运行时实现 | `main/preload.ts` L51-170: `contextBridge.exposeInMainWorld` | **类型与运行时分离**：preload 未导入 `ElectronAPI` 类型，签名使用 `any`/内联类型，两边可能不同步 |

## 2. 类型分层定义

### 2.1 领域模型（Domain Models）

跨进程共享的核心业务实体，表示系统中的"事物"。

| 类型 | 当前归属 | 迁移目标 |
|------|---------|---------|
| `Account` | src + main 各一份 | shared |
| `AccountHealth` | src + main 各一份 | shared |
| `SeedanceQuota` | src + main 内联 | shared |
| `AccountScheduling`（当前 inline） | src + main 内联 | shared |
| `Task` | src + main + preload 三份 | shared |
| `TaskRunSnapshot` | src + main | shared |
| `TaskRunRecord` | src + main | shared |
| `TaskLock` | src + main | shared |
| `TaskArtifact` | src + main | shared |
| `DownloadJob` | src + main | shared |
| `Project` | src + main | shared |
| `LogEntry` | main only | shared（渲染进程也需使用） |

### 2.2 枚举/联合（Enum-like Unions）

| 类型 | 当前归属 | 迁移目标 |
|------|---------|---------|
| `GenerationMode` | 4 处 | shared |
| `AccountStatus` | 2 处 + 1 内联 | shared |
| `TaskStatus` | 3 处 | shared |
| `TaskStage` | 2 处 | shared |
| `TaskErrorCode` | src only | shared（主进程需开始使用） |
| `VideoModel` / `VideoDuration` / `VideoAspectRatio` | 各 2 处 | shared |
| `DependencyPolicy`（当前 inline `'all_done' \| 'all_finished'`） | src + main 内联 | shared |

### 2.3 持久化记录（Persistence Records）

当前领域模型与持久化记录结构相同——JSON 文件直接存储领域对象。迁移后应显式区分：

| JSON 文件 | 当前存储类型 | 迁移后 |
|-----------|------------|--------|
| `accounts.json` | `Account[]` | `AccountRecord[]`（首批仍为 `Account` 的类型别名） |
| `tasks.json` | `Task[]` | `TaskRecord[]`（首批仍为 `Task` 的类型别名） |
| `projects.json` | `Project[]` | `ProjectRecord[]`（首批仍为 `Project` 的类型别名） |
| `downloads.json` | `DownloadJob[]` | `DownloadJobRecord[]` |
| `logs.json` | `LogEntry[]` | `LogEntryRecord[]` |

**策略**：首批迁移保持 `Record = Model`（类型别名），不向每条记录写入 `schemaVersion`，因此磁盘格式完全不变。版本来源继续使用现有文件级 `schema.json`；未来如需独立版本，应一次性引入带版本的文件 envelope，并提供原子迁移。

### 2.4 IPC 命令/响应 DTO

当前 IPC handler 的参数和返回值类型内联在 `ipcMain.handle` 调用中，无独立类型定义。`ElectronAPI` 在渲染进程中描述了这些 DTO 但主进程未消费。

迁移后应为每个 IPC channel 定义命名 DTO：

```
packages/contracts/src/dto/accounts.ts    — ListAccountsResponse, AddAccountRequest, AddAccountResponse, ...
packages/contracts/src/dto/tasks.ts       — ListTasksResponse, AddTaskRequest, AddTaskResponse, UpdateRuntimeRequest, ...
packages/contracts/src/dto/projects.ts    — ListProjectsResponse, AddProjectRequest, ...
packages/contracts/src/dto/system.ts      — CheckIntegrityResponse, ExportBackupResponse, CheckUpdateResponse, ...
packages/contracts/src/dto/logs.ts        — ListLogsResponse, AppendLogRequest, ...
```

### 2.5 公开 Agent API Schema（未来）

ROADMAP 2.3 定义的公共协议对象，当前尚不存在。迁移后应在 `packages/contracts/src/api/` 中预留：

- `CapabilityManifest`
- `CreateTaskRequest`
- `TaskSnapshot`
- `TaskEvent`
- `ArtifactDescriptor`
- `ApiError`

这些 DTO **不能**直接复用内部 `Account.partition`、`Task.runtime.conversationUrl`、绝对文件路径和 Cookie 等内部状态。

### 2.6 UI 展示常量（渲染进程独占）

`VIDEO_MODEL_LABELS`、`GENERATION_MODE_CONFIG`、`TASK_STATUS_CONFIG` 等常量含 UI 标签、颜色和图标，依赖 DOM 上下文，**不迁移**到 shared 层，保留在 `src/types/index.ts` 或拆分到 `src/constants/`。

## 3. 目录与构建方案比较

### 方案 A：顶层 `shared/` 目录 + 独立 tsconfig

```
doubao-studio-main/
├── shared/
│   ├── tsconfig.json          # module: ESNext, declaration: true, emit d.ts only
│   ├── enums.ts               # GenerationMode, TaskStatus, TaskErrorCode, ...
│   ├── domain.ts              # Account, Task, Project, ...
│   ├── dto.ts                 # IPC 请求/响应 DTO
│   └── api.ts                 # 未来 Agent API Schema
├── main/
│   └── tsconfig.main.json     # rootDir: ".", include: ["main/**/*", "shared/**/*"]
├── src/
│   └── tsconfig.renderer.json # rootDir: ".", include: ["src/**/*", "shared/**/*"]
```

**模块格式**：
- shared 编译为 ESM（`.js` + `.d.ts`）
- 主进程（Node16/CJS）通过 `esModuleInterop` 消费 ESM 类型声明
- 渲染进程通过 Vite bundler 消费

**优点**：
- 清晰的物理边界，shared 层一目了然
- 可以独立编译和类型检查
- 未来可发布为 npm workspace package

**缺点**：
- `rootDir` 从 `main`/`src` 变为 `.`，输出路径从 `dist/main/main.js` 变为 `dist/main/main/main.js`，需要调整 `package.json` 的 `main` 入口
- 两个 tsconfig 都要 `include` shared 目录，增加配置复杂度
- 运行时常量（如 `DEFAULT_VIDEO_CONFIG`）从 shared 导入时，主进程 CJS 需要处理 ESM 互操作

**`package.json` main 入口影响**：
- 当前：`"main": "dist/main/main.js"`
- 变更后：`"main": "dist/main/main/main.js"`（如果 rootDir 改为 `.`）
- `rootDirs` 只影响模块解析，不会改变 emit 路径，不能用来保持 `dist/main/main.js`

### 方案 B：`src/types/` 作为 shared 层 + 主进程路径别名

```
doubao-studio-main/
├── src/
│   └── types/
│       ├── shared.ts          # 从 index.ts 拆出的跨进程共享类型
│       ├── index.ts           # 渲染进程独占类型 + re-export shared
│       └── electron.d.ts      # ElectronAPI（从 shared 导入类型）
├── main/
│   └── tsconfig.main.json     # rootDir: ".", paths: { "@shared/*": ["src/types/shared/*"] }
```

**模块格式**：
- 主进程直接编译 `src/types/shared.ts`（CJS 输出）
- 渲染进程通过 Vite 消费

**优点**：
- 不新增顶层目录
- 渲染进程无配置变更
- shared 类型仍在 `src/types/` 下，减少移动

**缺点**：
- `rootDir` 从 `main` 改为 `.`，输出路径变化
- 主进程导入 `src/` 下文件在概念上不清晰——主进程不应依赖渲染进程目录
- `src/types/` 混合了 shared 和 renderer-only 类型，边界模糊
- 未来拆分为 workspace package 时仍需移动

### 方案 C：顶层 `shared/` + 项目引用（Project References）

```
doubao-studio-main/
├── shared/
│   ├── tsconfig.json          # composite: true, declaration: true
│   └── *.ts
├── tsconfig.main.json         # references: [{ path: "./shared" }]
├── tsconfig.renderer.json     # references: [{ path: "./shared" }]
```

**模块格式**：
- shared 作为独立项目编译到 `dist/shared/`
- 主进程和渲染进程通过 `tsc --build` 引用

**优点**：
- TypeScript 原生支持，增量编译
- 物理隔离最强

**缺点**：
- 构建流程从 `tsc -p` 变为 `tsc --build`，CI 和 dev 脚本都需要调整
- `electron-builder` 的 `files` 配置需增加 `dist/shared/**/*`
- 对当前简单构建流程改动最大

### 方案 D：私有 workspace contracts 包

```
doubao-studio-main/
├── packages/contracts/
│   ├── package.json           # @doubao-studio/contracts，private
│   ├── tsconfig.json          # emitDeclarationOnly
│   └── src/                   # enums/domain/dto/index
├── main/                      # rootDir 继续保持 main
└── src/                       # rootDir 继续保持 src
```

**优点**：
- contracts 独立编译，主进程和渲染进程的 `rootDir` 与输出路径完全不变
- 通过 pnpm workspace 名称解析，不依赖 TypeScript `paths` 运行时重写
- 首阶段只允许 `import type`，编译后不产生 `require('@doubao-studio/contracts')`
- 可被未来 CLI、MCP Server 和 SDK 复用

**缺点**：
- 类型检查前必须先构建 contracts 声明
- 需要增加一个私有 workspace package 和构建顺序
- 如未来加入运行时校验器，需要另行设计双格式导出，不能默认把 ESM 当作 CJS 使用

## 4. 推荐方案

**推荐方案 D：私有 workspace contracts 包**

理由：
1. 物理边界最清晰，shared 层不依赖 Electron/React/Zustand/DOM/Node fs
2. 不修改主进程与渲染进程的 `rootDir`，Electron 入口继续是 `dist/main/main.js`
3. 使用现有 pnpm workspace 解析，而不是不会重写运行时 import 的 `paths`
4. preload 和 renderer 的 `ElectronAPI` 类型可以从 shared DTO 消费同一来源

### 4.1 shared 层纯洁性约束

`packages/contracts/src/` 下的文件**禁止**导入：
- `electron` — Electron 主进程 API
- `react` / `react-dom` — 渲染进程 UI 框架
- `zustand` — 状态管理
- `fs` / `path` / `os` — Node 文件系统
- 浏览器 DOM 类型（`document`、`window`、`HTMLElement` 等）

允许导入：
- TypeScript 内置类型
- 同目录下其他 shared 文件
- 纯类型工具库（如 `uuid` 的类型声明，但不含运行时值）

### 4.2 构建配置变更

- 新建 `packages/contracts/package.json`，名称为 `@doubao-studio/contracts`，设置 `private: true`、`sideEffects: false`，仅导出 `dist/index.d.ts` 类型声明。
- 新建 `packages/contracts/tsconfig.json`，启用 `composite`、`declaration`、`emitDeclarationOnly`，输出到包内 `dist/`。
- 根应用以 `workspace:*` devDependency 引用 contracts；所有消费点首阶段必须使用 `import type`。
- `build`、`ts-check` 和测试类型检查在消费方之前构建 contracts。
- `tsconfig.main.json` 的 `rootDir: "main"`、`outDir: "dist/main"` 保持不变。
- `tsconfig.renderer.json` 的 `rootDir: "src"` 保持不变；Vite 不需要为纯类型 import 添加 alias。
- `package.json.main` 保持 `dist/main/main.js`；`electron-builder.files` 不需要打包纯声明包。
- 禁止使用 `paths` 假装提供运行时模块解析；`paths` 不会改写生成的 `require()`。

### 4.3 CommonJS 与 ESM 互操作

- contracts 首阶段是纯类型包，消费方只使用 `import type`，因此没有 CJS/ESM 运行时互操作。
- UI 标签、默认配置和其他运行时常量继续留在渲染进程，不进入 contracts。
- Agent JSON Schema 或运行时校验器应作为后续独立协议包设计，并提供明确的 CJS/ESM exports；`esModuleInterop` 不能解决 Node `require()` ESM 的问题。

## 5. 版本化与兼容策略

### 5.1 Schema 版本

- 当前以现有 `schema.json` 作为整个用户数据目录的版本来源，不向数组中的每条实体重复写版本
- Repository 读取时先读取文件级版本，再执行校验与渐进迁移
- 备份文件继续使用已有的 `format: 'doubao-studio-backup'` + `version`；备份版本与数据目录 schema 版本职责分离
- 只有在需要让单个文件独立演进时，才通过一次显式迁移改为 `{ schemaVersion, records }` envelope

### 5.2 可选字段策略

- 滚动兼容期间新增字段先设为可选（`field?: Type`），由 Repository 归一化默认值
- 完成磁盘迁移且所有调用点切换后，可在领域模型中收紧为必填，不能永久用可选字段掩盖不完整状态
- 示例：新增 `Task.priority` 时旧记录允许缺失，但进入领域层前应被归一化为明确默认值

### 5.3 枚举扩展策略

- 枚举只能新增成员，不能删除或重命名已有成员
- 新增成员时，消费方必须处理未知值（`default` 分支）
- 示例：`TaskStatus` 未来可能增加 `'skipped'`，调度器和 UI 都需要默认处理

### 5.4 旧 JSON 数据迁移

```typescript
// main/core/persistence/migrations/accounts.ts（未来）
export function migrateAccount(record: unknown): Account {
  // v1: 当前格式
  // v2: 未来可能拆分 scheduling 为独立文件
  return record as Account;
}
```

- 迁移属于主进程持久化层，不进入纯类型 contracts 包
- Repository 按“读取主文件 → 解析/校验/迁移 → 任一步失败则读取并验证 `.bak`”的顺序执行
- 当前通用 `readJSON<T>()` 不能自动覆盖“JSON 合法但 schema/迁移失败”的回退；实施时需增加 migration-aware Repository
- 迁移成功后先原子写入，再更新文件级 schema 版本；失败时保留主文件和 `.bak`

## 6. 迁移批次

每批必须能独立编译、独立提交、可回滚。

### 批次 1：创建 contracts 包 + 枚举类型

| 项目 | 内容 |
|------|------|
| **新建文件** | `packages/contracts/package.json`、`packages/contracts/tsconfig.json`、`packages/contracts/src/enums.ts`、`packages/contracts/src/index.ts` |
| **修改文件** | 根 workspace 配置与构建顺序；应用的 `rootDir`、Vite alias 和 Electron 入口均不改变 |
| **修改文件** | `main/ipc/tasks.ts`、`main/ipc/accounts.ts`、`main/utils/csv.ts` 使用 `import type` 从 `@doubao-studio/contracts` 导入 |
| **修改文件** | `src/types/index.ts` 使用 `export type` 兼容现有渲染进程导入路径 |
| **约束** | contracts 仅生成 `.d.ts`；禁止普通 import、运行时常量与 TS `paths` 运行时假象 |
| **回滚点** | `git revert` 单次提交；应用构建入口和输出路径始终不变 |

### 批次 2：领域模型接口迁移

| 项目 | 内容 |
|------|------|
| **新建文件** | `packages/contracts/src/domain.ts`（`Account`、`AccountHealth`、`SeedanceQuota`、`AccountScheduling`、`Task`、`TaskRunSnapshot`、`TaskRunRecord`、`TaskLock`、`TaskArtifact`、`DownloadJob`、`Project`、`LogEntry`） |
| **修改文件** | `main/ipc/tasks.ts`、`main/ipc/accounts.ts`、`main/ipc/projects.ts`、`main/ipc/system.ts` 从 `@doubao-studio/contracts` 进行 type-only 导入 |
| **修改文件** | `src/types/index.ts` 删除重复接口并进行 type-only re-export |
| **兼容桥** | `src/types/index.ts` re-export 保持现有导入路径不变 |
| **行为变化** | 主进程 `TaskErrorInfo.code` 从 `string` 收紧为 `TaskErrorCode`；`AccountHealth.lastErrorCode` 同理 |
| **回滚点** | `git revert`；如主进程有使用 `string` 而非 `TaskErrorCode` 的错误码，需补充 `'unknown'` |

### 批次 3：IPC DTO 提取

| 项目 | 内容 |
|------|------|
| **新建文件** | `packages/contracts/src/dto/accounts.ts`、`tasks.ts`、`projects.ts`、`system.ts`、`logs.ts`、`electron-api.ts` |
| **修改文件** | `main/preload.ts` 从 `@doubao-studio/contracts` 导入 `ElectronAPI` 类型，替换内联 `any` 签名 |
| **修改文件** | `src/types/electron.d.ts` 只负责用同一个 `ElectronAPI` 增补 `Window` |
| **修改文件** | `main/ipc/*.ts`（handler 参数/返回值使用 DTO 类型） |
| **兼容桥** | `ElectronAPI` 结构不变，仅类型来源变更 |
| **回滚点** | `git revert`；DTO 是类型层变更，无运行时影响 |

### 批次 4：preload 类型对齐

| 项目 | 内容 |
|------|------|
| **修改文件** | `main/preload.ts` 删除本地领域类型，使用 `import type { ElectronAPI } from '@doubao-studio/contracts'` |
| **修改文件** | `main/preload.ts` 中导出的对象使用 `satisfies ElectronAPI`，再交给 `contextBridge.exposeInMainWorld` |
| **兼容桥** | 无——此批次消除 preload 与 electron.d.ts 的类型分叉 |
| **回滚点** | `git revert` |

### 批次 5：持久化 Repository 边界

| 项目 | 内容 |
|------|------|
| **新建文件** | `main/core/persistence/` 下的 Repository、记录类型、校验和迁移模块；不放入 contracts |
| **修改文件** | Repository 封装主文件与 `.bak` 的读取、校验、迁移和原子写入语义 |
| **修改文件** | `main/ipc/*.ts` 仅通过 Repository 读写，不直接依赖磁盘记录 |
| **兼容桥** | 首批 `*Record = *Model` 且沿用现有 `schema.json`，磁盘格式不变 |
| **回滚点** | `git revert`；无磁盘格式变更 |

### 批次 6：csv.ts 临时类型归一

| 项目 | 内容 |
|------|------|
| **修改文件** | `main/utils/csv.ts`（删除 `CsvGenerationMode`，从 `@doubao-studio/contracts` type-only 导入 `GenerationMode`） |
| **修改文件** | `tests/unit/csv.test.ts`（更新类型引用） |
| **依赖** | 批次 1 完成 |
| **回滚点** | `git revert` |

## 7. preload 与 renderer ElectronAPI 统一

### 当前问题

```
main/preload.ts                          src/types/electron.d.ts
┌─────────────────────┐                  ┌──────────────────────┐
│ contextBridge       │                  │ export interface     │
│ .exposeInMainWorld( │                  │   ElectronAPI {      │
│   'electronAPI',    │  ── 无类型关联 ── │   projects: {...}    │
│   { ... }           │                  │   accounts: {...}    │
│ )                   │                  │   tasks: {...}       │
│                     │                  │   ...                │
│ // 内联 Account,    │                  │ // 从 ./index 导入    │
│ // Task, GenMode    │                  │ // Account, Task...  │
└─────────────────────┘                  └──────────────────────┘
```

### 迁移后

```
@doubao-studio/contracts
┌─────────────────────────┐
│ export interface        │
│   AccountsDto { ... }   │
│ export interface        │
│   TasksDto { ... }      │
│ ...                     │
└───────────┬─────────────┘
            │
    ┌───────┴───────┐
    │               │
    ▼               ▼
main/preload.ts    src/types/electron.d.ts
┌──────────────┐   ┌──────────────────────┐
│ import type  │   │ import type          │
│ { ElectronAPI│   │ { AccountsDto, ... } │
│ } from       │   │ from contracts       │
│ contracts    │   │                      │
│              │   │ export type          │
│ const api:   │   │   ElectronAPI =      │
│ ElectronAPI  │   │   AccountsDto &      │
│ = { ... };   │   │   TasksDto & ...     │
│ expose(      │   │                      │
│   'electronAPI',│  │ Window.electronAPI: │
│   api)       │   │   ElectronAPI        │
└──────────────┘   └──────────────────────┘
```

**实现步骤**：
1. 在 contracts 中按命名空间定义 API（如 `accounts`、`tasks`），并只导出一个嵌套结构的 `ElectronAPI`
2. `src/types/electron.d.ts` 只导入 `ElectronAPI` 并声明 `Window.electronAPI: ElectronAPI`，不再重新拼装交叉类型
3. preload 对象使用 `satisfies ElectronAPI`；任何缺失方法、参数或返回值漂移都会在编译期失败
4. `contextBridge.exposeInMainWorld('electronAPI', api)` 的运行时对象和 channel 名称保持不变

**安全约束**：
- preload 的运行时行为不变（仍是 `ipcRenderer.invoke` 调用）
- 仅类型层变更，无运行时代码生成
- `contextBridge` 的 contextIsolation 安全模型不受影响

## 8. CLI/MCP DTO 复用边界

### 可复用

| shared 类型 | CLI/MCP 用途 |
|-------------|-------------|
| `GenerationMode`、`VideoModel`、`VideoAspectRatio` | 命令参数验证 |
| `TaskStatus`、`TaskStage` | 状态展示和过滤 |
| `TaskErrorCode` | 错误分类和重试决策 |
| `CreateTaskRequest`（未来 DTO） | CLI `tasks create` 命令参数 |
| `TaskSnapshot`（未来 DTO） | CLI `tasks get` 响应 |
| `ArtifactDescriptor`（未来 DTO） | CLI `artifacts list` 响应 |
| `ApiError`（未来 DTO） | 统一错误响应 |

### 禁止复用

| 内部类型/字段 | 原因 |
|---------------|------|
| `Account.partition` | 暴露内部 Session 隔离实现 |
| `Account.health.cooldownUntil` | 内部调度细节，Agent 不应直接操作 |
| `Task.runtime.conversationUrl` | 暴露豆包内部页面 URL |
| `Task.lock` | 内部租约实现，Agent 通过 API 幂等键管理并发 |
| `DownloadJob.saveDir` / `filePath` | 本地绝对路径，安全风险 |
| `TaskArtifact.url`（原始） | 远程地址可能含认证信息，应通过 `ArtifactDescriptor` 暴露安全代理 |
| `LogEntry` 完整结构 | 内部诊断日志，Agent 仅通过 `TaskEvent` 订阅 |
| Cookie、Session 数据 | 永不暴露 |

### 映射规则

```
内部 Account         →  公开 AccountSummary（id, name, status, health 简要）
内部 Task            →  公开 TaskSnapshot（id, status, stage, progress, errorInfo）
内部 TaskArtifact    →  公开 ArtifactDescriptor（id, kind, validationState, downloadUrl?）
内部 DownloadJob     →  公开 DownloadStatus（id, taskId, status, bytes?）
```

## 9. csv.ts 临时模式类型归一

### 当前状态

`main/utils/csv.ts` 在 G-204 抽取时定义了 `CsvGenerationMode`：

```typescript
export type CsvGenerationMode = 'chat' | 'image' | 'video' | 'music';
```

这是为了消除 `csv.ts` 对 `main/ipc/tasks.ts` 的依赖（`tasks.ts` 导入 `electron`，`csv.ts` 作为纯函数不应传递依赖 Electron）。审查中此改动被保留。

### 迁移后

批次 1 完成后，contracts 导出 `GenerationMode`，`csv.ts` 以 type-only 方式导入：

```typescript
// 迁移后
import type { GenerationMode } from '@doubao-studio/contracts';

export function normalizeCsvMode(value: string): GenerationMode {
  // ...
}
```

`CsvGenerationMode` 类型别名删除，所有引用（包括 `tests/unit/csv.test.ts`）改为 `GenerationMode`。

### 兼容性

- `CsvGenerationMode` 和 `GenerationMode` 值完全一致，纯类型变更
- 运行时行为不变
- 测试中如有 `CsvGenerationMode` 引用需批量替换

## 10. 未决风险

1. **contracts 构建顺序**：消费方类型检查前必须先生成 contracts 声明。根脚本和 CI 应固定该顺序，并验证全新 clone 后可直接执行 `pnpm run validate`。

2. **主进程 `TaskErrorInfo.code` 类型收紧**：从 `string` 改为 `TaskErrorCode` 可能导致主进程代码编译失败——如果存在动态构造错误码的路径。需要在批次 2 前全局搜索 `code:` 赋值点。

3. **preload 运行时与类型对齐**：preload 当前使用大量 `any` 和内联类型。对齐为 `ElectronAPI` 后，可能暴露类型不匹配（如 `Promise<any>` vs `Promise<Task[]>`）。需要逐一修正。

4. **类型边界被运行时 import 污染**：首阶段必须通过 ESLint 或工程检查禁止从 contracts 发出普通 import；否则 Electron 主进程可能生成无法解析的 `require('@doubao-studio/contracts')`。

5. **测试覆盖**：类型迁移本身不改变运行时行为，但需要确保 `pnpm run validate`（含 ts-check）在每个批次后通过。建议每个批次都在 CI 上验证。

6. **运行时 Schema 的模块格式**：G-302 的 JSON Schema/校验器若需要由主进程和 Agent 服务共同执行，应作为明确支持 CJS/ESM 双入口的后续包，不能混入当前纯声明包。

7. **持久化回退完整性**：Repository 必须覆盖 JSON 解析、schema 校验和迁移三个失败阶段的 `.bak` 回退，并测试写入失败时主文件与备份均可恢复。

## 11. 总结

| 项目 | 值 |
|------|-----|
| 推荐方案 | 方案 D：私有、纯类型 workspace contracts 包 |
| contracts 模块格式 | 仅 `.d.ts`，消费方全部使用 `import type` |
| 迁移批次数 | 6 批 |
| 首批可独立编译 | 批次 1（contracts 脚手架 + 枚举类型） |
| 预计影响文件 | ~20 个（含新增） |
| 运行时行为变更 | 无（纯类型层迁移） |
| 最大风险 | contracts 构建顺序与 type-only 边界失守 |
