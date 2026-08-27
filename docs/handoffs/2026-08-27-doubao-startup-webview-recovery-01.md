# DOUBAO-STARTUP-WEBVIEW-RECOVERY-01 实施与验收报告

- 日期：2026-08-27
- 工作树：`D:\豆包工作室\doubao-automation-closeout-01`
- 分支：`codex/doubao-startup-webview-recovery-01`
- 基线 HEAD：`83a328ae576a84a1094164535526d7a1fd50b30e`（`origin/main`）
- 当前 HEAD：同基线（本包未提交）
- 关联事故单：`D:\项目架构师\handoffs\2026-08-27-doubao-studio-production-desktop-control-incident-01.md`

## 1. 治理与冻结验收包

开工前已完整读取总架构师治理规则、豆包仓库 `AGENTS.md` 与事故单。本包冻结范围：

1. 启动恢复账号列表后自动建立唯一当前账号，使对应 webview 无需人工点击即可显示。
2. 非标准 `electron .` 源码直启缺少 Vite 注入时显示明确诊断页，不再静默黑屏。
3. 不修改账号数据、任务 JSON、Cookie、Token、用户产物或运行时业务状态。
4. Windows Computer Use Sky runtime 作为外部工具基础设施单独记载，不伪装成应用代码修复。

## 2. 根因与整改

### P0-1 启动后必须点击账号

根因：`useAccountStore.loadAccounts()` 只恢复账号列表，从未设置 `selectedAccountId`；冷启动时 `App.tsx` 得到的 `activeAccount` 恒为 `null`，BrowserPanel 没有当前可见 webview。

整改：新增纯函数 `resolveStartupAccountId()`。当前选择仍有效时保留，否则优先首个置顶账号，再回退到账号列表首项；空列表保持 `null`。`loadAccounts()` 在同一次状态更新中写入规范化账号和解析后的当前账号。

唯一行为变化：有账号的冷启动会自动显示一个确定的账号 webview；账号、分区、Cookie 与业务数据本身不改变。

### P0-2 非标准源码直启黑屏

根因：开发模式缺少 `VITE_DEV_SERVER_URL` 时仍盲目访问 `http://127.0.0.1:5173`，Vite 未运行即形成静默黑屏。

整改：新增 `resolveRendererStartupTarget()`。打包版只加载 renderer 文件；标准开发入口只接受显式注入的 HTTP(S) dev server URL；缺少注入时显示本地 `data:` 诊断页，明确提示使用 `pnpm run dev`。renderer 加载失败会写入 crash log 并回退到诊断页。

## 3. 实际修改文件

### tracked 修改

- `main/main.ts`
- `src/store/useAccountStore.ts`

### untracked 新增

- `main/utils/rendererStartup.ts`
- `src/utils/accountStartupSelection.ts`
- `tests/unit/startupRecovery.test.ts`
- `docs/handoffs/2026-08-27-doubao-startup-webview-recovery-01.md`

### tracked 删除

- 无。

## 4. 验证结果

- 启动恢复专项：`startupRecovery + webviewLifecycle + accountAvailability`，3 files / 26 pass / 0 fail。
- Store 集成行为：模拟真实 `accounts.list()` 返回两个账号，`loadAccounts()` 后自动选择置顶账号并恢复 2 个账号。
- TypeScript：`pnpm run ts-check`，PASS。
- 修改文件 ESLint：0 error；全量 ESLint：0 error / 143 warning，小于 149 上限。
- 工程结构与 contracts 边界：PASS。
- 全量测试：35 files / 840 pass / 0 fail。
- Renderer build：PASS；Main build：PASS。
- `git diff --check`：PASS。
- 非标准直启：清除 `VITE_DEV_SERVER_URL` 后 Electron 主进程成功运行、IPC 全注册，未依赖 5173；目标解析与诊断页内容由专项测试覆盖。
- 标准启动：Vite `127.0.0.1:5173` 可达、IPC 全注册、Electron 主进程响应正常、账号隔离 renderer/webview 进程建立，未见 renderer load failure。

Windows Computer Use Sky runtime 在可视化验收时返回 `unavailable`，因此没有伪造可视截图或人工点击结论。这是事故单中的外部工具基础设施问题，不影响上述应用代码、进程与门禁证据，但可视化自动验收状态仍单列为未完成。

## 5. 开发环境清理

清理前逐项确认工作树干净且 HEAD 已并入 `origin/main`，随后移除 3 个过时 worktree：

- `D:\豆包工作室\doubao-cli-mcp-01`
- `D:\豆包工作室\doubao-studio-dev-main`
- `D:\豆包工作室\doubao-studio-mcp-client`

以下过时缓存/旧构建产物已送入回收站：

- `D:\豆包工作室\.codex-temp`
- `D:\豆包工作室\doubao-studio-main\release`（含旧 `豆包工作室 Setup 2.0.0.exe`；当前项目版本 2.3.0）

合计约释放 2.51 GB。Git 分支与远端引用均保留；旧 worktree 的代码可从分支恢复，回收站项目可恢复。

明确保留且未清理：

- 当前工作树 `doubao-automation-closeout-01`
- `doubao-public-share-media-01` 的 47 项脏变更现场
- `doubao-studio-main` 的 14 项脏变更取证现场
- 用户账号会话、任务、产物与所有 Git 分支

## 6. 纪律与裁决

- 应用整改实现：PASS。
- 自动化与构建门禁：PASS。
- 标准启动进程级验收：PASS。
- Windows 可视化自动验收：BLOCKED（外部 Sky runtime unavailable，未归因于应用）。
- 未提交、未推送、未创建或修改 PR、未打包、未发布。
- 未提交任务、未上传素材、未发送消息、未消耗豆包额度。
- 未修改或删除账号数据、任务 JSON、Cookie、Token、用户产物。

本报告不把“已实现/自动化验证”表述为“已发布”。
