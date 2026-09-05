# DOUBAO-WEBVIEW-LAZY-HYDRATION-01 实施交接单

- 日期：2026-09-06
- 状态：代码已实现、自动化测试通过；人工多账号验收待安装候选后执行
- 基线：`origin/main@f484d67fd87147e1321e6376d74650b4a4fa934d`
- 分支：`codex/doubao-webview-lazy-hydration-01`
- 候选版本：`2.3.2`

## 治理与冻结验收包

开工前已读取总架构师治理规则、豆包工作室 `AGENTS.md`、2.3.1 本机控制交接单及实际运行状态。

本包冻结目标：修复正式实例在 13 个账号启动时并发创建全部 webview，导致首个账号之外页面黑屏的问题。

1. 启动时只挂载当前账号，不清理或迁移任何账号 Session。
2. 用户切换账号时按需创建对应 webview；已创建实例继续常驻。
3. 后台任务进入执行态时自动挂载其账号 webview，保持多账号生成能力。
4. 当前账号首次加载失败时只允许一次有界 reload；不循环重试、不清 Cookie。
5. 不提交真实平台任务、不消耗额度、不修改任务/项目台账。

## 实现与行为证据

- `getWebviewHydrationAccountIds` 将初始挂载集合收敛为当前账号与真实执行账号。
- BrowserPanel registry 仍保留已经使用过的 webview，账号切换不会销毁 Session 或页面状态。
- `executingTasks` 变化会触发后台账号挂载；webview 注册后通过既有 epoch 触发原自动化路由。
- 当前账号 `did-fail-load` 后最多 reload 一次；成功 `dom-ready` 后重置恢复计数。

## 修改文件

Tracked 修改：

- `CHANGELOG.md`
- `package.json`
- `src/components/BrowserPanel.tsx`

Untracked 新增：

- `src/utils/webviewHydration.ts`
- `tests/unit/webviewHydration.test.ts`
- `docs/handoffs/2026-09-06-doubao-webview-lazy-hydration-01.md`

Tracked 删除：无。

## 门禁

- 专项：2 files / 7 tests，通过。
- 全量：44 files / 966 tests，通过。
- TypeScript：零错误。
- ESLint：零错误 / 146 个既有警告，低于 149 上限。
- 工程与 Contracts 边界：通过。
- Renderer/Main build：通过。
- `git diff --check`：通过。

## 安全声明

- 未读取、输出或修改 Cookie、Token、完整账号 Session。
- 未修改 `accounts.json`、`tasks.json`、`projects.json` 或视频产物。
- 未触发豆包平台提交、上传或额度消耗。
