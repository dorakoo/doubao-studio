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
| `accounts.json` | `Account[]` | `AccountRecord[]`（= `Account` + `schemaVersion: number`） |
| `tasks.json` | `Task[]` | `TaskRecord[]`（= `Task` + `schemaVersion: number`） |
| `projects.json` | `Project[]` | `ProjectRecord[]`（= `Project` + `schemaVersion: number`） |
| `downloads.json` | `DownloadJob[]` | `DownloadJobRecord[]` |
| `logs.json` | `LogEntry[]` | `LogEntryRecord[]` |

**策略**：首批迁移保持 `Record = Model`（类型别名），仅引入 `schemaVersion` 字段供未来迁移使用。不立即改变磁盘格式。

### 2.4 IPC 命令/响应 DTO

当前 IPC handler 的参数和返回值类型内联在 `ipcMain.handle` 调用中，无独立类型定义。`ElectronAPI` 在渲染进程中描述了这些 DTO 但主进程未消费。

迁移后应为每个 IPC channel 定义命名 DTO：

```
shared/dto/accounts.ts    — ListAccountsResponse, AddAccountRequest, AddAccountResponse, ...
shared/dto/tasks.ts       — ListTasksResponse, AddTaskRequest, AddTaskResponse, UpdateRuntimeRequest, ...
shared/dto/projects.ts    — ListProjectsResponse, AddProjectRequest, ...
shared/dto/system.ts      — CheckIntegrityResponse, ExportBackupResponse, CheckUpdateResponse, ...
shared/dto/logs.ts        — ListLogsResponse, AppendLogRequest, ...
```

### 2.5 公开 Agent API Schema（未来）

ROADMAP 2.3 定义的公共协议对象，当前尚不存在。迁移后应在 `shared/api/` 中预留：

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
- 或保持不变但需要在 tsconfig.main.json 中配置 `rootDir: "."` + `rootDirs: ["main", "shared"]`

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

## 4. 推荐方案

**推荐方案 A：顶层 `shared/` 目录 + 独立 tsconfig**

理由：
1. 物理边界最清晰，shared 层不依赖 Electron/React/Zustand/DOM/Node fs
2. 对现有构建流程改动可控——仅调整 `rootDir` 和 `include`
3. 未来可平滑过渡到 workspace package 或独立 npm 包
4. preload 和 renderer 的 `ElectronAPI` 类型可以从 shared DTO 消费同一来源

### 4.1 shared 层纯洁性约束

`shared/` 下的文件**禁止**导入：
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

**`shared/tsconfig.json`（新建）**：
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "isolatedModules": true,
    "noEmit": false,
    "outDir": "../dist/shared"
  },
  "include": ["**/*.ts"]
}
```

**`tsconfig.main.json`（修改）**：
```json
{
  "compilerOptions": {
    "rootDir": ".",               // 从 "main" 改为 "."
    "outDir": "dist/main",
    // ... 其余不变
    "paths": {
      "@shared/*": ["shared/*"]
    }
  },
  "include": ["main/**/*.ts", "shared/**/*.ts"]
}
```

**`tsconfig.renderer.json`（修改）**：
```json
{
  "compilerOptions": {
    "rootDir": ".",               // 从 "src" 改为 "."
    "outDir": "dist/renderer",
    // ... 其余不变
    "paths": {
      "@shared/*": ["shared/*"]
    }
  },
  "include": ["src/**/*.ts", "src/**/*.tsx", "shared/**/*.ts"]
}
```

**`package.json`**：
- `"main"` 保持 `"dist/main/main.js"`（rootDir 改为 `.` 后，`main/main.ts` 编译输出仍为 `dist/main/main/main.js`，需要调整）

> **注意**：`rootDir` 从 `main` 改为 `.` 后，`tsc` 会保留输入目录结构。`main/main.ts` → `dist/main/main/main.js`。需要将 `package.json` 的 `"main"` 改为 `"dist/main/main/main.js"`，或将 `rootDir` 设为 `"."` 配合 `rootDirs: ["main", "shared"]` 使输出扁平化。推荐使用 `rootDirs` 方案，输出仍为 `dist/main/main.js`。

**`vite.config.ts`**：
- 添加 `resolve.alias`：`'@shared': path.resolve(__dirname, 'shared')`

### 4.3 CommonJS 与 ESM 互操作

- 主进程 `tsconfig.main.json` 使用 `module: Node16`（CJS）
- shared 使用 `module: ESNext`
- **类型导入**（`import type`）：编译时擦除，无运行时影响，安全跨格式使用
- **运行时常量**（如 `DEFAULT_VIDEO_CONFIG`）：主进程 CJS 需要 `esModuleInterop: true`（已有），`require()` ESM 输出时 Node 16 可能报错
- **解决方案**：shared 中的运行时值仅使用 `export const`，主进程通过 `tsconfig` 的 `module: Node16` + `esModuleInterop` 正确处理。或 shared 也编译为 CJS（`module: CommonJS`），但这与渲染进程的 ESM 不冲突——Vite bundler 可以消费 CJS。

**最终建议**：shared 编译为 **CJS**（`module: CommonJS`），因为：
1. 主进程是 CJS，无需互操作
2. Vite/Rollup 天然支持 CJS 导入
3. 类型声明文件（`.d.ts`）不受模块格式影响

## 5. 版本化与兼容策略

### 5.1 Schema 版本

- 每个持久化 JSON 文件增加 `schemaVersion: number` 字段（可选，默认 1）
- 读取时检查版本，执行渐进迁移
- 备份文件 `format: 'doubao-studio-backup'` + `version: 2` 已有此模式，扩展到实体级别

### 5.2 可选字段策略

- 新增字段必须标记为可选（`field?: Type`）
- 读取时使用 `??` 或 `||` 提供默认值
- 示例：`Task.artifacts` 已是可选字段；未来新增 `Task.priority` 也应为可选

### 5.3 枚举扩展策略

- 枚举只能新增成员，不能删除或重命名已有成员
- 新增成员时，消费方必须处理未知值（`default` 分支）
- 示例：`TaskStatus` 未来可能增加 `'skipped'`，调度器和 UI 都需要默认处理

### 5.4 旧 JSON 数据迁移

```typescript
// shared/migrations.ts（未来）
export function migrateAccount(record: unknown): Account {
  // v1: 当前格式
  // v2: 未来可能拆分 scheduling 为独立文件
  return record as Account;
}
```

- 迁移函数在 `readJSON<T>()` 之后调用
- 迁移失败时回退到 `.bak` 文件（现有机制）
- 迁移成功后以新版本写盘

## 6. 迁移批次

每批必须能独立编译、独立提交、可回滚。

### 批次 1：创建 shared 层 + 枚举类型

| 项目 | 内容 |
|------|------|
| **新建文件** | `shared/enums.ts`（`GenerationMode`、`AccountStatus`、`TaskStatus`、`TaskStage`、`VideoModel`、`VideoDuration`、`VideoAspectRatio`、`TaskErrorCode`、`DependencyPolicy`） |
| **新建文件** | `shared/tsconfig.json` |
| **修改文件** | `tsconfig.main.json`（rootDir/rootDirs + include shared）、`tsconfig.renderer.json`（同）、`tsconfig.test.json`（同）、`vite.config.ts`（alias） |
| **修改文件** | `main/ipc/tasks.ts`（删除本地枚举，从 `@shared/enums` 导入） |
| **修改文件** | `main/ipc/accounts.ts`（删除本地枚举，从 `@shared/enums` 导入） |
| **修改文件** | `main/utils/csv.ts`（`CsvGenerationMode` → 从 `@shared/enums` 导入 `GenerationMode`） |
| **修改文件** | `src/types/index.ts`（删除枚举，从 `@shared/enums` re-export） |
| **兼容桥** | `src/types/index.ts` re-export 所有 shared 枚举，现有渲染进程导入路径不变 |
| **回滚点** | `git revert` 单次提交；tsconfig 和 alias 恢复后不影响业务行为 |

### 批次 2：领域模型接口迁移

| 项目 | 内容 |
|------|------|
| **新建文件** | `shared/domain.ts`（`Account`、`AccountHealth`、`SeedanceQuota`、`AccountScheduling`、`Task`、`TaskRunSnapshot`、`TaskRunRecord`、`TaskLock`、`TaskArtifact`、`DownloadJob`、`Project`、`LogEntry`） |
| **修改文件** | `main/ipc/tasks.ts`（删除本地接口，从 `@shared/domain` 导入） |
| **修改文件** | `main/ipc/accounts.ts`（删除本地接口，从 `@shared/domain` 导入） |
| **修改文件** | `main/ipc/projects.ts`（从 `@shared/domain` 导入 `Project`） |
| **修改文件** | `main/ipc/system.ts`（`LogEntry` 从 `@shared/domain` 导入） |
| **修改文件** | `src/types/index.ts`（删除接口定义，从 `@shared/domain` re-export） |
| **兼容桥** | `src/types/index.ts` re-export 保持现有导入路径不变 |
| **行为变化** | 主进程 `TaskErrorInfo.code` 从 `string` 收紧为 `TaskErrorCode`；`AccountHealth.lastErrorCode` 同理 |
| **回滚点** | `git revert`；如主进程有使用 `string` 而非 `TaskErrorCode` 的错误码，需补充 `'unknown'` |

### 批次 3：IPC DTO 提取

| 项目 | 内容 |
|------|------|
| **新建文件** | `shared/dto/accounts.ts`、`shared/dto/tasks.ts`、`shared/dto/projects.ts`、`shared/dto/system.ts`、`shared/dto/logs.ts` |
| **修改文件** | `main/preload.ts`（从 `@shared/dto/*` 导入类型，替换内联 `any` 签名） |
| **修改文件** | `src/types/electron.d.ts`（`ElectronAPI` 接口从 `@shared/dto/*` 导入，与 preload 使用同一来源） |
| **修改文件** | `main/ipc/*.ts`（handler 参数/返回值使用 DTO 类型） |
| **兼容桥** | `ElectronAPI` 结构不变，仅类型来源变更 |
| **回滚点** | `git revert`；DTO 是类型层变更，无运行时影响 |

### 批次 4：preload 类型对齐

| 项目 | 内容 |
|------|------|
| **修改文件** | `main/preload.ts`（删除本地 `Account`、`Task`、`GenerationMode` 定义，从 `@shared/*` 导入） |
| **修改文件** | `main/preload.ts`（`contextBridge.exposeInMainWorld` 的回调签名使用 `ElectronAPI` 类型） |
| **兼容桥** | 无——此批次消除 preload 与 electron.d.ts 的类型分叉 |
| **回滚点** | `git revert` |

### 批次 5：持久化记录与 Schema 版本

| 项目 | 内容 |
|------|------|
| **新建文件** | `shared/persistence.ts`（`AccountRecord`、`TaskRecord`、`ProjectRecord`、`DownloadJobRecord`、`LogEntryRecord`，当前为类型别名） |
| **新建文件** | `shared/migrations.ts`（迁移函数占位） |
| **修改文件** | `main/utils/store.ts`（`readJSON<T>` 后调用迁移函数） |
| **修改文件** | `main/ipc/*.ts`（持久化读写使用 `*Record` 类型） |
| **兼容桥** | `*Record = *Model` 类型别名，磁盘格式不变 |
| **回滚点** | `git revert`；无磁盘格式变更 |

### 批次 6：csv.ts 临时类型归一

| 项目 | 内容 |
|------|------|
| **修改文件** | `main/utils/csv.ts`（删除 `CsvGenerationMode`，直接从 `@shared/enums` 导入 `GenerationMode`） |
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
shared/dto/*.ts
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
│ } from       │   │ from '@shared/dto'   │
│ '@shared/dto'│   │                      │
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
1. 在 `shared/dto/` 中定义每个命名空间的 DTO 接口（如 `AccountsDto`、`TasksDto`）
2. `ElectronAPI = AccountsDto & TasksDto & ProjectsDto & SettingsDto & LogsDto & SystemDto`
3. preload 的 `contextBridge.exposeInMainWorld` 调用对象标注为 `ElectronAPI` 类型
4. TypeScript 编译时验证两边签名一致——如果不一致，编译失败

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

批次 1 完成后，`shared/enums.ts` 导出 `GenerationMode`，`csv.ts` 直接导入：

```typescript
// 迁移后
import type { GenerationMode } from '@shared/enums';

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

1. **rootDir 变更影响输出路径**：`tsconfig.main.json` 的 `rootDir` 从 `"main"` 改为 `"."` 会导致输出路径变化。需要使用 `rootDirs` 或调整 `package.json` 的 `main` 入口。必须在实施前验证 `electron .` 能正确定位入口文件。

2. **主进程 `TaskErrorInfo.code` 类型收紧**：从 `string` 改为 `TaskErrorCode` 可能导致主进程代码编译失败——如果存在动态构造错误码的路径。需要在批次 2 前全局搜索 `code:` 赋值点。

3. **preload 运行时与类型对齐**：preload 当前使用大量 `any` 和内联类型。对齐为 `ElectronAPI` 后，可能暴露类型不匹配（如 `Promise<any>` vs `Promise<Task[]>`）。需要逐一修正。

4. **ESLint warning 基线**：类型迁移可能新增或消除 warning。需要与 `--max-warnings 149` 基线协调。如果 warning 减少，应下调基线而非维持。

5. **测试覆盖**：类型迁移本身不改变运行时行为，但需要确保 `pnpm run validate`（含 ts-check）在每个批次后通过。建议每个批次都在 CI 上验证。

6. **Vite 对 shared/ 的解析**：Vite 的 `resolve.alias` 配置需要同时处理开发模式和构建模式。需要验证 `vite build` 能正确打包 shared 类型。

7. **electron-builder files 配置**：如果 shared 编译输出到 `dist/shared/`，需要更新 `package.json` 的 `build.files` 包含 `dist/shared/**/*`。如果 shared 仅作为类型（`import type`），则不需要。需要区分 shared 中的类型定义和运行时常量。

## 11. 总结

| 项目 | 值 |
|------|-----|
| 推荐方案 | 方案 A：顶层 `shared/` 目录 |
| shared 模块格式 | CJS（与主进程一致，Vite 可消费） |
| 迁移批次数 | 6 批 |
| 首批可独立编译 | 批次 1（枚举类型 + 配置变更） |
| 预计影响文件 | ~20 个（含新增） |
| 运行时行为变更 | 无（纯类型层迁移） |
| 最大风险 | rootDir 变更影响构建输出路径 |
