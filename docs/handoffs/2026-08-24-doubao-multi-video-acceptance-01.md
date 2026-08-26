# DOUBAO-MULTI-VIDEO-ACCEPTANCE-01（2026-08-24）

## 开工声明与冻结验收包

- 已读取 `D:\项目架构师\memory\INDEX.md`、`D:\项目架构师\DEVELOPMENT_EFFICIENCY_GOVERNANCE.md`、本仓 `AGENTS.md`、真实发送整改 handoff、实际 Git/运行数据和 Electron 页面。
- 核心目标：验证重复提交 R1 修复后的双账号、多视频并发链路。
- P0-1：每个任务只有一个 run/attempt/submittedAt，豆包会话提交阶段唯一标识恰好出现一次，不自动补发。
- P0-2：两个任务分别绑定 `本人豆包`、`本人豆包2`，并发执行且不串号；页面实际参数为 Seedance 2.0 Mini、10s、9:16。
- P0-3：两个任务均到达 done/completed，各产生一个可访问 MP4；应用日志各只有一次开始和一次完成。
- 非目标：不测试未授权账号，不打包、不部署、不提交、不推送，不自动下载产物。

## 基线与运行环境

- 工作树：`D:\豆包工作室\doubao-public-share-media-01`
- 分支 / HEAD：`codex/doubao-public-share-media-01` / `efa646a`
- 开工时仅历史故障任务 `79e550aa-...`，保持 paused、attempt=1、无运行锁。
- Electron 开发版从当前工作树启动，Vite `127.0.0.1:5173`，CDP 仅用于本机验收。

## 真实任务与结果

| 标识 | 任务 ID | 账号 | run / attempt | 提交证据 | 终态 | 产物 |
| --- | --- | --- | --- | --- | --- | --- |
| QA-MV-A-20260824 | `ce7e3437-6ef8-4a2e-880c-442c8c2de009` | 本人豆包 | 单一 run / 1 | 提交阶段唯一标识 1 次；页面回显 9:16、10s、Mini | done / completed | 1 个 MP4，`v9-default.douyin.com`，Range 回读 206 `video/mp4` |
| QA-MV-B-20260824 | `a9ee216e-3f1a-4e54-b7bd-144fe2b092d1` | 本人豆包2 | 单一 run / 1 | 提交阶段唯一标识 1 次；页面回显 9:16、10s、Mini | done / completed | 1 个 MP4，`v26-videoweb.doubao.com`，Range 回读 206 `video/mp4` |

终态页面会在“你的视频生成好了”结果卡中再次回显原提示词，因此完成后全页文本可出现两次；这不是第二条用户提交。判定依据为提交阶段即时计数=1、单一 run/attempt/submittedAt、日志各一次 start/complete、无第二次 submitting 记录。

## 自动门禁

- `real-send-recovery + automationEngineLease + videoCapability + taskService`：4 files / 251 pass / 0 fail（R1 后首次执行）。
- R1 全量门禁事实：27 files / 746 pass / 0 fail，类型检查、lint（0 error）、工程边界和构建通过。
- 本次真实验收未触发补丁；源码与开工时相同，仅新增本证据 handoff。

## 证据与纪律

- 截图目录：`D:\项目架构师\evidence\doubao-multi-video-qa-20260824\`。
- 运行数据：`%APPDATA%\doubao-studio-desktop\DoubaoStudioData\tasks.json` 与 `logs.json`；只记录任务 ID、状态和脱敏主机，不在报告保存完整临时 CDN URL。
- 两任务日志均为 start=1、complete=1、pause=0；终态后两个账号回到 idle，无遗留执行锁。
- 未使用其他账号；未改 `.env`、账号 Cookie、生产安装包或受保护运行数据结构；未暂存、未提交、未推送、未打包、未部署。

## 裁决

**PASS**：重复发送整改通过真实双账号并发验证；多视频任务能够独立配置、单次提交、并行生成、分别收敛到完成并产出可访问 MP4。
