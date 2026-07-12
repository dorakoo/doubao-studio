/**
 * tests/unit/videoArtifactIntegration.test.ts
 *
 * 集成级 mock 测试：使用模拟 WebviewHandle 测试 resolveVideoArtifact 的
 * 全局 deadline、取消中止、旧候选拒绝绑定、带 vid 候选成功绑定。
 *
 * 这些测试验证策略编排层的时序与过滤行为，不依赖真实豆包页面。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  resolveVideoArtifact,
  manualResolveVideoArtifact,
} from '../../src/utils/doubaoBridge';
import type { WebviewHandle } from '../../src/utils/doubaoBridge';

// ==================== Mock WebviewHandle ====================

/**
 * 创建一个模拟 WebviewHandle，按注入代码中的特征字符串返回预设值。
 * executeJavaScript 接收一段代码字符串，根据其中包含的关键词返回不同的 mock 响应。
 */
function createMockWebview(responses: {
  cache?: { found: boolean; vid?: string; videoUrl?: string; fieldSource?: string } | null;
  playInfo?: { status: number; data: unknown } | null;
  creationList?: { found: boolean; resourceId: string | null; status: number } | null;
  downloadInfo?: { status: number; data: unknown } | null;
  structuredData?: unknown[] | null;
  domUrls?: string[];
  resultUrl?: string;
}): WebviewHandle {
  const mock: WebviewHandle = {
    executeJavaScript: vi.fn(async (code: string): Promise<unknown> => {
      // 模拟网络延迟
      await new Promise((r) => setTimeout(r, 10));

      // scanConversationStructured — 必须在 __doubaoVideoCache 之前检测
      // （因为 scanConversationStructured 的代码中也包含 '__doubaoVideoCache' 字符串）
      if (code.includes('__NEXT_DATA__') || code.includes('__PRELOADED_STATE__')) {
        return responses.structuredData ?? [];
      }

      // getCachedVideoUrl — 检测 window.__doubaoVideoCache（精确匹配，避免误匹配 globals 数组）
      if (code.includes('window.__doubaoVideoCache')) {
        return responses.cache ?? { found: false };
      }

      // fetchPlayInfoRaw — 检测 get_play_info
      if (code.includes('get_play_info')) {
        if (responses.playInfo === null) return { status: 0, data: null, error: 'timeout' };
        return responses.playInfo;
      }

      // fetchCreationDownloadInfo step 1 — 检测 get_creation_list
      if (code.includes('get_creation_list')) {
        if (responses.creationList === null) return { found: false, resourceId: null, status: 0, error: 'timeout' };
        return responses.creationList;
      }

      // fetchCreationDownloadInfo step 2 — 检测 aispace/get_download_info
      if (code.includes('aispace/get_download_info')) {
        if (responses.downloadInfo === null) return { status: 0, data: null, error: 'timeout' };
        return responses.downloadInfo;
      }

      // scanConversationForVideoUrls — 检测 querySelectorAll('video')
      if (code.includes("querySelectorAll('video')")) {
        return responses.domUrls ?? [];
      }

      // getResultUrl — 检测 JSON.stringify(urls)
      if (code.includes('JSON.stringify(urls)')) {
        return responses.resultUrl ?? '[]';
      }

      return null;
    }),
    loadURL: vi.fn(),
    getURL: vi.fn(() => 'https://www.doubao.com/chat/'),
  };
  return mock;
}

// ==================== 测试 ====================

describe('resolveVideoArtifact 集成测试', () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ---- 1. 带 vid 的候选成功绑定 ----

  it('缓存命中 vid + original_media_info 时成功绑定原始地址', async () => {
    const webview = createMockWebview({
      cache: {
        found: true,
        vid: 'vid_test_001',
        videoUrl: 'https://vod.example.com/video/original.mp4',
        fieldSource: 'original_media_info',
      },
    });

    const result = await resolveVideoArtifact(webview, {
      conversationUrl: 'https://www.doubao.com/chat/?conversation_id=conv1',
      timeoutMs: 5000,
    });

    expect(result.status).toBe('resolved');
    expect(result.url).toBe('https://vod.example.com/video/original.mp4');
    expect(result.vid).toBe('vid_test_001');
  });

  it('缓存命中 vid + play_info（非原始）时成功绑定但标记为非原始', async () => {
    const webview = createMockWebview({
      cache: {
        found: true,
        vid: 'vid_test_002',
        videoUrl: 'https://vod.example.com/video/play_info.mp4',
        fieldSource: 'play_info',
      },
    });

    const result = await resolveVideoArtifact(webview, {
      conversationUrl: 'https://www.doubao.com/chat/?conversation_id=conv1',
      timeoutMs: 5000,
    });

    expect(result.status).toBe('resolved');
    expect(result.url).toBe('https://vod.example.com/video/play_info.mp4');
  });

  // ---- 2. 单个旧候选拒绝绑定 ----

  it('无 vid 且有 conversationUrl 时拒绝单个无 vid 的 page_fallback 候选', async () => {
    const webview = createMockWebview({
      cache: { found: false },
      // 无 play_info/download_info（无 vid 无法调用）
      structuredData: [],
      domUrls: ['https://vod.example.com/video/stale_old_video.mp4'],
      resultUrl: '["https://vod.example.com/video/stale_result.mp4"]',
    });

    const result = await resolveVideoArtifact(webview, {
      conversationUrl: 'https://www.doubao.com/chat/?conversation_id=conv_stale',
      timeoutMs: 5000,
    });

    // 有候选但无法证明归属 → needs_manual_selection
    expect(result.status).toBe('needs_manual_selection');
    expect(result.url).toBeUndefined();
  });

  it('无 vid 且有 conversationUrl 时拒绝单个无 vid 的 conversation_scan 候选', async () => {
    const webview = createMockWebview({
      cache: { found: false },
      structuredData: [
        {
          messages: [
            {
              // 无 vid，仅有 play_info URL（无法证明属于当前会话）
              play_info: {
                main: 'https://vod.example.com/video/scan_no_vid.mp4',
              },
            },
          ],
        },
      ],
    });

    const result = await resolveVideoArtifact(webview, {
      conversationUrl: 'https://www.doubao.com/chat/?conversation_id=conv_scan',
      timeoutMs: 5000,
    });

    expect(result.status).toBe('needs_manual_selection');
    expect(result.url).toBeUndefined();
  });

  // ---- 3. 带 vid 的候选成功绑定（从 conversation_scan 发现 vid） ----

  it('conversation_scan 发现 vid + original_media_info 时成功绑定', async () => {
    const webview = createMockWebview({
      cache: { found: false },
      structuredData: [
        {
          props: {
            pageProps: {
              video: {
                vid: 'vid_from_scan_123',
                original_media_info: {
                  main_url: 'https://vod.example.com/video/scan_orig.mp4',
                },
              },
            },
          },
        },
      ],
    });

    const result = await resolveVideoArtifact(webview, {
      conversationUrl: 'https://www.doubao.com/chat/?conversation_id=conv_scan_ok',
      timeoutMs: 5000,
    });

    expect(result.status).toBe('resolved');
    expect(result.url).toBe('https://vod.example.com/video/scan_orig.mp4');
    expect(result.vid).toBe('vid_from_scan_123');
  });

  // ---- 4. 取消中止 ----

  it('AbortSignal 在策略 1 后取消时停止后续策略', async () => {
    const controller = new AbortController();
    const executeCalls: string[] = [];

    const webview: WebviewHandle = {
      executeJavaScript: vi.fn(async (code: string): Promise<unknown> => {
        // 记录调用顺序
        if (code.includes('__doubaoVideoCache')) executeCalls.push('cache');
        else if (code.includes('get_play_info')) executeCalls.push('play_info');
        else if (code.includes('get_creation_list')) executeCalls.push('creation_list');
        else if (code.includes('get_download_info')) executeCalls.push('download_info');
        else if (code.includes('__NEXT_DATA__')) executeCalls.push('structured');
        else if (code.includes("querySelectorAll('video')")) executeCalls.push('dom_urls');
        else if (code.includes('JSON.stringify(urls)')) executeCalls.push('result_url');
        else executeCalls.push('other');

        await new Promise((r) => setTimeout(r, 10));

        if (code.includes('__doubaoVideoCache')) {
          // 返回有 vid 的缓存，触发后续策略
          return {
            found: true,
            vid: 'vid_cancel_test',
            videoUrl: 'https://vod.example.com/video/cancel.mp4',
            fieldSource: 'original_media_info',
          };
        }
        return null;
      }),
      loadURL: vi.fn(),
      getURL: vi.fn(() => 'https://www.doubao.com/chat/'),
    };

    // 在策略 1 返回后立即取消
    const originalExecute = webview.executeJavaScript;
    webview.executeJavaScript = vi.fn(async (code: string) => {
      const result = await originalExecute(code);
      if (code.includes('__doubaoVideoCache')) {
        // 策略 1 完成后取消
        controller.abort();
      }
      return result;
    });

    const result = await resolveVideoArtifact(webview, {
      conversationUrl: 'https://www.doubao.com/chat/?conversation_id=conv_cancel',
      timeoutMs: 10000,
      signal: controller.signal,
    });

    // 策略 1 应该执行了
    expect(executeCalls).toContain('cache');
    // 后续策略不应执行（因为已取消）
    expect(executeCalls).not.toContain('play_info');
    expect(executeCalls).not.toContain('creation_list');

    // 虽然取消了，但策略 1 已拿到候选，应返回 resolved
    expect(result.status).toBe('resolved');
    expect(result.url).toBe('https://vod.example.com/video/cancel.mp4');
  });

  // ---- 5. 全局 deadline ----

  it('timeoutMs 过短时所有策略在预算内完成或跳过', async () => {
    // 使用极短超时，确保 deadline 机制生效
    const webview = createMockWebview({
      cache: { found: false },
      structuredData: [],
      domUrls: [],
      resultUrl: '[]',
    });

    const start = Date.now();
    const result = await resolveVideoArtifact(webview, {
      timeoutMs: 2000,
    });
    const elapsed = Date.now() - start;

    // 所有策略应在合理时间内完成（即使每步最少 1 秒）
    // 关键是不超过 timeoutMs 的 2 倍（容忍 safeExecuteJS 的 race 开销）
    expect(elapsed).toBeLessThan(5000);
    expect(result.status).toBe('unavailable');
  });

  // ---- 6. manualResolveVideoArtifact 取消 ----

  it('manualResolveVideoArtifact 传入已取消的 signal 时立即返回', async () => {
    const controller = new AbortController();
    controller.abort();

    const webview = createMockWebview({});

    const result = await manualResolveVideoArtifact(webview, {
      conversationUrl: 'https://www.doubao.com/chat/?conversation_id=conv_aborted',
      timeoutMs: 15000,
      signal: controller.signal,
    });

    expect(result.status).toBe('unavailable');
    expect(result.reason).toContain('取消');
    // 不应执行任何 webview 调用
    expect(webview.executeJavaScript).not.toHaveBeenCalled();
  });

  // ---- 7. 创作空间三步解析 ----

  it('创作空间三步解析成功时返回 download_infos 中的地址', async () => {
    const webview = createMockWebview({
      cache: {
        found: true,
        vid: 'vid_aispace_001',
        videoUrl: '', // 缓存无 URL，触发后续策略
        fieldSource: '',
      },
      playInfo: { status: 200, data: { data: {} } }, // play_info 无有效 URL
      creationList: { found: true, resourceId: 'res_001', status: 200 },
      downloadInfo: {
        status: 200,
        data: {
          data: {
            download_infos: [
              { main_url: 'https://vod.example.com/video/aispace_no_wm.mp4' },
            ],
          },
        },
      },
    });

    const result = await resolveVideoArtifact(webview, {
      conversationUrl: 'https://www.doubao.com/chat/?conversation_id=conv_aispace',
      timeoutMs: 10000,
    });

    expect(result.status).toBe('resolved');
    expect(result.url).toBe('https://vod.example.com/video/aispace_no_wm.mp4');
    expect(result.source).toBe('platform_download_info');
  });

  it('创作空间第一步未找到 vid 时返回 null 不影响后续策略', async () => {
    const webview = createMockWebview({
      cache: {
        found: true,
        vid: 'vid_not_in_list',
        videoUrl: '',
        fieldSource: '',
      },
      playInfo: {
        status: 200,
        data: {
          data: {
            original_media_info: {
              main_url: 'https://vod.example.com/video/from_play_info.mp4',
            },
          },
        },
      },
      creationList: { found: false, resourceId: null, status: 200 },
    });

    const result = await resolveVideoArtifact(webview, {
      conversationUrl: 'https://www.doubao.com/chat/?conversation_id=conv_fallback',
      timeoutMs: 10000,
    });

    // 创作空间失败，但 play_info 成功 → 仍应 resolved
    expect(result.status).toBe('resolved');
    expect(result.url).toBe('https://vod.example.com/video/from_play_info.mp4');
    expect(result.source).toBe('play_info');
  });

  // ---- 8. 扫描仅得到 vid 后回补 API 策略 ----

  it('扫描仅得到 vid（无 URL）后回补 play_info 成功解析', async () => {
    const webview = createMockWebview({
      cache: { found: false },
      playInfo: {
        status: 200,
        data: {
          data: {
            original_media_info: {
              main_url: 'https://vod.example.com/video/scan_vid_retry.mp4',
            },
          },
        },
      },
      structuredData: [
        {
          props: {
            pageProps: {
              video: {
                // 只有 vid，没有 original_media_info / play_info 等 URL 字段
                vid: 'vid_scan_only_001',
              },
            },
          },
        },
      ],
      domUrls: [],
      resultUrl: '[]',
    });

    const result = await resolveVideoArtifact(webview, {
      conversationUrl: 'https://www.doubao.com/chat/?conversation_id=conv_vid_only',
      timeoutMs: 10000,
    });

    expect(result.status).toBe('resolved');
    expect(result.url).toBe('https://vod.example.com/video/scan_vid_retry.mp4');
    expect(result.source).toBe('play_info');
    expect(result.vid).toBe('vid_scan_only_001');

    // play_info 必须被调用过（仅在回补阶段，因为初始无 vid 时被跳过）
    const playInfoCalls = (webview.executeJavaScript as ReturnType<typeof vi.fn>).mock.calls.filter(
      (args: unknown[]) => typeof args[0] === 'string' && (args[0] as string).includes('get_play_info'),
    );
    expect(playInfoCalls.length).toBeGreaterThan(0);
  });

  it('扫描仅得到 vid 后回补 platform_download_info 成功解析', async () => {
    const webview = createMockWebview({
      cache: { found: false },
      // play_info 回补时返回空数据（无有效 URL）
      playInfo: { status: 200, data: { data: {} } },
      creationList: { found: true, resourceId: 'res_retry_002', status: 200 },
      downloadInfo: {
        status: 200,
        data: {
          data: {
            download_infos: [
              { main_url: 'https://vod.example.com/video/scan_vid_retry_dl.mp4' },
            ],
          },
        },
      },
      structuredData: [
        {
          props: {
            pageProps: {
              video: {
                vid: 'vid_scan_only_002',
              },
            },
          },
        },
      ],
      domUrls: [],
      resultUrl: '[]',
    });

    const result = await resolveVideoArtifact(webview, {
      conversationUrl: 'https://www.doubao.com/chat/?conversation_id=conv_vid_only_002',
      timeoutMs: 10000,
    });

    expect(result.status).toBe('resolved');
    expect(result.url).toBe('https://vod.example.com/video/scan_vid_retry_dl.mp4');
    expect(result.source).toBe('platform_download_info');
    expect(result.vid).toBe('vid_scan_only_002');
  });

  // ---- 9. fetch 进行中取消时立即返回 ----

  it('fetch 请求进行中 signal.abort() 时立即返回，不等待自身超时', async () => {
    const controller = new AbortController();

    const webview: WebviewHandle = {
      executeJavaScript: vi.fn(async (code: string): Promise<unknown> => {
        // 缓存返回 vid 但无 URL，触发 play_info 策略
        if (code.includes('__doubaoVideoCache')) {
          return {
            found: true,
            vid: 'vid_abort_inflight_001',
            videoUrl: '',
            fieldSource: '',
          };
        }
        // play_info 模拟长时间网络请求（5 秒后才返回）
        if (code.includes('get_play_info')) {
          await new Promise((r) => setTimeout(r, 5000));
          return { status: 200, data: { data: {} } };
        }
        return null;
      }),
      loadURL: vi.fn(),
      getURL: vi.fn(() => 'https://www.doubao.com/chat/'),
    };

    // 100ms 后取消（模拟用户在请求等待期间点击取消）
    setTimeout(() => controller.abort(), 100);

    const start = Date.now();
    const result = await resolveVideoArtifact(webview, {
      conversationUrl: 'https://www.doubao.com/chat/?conversation_id=conv_abort_inflight',
      timeoutMs: 15000,
      signal: controller.signal,
    });
    const elapsed = Date.now() - start;

    // 应在取消后很快返回（~100ms + 开销），绝不应等待 play_info 的 5 秒
    expect(elapsed).toBeLessThan(2000);
    // 未获取到有效候选
    expect(result.status).toBe('unavailable');
  });
});
