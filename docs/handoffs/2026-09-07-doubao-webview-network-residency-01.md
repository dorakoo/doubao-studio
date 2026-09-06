# DOUBAO-WEBVIEW-NETWORK-RESIDENCY-01 交接单

- 日期：2026-09-07
- 版本：2.3.4
- 分支：`codex/doubao-webview-activation-r3`
- 基线：`ae29b0ad6dd5383115dcdc90ec3bac8afa3e84a8`
- 状态：代码已实现；专项测试、静态门禁和打包态只读验收已通过；提交、CI、合并、正式安装与发布状态以本单后续附录为准。

## 治理与冻结验收包

开工前已读取总架构师治理规则、项目 `AGENTS.md`、中央与仓库 memory、2.3.2/2.3.3
相关 handoff 及本机控制文档。冻结范围如下：

1. 修复 Windows 本机代理未进入 Electron NetworkService 导致多账号黑屏。
2. 只重建可再生成的网络/代码/GPU 缓存，不清 Cookie、Local Storage、IndexedDB、账号 Session、任务或产物。
3. 每个账号使用唯一持久化 partition；后台页面保持常驻但移出可视区，避免 guest surface 串画面。
4. 启动时单通道顺序预热全部账号；当前项稳定后立即启动下一项，任务执行账号不被回收。
5. 账号列表按本次启动的预热结论排序：已确认可用优先，待确认/仍预热靠后；同级保持原顺序。
6. 提供默认关闭、仅监听 `127.0.0.1` 的短时 CDP 验收入口；不把裸 CDP 用作正式控制面。
7. 不提交真实平台任务、不上传素材、不消耗视频额度、不修改任务台账或登录凭据。

## 根因与行为

- Chromium 没有可靠继承系统 shell 代理，而本机 DNS 返回代理 fake-IP，导致无显式代理的 Webview 永久 loading。
- 多个正式账号分区的可再生成缓存结构损坏；仅调用 Electron `clearCache` 不足，需要在 Session 创建前归档并重建磁盘缓存。
- Electron guest surface 不可靠遵守普通 DOM `z-index`；多个不透明 Webview 原位叠放时会造成账号画面串层。
- 快速切换会保留被替代的未完成导航，形成加载风暴。
- 旧顺序预热在账号就绪后固定等待 800ms，再等待 750ms 轮询，产生 0.8–1.55 秒空档。

2.3.4 的行为变化是：只采用无凭据 loopback 代理；首次启动按版本归档并重建五类可再生缓存；账号 partition 在首次导航前固定；当前 Webview 原位显示，后台常驻 Webview 移到屏外；快速切换只回收无执行任务的旧加载页；账号预热在稳定 250ms 后事件驱动启动下一项，1 秒轮询仅兜底。15 秒登录/验证复检独立执行，不阻塞后续预热。

## 修改文件

Tracked 修改：

- `CHANGELOG.md`
- `docs/LOCAL_CONTROL.md`
- `main/main.ts`
- `package.json`
- `src/components/BrowserPanel.tsx`
- `src/components/AccountList.tsx`
- `src/utils/accountAvailability.ts`
- `src/utils/webviewHydration.ts`
- `tests/unit/accountAvailability.test.ts`
- `tests/unit/webviewHydration.test.ts`

Untracked 新增：

- `main/utils/localCdp.ts`
- `main/utils/localProxy.ts`
- `main/utils/webviewNetworkRecovery.ts`
- `tests/unit/localCdp.test.ts`
- `tests/unit/localProxy.test.ts`
- `tests/unit/webviewNetworkRecovery.test.ts`
- `docs/handoffs/2026-09-07-doubao-webview-network-residency-01.md`

Tracked 删除：无。

## 验证证据

- 账号可用性、Webview hydration/network recovery 专项：32/32 通过。
- TypeScript：contracts、main、renderer、test 四层零错误。
- 全量 `pnpm run validate`：47 files / 991 tests 全部通过；ESLint 0 error / 146 warning（低于 149 门限）。
- 修改范围 ESLint：0 error；仅既有 warning。
- `git diff --check`：通过。
- `pnpm run pack`：Renderer、Main 构建与 Windows unpacked 打包通过。
- 打包态短时 CDP：13/13 Webview 到达正式豆包标题，13 个唯一 partition，前台 1、后台屏外常驻 12。
- 快速切换 `hll豆包 → hll2 → 本人豆包2 → cyf136` 后，仅 cyf136 对应 partition 在前台，未再出现 ghz 页面覆盖。
- 顺序预热时间戳：代表性相邻衔接为 195ms、291ms、281ms；未再出现固定 0.8–1.55 秒空档，且任一时刻只新增一个预热 Webview。
- 未执行发送、上传、生成或额度消耗。
- 短时控制会话与测试实例已关闭，端口 `9333` 无残留监听。

## 保留与未决事项

- 缓存旧目录以 `.pre-2.3.4-*` 名称保留，可回滚，未删除。
- Dola 账号没有完成真实端到端验证，不得声明可用。
- 正式安装后仍需按同一只读矩阵复验；人工验收不等于真实平台写入验收。
- 不得把缓存目录、marker、账号数据、日志、Cookie、Token、Session 或验收临时产物加入 Git。
