# DOUBAO-WATERMARK-HOTFIX-01 交接报告

## 治理与冻结验收包

已读取总架构师治理规则、项目 `AGENTS.md`、项目路线与最新豆包交接文档。

- P0-1：复现去水印失败并定位链路
- P0-2：只接受豆包平台明确证明的无水印地址
- P0-3：热更新后以真实历史视频复验

未生成新内容、未购买会员、未消耗额度、未使用第三方去水印服务、未裁剪或覆盖水印、未读取或输出凭据。

## 根因

1. 新播放器不再渲染 `<video>`，`vid` 位于视频卡片 React Fiber 的 `video` props，旧 DOM 扫描无法稳定取得。
2. `/samantha/media/get_play_info` 的 `original_media_info` 是源媒体信息，不代表无水印。旧实现把它标记为无水印，导致下载成功但画面仍出现“豆包AI生成”。
3. 豆包网页当前权威接口是 `POST /creativity/resource/get_without_watermark`。只有业务成功、`without_watermark=true` 且 `download_video[vid].download_url` 有效时，才可确认官方无水印下载可用。

## 修复

- 从最多 20 个当前视频卡片、最多 12 层 React Fiber 中只读提取 `vid`、`creation_task_id`、`message_id`。
- 手动去水印入口强制 `requireWithoutWatermark=true`。
- 新增官方无水印接口请求；只接受明确的 `without_watermark=true`。
- `without_watermark=false` 时 fail-closed，不回退 `play_info`、SSE 缓存、DOM 或查询参数改写。
- `play_info.original_media_info`、缓存 `original_media_info/download_url` 及页面结构化字段均不再视为无水印授权。
- 下载 URL 保持平台原值，删除 `lr=video_gen_no_watermark` 参数伪装。
- UI 明确说明只下载豆包官方开放的无水印视频。

## 自动化门禁

- 媒体专项：113 pass / 0 fail
- 独立候选全量：491 pass / 0 fail（15 files）
- TypeScript：通过
- 工程结构与 contracts 边界：通过
- Build：通过
- 修改文件 ESLint：0 error（既有 warnings 未扩项清理）
- `git diff --check`：通过

## 真实历史视频复验

- 会话：`https://www.doubao.com/chat/38437390431449858`
- 页面 vid：成功识别
- 官方响应：HTTP 200、业务 code 0、`without_watermark=false`
- UI：显示“豆包官方未向当前账号或该视频开放无水印下载”
- 下载目录：无新增文件
- Seedance 预计额度：10 → 10，未记账
- 未发送生成、未点击套餐、未购买会员

## 裁决

热修 PASS：旧的“带水印视频被误报为去水印成功”已修复。当前账号/历史视频无法得到无水印文件，是豆包官方明确关闭该能力，不是本地下载故障；应用现已正确拒绝并说明原因。

失败证据 `watermar_1.mp4` 保留在用户下载目录，未擅自删除。三张本任务抽帧仍位于未跟踪目录 `.codex-watermark-check/`，不会进入候选提交。本报告随单一候选提交交付；未推送。
