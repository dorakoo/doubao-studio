/**
 * tests/unit/videoArtifactResolver.test.ts
 * 视频产物解析纯函数回归测试矩阵
 *
 * 覆盖 fixture：
 * - 原始媒体字段存在
 * - 仅 play_info
 * - 仅创作空间下载信息
 * - vid 缺失
 * - 多个候选
 * - 401/403（未授权）
 * - 过期
 * - 畸形 JSON
 * - 会话不匹配
 */

import { describe, it, expect } from 'vitest';
import {
  parsePlayInfoResponse,
  parseDownloadInfoResponse,
  parseCapturedResponse,
  parseConversationScanData,
  sortCandidatesByTrust,
  filterCandidatesByContext,
  isSameConversation,
  isValidVideoUrl,
  isOriginalMediaUrl,
  classifyVideoResolutionError,
  classifyDownloadError,
  createFailedResolution,
  createResolvedResolution,
} from '../../src/utils/videoArtifactResolver';
import type { VideoCandidate } from '../../src/utils/videoArtifactResolver';

// ==================== parsePlayInfoResponse ====================

describe('parsePlayInfoResponse', () => {
  it('解析 original_media_info.main_url（原始地址）', () => {
    const raw = {
      data: {
        original_media_info: {
          main_url: 'https://vod.example.com/video/original123.mp4',
        },
      },
    };
    const result = parsePlayInfoResponse(raw);
    expect(result).not.toBeNull();
    expect(result!.url).toBe('https://vod.example.com/video/original123.mp4');
    expect(result!.source).toBe('play_info');
    expect(result!.isOriginal).toBe(true);
  });

  it('解析 original_media_info.main（原始地址）', () => {
    const raw = {
      data: {
        original_media_info: {
          main: 'https://vod.example.com/video/main456.mp4',
        },
      },
    };
    const result = parsePlayInfoResponse(raw);
    expect(result).not.toBeNull();
    expect(result!.url).toBe('https://vod.example.com/video/main456.mp4');
    expect(result!.isOriginal).toBe(true);
  });

  it('解析 download_url（原始地址）', () => {
    const raw = {
      data: {
        download_url: 'https://vod.example.com/video/download789.mp4',
      },
    };
    const result = parsePlayInfoResponse(raw);
    expect(result).not.toBeNull();
    expect(result!.url).toBe('https://vod.example.com/video/download789.mp4');
    expect(result!.isOriginal).toBe(true);
  });

  it('解析 no_watermark_url（原始地址）', () => {
    const raw = {
      data: {
        no_watermark_url: 'https://vod.example.com/video/nowm012.mp4',
      },
    };
    const result = parsePlayInfoResponse(raw);
    expect(result).not.toBeNull();
    expect(result!.isOriginal).toBe(true);
  });

  it('仅 play_info.main（非原始地址）', () => {
    const raw = {
      data: {
        play_info: {
          main: 'https://vod.example.com/video/play345.mp4',
        },
      },
    };
    const result = parsePlayInfoResponse(raw);
    expect(result).not.toBeNull();
    expect(result!.url).toBe('https://vod.example.com/video/play345.mp4');
    expect(result!.isOriginal).toBe(false);
  });

  it('仅 play_infos[0].main（非原始地址）', () => {
    const raw = {
      data: {
        play_infos: [
          { main: 'https://vod.example.com/video/playinfos678.mp4' },
        ],
      },
    };
    const result = parsePlayInfoResponse(raw);
    expect(result).not.toBeNull();
    expect(result!.url).toBe('https://vod.example.com/video/playinfos678.mp4');
    expect(result!.isOriginal).toBe(false);
  });

  it('深度搜索找到嵌套视频 URL', () => {
    const raw = {
      data: {
        nested: {
          deep: {
            url: 'https://tos-example.byteoss.com/video/deep901.mp4',
          },
        },
      },
    };
    const result = parsePlayInfoResponse(raw);
    expect(result).not.toBeNull();
    expect(result!.url).toBe('https://tos-example.byteoss.com/video/deep901.mp4');
  });

  it('null 输入返回 null', () => {
    expect(parsePlayInfoResponse(null)).toBeNull();
  });

  it('非对象输入返回 null', () => {
    expect(parsePlayInfoResponse('string')).toBeNull();
    expect(parsePlayInfoResponse(42)).toBeNull();
  });

  it('无 data 字段返回 null', () => {
    expect(parsePlayInfoResponse({ code: 0 })).toBeNull();
  });

  it('data 中无视频 URL 返回 null', () => {
    const raw = { data: { message: 'no video here' } };
    expect(parsePlayInfoResponse(raw)).toBeNull();
  });

  it('畸形 JSON（非视频 URL 被忽略）', () => {
    const raw = { data: { url: 'https://example.com/page.html' } };
    expect(parsePlayInfoResponse(raw)).toBeNull();
  });
});

// ==================== parseDownloadInfoResponse ====================

describe('parseDownloadInfoResponse', () => {
  it('解析 download_url（原始地址）', () => {
    const raw = {
      data: {
        download_url: 'https://vod.example.com/video/dl111.mp4',
      },
    };
    const result = parseDownloadInfoResponse(raw);
    expect(result).not.toBeNull();
    expect(result!.url).toBe('https://vod.example.com/video/dl111.mp4');
    expect(result!.source).toBe('platform_download_info');
    expect(result!.isOriginal).toBe(true);
  });

  it('解析 download_url_list 中的字符串项', () => {
    const raw = {
      data: {
        download_url_list: [
          'https://vod.example.com/video/list222.mp4',
        ],
      },
    };
    const result = parseDownloadInfoResponse(raw);
    expect(result).not.toBeNull();
    expect(result!.url).toBe('https://vod.example.com/video/list222.mp4');
  });

  it('解析 download_url_list 中的对象项', () => {
    const raw = {
      data: {
        download_url_list: [
          { url: 'https://vod.example.com/video/obj333.mp4' },
        ],
      },
    };
    const result = parseDownloadInfoResponse(raw);
    expect(result).not.toBeNull();
    expect(result!.url).toBe('https://vod.example.com/video/obj333.mp4');
  });

  it('解析 original_media_info', () => {
    const raw = {
      data: {
        original_media_info: {
          main_url: 'https://vod.example.com/video/orig444.mp4',
        },
      },
    };
    const result = parseDownloadInfoResponse(raw);
    expect(result).not.toBeNull();
    expect(result!.isOriginal).toBe(true);
  });

  it('解析 main_url', () => {
    const raw = {
      data: {
        main_url: 'https://vod.example.com/video/main555.mp4',
      },
    };
    const result = parseDownloadInfoResponse(raw);
    expect(result).not.toBeNull();
    expect(result!.url).toBe('https://vod.example.com/video/main555.mp4');
  });

  it('null 输入返回 null', () => {
    expect(parseDownloadInfoResponse(null)).toBeNull();
  });

  it('无 data 字段返回 null', () => {
    expect(parseDownloadInfoResponse({ status: 'ok' })).toBeNull();
  });

  // ---- P1-1 回归：download_infos[].main_url ----

  it('P1-1: 解析 download_infos[].main_url（创作空间 aispace 结构）', () => {
    const raw = {
      data: {
        download_infos: [
          { main_url: 'https://vod.example.com/video/aispace_dl.mp4' },
        ],
      },
    };
    const result = parseDownloadInfoResponse(raw);
    expect(result).not.toBeNull();
    expect(result!.url).toBe('https://vod.example.com/video/aispace_dl.mp4');
    expect(result!.source).toBe('platform_download_info');
    expect(result!.isOriginal).toBe(true);
  });

  it('P1-1: download_infos 中的字符串项', () => {
    const raw = {
      data: {
        download_infos: [
          'https://vod.example.com/video/aispace_str.mp4',
        ],
      },
    };
    const result = parseDownloadInfoResponse(raw);
    expect(result).not.toBeNull();
    expect(result!.url).toBe('https://vod.example.com/video/aispace_str.mp4');
  });

  it('P1-1: download_infos 中多个项取第一个有效', () => {
    const raw = {
      data: {
        download_infos: [
          { main_url: 'https://vod.example.com/video/first.mp4' },
          { main_url: 'https://vod.example.com/video/second.mp4' },
        ],
      },
    };
    const result = parseDownloadInfoResponse(raw);
    expect(result).not.toBeNull();
    expect(result!.url).toBe('https://vod.example.com/video/first.mp4');
  });

  it('P1-1: download_infos 为空数组时回退到其他字段', () => {
    const raw = {
      data: {
        download_infos: [],
        download_url: 'https://vod.example.com/video/fallback.mp4',
      },
    };
    const result = parseDownloadInfoResponse(raw);
    expect(result).not.toBeNull();
    expect(result!.url).toBe('https://vod.example.com/video/fallback.mp4');
  });
});

// ==================== parseCapturedResponse ====================

describe('parseCapturedResponse', () => {
  it('解析 original_media_info 并提取 vid', () => {
    const raw = {
      original_media_info: {
        main_url: 'https://vod.example.com/video/cap666.mp4',
      },
      vid: 'v1234567890abcdef',
    };
    const result = parseCapturedResponse(raw);
    expect(result).not.toBeNull();
    expect(result!.url).toBe('https://vod.example.com/video/cap666.mp4');
    expect(result!.isOriginal).toBe(true);
    expect(result!.vid).toBe('v1234567890abcdef');
  });

  it('解析 play_info（非原始）', () => {
    const raw = {
      play_info: {
        main: 'https://vod.example.com/video/capplay777.mp4',
      },
    };
    const result = parseCapturedResponse(raw);
    expect(result).not.toBeNull();
    expect(result!.isOriginal).toBe(false);
  });

  it('解析 download_url', () => {
    const raw = {
      download_url: 'https://vod.example.com/video/capdl888.mp4',
    };
    const result = parseCapturedResponse(raw);
    expect(result).not.toBeNull();
    expect(result!.isOriginal).toBe(true);
  });

  it('null 输入返回 null', () => {
    expect(parseCapturedResponse(null)).toBeNull();
  });

  it('空对象返回 null', () => {
    expect(parseCapturedResponse({})).toBeNull();
  });
});

// ==================== parseConversationScanData ====================

describe('parseConversationScanData', () => {
  it('从结构化数据中提取 vid 和视频地址', () => {
    const raw = {
      props: {
        pageProps: {
          video: {
            vid: 'conv_vid_1234567890',
            original_media_info: {
              main_url: 'https://vod.example.com/video/conv999.mp4',
            },
          },
        },
      },
    };
    const result = parseConversationScanData(raw);
    expect(result.vid).toBe('conv_vid_1234567890');
    expect(result.candidates.length).toBeGreaterThan(0);
    expect(result.candidates[0].url).toBe('https://vod.example.com/video/conv999.mp4');
    expect(result.candidates[0].source).toBe('conversation_scan');
  });

  it('无 vid 时返回 undefined', () => {
    const raw = { data: { message: 'no vid here' } };
    const result = parseConversationScanData(raw);
    expect(result.vid).toBeUndefined();
  });

  it('null 输入返回空候选列表', () => {
    const result = parseConversationScanData(null);
    expect(result.candidates).toEqual([]);
    expect(result.vid).toBeUndefined();
  });

  // ---- P1-5 回归：URL 与 original_media_info 必须同一对象 ----

  it('P1-5: URL 与 original_media_info 属于同一对象时标记为原始', () => {
    const raw = {
      messages: [
        {
          vid: 'vid_msg_001',
          original_media_info: {
            main_url: 'https://vod.example.com/video/orig_msg1.mp4',
          },
        },
        {
          vid: 'vid_msg_002',
          play_info: {
            main: 'https://vod.example.com/video/play_msg2.mp4',
          },
        },
      ],
    };
    const result = parseConversationScanData(raw);
    const original = result.candidates.find(c => c.url.includes('orig_msg1'));
    const nonOriginal = result.candidates.find(c => c.url.includes('play_msg2'));
    expect(original).toBeDefined();
    expect(original!.isOriginal).toBe(true);
    expect(nonOriginal).toBeDefined();
    expect(nonOriginal!.isOriginal).toBe(false);
  });

  it('P1-5: 不会把 B 对象的 URL 标记为原始仅因 A 对象有 original_media_info', () => {
    const raw = {
      msgA: {
        vid: 'vid_a',
        original_media_info: {
          main_url: 'https://vod.example.com/video/orig_a.mp4',
        },
      },
      msgB: {
        vid: 'vid_b',
        play_info: {
          main: 'https://vod.example.com/video/play_b.mp4',
        },
      },
    };
    const result = parseConversationScanData(raw);
    const playB = result.candidates.find(c => c.url.includes('play_b'));
    expect(playB).toBeDefined();
    expect(playB!.isOriginal).toBe(false);
  });

  it('P1-5: download_url 字段直接作为字符串时标记为原始', () => {
    const raw = {
      item: {
        vid: 'vid_dl_test',
        download_url: 'https://vod.example.com/video/direct_dl.mp4',
      },
    };
    const result = parseConversationScanData(raw);
    const dl = result.candidates.find(c => c.url.includes('direct_dl'));
    expect(dl).toBeDefined();
    expect(dl!.isOriginal).toBe(true);
  });

  it('P1-5: no_watermark_url 字段标记为原始', () => {
    const raw = {
      item: {
        vid: 'vid_nowm_test',
        no_watermark_url: 'https://vod.example.com/video/nowm.mp4',
      },
    };
    const result = parseConversationScanData(raw);
    const nowm = result.candidates.find(c => c.url.includes('nowm'));
    expect(nowm).toBeDefined();
    expect(nowm!.isOriginal).toBe(true);
  });
});

// ==================== sortCandidatesByTrust ====================

describe('sortCandidatesByTrust', () => {
  it('原始地址优先于非原始地址', () => {
    const candidates: VideoCandidate[] = [
      { url: 'https://vod.example.com/page.mp4', source: 'page_fallback', isOriginal: false },
      { url: 'https://vod.example.com/orig.mp4', source: 'platform_download_info', isOriginal: true },
    ];
    const sorted = sortCandidatesByTrust(candidates);
    expect(sorted[0].isOriginal).toBe(true);
    expect(sorted[1].isOriginal).toBe(false);
  });

  it('同级别按 source 优先级排序', () => {
    const candidates: VideoCandidate[] = [
      { url: 'https://vod.example.com/cap.mp4', source: 'captured_response', isOriginal: true },
      { url: 'https://vod.example.com/dl.mp4', source: 'platform_download_info', isOriginal: true },
      { url: 'https://vod.example.com/play.mp4', source: 'play_info', isOriginal: true },
    ];
    const sorted = sortCandidatesByTrust(candidates);
    expect(sorted[0].source).toBe('platform_download_info');
    expect(sorted[1].source).toBe('play_info');
    expect(sorted[2].source).toBe('captured_response');
  });

  it('空数组返回空数组', () => {
    expect(sortCandidatesByTrust([])).toEqual([]);
  });

  it('单个候选不变', () => {
    const candidates: VideoCandidate[] = [
      { url: 'https://vod.example.com/single.mp4', source: 'page_fallback', isOriginal: false },
    ];
    const sorted = sortCandidatesByTrust(candidates);
    expect(sorted).toHaveLength(1);
    expect(sorted[0].url).toBe('https://vod.example.com/single.mp4');
  });
});

// ==================== filterCandidatesByContext ====================

describe('filterCandidatesByContext', () => {
  it('有 vid 时过滤匹配的候选', () => {
    const candidates: VideoCandidate[] = [
      { url: 'https://vod.example.com/a.mp4', source: 'play_info', vid: 'vid_a', isOriginal: true },
      { url: 'https://vod.example.com/b.mp4', source: 'play_info', vid: 'vid_b', isOriginal: true },
    ];
    const filtered = filterCandidatesByContext(candidates, { vid: 'vid_a' });
    expect(filtered).toHaveLength(1);
    expect(filtered[0].vid).toBe('vid_a');
  });

  it('vid 不匹配时保留无 vid 的候选', () => {
    const candidates: VideoCandidate[] = [
      { url: 'https://vod.example.com/a.mp4', source: 'play_info', vid: 'vid_a', isOriginal: true },
      { url: 'https://vod.example.com/b.mp4', source: 'conversation_scan', isOriginal: false },
    ];
    const filtered = filterCandidatesByContext(candidates, { vid: 'vid_other' });
    expect(filtered).toHaveLength(1);
    expect(filtered[0].source).toBe('conversation_scan');
  });

  it('无 vid 时全部保留', () => {
    const candidates: VideoCandidate[] = [
      { url: 'https://vod.example.com/a.mp4', source: 'play_info', isOriginal: true },
      { url: 'https://vod.example.com/b.mp4', source: 'page_fallback', isOriginal: false },
    ];
    const filtered = filterCandidatesByContext(candidates, {});
    expect(filtered).toHaveLength(2);
  });

  it('空候选列表返回空', () => {
    expect(filterCandidatesByContext([], { vid: 'test' })).toEqual([]);
  });

  // ---- P1-2 回归：conversationUrl 过滤 ----

  it('P1-2: 无 vid 但有 conversationUrl 且多个候选时返回空（无法可靠归属）', () => {
    const candidates: VideoCandidate[] = [
      { url: 'https://vod.example.com/a.mp4', source: 'play_info', isOriginal: true },
      { url: 'https://vod.example.com/b.mp4', source: 'page_fallback', isOriginal: false },
    ];
    const filtered = filterCandidatesByContext(candidates, {
      conversationUrl: 'https://www.doubao.com/chat/?conversation_id=conv1',
    });
    expect(filtered).toEqual([]);
  });

  it('P2: 无 vid 但有 conversationUrl 且仅 1 个候选时拒绝（防止旧产物绑定）', () => {
    const candidates: VideoCandidate[] = [
      { url: 'https://vod.example.com/a.mp4', source: 'page_fallback', isOriginal: false },
    ];
    const filtered = filterCandidatesByContext(candidates, {
      conversationUrl: 'https://www.doubao.com/chat/?conversation_id=conv1',
    });
    expect(filtered).toEqual([]);
  });

  it('P2: 有 vid 且 vid 匹配时保留匹配候选（即使有 conversationUrl）', () => {
    const candidates: VideoCandidate[] = [
      { url: 'https://vod.example.com/a.mp4', source: 'play_info', vid: 'vid_target', isOriginal: true },
      { url: 'https://vod.example.com/b.mp4', source: 'page_fallback', isOriginal: false },
    ];
    const filtered = filterCandidatesByContext(candidates, {
      vid: 'vid_target',
      conversationUrl: 'https://www.doubao.com/chat/?conversation_id=conv1',
    });
    expect(filtered).toHaveLength(1);
    expect(filtered[0].vid).toBe('vid_target');
  });

  it('P2: 有 vid 但 vid 不匹配且有 conversationUrl 时拒绝全部', () => {
    const candidates: VideoCandidate[] = [
      { url: 'https://vod.example.com/a.mp4', source: 'play_info', vid: 'vid_a', isOriginal: true },
      { url: 'https://vod.example.com/b.mp4', source: 'conversation_scan', isOriginal: false },
    ];
    const filtered = filterCandidatesByContext(candidates, {
      vid: 'vid_other',
      conversationUrl: 'https://www.doubao.com/chat/?conversation_id=conv1',
    });
    expect(filtered).toEqual([]);
  });

  it('P1-2: 所有候选都有 vid 但都不匹配时返回空', () => {
    const candidates: VideoCandidate[] = [
      { url: 'https://vod.example.com/a.mp4', source: 'play_info', vid: 'vid_a', isOriginal: true },
      { url: 'https://vod.example.com/b.mp4', source: 'play_info', vid: 'vid_b', isOriginal: true },
    ];
    const filtered = filterCandidatesByContext(candidates, { vid: 'vid_other' });
    expect(filtered).toEqual([]);
  });

  it('P1-2: 无 vid 且无 conversationUrl 时全部保留（兼容旧行为）', () => {
    const candidates: VideoCandidate[] = [
      { url: 'https://vod.example.com/a.mp4', source: 'play_info', isOriginal: true },
      { url: 'https://vod.example.com/b.mp4', source: 'page_fallback', isOriginal: false },
    ];
    const filtered = filterCandidatesByContext(candidates, {});
    expect(filtered).toHaveLength(2);
  });
});

// ==================== isSameConversation ====================

describe('isSameConversation', () => {
  it('相同 URL 返回 true', () => {
    const url = 'https://www.doubao.com/chat/?conversation_id=abc123';
    expect(isSameConversation(url, url)).toBe(true);
  });

  it('相同 conversation_id 返回 true', () => {
    const urlA = 'https://www.doubao.com/chat/?conversation_id=abc123&other=1';
    const urlB = 'https://www.doubao.com/chat/?conversation_id=abc123&other=2';
    expect(isSameConversation(urlA, urlB)).toBe(true);
  });

  it('不同 conversation_id 返回 false', () => {
    const urlA = 'https://www.doubao.com/chat/?conversation_id=abc123';
    const urlB = 'https://www.doubao.com/chat/?conversation_id=def456';
    expect(isSameConversation(urlA, urlB)).toBe(false);
  });

  it('不同 origin 返回 false', () => {
    const urlA = 'https://www.doubao.com/chat/?conversation_id=abc123';
    const urlB = 'http://www.doubao.com/chat/?conversation_id=abc123';
    expect(isSameConversation(urlA, urlB)).toBe(false);
  });

  it('空 URL 返回 false', () => {
    expect(isSameConversation('', 'https://example.com')).toBe(false);
    expect(isSameConversation('https://example.com', '')).toBe(false);
  });

  it('无 conversation_id 时比较完整 search', () => {
    const urlA = 'https://www.doubao.com/chat/?foo=1&bar=2';
    const urlB = 'https://www.doubao.com/chat/?foo=1&bar=2';
    expect(isSameConversation(urlA, urlB)).toBe(true);
  });

  it('手动提取时会话不匹配返回 false', () => {
    const taskUrl = 'https://www.doubao.com/chat/?conversation_id=task_conv_001';
    const currentUrl = 'https://www.doubao.com/chat/?conversation_id=other_conv_002';
    expect(isSameConversation(taskUrl, currentUrl)).toBe(false);
  });
});

// ==================== isValidVideoUrl ====================

describe('isValidVideoUrl', () => {
  it('有效视频 URL', () => {
    expect(isValidVideoUrl('https://vod.example.com/video/test.mp4')).toBe(true);
    expect(isValidVideoUrl('https://tos-example.byteoss.com/video/abc')).toBe(true);
    expect(isValidVideoUrl('https://tosv.example.com/segment123')).toBe(true);
  });

  it('非视频 URL 返回 false', () => {
    expect(isValidVideoUrl('https://example.com/page.html')).toBe(false);
    expect(isValidVideoUrl('https://example.com/image.png')).toBe(false);
  });

  it('非 http(s) URL 返回 false', () => {
    expect(isValidVideoUrl('ftp://vod.example.com/video.mp4')).toBe(false);
    expect(isValidVideoUrl('file:///video.mp4')).toBe(false);
  });

  it('过短 URL 返回 false', () => {
    expect(isValidVideoUrl('http://v')).toBe(false);
  });

  it('非字符串返回 false', () => {
    expect(isValidVideoUrl(null)).toBe(false);
    expect(isValidVideoUrl(undefined)).toBe(false);
    expect(isValidVideoUrl(42)).toBe(false);
  });
});

// ==================== isOriginalMediaUrl ====================

describe('isOriginalMediaUrl', () => {
  it('platform_download_info 始终为原始', () => {
    expect(isOriginalMediaUrl('https://any.url', 'platform_download_info')).toBe(true);
  });

  it('captured_response 默认为非原始（保守判定）', () => {
    expect(isOriginalMediaUrl('https://any.url/video/normal.mp4', 'captured_response')).toBe(false);
  });

  it('captured_response 中包含 no_watermark 为原始', () => {
    expect(isOriginalMediaUrl('https://vod.example.com/no_watermark.mp4', 'captured_response')).toBe(true);
  });

  it('captured_response 中包含 original 为原始', () => {
    expect(isOriginalMediaUrl('https://vod.example.com/original.mp4', 'captured_response')).toBe(true);
  });

  it('play_info 中包含 no_watermark 为原始', () => {
    expect(isOriginalMediaUrl('https://vod.example.com/no_watermark.mp4', 'play_info')).toBe(true);
  });

  it('play_info 中包含 original 为原始', () => {
    expect(isOriginalMediaUrl('https://vod.example.com/original.mp4', 'play_info')).toBe(true);
  });

  it('play_info 中无标记字段为非原始', () => {
    expect(isOriginalMediaUrl('https://vod.example.com/normal.mp4', 'play_info')).toBe(false);
  });

  it('conversation_scan 和 page_fallback 为非原始', () => {
    expect(isOriginalMediaUrl('https://any.url', 'conversation_scan')).toBe(false);
    expect(isOriginalMediaUrl('https://any.url', 'page_fallback')).toBe(false);
  });
});

// ==================== classifyVideoResolutionError ====================

describe('classifyVideoResolutionError', () => {
  it('401 返回 unauthorized', () => {
    expect(classifyVideoResolutionError(401, null)).toBe('unauthorized');
  });

  it('403 返回 unauthorized', () => {
    expect(classifyVideoResolutionError(403, null)).toBe('unauthorized');
  });

  it('404 返回 expired', () => {
    expect(classifyVideoResolutionError(404, null)).toBe('expired');
  });

  it('410 返回 expired', () => {
    expect(classifyVideoResolutionError(410, null)).toBe('expired');
  });

  it('429 返回 retryable_error', () => {
    expect(classifyVideoResolutionError(429, null)).toBe('retryable_error');
  });

  it('500 返回 retryable_error', () => {
    expect(classifyVideoResolutionError(500, null)).toBe('retryable_error');
  });

  it('503 返回 retryable_error', () => {
    expect(classifyVideoResolutionError(503, null)).toBe('retryable_error');
  });

  it('响应体包含登录失效错误码返回 unauthorized', () => {
    expect(classifyVideoResolutionError(200, { code: 401, message: '登录已失效' })).toBe('unauthorized');
  });

  it('响应体包含过期消息返回 expired', () => {
    expect(classifyVideoResolutionError(200, { code: 0, message: '产物已过期' })).toBe('expired');
  });

  it('响应体包含不存在消息返回 expired', () => {
    expect(classifyVideoResolutionError(200, { code: 0, message: '资源不存在' })).toBe('expired');
  });

  it('响应体包含次数限制返回 unauthorized', () => {
    expect(classifyVideoResolutionError(200, { code: 0, message: '免费次数已用完' })).toBe('unauthorized');
  });

  it('响应体包含会员限制返回 unauthorized', () => {
    expect(classifyVideoResolutionError(200, { code: 0, message: '仅限会员使用' })).toBe('unauthorized');
  });

  it('响应体包含权益限制返回 unauthorized', () => {
    expect(classifyVideoResolutionError(200, { code: 0, message: '权益不足' })).toBe('unauthorized');
  });

  it('200 无特殊错误返回 unavailable', () => {
    expect(classifyVideoResolutionError(200, { code: 0, message: 'success' })).toBe('unavailable');
  });

  it('200 无响应体返回 unavailable', () => {
    expect(classifyVideoResolutionError(200, null)).toBe('unavailable');
  });
});

// ==================== classifyDownloadError ====================

describe('classifyDownloadError', () => {
  it('超时错误分类为 network_error', () => {
    const result = classifyDownloadError(null, null, null, 'AbortError: The operation was aborted', 'video');
    expect(result.type).toBe('network_error');
    expect(result.message).toBe('下载超时');
  });

  it('网络断连分类为 network_error', () => {
    const result = classifyDownloadError(null, null, null, 'network error: ECONNRESET', 'video');
    expect(result.type).toBe('network_error');
  });

  it('磁盘空间不足分类为 disk_error', () => {
    const result = classifyDownloadError(null, null, null, 'ENOSPC: disk full', 'video');
    expect(result.type).toBe('disk_error');
  });

  it('HTTP 403 分类为 http_error 并附带权限说明', () => {
    const result = classifyDownloadError(403, null, null, null, 'video');
    expect(result.type).toBe('http_error');
    expect(result.message).toContain('登录态失效或无权限');
  });

  it('HTTP 404 分类为 http_error 并附带过期说明', () => {
    const result = classifyDownloadError(404, null, null, null, 'video');
    expect(result.type).toBe('http_error');
    expect(result.message).toContain('已过期或不存在');
  });

  it('HTTP 500 分类为 http_error', () => {
    const result = classifyDownloadError(500, null, null, null, 'video');
    expect(result.type).toBe('http_error');
  });

  it('空文件分类为 empty_file', () => {
    const result = classifyDownloadError(200, 'video/mp4', 0, null, 'video');
    expect(result.type).toBe('empty_file');
  });

  it('视频模式非视频 content-type 分类为 invalid_content', () => {
    const result = classifyDownloadError(200, 'text/html', 1024, null, 'video');
    expect(result.type).toBe('invalid_content');
    expect(result.message).toContain('text/html');
  });

  it('视频模式 octet-stream 通过校验', () => {
    const result = classifyDownloadError(200, 'application/octet-stream', 1024, null, 'video');
    expect(result.type).toBe('unknown'); // 通过验证后返回 unknown（无错误）
  });

  it('无错误信息且状态正常返回 unknown', () => {
    const result = classifyDownloadError(200, 'video/mp4', 1024, null, 'video');
    expect(result.type).toBe('unknown');
  });
});

// ==================== createFailedResolution / createResolvedResolution ====================

describe('createFailedResolution', () => {
  it('构建失败结果', () => {
    const attempts = [{ strategy: 'test', result: 'fail' as const, reason: 'test reason' }];
    const result = createFailedResolution('unavailable', '测试失败', attempts, 'vid123');
    expect(result.status).toBe('unavailable');
    expect(result.reason).toBe('测试失败');
    expect(result.attempts).toBe(attempts);
    expect(result.vid).toBe('vid123');
    expect(result.url).toBeUndefined();
  });

  it('无 vid 时构建失败结果', () => {
    const result = createFailedResolution('expired', '已过期', []);
    expect(result.vid).toBeUndefined();
  });
});

describe('createResolvedResolution', () => {
  it('构建成功结果', () => {
    const attempts = [{ strategy: 'play_info', result: 'success' as const }];
    const result = createResolvedResolution(
      'https://vod.example.com/video.mp4',
      'play_info',
      'vid456',
      attempts,
    );
    expect(result.status).toBe('resolved');
    expect(result.url).toBe('https://vod.example.com/video.mp4');
    expect(result.source).toBe('play_info');
    expect(result.vid).toBe('vid456');
    expect(result.attempts).toBe(attempts);
  });

  it('无 vid 时构建成功结果', () => {
    const result = createResolvedResolution('https://vod.example.com/video.mp4', 'page_fallback', undefined, []);
    expect(result.vid).toBeUndefined();
  });
});
