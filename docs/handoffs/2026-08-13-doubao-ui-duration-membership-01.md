# DOUBAO-UI-DURATION-MEMBERSHIP-01 候选报告

## 治理与冻结验收包

已读取总架构师治理规则、项目 `AGENTS.md`、README、ROADMAP、DESIGN、最新 UI capability handoff 和相关源码测试。

- P0-1：适配当前 4–15 秒 Radix 时长滑杆，只操作页面可见控件
- P0-2：选择时长后检测会员订阅 iframe，返回 `membership_required` 并停止
- P0-3：增强 Adapter 会员 iframe 只读取证和 dry-run 回归

## 实现

- 识别 `role=slider` 且 `aria-valuemin=0`、`aria-valuemax=11` 的当前时长滑杆。
- 使用 Electron 页面输入事件聚焦滑杆，从 Home 起按目标秒数移动；不改写请求参数。
- 控件未出现时保留旧下拉 UI 兼容回退；两者均失败时明确报错。
- 选择后回读 `aria-valuenow`，并只读检查 iframe `title/src` 中的订阅/会员证据。
- 发现会员动作时发送 Escape 关闭本次弹窗，返回 `membership_required`，禁止最终提交。
- Adapter 自检将跨域订阅 iframe 作为结构化 `action_required` 证据。

## 边界

- 11–15 秒出现会员窗口仅是当前账户、当前页面的观察，不是永久平台规则。
- 未点击购买、支付或升级确认。
- 未发送真实生成、未消耗额度、未读取 Cookie/Token。
- 未修改已合并的官方无水印解析链。

## 自动化门禁

- 会员与能力专项：49 pass / 0 fail
- 全量：494 pass / 0 fail（15 files）
- TypeScript：通过
- 工程结构与 contracts 边界：通过
- Production build：通过
- 修改文件 ESLint：0 error（既有 warnings 未扩项清理）
- `git diff --check`：通过

## 状态

代码候选已实现并通过自动化门禁，等待总架构师复验。未部署。
