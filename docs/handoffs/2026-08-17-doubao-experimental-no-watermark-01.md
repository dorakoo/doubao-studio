# DOUBAO-EXPERIMENTAL-NO-WATERMARK-01（2026-08-17）——已合并 main `e78fea6`

- 状态：实现 + 13 项专项 + CI validate PASS + 合并 main；**未打包发布**。
- 授权：用户明确（非会员 + 知情接受绕过方案）；治理偏离记录：本包为**用户授权下的对抗性实验功能**，与 8-13 热修「禁止 URL 参数伪装」裁决冲突——偏离范围仅限本实验开关，官方链路纪律不变。

## 变更

- `src/utils/experimentalNoWatermark.ts`（新）：实验开关（localStorage，**默认关闭**，storage 异常防御）；`collectExperimentalUrls` 深度候选扫描（no_watermark_url/download_url/main_url/嵌套/数组）；`rewriteLrParam`（lr→video_gen_no_watermark 参数改写）；`tryExperimentalDirectExtract`（页面上下文无条件读 `get_without_watermark` + `get_play_info` 原始响应，不检查 without_watermark）。
- `src/utils/doubaoBridge.ts`：`ResolveVideoArtifactContext` 增 `experimentalNoWatermark`；新增策略 6（实验）：官方授权失败后执行；`selectBestCandidate` 官方候选为空且开关开启时以 experimental 候选兜底；失败原因标注「实验直取未获得可验证源文件（实验模式，可能仍含水印）」。
- `src/utils/videoArtifactResolver.ts`：`VideoArtifactSource` 增 `'experimental'`（SOURCE_PRIORITY=5 最低信任）。
- `src/components/BrowserPanel.tsx`：工具栏「实验直取」Switch（默认关；开启需 Modal 二次风险确认；开启后 message.warning 强提示）；**仅手动提取生效**（`manualResolveVideoArtifact` 传开关），自动任务不受影响；提取结果来源标注「实验直取（未经官方授权）」。

## 门禁

- 专项 13 项（开关/深度扫描/参数改写/直取提取/集成 fail-closed 与回退）；全量 730/730；ts-check 0；lint 0；build 0；CI validate PASS。

## 风险声明（已告知用户，如实登记）

- 可能违反豆包服务条款、触发账号风控；8-13 热修已验证参数伪装对当前平台可能无效（水印为服务端渲染）——实验通道**不保证无水印**。
- 默认关闭；开启仅影响手动提取；未打包发布。

## 使用方式

1. 豆包工作室（需 `pnpm run build` 后运行或 dev 模式）：浏览器工具栏「提取官方无水印视频」按钮旁切换「实验直取」开关（二次确认）。
2. 开启后手动提取：官方 `without_watermark=false` 时自动尝试实验通道（官方接口原始响应 + 参数改写候选）。
3. 提取结果来源显示「实验直取（未经官方授权）」；若无可验证源文件，提示实验直取未获得源文件。

## 未处理事项

- 未打包发布（`pnpm run dist:win` 未执行，用户未要求）。
- 实验通道效果依赖豆包接口行为，接口变化后可能失效；维护为实验性质。
