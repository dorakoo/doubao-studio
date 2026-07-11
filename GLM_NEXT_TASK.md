# GLM 下一任务：G-301

当前只执行 `G-301 Shared 类型清单与迁移图`。这是架构设计任务，不移动代码、不修改 tsconfig、不新增依赖。

## 开始方式

1. 切换到 Codex 创建的 `glm/g-301-shared-types-design` 分支。
2. 确认 `git status --short --branch` 为空。
3. 阅读 `ROADMAP.md` 的 2.1 章节和 `AGENT_EXECUTION_PLAN.md` 的 G-301。
4. 审查现有主进程、preload、渲染进程和测试配置后再写方案。

## 盘点范围

- `src/types/index.ts`
- `src/types/electron.d.ts`
- `main/preload.ts`
- `main/ipc/accounts.ts`
- `main/ipc/tasks.ts`
- `main/ipc/projects.ts`
- `main/ipc/system.ts`
- `main/utils/csv.ts`
- `tsconfig.main.json`、`tsconfig.renderer.json`、`tsconfig.test.json`
- `package.json` 的 Main 入口与构建脚本

## 交付物

只新增 `docs/architecture/shared-types-migration.md`，内容必须包含：

1. 重复类型与字段差异矩阵，不能只列类型名。
2. 区分领域模型、持久化记录、IPC 命令/响应 DTO、公开 Agent API Schema。
3. 至少比较两种目录/构建方案，并说明 CommonJS、ESM、`rootDir`、输出路径和 Electron `main` 入口影响。
4. 推荐方案必须保证 shared 层不导入 Electron、React、Zustand、DOM 或 Node 文件系统。
5. 明确版本化和兼容策略：可选字段、枚举扩展、Schema 版本、旧 JSON 数据迁移。
6. 给出可独立编译的迁移批次，每批包含修改文件、兼容桥和回滚点。
7. 说明如何让 preload 的运行时 API 与 renderer 的 `ElectronAPI` 类型使用同一来源。
8. 说明未来 CLI/MCP 如何复用 DTO，但不能直接复用内部 Cookie、Webview、绝对路径和 Store 状态。
9. 标记当前 `main/utils/csv.ts` 的临时模式类型如何在迁移后归一。

## 禁止事项

- 不创建 `shared/`、`core/` 或 workspace package。
- 不修改任何现有 TypeScript 导入。
- 不改业务代码、配置、版本号或锁文件。
- 不直接实施自己推荐的方案。

## 验收

```powershell
pnpm.cmd run validate
git diff --check
```

提交信息：

```text
docs(architecture): design shared type migration
```

不要推送或合并。交接报告中列出推荐方案、未决风险、迁移批次数量和提交 SHA。
