# DOUBAO-QUOTA-SCHEDULING-CSV-DOLA-01 交付报告

- 日期：2026-08-24
- 工作树：`D:\豆包工作室\doubao-public-share-media-01`
- 分支：`codex/doubao-public-share-media-01`
- 基线/当前 HEAD：`efa646a2ac51773889c509b18b0c5a5b0df7f9f4`
- 状态：实现、自动化测试与本地人工验收通过；未暂存、未提交、未推送、未打包、未部署。

## 治理与冻结范围

已读取 `D:\项目架构师\memory\INDEX.md`、`D:\项目架构师\DEVELOPMENT_EFFICIENCY_GOVERNANCE.md`、本仓 `AGENTS.md` 及相关源码/既有 handoff。冻结验收包：

1. P0-1：每日 6 个视频额度单位，按每 5 秒 1 单位计费；失败/冷却账号仍允许手动指派，队列不得静默改派。
2. P0-2：自动指派同时考虑健康、冷却、调度开关、负载、当前额度和批内额度预留；CSV 非法显式值及未知账号按行 fail-closed。
3. P0-3：Dola 账号使用独立平台类型、Session 和入口；跨平台重名/CSV 标识可判定，无法确认平台时不得串到豆包。

真实双视频验收发现的模型会员 iframe 与重复开合时长弹层属于核心承诺的直接阻断，使用本轮安全余量一并修正；未扩展到打包、安装、发布或 Dola 绕过。

## 核心行为

- 视频额度总量固定为 6；4–5s=1、6–10s=2、11–15s=3。只在视频成功终态扣减；平台明确额度耗尽时将已用量推进到至少 6。
- 手动账号选择列出全部 13 个现存账号。异常、失败、冷却、登录失效、调度暂停或额度不足只展示原因，不从列表消失。
- 手动绑定任务被阻塞时保持原账号和排队状态；`processQueue` 不再寻找替代账号静默改派。
- 自动指派按批次规划并预留额度，避免同一批任务超卖一个账号剩余额度；无可用账号明确保留未指派。
- 自动指派开关持久化到 settings；重启后回读。验收结束保持 `autoAssignEnabled=false`。
- CSV 仅为空字段应用默认值；显式非法 mode/model/duration/aspect ratio/dependency policy、未知账号、跨平台重名均按行跳过并返回行号。
- CSV 账号支持 ID、精确名称、`doubao:名称`、`dola:名称`；空账号任务可进入同一自动规划器。
- 历史账号归一为 `doubao`；Dola 使用 `persist:dola_*` 与 `https://www.dola.com/chat`，导航、新会话和模式切换均不得串到豆包。
- 普通账号默认视频模型改为当前真实可用的 `Seedance 2.0 Mini`；显式选择会触发付费面的模型时，跨源会员 iframe 被识别为 `membership_required`，不再误报页面变化。
- 视频比例已经匹配时不重复选择；时长面板仅在 slider 不可见时打开，避免第二次点击把面板关闭。

## CSV 与运行态验收

隔离 CSV 使用当前真实 `accounts.json` 的最小账号投影，不写真实 `tasks.json`：

- 有效 2 条、跳过 2 条、错误 2 条。
- `doubao:本人豆包` 精确解析成功。
- 空账号保持 `assignedAccountId=null`。
- `20s` 与不存在账号分别按第 4/5 行拒绝。
- 证据：`D:\项目架构师\evidence\doubao-quota-scheduling-csv-dola-20260824\csv-integration-input.csv` 与 `csv-integration-result.json`。

真实并发视频验收：

- 任务 A `15d8995c-c3fc-4796-8c4d-27cef1554a39`，本人豆包，Mini/5s/16:9，最终 `done`，1 个视频产物。
- 任务 B `0c812f94-44f2-4c82-a47b-4638782e6a7e`，本人豆包2，Mini/5s/16:9，最终 `done`，1 个视频产物。
- 两个成功 run 各只有一个 `native-click` 提交点；没有 Enter 回退或自动重发。
- 两账号各从已用 1/6 变为 2/6，剩余均为 4，符合 5 秒扣 1 单位。
- 重启后两任务仍为 `done`、额度仍为 2/6，新建视频表单默认 Mini。
- 截图证据：`multi-video-retry-concurrent.png`、`multi-video-final-success.png`、`post-restart-default-and-results.png`。

首次验收使用标准版模型时，两个账号均在提交前停止；随后修复并复用原任务重试，没有额外创建任务。失败历史被如实保留，最终成功 run 的 `runtime.submittedAt` 与单次提交日志可回读。

## Dola 边界

Dola 的账号类型、隔离 Session、入口和 fail-closed 接线已通过代码/测试及临时账号验收。当前网络访问 `https://www.dola.com/chat` 被官方跳转到 `security/region-restricted`，页面显示地区限制。因此：

- Dola 接线与不串号裁决：PASS。
- Dola 真实视频生产：BLOCKED（官方地区限制），未绕过、未伪造通过。

## 自动化门禁

- 专项：9 个核心文件，314/314 通过；追加模型/时长修复后相关 3 文件 244/244 通过。
- `pnpm run validate`：PASS。
  - TypeScript/Contracts/工程边界：PASS。
  - ESLint：0 error / 139 warning（上限 149；`TaskService.importCsv` complexity 51 为已知非阻断项）。
  - Vitest：32 files / 770 pass / 0 fail。
  - Renderer build / Main build：PASS。
- `git diff --check`：PASS。

## 工作树与受保护资产

当前工作树是此前“公开分享解析 + 真实发送恢复 + 多视频验收”未提交候选与本包的组合现场，共 26 个 tracked 修改和 18 个 untracked 候选（含本文）。本包没有清理、覆盖或拆分前序候选。

未修改/未执行：

- 未暂存、未提交、未推送、未创建或修改 PR。
- 未打包、未部署、未创建 Tag/Release。
- 未修改凭据、Cookie、Token 或账号登录数据。
- 未删除验收任务；两条成功任务保留在本地任务列表供用户查看结果。
- Dola 未绕过地区限制；未宣称真实生产通过。

## 单一裁决与下一步

裁决：**PASS（Dola 真实生产除外，因官方地区限制保持 BLOCKED）**。

下一步应先由总架构师对组合工作树做逐文件只读复验并冻结候选清单；提交、推送、PR、合并、打包和部署继续分别等待用户授权。
