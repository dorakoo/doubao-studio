# DOUBAO-238-FOUR-PACKAGE-INTEGRATION-01 集成交接单

- 日期：2026-09-12
- 状态：四包本地集成候选已提交；门禁通过；**未**推送、未建 PR、未合并、未改版本、未安装、未部署、未发布
- 锁定基线：`origin/main@f461a7fb9fcefcf35050de5a4459bd1b94f897b3`（Tag `v2.3.7`）
- 分支：`codex/doubao-238-four-package-integration-01`
- 工作目录：`D:\豆包工作室\doubao-238-four-package-integration-01`（独立 clone，非共享 worktree）
- 功能候选 HEAD（包 D）：`d9d8a75c8a508c0df59bf422fc82bbe97a771f60`；分支 tip 为本交接单 docs commit
- 工作区：clean（`git status --short` 为空）

## 治理声明

开工前已读取：

1. `D:\项目架构师\memory\INDEX.md`
2. `D:\项目架构师\DEVELOPMENT_EFFICIENCY_GOVERNANCE.md`
3. `D:\项目架构师\memory\CURRENT.md`
4. `D:\项目架构师\memory\DEPENDENCIES.md`
5. `D:\项目架构师\memory\QUEUE.md`
6. 豆包仓库 `AGENTS.md`（v2.3.7）
7. 四包 handoff（A/B/C/D）及实际 Git diff / 工作树状态

冻结核心目标：在干净分支中忠实整合 A/B/C/D，形成可供总架构师复验的 v2.3.8 本地功能候选。

**未授权且未执行**：推送、PR、合并 main、改版本号、创建 Tag/Release、安装、部署、启动正式工作室、真实平台操作。

## 开工锁定核对

| 项 | 期望 | 实测 |
| --- | --- | --- |
| `origin/main` | `f461a7f` | `f461a7fb9fcefcf35050de5a4459bd1b94f897b3` |
| A | `201b3048…` 已提交干净 | 一致 |
| B | `b4c2169f…` 已提交干净 | 一致 |
| C | HEAD `f461a7f`，8 tracked + 2 untracked | 一致；handoff SHA `D5FF03AB…C344` |
| D | HEAD `f461a7f`，R2 已复验；多文件未提交 | 一致；handoff SHA `3C703DCF…DD61` |
| 提示词 SHA-256 | `CB846201…DB99` | 一致 |

说明：首次 `git worktree add` 被隔离策略拦截后，改为从主仓独立 `git clone --no-hardlinks` 创建集成目录，origin 最终校正为 `https://github.com/dorakoo/doubao-studio.git`。未删除、未覆盖、未清理任何既有工作树或旧 stash。

## 四个独立候选提交

| 包 | 集成分支 commit | 说明 |
| --- | --- | --- |
| A | `07f631e0c7f689cc4414fc62b56945a055b88d96` | `feat(tasks): separate assignment from execution intent` |
| B | `d8c5dc894a9846e5bd71ba598d1eb41b9e6342d8` | `fix(automation): preserve task conversation location` + A 夹具对齐 B 会话同步 |
| C | `b71dd70f3f663fd05ebc64fa1c98efcc74321dfd` | `feat(local-control): add assign, account, artifact query and single download` |
| D | `d9d8a75c8a508c0df59bf422fc82bbe97a771f60` | `feat(status-download): …` R2 + A/B 集成语义合并与夹具对齐 |

## 实际冲突与保留语义

### A×B

- `src/components/BrowserPanel.tsx`、`TaskConsole.tsx`：自动合并成功。
- **语义冲突**：B 的 `hasPlatformAcceptance` 要求 `runtime.conversationUrl` 与 binding URL 同步；A 的 `observingTask` 夹具缺少 runtime URL，导致跨账号 `all_accepted` 放行测试失败。
- **处置**：补齐 A 夹具 `runtime.conversationUrl`（不放宽 B 安全检查）；并入 B 提交。

### A×D（真实 7 文件冲突，人工合并）

| 文件 | 保留双方语义 |
| --- | --- |
| `packages/contracts/src/enums.ts` | 保留 A 的 `TaskExecutionIntent` + D 的 `QualityVerdict*` |
| `packages/contracts/src/index.ts` | 同时导出双方类型 |
| `packages/contracts/src/dto/tasks.ts` | `TaskUpdateRuntimeParams` 同时含 `executionIntent` 与 `blockedByTaskIds` |
| `packages/contracts/src/dto/electron-api.ts` | `updateRuntime` patch 同时含双方字段 |
| `src/types/index.ts` | 双方 import/re-export 并存 |
| `main/core/TaskService.ts` `retry` | 先 D 的 `isDependencyBlockedTask` 拒绝，再 A 的 `resetTaskForQueue(..., 'armed')`，并清除 `blockedByTaskIds` |
| `src/store/useTaskStore.ts` `processQueue` | **A**：只扫描 `executionIntent === 'armed'`（历史缺失意图 fail-closed，不采用 D 的“未标记可执行”兼容）；**D**：ready/waiting/blocked 三分支，阻断保持 `queued` + `markDependencyBlock`，不写 `fail` |

### B×D

- `TaskConsole.tsx` 自动合并；`acceptedObservation.test.ts` / `dependencyEval.test.ts` 自动合并后按 B 语义补齐会话 URL。

### C×D

- `main/ipc/tasks.ts`、`main/preload.ts`、`README.md` 等自动合并成功；C 的 assign 永远 hold 与 D 的 setQualityVerdict / blockedByTaskIds 并存。

### 集成夹具对齐（D 提交内）

- D 的 `dependencyQueueBehavior` / `statusDownloadCloseoutR1/R2` 夹具默认 `executionIntent: 'armed'`（hold 仍显式 hold）。
- 观察前置夹具补齐 `runtime.conversationUrl`。
- A 测试 `processQueue` mock 改为 async，匹配 D 的 async processQueue。
- 移除 `TaskConsole` 未使用 `SegmentedProps`，ESLint warning 回到 149。

## 受保护现场

| 工作树 | 整合前 HEAD / 内容 | 整合后 |
| --- | --- | --- |
| C `doubao-local-control-artifact-01` | `f461a7f` + 8M/2U | HEAD/status/文件 SHA-256 **完全一致** |
| D `doubao-status-download-closeout-01` | `f461a7f` + 多文件未提交 | HEAD/status/文件 SHA-256 **完全一致** |

证据目录：`D:\豆包工作室\_evidence\238-pre\` 与 `238-post\`。

未读取或输出生产 `accounts.json` / `tasks.json` / `downloads.json`、Cookie、Token、Session、真实提示词、素材路径或视频文件。

## 门禁证据

| 命令 | exit | 结果 |
| --- | --- | --- |
| `pnpm run validate` | 0 | TypeScript PASS；ESLint **0 error / 149 warning**；工程/Contracts 边界 PASS；全量 **56 files / 1146 tests PASS / 0 fail**；Renderer/Main build PASS |
| `pnpm run pack` | 0 | `release\win-unpacked\豆包工作室.exe` 生成；签名跳过（既有技术债） |
| `git diff --check` | 0 | PASS |

无跳过、超时、强杀或 flaky 重跑记为 PASS。

## 状态严格分离

| 项目 | 状态 |
| --- | --- |
| 代码实现 | 已完成（四包语义整合） |
| 自动化测试 | 已执行并通过（1146/1146） |
| 人工验收 | **未执行** |
| 真实任务执行 | **未执行** |
| 提交 | 已完成（本地 4 个候选提交） |
| 推送 / PR / 合并 | **未执行** |
| 安装 / 部署 / 发布 | **未执行** |
| 版本号 / Tag | 保持 2.3.7 基线；未创建 v2.3.8 |

## 安全不变量核对（集成后）

- assign（UI 与本机 C 端点）只落 hold，不 arm、不调度。
- 仅显式启动 / 批量 arm / CSV 导入后执行 / 本机 start / retry 可 armed。
- `processQueue` 只处理 armed；依赖阻断保持 queued + 结构化原因。
- 跨账号 `all_accepted` 放行、同账号 observing 串行阻塞、waiting_generation_confirmation 有效绑定（含 B 的 URL 同步）不回退。
- 双击 / 核对平台结果定位原会话；Dola fail-closed。
- C 产物下载按稳定 artifact ID；D 批量下载单项目单批次非空产物 fail-closed。
- 依赖错误不计平台失败率/额度/健康冷却；非法质量标签整体拒绝；非法 `decidedAt` 丢弃。
- `submission_uncertain` / 防重复扣费语义未回退。
- Dola 仍为未完成真实端到端验收。

## 未处理事项（明确分流，不属本包）

1. 依赖复检退避/生命周期精细化。
2. 任务栏排队与阻断重复计数。
3. 等待态多一次安全拒绝。
4. 代码签名与自定义图标。
5. Dola 真实端到端验收。
6. ESLint 复杂度/any 既有技术债（warning 顶在 149）。

## 下一步建议（均需独立授权）

1. 总架构师复验本分支四个候选提交与本交接单。
2. 复验通过后另授权：推送、Draft PR、CI、合并、版本 2.3.8、安装与只读验收。
3. 禁止在本分支继续包装 D 的后续维护项为 R3。

## 停止声明

已完成本地集成候选，停在：

`codex/doubao-238-four-package-integration-01` 上的四个包提交 + 本交接单 docs commit；功能候选为包 D `d9d8a75c…`。

不 push、不建 PR、不合并、不改版本、不安装、不部署、不发布。
