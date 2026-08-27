# DOUBAO-REPOSITORY-DOCS-REFRESH-01 交付记录

- 日期：2026-08-27（Asia/Shanghai）
- 工作树：`D:\豆包工作室\doubao-automation-closeout-01`
- 分支：`codex/doubao-repository-docs-refresh-01`
- 基线：`origin/main@819b49d0a2807ad83ae695c490f5c61740414614`
- 本记录生成时状态：未暂存、未提交、未推送；用户已授权自行更新仓库。

## 治理读取与冻结验收包

已读取总架构师 `memory/INDEX.md`、`DEVELOPMENT_EFFICIENCY_GOVERNANCE.md`、仓库 `AGENTS.md`、公开 README/ROADMAP/CHANGELOG/架构文档、实际 Git/Release/源码与 Copywriting 技能说明。

冻结目标：清理 GitHub 仓库的过时描述与旧版本残留，并补齐公开协作入口。

1. P0-1：源码版本、GitHub Release、15 秒能力、Webview 生命周期、IPC 数量、路线状态与当前实现一致。
2. P0-2：README 增加可读的 CSV 构建准则图，字段语义以 `TaskService.importCsv()` 为准。
3. P0-3：补齐 CONTRIBUTING、SECURITY、Issue/PR 模板与 package 仓库元数据；删除无引用的根部旧副本和历史临时任务单。

非目标：不改业务行为、不改平台写入、不修改历史 handoff、不重写 CHANGELOG 历史事实、不发 Tag/Release、不部署。

## 核心修正

- README 将源码 `2.3.0` 与 GitHub Latest Release 分开显示，不再把未发布源码写成安装包版本。
- 历史 15 秒请求改写说明更正为“永久禁用；11–15 秒必须有页面实时可选证据”。
- `AGENTS.md` 更正为常驻独立 Webview + 前台交互租约，补齐 Core/Contracts/CLI/MCP 结构和真实验证命令。
- `ROADMAP.md` 增加截至 2026-08-27 的完成/部分完成/未开始矩阵，并重写当前优先队列。
- `AGENT_EXECUTION_PLAN.md` 将 Wave 0–3 标记为历史记录，源码版本更新为 2.3.0，IPC 基线更新为 52/3。
- Capability Schema 与 CLI/MCP 文档的示例 `serviceVersion` 从 2.1.0 更新为 2.3.0，协议结构不变。
- 新增 CSV 构建图：编码、表头、提示词转义、视频参数、素材路径、账号消歧、依赖及导入前检查。
- README、AGENTS、ROADMAP 和 CSV 图明确标注 Dola 仅完成字段/Session/URL/账号消歧接线，端到端可用性尚未人工验证，不得宣称生产可用。
- 删除根部无引用的旧 `doubaoBridge.ts` 副本、空文件 `git` 和已完成的 `GLM_NEXT_TASK.md`；真实实现 `src/utils/doubaoBridge.ts` 未修改。

## 实际文件

共 19 个文件：8 个 tracked 修改、3 个 tracked 删除、8 个 untracked 新增。

### tracked 修改

- `AGENTS.md`
- `AGENT_EXECUTION_PLAN.md`
- `CHANGELOG.md`
- `README.md`
- `ROADMAP.md`
- `docs/architecture/cli-mcp-mapping.md`
- `package.json`
- `schemas/capability/v1/capability-manifest.schema.json`

### tracked 删除

- `GLM_NEXT_TASK.md`
- `doubaoBridge.ts`
- `git`

### untracked 新增

- `.github/ISSUE_TEMPLATE/bug_report.yml`
- `.github/ISSUE_TEMPLATE/config.yml`
- `.github/ISSUE_TEMPLATE/feature_request.yml`
- `.github/PULL_REQUEST_TEMPLATE.md`
- `CONTRIBUTING.md`
- `SECURITY.md`
- `docs/assets/README-csv-guide.svg`
- `docs/handoffs/2026-08-27-doubao-repository-docs-refresh-01.md`

## 验证

- `pnpm run validate`：PASS。
- TypeScript：0 error。
- ESLint：0 error / 143 warning，低于 149 上限。
- 工程与 Contracts 边界：PASS；52 个 handle/invoke、3 个 on/send。
- Vitest：37 files / 869 tests，全通过。
- Renderer/Main build：PASS。
- SVG XML、package/schema JSON、GitHub Issue YAML、README 本地链接：PASS。
- `git diff --check`：PASS。
- 根部旧 `doubaoBridge.ts`、`git`、`GLM_NEXT_TASK.md` 无源码引用；删除后完整构建与测试通过。

## 纪律与状态

- 业务代码、用户数据、Cookie、Token、Session、素材、产物、release、安装包零修改。
- 实现与本地验证完成；CI、合并和远端 GitHub 元数据更新待提交推送后回读。
- 未部署、未发布、未创建 Tag/Release、未启动或提交真实平台任务。

## 裁决

PASS。可创建文档候选提交、合并到最新 `main` 并推送；推送后更新仓库描述/Topics 与私密漏洞报告入口，并回读 CI。
