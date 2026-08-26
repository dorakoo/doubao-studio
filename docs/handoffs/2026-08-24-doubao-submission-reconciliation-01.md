# DOUBAO-SUBMISSION-RECONCILIATION-01 交付记录

- 日期：2026-08-24
- 工作树：`D:\豆包工作室\doubao-automation-closeout-01`
- 分支：`codex/doubao-automation-closeout-01`
- 基线/当前 HEAD：`346b4049b15232052fd893c415e4c32e39cb0aa4`（未提交）
- 治理：已读取中央治理规则与本仓 `AGENTS.md`；本包冻结为发送按钮统一、已提交重试门禁、只读核对恢复三个 P0。

## 根因与修复

1. 注入阶段的按钮检查与实际点击使用不同定位器，且“找不到按钮”被放行；现统一使用同一个 composer 内强证据定位器，找不到即 fail-closed。
2. 旧任务虽已有 `runtime.submittedAt`，仍可普通 retry 并清除运行快照；Core 与 UI 现统一禁止重新发送，旧 `cancelled` 文案也兼容识别。
3. 新增“核对平台结果（不重新发送）”：只读打开原账号/原会话，匹配提示词稳定前缀与平台回执，解析视频卡片并恢复台账；整个路径没有注入、点击发送或 Enter。
4. 新豆包播放器把 `video.vid` 移到父级 DOM 的 React props children；结构化扫描增加受限递归读取，发现 vid 后仍走既有平台媒体接口。

## 真实 C01-A 验收

- task：`02862027-f605-47d5-bf18-96eead3d3e7c`
- 原 runId：`02862027-f605-47d5-bf18-96eead3d3e7c-1787571637608`（未变化）
- submittedAt：`2026-08-24T11:41:00.458Z`（未变化）
- 原会话：`https://www.doubao.com/chat/38438661029880834`
- 平台回读：同时存在“视频生成已提交”和“你的视频生成好了”。
- 最终台账：`done`、1 个 output、1 个 artifact、runHistory 仍为 1。
- B/C/D：全部保持 `queued`、未指派、无 output。
- 额度：本人豆包 `usedUnits 2 → 3`，仅记录 C01-A 一个 5 秒单位；再次派发核对事件后仍为 3。
- 产物 URL 为平台实际返回的 `video_gen_watermark_unpaid` 媒体地址；本包不改写水印参数。

## 测试与门禁

- 专项：real-send + TaskService 205 pass。
- 视频解析专项：videoArtifactIntegration 15 pass；videoArtifactResolver 98 pass。
- 最终全量：34 files / 812 pass，TypeScript、工程检查、Renderer/Main build 通过。
- 修改文件 ESLint：0 error；`git diff --check`：通过。

## 纪律

- 未提交、未推送、未创建或修改 PR、未打包、未部署。
- 未再次提交 C01-A，未启动 B/C/D，未触碰未授权账号、凭据或外部发布。
- 工作树原有组合候选保留；未清理或覆盖未知改动。
