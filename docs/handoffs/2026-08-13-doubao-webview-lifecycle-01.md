# DOUBAO-WEBVIEW-LIFECYCLE-01

## 治理与冻结范围

已读取总架构师治理规则、项目规则、ROADMAP、最新稳定性 handoff 与 BrowserPanel 源码。本包只处理 webview 资源生命周期。

- P0-1：账号删除时注销监听器、停止定时器、移除 DOM。
- P0-2：组件卸载时清理所有 webview 资源并中止执行控制器。
- P0-3：已释放作用域的异步回调不得更新组件状态。

非目标：不改页面选择器、生成流程和 UI，不运行真实生成，不部署。

## 实现与验证

- 新增每账号资源作用域，集中持有监听器与 timer，并提供幂等 dispose。
- 6 个 webview 加载/导航事件、2 秒轮询和 60 秒超时统一登记。
- 账号删除清理对应作用域、DOM、加载状态和相关 AbortController。
- 组件卸载以稳定 ref 快照清理全部作用域、webview 与控制器。
- 所有加载状态回调先验证 `scope.active`，释放后不再触发状态更新。
- 专项：3 pass / 0 fail；全量：19 files，510 pass / 0 fail。
- TypeScript、全局 ESLint（0 error / 既有 warnings）、工程/contracts 边界、生产构建和 `git diff --check` 全部通过。

系统 C 盘 Temp 空间为 0，本包使用 D 盘任务专用 TEMP/TMP 验证，未删除用户文件。

候选门禁通过，等待提交与 CI。未部署。
