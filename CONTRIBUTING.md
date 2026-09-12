# 参与豆包工作室开发

感谢你帮助改进豆包工作室。这个项目同时涉及 Electron、网页自动化、本地数据和外部平台，提交代码前请先确认修改不会读取或泄露账号会话，也不会在测试中触发真实平台写入。

## 开始之前

1. 阅读 `AGENTS.md`、`ROADMAP.md` 和与修改领域相关的 `docs/architecture/` 文档。
2. 从最新 `origin/main` 创建一个聚焦的功能分支。
3. 开工前运行 `git status`，不要覆盖来源不明的本地改动。
4. 一个提交只解决一个明确问题；平台页面适配、Core 重构和界面改版不要混在一起。

```powershell
git fetch --all --prune
git switch -c fix/short-description origin/main
pnpm install --frozen-lockfile
```

## 开发边界

- 任务域读写经过 `TaskService` 和 Repository；不要新增对 `tasks.json` 的旁路写入。
- 账号 Cookie、Token、Session、诊断包、生成素材、下载产物和用户数据不得进入 Git。
- 平台提交必须“回读输入与控件 → 持久化提交意图 → 单次发送 → 回读平台结果”。
- 页面状态不确定、人工验证未完成或权限/额度无法确认时必须 fail-closed。
- 不通过请求改写绕过平台会员、额度、风控或服务端校验。
- 修改共享 DTO 时同步检查 `packages/contracts`、preload、IPC 和调用方。
- 修改控制面时保持 `--local-control` 与短时 `--local-cdp` 分离：前者是带鉴权的稳定任务协议，后者只用于开发诊断；不得新增局域网监听、任意 DOM/脚本执行或敏感会话输出。
- 修改 Webview 生命周期时必须保留 2.3.4 的唯一 partition、顺序预热、后台屏外常驻和任务账号租约，并验证快速切换不串层。

## 验证

日常开发先运行相关专项测试；提交候选前运行完整门禁：

```powershell
pnpm run validate
git diff --check
```

`validate` 会执行 TypeScript、ESLint、IPC/Contracts 工程检查、Vitest 和 Renderer/Main 构建。真实豆包账号或付费生成不属于 CI；如果确实执行了人工平台测试，请在 PR 中写明账号状态、操作范围、是否产生平台写入和额度消耗，不要附带敏感截图。

## Pull Request 内容

PR 至少说明：

- 问题与根因；
- 用户可观察到的行为变化；
- 修改文件和安全边界；
- 实际运行的测试及结果；
- 未验证事项和残余风险；
- 对平台页面、持久化、契约或迁移的影响。

提交消息建议使用 Conventional Commits，例如：

```text
fix(webview): preserve task context during account switches
feat(csv): add guarded drag-and-drop import
docs: refresh repository usage guide
```

## 版本发布与更新说明

准备新版本（修改 `package.json` version、打 `v*` Tag 或创建 GitHub Release）时：

1. **必须**在 `CHANGELOG.md` 增加该版本章节，写清完成了什么更新（能力、操作方式、修复、明确未做项）。
2. CI Release 工作流会把该章节写入 GitHub Release 正文；章节缺失会导致发布失败。
3. 不要把自动化测试通过写成“人工验收完成”或“生产可用”；Dola、签名、图标等未验证项保持如实标注。
4. 详细规则见 `AGENTS.md` 的「发布与更新说明」。

## 报告页面适配问题

请使用 Bug Report 模板，提供豆包页面模式、模型、比例、时长、失败阶段和可复现步骤。只上传脱敏日志；删除 Cookie、Token、完整提示词、私人素材路径、账号名和媒体 URL。
