# DOUBAO-WEBVIEW-ACTIVATION-R2 收口报告

- 日期：2026-09-06
- 分支：`codex/doubao-webview-activation-r2`
- 基线：`bf8d0d9`（2.3.2）
- 目标版本：2.3.3
- 状态：代码已实现、测试通过；提交/PR/合并/安装/人工验收待后续执行

## 治理声明

开工前已读取总架构师治理规则、豆包工作室 `AGENTS.md`、中央记忆与本问题相关 handoff。实现、CI、人工验收、部署、发布五态分开记录；未清理 Cookie、Token、账号 Session，未提交真实平台任务，未消耗视频额度，未修改视频产物或用户台账。

## 冻结验收包

1. Webview 切换时不得使用 `visibility:hidden`，避免 Electron guest view 恢复后未重绘。
2. 导航地址变化不得被当作页面内容已就绪；只有正式加载事件或只读探针确认文档已形成，才撤下加载层。
3. 60 秒超时不得伪装成功；保留明确的慢加载提示和手动刷新入口。
4. 保持 2.3.2 的按需挂载策略：启动时只创建当前账号，切换或执行任务时才加载对应账号，已加载账号常驻。
5. 不改变账号身份、Session 分区、任务调度、平台提交和额度语义。

## 实现结果

- `src/components/BrowserPanel.tsx`：Webview 始终留在合成树中，通过 opacity、层级和 pointer-events 切换；移除 `did-navigate` 的过早完成判定；增加页面文档就绪探针；超时保持可见提示。
- `src/utils/webviewHydration.ts`：新增可单测的 Webview 激活样式策略。
- `src/styles/global.css`：加载遮罩改为不透明居中，避免暴露 SPA 空壳黑屏。
- `tests/unit/webviewHydration.test.ts`：新增隐藏/激活样式行为测试。
- `package.json`、`CHANGELOG.md`：版本与修复说明更新为 2.3.3。

## 门禁证据

- 专项：2 files / 8 tests，PASS。
- TypeScript：0 error。
- 修改文件 ESLint：0 error / 12 warning（既有警告）。
- 全量 `pnpm run validate`：PASS。
  - ESLint：0 error / 146 warning（低于 149 上限）。
  - 工程结构与 contracts 边界：PASS。
  - 全量测试：44 files / 967 tests，全部通过。
  - Renderer/Main build：PASS。
- `git diff --check`：PASS。

## 文件清单

Tracked 修改：

- `CHANGELOG.md`
- `package.json`
- `src/components/BrowserPanel.tsx`
- `src/styles/global.css`
- `src/utils/webviewHydration.ts`
- `tests/unit/webviewHydration.test.ts`

Untracked 新增：

- `docs/handoffs/2026-09-06-doubao-webview-activation-r2.md`

Tracked 删除：无。

## 后续验收

从最终 main 构建 clean release 并安装后，依次切换至少四个豆包账号：每次先显示明确加载界面，随后正常绘制页面；切回已加载账号仍能显示；启动时不得一次创建全部账号 Webview。全过程不发送消息、不上传素材、不启动任务。安装前后回读 `accounts.json`、`tasks.json`、`projects.json`，并确认本机控制面仅监听 `127.0.0.1`。

