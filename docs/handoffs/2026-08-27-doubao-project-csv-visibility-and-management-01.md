# DOUBAO-PROJECT-CSV-VISIBILITY-AND-MANAGEMENT-01 实施与验收报告

## 1. 治理规则与冻结验收包

已按顺序读取总架构师治理规则、仓库 `AGENTS.md`、问题报告、最新相关 handoff 与项目/任务/CLI/Contracts/Preload/Store 源码。仓库中不存在 `docs/memory/INDEX.md`、`CURRENT.md`、`DEPENDENCIES.md`、`QUEUE.md`，按实际缺失记录，未虚构读取。

本轮冻结验收包：

- P0-1：CLI 项目完整性、`PROJECT_NOT_FOUND` fail-closed、新 UUID 项目创建、脱敏输出。
- P0-2：冻结来源/目标/12 项 queued video 的默认 dry-run 受控迁移，原文漂移拒绝、原子替换与迁移后回读。
- P0-3：项目任务数、编辑、归档、安全删除和当前项目任务统计界面。

非目标保持不变：不提交平台任务、不上传素材、不消耗额度、不改 Cookie/Token/Session/视频产物，不重构视频生成、账号调度或音轨逻辑。

## 2. Git 基线与状态

- 工作树：`D:\豆包工作室\doubao-automation-closeout-01`
- 分支：`codex/doubao-project-csv-visibility-management-01`
- 基线/当前 HEAD：`1b04cbc36b5f973300ab4d6b86c731d4700485e6`
- `origin/main`（开工时）：`1b04cbc36b5f973300ab4d6b86c731d4700485e6`
- 开工状态：clean
- 收口状态：15 个候选文件，全部未暂存、未提交

## 3. 实现结果

### P0-1 CLI 项目完整性

- `import-csv` 在创建任务存储与读取/写入 `tasks.json` 前读取 `projects.json` 并校验真实项目 ID。
- 未知 ID 固定返回 `PROJECT_NOT_FOUND`，任务文件保持逐字节不变。
- `--project-id` 与 `--project-name` 互斥；`--project-name` 每次创建新的 UUID，同名项目不复用、不把名称当 ID。
- 项目文件以原文作为并发基线，使用同目录临时文件 + rename 原子替换；漂移返回 `PROJECTS_FILE_CHANGED`。
- 成功输出投影为 `imported/skipped/projectId/batchId/errors`，不返回 tasks、提示词或素材绝对路径。

### P0-2 一次性孤儿任务修复

- 新增 `migrate-project-tasks` / `pnpm run cli:migrate-project`。
- 范围硬冻结为：
  - 来源 `MY-CATSCRATCHER-VIDEO-20260824-01`
  - 目标 `30c20259-58bd-4f01-8a70-f6c8d0a0732d`
  - 恰好 12 项 `queued + video`
- 默认仅 dry-run；仅 `--confirm 12` 执行写入。
- 写入前校验目标项目存在、目标当前为空、默认项目恰好 4 项 done；任务原文发生漂移即 `TASKS_FILE_CHANGED`。
- 写入使用同目录临时文件原子替换；写入后重新读取并校验来源 0、目标 12 queued/video、默认项目 4 项 done 完整对象指纹不变。

### P0-3 项目管理界面

- 项目下拉旁增加“管理项目”入口。
- 管理界面显示完整项目 ID、总任务、排队、运行、完成数量；支持编辑名称/说明、归档/恢复和删除。
- 默认项目禁止归档和删除；含任务项目由后端返回真实 `taskCount` 并拒绝删除；空项目经 `Popconfirm` 二次确认后删除并切回默认项目。
- 项目 IPC 对 `writeJSON=false` 统一 fail-closed，不再返回虚假成功；更新只接受冻结字段，空名称拒绝。
- 任务调度标题显示当前项目名称/ID，排队、运行、完成统计即使为 0 也始终显示。

## 4. 实际候选文件

Tracked 修改（10）：

1. `AGENT_EXECUTION_PLAN.md`
2. `README.md`
3. `main/cli/doubaoCliEntry.ts`
4. `main/ipc/projects.ts`
5. `package.json`
6. `packages/contracts/src/dto/projects.ts`
7. `src/components/ProjectSwitcher.tsx`
8. `src/components/TaskConsole.tsx`
9. `src/store/useProjectStore.ts`
10. `tests/unit/csvProductionExperience.test.ts`

Untracked 新增（5）：

1. `main/cli/projectTaskMigration.ts`
2. `main/utils/projectManagement.ts`
3. `src/components/ProjectManagementModal.tsx`
4. `tests/unit/projectCsvVisibility.test.ts`
5. `docs/handoffs/2026-08-27-doubao-project-csv-visibility-and-management-01.md`

真正 tracked 删除：0。

## 5. 测试与门禁

- 专项：`tests/unit/projectCsvVisibility.test.ts` + `tests/unit/csvProductionExperience.test.ts`，2 files / 38 pass / 0 fail。
- 类型检查：contracts/main/renderer/tests 全部通过，0 error。
- ESLint：0 error / 142 warning，低于 149 上限；本轮新增文件无 lint error。
- 工程与 contracts 边界：全部通过。
- 全量 Vitest：38 files / 886 pass / 0 fail。
- Renderer 构建：PASS。
- Main 构建：PASS。
- `git diff --check`：PASS。

## 6. 一次性本地台账迁移证据

- 数据目录：`C:\Users\Administrator\AppData\Roaming\doubao-studio-desktop\DoubaoStudioData`
- 执行前先运行默认 dry-run：affected=12、source after=0、target after=12、default done=4，全部冻结不变量匹配。
- 检测到桌面应用运行后，先关闭该开发实例并确认相关 Electron 进程退出，避免双写。
- 明确执行 `--confirm 12` 后回读：
  - 来源项目：0
  - 目标项目：12 项 queued/video
  - 默认项目：4 项 done，完整对象指纹保持不变
- `tasks.json` SHA-256：
  - before：`338027460E7CB721D56D50D6D50CC73B7ACA01872C27A6CC3C5A82CA709BB01E`
  - after：`32D910D930EBACB8306834EEA6A7409FAFFB43F91B64E3CD5F8427BF14344AA9`
- `projects.json`：前后 SHA-256 相同。

这是一项本地任务台账归属修复，不是平台任务执行；未提交、上传或生成任何真实视频，额度消耗为 0。

## 7. 五态与停止声明

- 代码已实现：是。
- 自动化测试：通过。
- 人工界面验收：未完成。Windows 桌面控制运行时返回 `unavailable`，未使用不受控坐标或替代点击方式虚报结果。
- 真实任务执行：未执行。
- 一次性本地台账迁移：已执行并回读通过。
- Git 提交/推送：未执行。
- 部署/发布：未执行。
- 豆包工作室当前状态：为避免迁移双写已关闭，未自动重启。

## 8. 单一裁决

**PASS（代码、自动化门禁与一次性迁移） / 人工界面验收待桌面控制恢复后补做。**

禁止将本裁决解释为已提交、已推送、已部署、已发布或已完成真实平台任务。
