# G-304 交接报告：视频原始产物解析与授权下载链路增强

**任务 ID**: G-304  
**分支**: `glm/g-304-video-artifact-resolution`  
**基线 SHA**: `64d263642e477def0a5de43394f830b85db6914b`  
**日期**: 2026-07-12  

---

## 修改文件清单

| 文件 | 类型 | 说明 |
|------|------|------|
| `src/utils/videoArtifactResolver.ts` | 新增 | 视频产物解析纯函数模块（不依赖 DOM/React/Electron） |
| `src/utils/doubaoBridge.ts` | 修改 | 新增 `resolveVideoArtifact`、`manualResolveVideoArtifact` 及 5 个策略辅助函数 |
| `src/components/BrowserPanel.tsx` | 修改 | 自动/手动提取改用结构化解析器，传递 AbortSignal |
| `src/components/TaskConsole.tsx` | 修改 | 手动提取按钮增加 `conversationUrl` 存在性检查 |
| `main/utils/downloadValidation.ts` | 新增 | 下载验证与错误分类工具（主进程侧） |
| `main/ipc/tasks.ts` | 修改 | 下载处理器增加 content-type 校验和结构化失败分类 |
| `tests/unit/videoArtifactResolver.test.ts` | 新增 | 82 条测试覆盖响应解析、候选排序、URL 可信度、错误分类、会话匹配 |
| `tests/unit/downloadValidation.test.ts` | 新增 | 18 条测试覆盖下载验证和异常分类 |

---

## 解析策略与回退顺序

`resolveVideoArtifact` 按以下优先级依次尝试，每层独立捕获错误，失败不影响下一层：

| 优先级 | 策略 | 来源标记 | 原始性 | 说明 |
|--------|------|----------|--------|------|
| 1 | `captured_response` | SSE 响应缓存 | ✅ 原始 | 从 `inject15sVideoPatch` 拦截的生成响应中提取 `original_media_info` |
| 2 | `play_info` | `get_play_info` 接口 | ✅ 原始（有 `original_media_info`/`download_url`/`no_watermark_url` 时） | 以 `vid` 调用播放信息接口 |
| 3 | `platform_download_info` | `get_download_info` 接口 | ✅ 原始 | 创作空间下载信息接口回退 |
| 4 | `conversation_scan` | 页面结构化数据 + DOM | 视情况 | 扫描 `__NEXT_DATA__`、全局变量、`script[type="application/json"]` 及 `<video>`/`<a>` 标签 |
| 5 | `page_fallback` | 普通 DOM 结果 URL | ❌ 非原始 | 最后回退，明确标记为非原始地址 |

**关键原则**：只有平台响应明确给出的 `original_media_info`、`download_url`、`no_watermark_url` 字段才标记为原始地址。URL 参数替换（如 `lr=`）不视为取得原始产物。

---

## 结构化返回类型

```typescript
interface VideoArtifactResolution {
  status: 'resolved' | 'unavailable' | 'expired' | 'unauthorized' | 'retryable_error' | 'needs_manual_selection';
  url?: string;
  source?: 'platform_download_info' | 'play_info' | 'captured_response' | 'conversation_scan' | 'page_fallback';
  vid?: string;
  reason?: string;
  attempts: ArtifactAttempt[];
}
```

---

## 下载信息链路保护

1. **不硬编码用户标识**：`device_id` 通过 `sessionStorage` 动态生成并复用，不硬编码任何用户 Cookie、设备 ID 或账号标识。
2. **形状校验**：所有接口响应通过纯函数（`parsePlayInfoResponse`、`parseDownloadInfoResponse`、`parseCapturedResponse`）做形状校验，字段变化不抛出未捕获异常。
3. **短超时**：单次解析默认 12s 超时；手动提取默认 15s 超时；每个策略独立 `safeExecuteJS` 超时保护。
4. **独立错误捕获**：每个策略独立 `try/catch`，错误记录到 `attempts` 数组但不中断后续策略。
5. **取消支持**：`ResolveVideoArtifactContext.signal` 接受 `AbortSignal`，取消后各策略跳过，`manualResolveVideoArtifact` 在轮间检查取消。
6. **错误分类**：`classifyVideoResolutionError` 对 401/403（未授权）、404/410（过期）、429/5xx（可重试）、业务码（登录失效、额度限制、产物过期）分别返回可识别状态。
7. **有限重试**：手动提取最多 3 轮，不可重试状态（`unauthorized`/`expired`/`needs_manual_selection`）立即返回。
8. **UI 反馈**：`formatResolutionMessage` 将解析来源和失败原因转换为用户可读消息。

---

## 产物绑定准确性

1. **会话 URL 传递**：`extractVideoOutputs` 使用 `webview.getURL()` 作为 `conversationUrl`；手动提取使用 `task.runtime.conversationUrl`。
2. **候选过滤**：`filterCandidatesByContext` 按 `vid` 过滤候选，`vid` 不匹配时保留无 `vid` 标记的候选。
3. **多候选处理**：多个原始地址候选且无 `vid` 时返回 `needs_manual_selection`，不静默取第一个。
4. **手动提取可用性**：`canManualExtractVideo` 要求 `task.runtime.conversationUrl` 存在，覆盖已完成、失败、暂停、取消状态。
5. **会话导航**：手动提取时若 webview 不在任务对话页面，先 `loadURL(conversationUrl)` 再解析。

---

## 下载队列增强

1. **Session 请求**：继续通过任务所属账号的 `session.fromPartition` 请求，保留 `Referer: https://www.doubao.com/`。
2. **媒体校验**：`validateDownloadResponse` 校验 HTTP 状态（2xx）、非空文件、视频模式 content-type（`video/`、`octet-stream`、`binary/`）。
3. **失败分类**：`classifyDownloadException` 将异常分类为 `http_error`/`empty_file`/`invalid_content`/`network_error`/`disk_error`/`unknown`。
4. **诊断包脱敏**：`exportDiagnostics` 已将下载 URL 脱敏为 `[已脱敏]`，不暴露签名 URL 或内部请求详情。

---

## 测试矩阵

| 测试文件 | 测试数 | 覆盖范围 |
|----------|--------|----------|
| `videoArtifactResolver.test.ts` | 82 | 响应解析（原始/非原始/缺失/畸形）、候选排序、URL 可信度、错误分类（401/403/404/410/429/500/业务码）、会话匹配、候选过滤、下载错误分类 |
| `downloadValidation.test.ts` | 18 | 下载响应验证（HTTP/空文件/content-type）、异常分类（超时/断连/磁盘/未知） |
| **新增合计** | **100** | |
| **项目总计** | **192** | 含原有 92 条测试 |

### Fixture 覆盖

- ✅ 原始媒体字段存在（`original_media_info.main_url`/`main`/`download_url`/`no_watermark_url`）
- ✅ 仅 `play_info`（非原始）
- ✅ 仅创作空间下载信息（`download_url`/`download_url_list`/`main_url`）
- ✅ vid 缺失
- ✅ 多个候选（排序 + 过滤）
- ✅ 401/403（未授权）
- ✅ 过期（404/410/业务码）
- ✅ 畸形 JSON（非视频 URL 被忽略）
- ✅ 会话不匹配（不同 `conversation_id`）
- ✅ 空文件
- ✅ 非视频 content-type
- ✅ 网络超时/断连/磁盘错误

---

## 验证结果

| 检查项 | 结果 |
|--------|------|
| `pnpm run ts-check` | ✅ 通过（主进程 + 渲染进程 + 测试） |
| `pnpm run lint` | ✅ 通过（149 warnings 上限内） |
| `pnpm run check:project` | ✅ 通过（7/7 fixtures, 5 关键文件, 49 通道） |
| `pnpm run test` | ✅ 通过（192/192 tests, 9 files） |
| `pnpm run build` | ✅ 通过（renderer + main） |
| `git diff --check` | ✅ 通过（无空白错误） |

---

## 未验证的真实页面假设

以下假设基于豆包页面结构的合理推断，未在真实环境中验证：

1. **`get_download_info` 接口路径**：假设为 `/samantha/media/get_download_info`，与 `get_play_info` 同前缀。实际路径可能不同。
2. **`original_media_info` 字段路径**：假设 `get_play_info` 和 `get_download_info` 响应中 `data.original_media_info.main_url` 包含原始无水印地址。
3. **`__NEXT_DATA__` 存在性**：假设豆包页面使用 Next.js 且有 `__NEXT_DATA__` script 标签。实际可能使用其他框架。
4. **`download_url_list` 字段名**：假设创作空间下载信息接口返回 `download_url_list` 数组。实际字段名可能不同。
5. **`sessionStorage` 可用性**：假设 webview 上下文中 `sessionStorage` 可用且持久。
6. **API 参数格式**：`version_code`、`aid`、`device_platform` 等参数基于现有 `getVideoPlayUrl` 的实现，未验证 `get_download_info` 是否需要相同参数。

---

## 与 GPL 参考项目的独立实现说明

本实现完全独立于外部 GPL-3.0 参考仓库 `yht-cdd/doubao-seedance-15s`：

1. **未复制任何代码**：未复制该仓库的源码、正则表达式、注释或大段结构。
2. **独立设计**：解析策略、类型系统、错误分类、候选排序均为本项目独立设计。
3. **行为参考**：仅参考了"从 Thread 页面解析视频数据"和"通过创作空间下载信息接口获取下载地址"的行为思路。
4. **纯函数架构**：所有可测试逻辑抽取为纯函数（`videoArtifactResolver.ts`），与 DOM/Electron 运行时完全解耦。
5. **许可证兼容**：本项目为 MIT 许可证，未引入任何 GPL 代码或依赖。

---

## 提交信息

**建议提交信息**：`feat(video): strengthen artifact resolution fallback`

**当前状态**：改动尚未提交（工作区有 4 个修改文件 + 4 个新增文件）。按照任务要求，不修改版本号、不创建 Tag/Release、不推送、不合并。
