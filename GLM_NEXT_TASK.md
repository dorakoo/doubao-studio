# GLM 下一任务：G-201

当前只执行 `G-201 工程检查增强`，不要提前开始 ESLint、测试框架或业务重构。

## 开始方式

1. 切换到 Codex 创建的 `glm/g-201-project-check` 分支。
2. 运行 `git status --short --branch`，工作区必须干净。
3. 阅读 `AGENT_EXECUTION_PLAN.md` 中 G-201 的完整范围。
4. 先输出对现有检查脚本盲区的简短确认，再开始修改。

## 实施要求

- 使用项目现有 `typescript` 包的 Compiler API，不添加新依赖。
- 仅修改 `scripts/check-project.mjs`、`scripts/lib/`、`scripts/fixtures/`。
- 扫描主进程全部注册入口，不只扫描 `main/ipc/`。
- 校验 `handle/invoke` 与 `on/send` 的方向和数量。
- 检查顶层 IPC 注册与顶层 `app.getPath()`。
- 为正常和五类失败情况提供自测试 Fixture。
- 不修改任何业务文件来迁就检查器；如当前工程暴露真实不一致，先在交接报告中列出并停下等待 Codex 决策。

## 验收

```powershell
pnpm.cmd run check:project
pnpm.cmd run validate
git diff --check
```

完成后创建一个提交：

```text
build(check): validate IPC contracts with TypeScript AST
```

不要推送、不要合并、不要修改版本号。按 `AGENT_EXECUTION_PLAN.md` 的交接格式返回提交 SHA、检测数量、Fixture 结果和残余风险。
