# DOUBAO-TASK-CONVERSATION-LOCATOR-R2-01 实施交接单

- 日期：2026-09-12
- 状态：代码已实现、自动化候选门禁与免安装包打包通过；未人工验收、未执行真实任务、未提交、未推送、未部署、未发布
- 基线/当前 HEAD：`origin/main@f461a7fb9fcefcf35050de5a4459bd1b94f897b3`（v2.3.7）
- 分支：`codex/doubao-task-conversation-locator-r2-01`
- 工作树：`D:\豆包工作室\doubao-task-conversation-locator-r2-01`

## 治理与冻结验收包

开工前已读取总架构师治理规则、中央 memory、豆包仓库 `AGENTS.md`、v2.3.7 页面就绪/受理观察收口单及旧定位工作树 handoff。旧工作树只读取证；未合并其 `dfbb7f2` diff，未改动或清理任何既有工作树。

本包唯一核心目标：任务卡与“核对平台结果”始终定位任务绑定的具体原会话，不再只切账号、打开根页或新会话。

冻结 P0：

1. 双击任务卡切换绑定账号并有界等待该账号 WebView，再精确打开原会话。
2. 核对平台结果：不在目标会话时只导航，已在目标会话时才刷新；全程不注入、不发送、不新建对话。
3. 仅接受规范化 `https://www.doubao.com/chat/{id}`；拒绝根页、HTTP、错误域名、端口、凭据 URL、歧义和跨 run 候选。
4. 平台明确受理后才等待具体会话 URL，并与 acceptance binding 在一次 runtime 写入中持久化及回读校验。
5. 应用重启、慢加载或 WebView 尚未挂载时有界等待；导航预检失败不改任务台账。
6. 不带回旧工作树的缓存、网络恢复、WebView 预热或生命周期变更；Dola 保持未验证、fail-closed。

## 实现结果

- 新增 `taskConversationLocator`：
  - 严格规范化具体豆包会话；
  - runtime 与 acceptance binding 的 run/URL 必须同步；
  - 旧任务只允许回退到当前 run 的唯一 artifact 会话；
  - 有界等待 WebView 与具体会话 URL；
  - 导航/刷新后重新核对会话身份；
  - Dola 分区明确拒绝使用豆包定位器。
- 任务卡新增双击定位事件；单击行为仍只切账号。
- “核对平台结果”先切账号、等待 WebView、导航或原地刷新并等待页面就绪；上述预检失败只提示，不修改任务状态。预检通过后才续租并进入既有只读产物核对。
- 新任务不再把 `/chat/` 根页预写为 `runtime.conversationUrl`。平台受理后有界等待具体 URL，再将 `conversationUrl + acceptanceObservation` 原子写入；回读必须校验 account/run/outcome/URL 一致。
- `hasPlatformAcceptance` 只有在 runtime 与 binding 具体 URL 同步时才成立；不一致状态不会放行 `all_accepted` 后继。
- 人工提交观察入口复用同一规范化器，不再维护独立正则。

## 精确文件清单

Tracked 修改（7）：

1. `src/components/BrowserPanel.tsx`
2. `src/components/TaskConsole.tsx`
3. `src/utils/acceptedObservation.ts`
4. `tests/unit/acceptedObservation.test.ts`
5. `tests/unit/dependencyEval.test.ts`
6. `tests/unit/generationControlReadiness.test.ts`
7. `tests/unit/productionObservability.test.ts`

Untracked 新增（3）：

1. `src/utils/taskConversationLocator.ts`
2. `tests/unit/taskConversationLocator.test.ts`
3. `docs/handoffs/2026-09-12-doubao-task-conversation-locator-r2-01.md`

Tracked 删除：0。

明确未移植：`main/main.ts`、`main/utils/webviewNetworkRecovery.ts`、`src/utils/webviewHydration.ts` 及其旧测试变更。

## 门禁证据

- 包 B 专项与受影响回归：8 files / 157 tests PASS。
- `pnpm run validate`：PASS，exit code 0。
  - 全量：50 files / 1053 tests PASS / 0 fail。
  - TypeScript：PASS。
  - ESLint：0 error / 146 warning，低于 v2.3.7 的 147 warning。
  - 工程结构、Contracts 边界、Renderer/Main build：PASS。
- `pnpm run pack`：PASS；候选 `release\win-unpacked\豆包工作室.exe` 已生成。
- `git diff --check`：PASS。

新增/收紧行为测试覆盖严格 URL、同 run 唯一 artifact、歧义与跨 run 拒绝、binding/runtime 冲突、Dola fail-closed、WebView 有界等待、导航/刷新分支、导航异常、受理 binding 构造、重启恢复与 `all_accepted` 不一致拒绝。

## 边界、偏差与剩余风险

- 未启动正式或候选应用，未读取或改动 Cookie、Token、Session、真实任务/项目/下载台账及视频产物。
- 未提交真实视频、未上传素材、未消耗额度。
- 本轮没有按钮级人工验收；双击与核对的实际 UI 验收需在后续集成候选中只读执行。
- Dola 仍未完成真实端到端验收，本包明确拒绝用豆包定位器导航 Dola 账号。
- Windows 代码签名和自定义图标仍是独立技术债，不属于本包。

## 五态与停止声明

- 代码已实现：是。
- 自动化测试：是。
- 人工验收：未执行。
- 真实任务执行：未执行。
- 提交、推送、PR、合并、安装、部署、发布：均未执行。
- 不自行创建 v2.3.8；等待总架构师复验及后续独立授权。
