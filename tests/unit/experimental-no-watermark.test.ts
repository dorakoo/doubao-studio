/**
 * tests/unit/experimental-no-watermark.test.ts
 *
 * 实验通道（用户授权绕过官方无水印授权）专项测试：
 *  - 开关默认关闭 / 持久化 / storage 不可用防御。
 *  - collectExperimentalUrls 深度扫描与顺序去重。
 *  - rewriteLrParam 参数改写边界。
 *  - tryExperimentalDirectExtract：无条件读官方接口原始响应 → 候选提取 → 参数改写候选。
 *  - 集成（resolveVideoArtifact）：开关关闭保持 fail-closed；开启后官方失败回退实验候选并标注来源。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  isExperimentalNoWatermarkEnabled,
  setExperimentalNoWatermarkEnabled,
  collectExperimentalUrls,
  rewriteLrParam,
  tryExperimentalDirectExtract,
} from '../../src/utils/experimentalNoWatermark';
import { manualResolveVideoArtifact } from '../../src/utils/doubaoBridge';
import type { WebviewHandle } from '../../src/utils/doubaoBridge';

describe('实验通道开关', () => {
  const storage = new Map<string, string>();
  beforeEach(() => {
    storage.clear();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => storage.set(k, v),
      removeItem: (k: string) => storage.delete(k),
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('默认关闭；set(true) 后开启并持久化', () => {
    expect(isExperimentalNoWatermarkEnabled()).toBe(false);
    setExperimentalNoWatermarkEnabled(true);
    expect(isExperimentalNoWatermarkEnabled()).toBe(true);
    expect(storage.get('doubao.experimental.noWatermark.enabled')).toBe('1');
    setExperimentalNoWatermarkEnabled(false);
    expect(isExperimentalNoWatermarkEnabled()).toBe(false);
  });

  it('storage 不可用（异常）时默认关闭且不抛错', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('denied'); },
      setItem: () => { throw new Error('denied'); },
      removeItem: () => { throw new Error('denied'); },
    });
    expect(isExperimentalNoWatermarkEnabled()).toBe(false);
    expect(() => setExperimentalNoWatermarkEnabled(true)).not.toThrow();
    expect(isExperimentalNoWatermarkEnabled()).toBe(false);
  });
});

describe('collectExperimentalUrls 深度扫描', () => {
  it('提取 no_watermark_url / download_url / main_url / 嵌套与数组', () => {
    const data = {
      code: 0,
      data: {
        without_watermark: false,
        download_video: { vid1: { download_url: 'https://vod.example.com/a.mp4' } },
        video_info: { main_url: 'https://vod.example.com/b.mp4' },
        list: [{ no_watermark_url: 'https://vod.example.com/c.mp4' }],
      },
    };
    const urls = collectExperimentalUrls(data);
    expect(urls).toEqual([
      'https://vod.example.com/a.mp4',
      'https://vod.example.com/b.mp4',
      'https://vod.example.com/c.mp4',
    ]);
  });

  it('非法值（非 http、非字符串）跳过；深循环不崩溃', () => {
    const cyclic: Record<string, unknown> = { url: 'not-a-url' };
    cyclic.self = cyclic;
    expect(collectExperimentalUrls({ a: cyclic, b: 1, c: null })).toEqual([]);
  });
});

describe('rewriteLrParam 参数改写', () => {
  it('已有 lr 参数 → 替换为 video_gen_no_watermark', () => {
    expect(rewriteLrParam('https://vod.example.com/v.mp4?lr=abc&x=1')).toBe(
      'https://vod.example.com/v.mp4?lr=video_gen_no_watermark&x=1',
    );
  });

  it('无 lr 参数 → 追加', () => {
    expect(rewriteLrParam('https://vod.example.com/v.mp4?x=1')).toBe(
      'https://vod.example.com/v.mp4?x=1&lr=video_gen_no_watermark',
    );
  });

  it('已是目标值或非法 URL → 原样返回', () => {
    expect(rewriteLrParam('https://vod.example.com/v.mp4?lr=video_gen_no_watermark')).toBe(
      'https://vod.example.com/v.mp4?lr=video_gen_no_watermark',
    );
    expect(rewriteLrParam('not-a-url')).toBe('not-a-url');
  });
});

describe('tryExperimentalDirectExtract', () => {
  const createWebview = (responses: unknown[] | null): WebviewHandle => ({
    executeJavaScript: vi.fn(async (): Promise<unknown> => responses),
    loadURL: vi.fn(),
    getURL: vi.fn(() => 'https://www.doubao.com/chat/'),
  });

  it('官方响应带 download_url → 提取候选并附加参数改写候选（去重）', async () => {
    const wm = JSON.stringify({
      code: 0,
      data: { without_watermark: false, download_video: { vid1: { download_url: 'https://vod.example.com/a.mp4?lr=wm1' } } },
    });
    const pi = JSON.stringify({ code: 0, data: { video_info: { no_watermark_url: 'https://vod.example.com/b.mp4' } } });
    const candidates = await tryExperimentalDirectExtract(createWebview([wm, pi]), 'vid1', 5000);
    const urls = candidates.map((c) => c.url);
    expect(urls).toContain('https://vod.example.com/a.mp4?lr=video_gen_no_watermark');
    expect(urls).toContain('https://vod.example.com/b.mp4');
    expect(candidates.every((c) => c.source === 'experimental' && c.isOriginal === false && c.vid === 'vid1')).toBe(true);
    expect(new Set(urls).size).toBe(urls.length);
  });

  it('无 vid → 空；执行抛错 → 空（fail-closed 不中断）', async () => {
    expect(await tryExperimentalDirectExtract(createWebview([]), '', 1000)).toEqual([]);
    const throwing: WebviewHandle = {
      executeJavaScript: vi.fn(async () => { throw new Error('boom'); }),
      loadURL: vi.fn(),
      getURL: vi.fn(),
    };
    expect(await tryExperimentalDirectExtract(throwing, 'vid1', 1000)).toEqual([]);
  });

  it('响应非数组（协议异常）→ 空', async () => {
    const webview: WebviewHandle = {
      executeJavaScript: vi.fn(async () => ({ status: 200 })),
      loadURL: vi.fn(),
      getURL: vi.fn(),
    };
    expect(await tryExperimentalDirectExtract(webview, 'vid1', 1000)).toEqual([]);
  });
});

describe('集成：manualResolveVideoArtifact 实验回退', () => {
  const VID = 'vid_exp_001';

  function createWebview(expResponses: string[] | null): WebviewHandle {
    const mock: WebviewHandle = {
      executeJavaScript: vi.fn(async (code: string): Promise<unknown> => {
        await new Promise((r) => setTimeout(r, 5));
        if (code.includes('function probe(path, body)')) {
          return expResponses; // 实验通道：返回响应文本数组
        }
        if (code.includes('get_without_watermark')) {
          return { status: 200, data: { code: 0, data: { without_watermark: false } } };
        }
        if (code.includes('get_play_info')) {
          return { status: 200, data: { code: 0, data: {} } };
        }
        return null;
      }),
      loadURL: vi.fn(),
      getURL: vi.fn(() => 'https://www.doubao.com/chat/'),
    };
    return mock;
  }

  it('实验关闭（默认）：官方 without_watermark=false → fail-closed unavailable', async () => {
    const webview = createWebview(['{"code":0,"data":{"without_watermark":false}}', '{}']);
    const result = await manualResolveVideoArtifact(webview, {
      knownVid: VID,
      timeoutMs: 3000,
      // experimentalNoWatermark 未传 → 关闭
    });
    expect(result.status).toBe('unavailable');
    expect(result.reason).toContain('without_watermark=false');
  });

  it('实验开启：官方拒绝 → 实验候选可用并标注 experimental', async () => {
    const webview = createWebview([
      JSON.stringify({ code: 0, data: { without_watermark: false, download_video: { [VID]: { download_url: 'https://vod.example.com/exp_a.mp4' } } } }),
      '{}',
    ]);
    const result = await manualResolveVideoArtifact(webview, {
      knownVid: VID,
      timeoutMs: 3000,
      experimentalNoWatermark: true,
    });
    expect(result.status).toBe('resolved');
    expect(result.source).toBe('experimental');
    expect(result.url).toContain('exp_a.mp4');
  });

  it('实验开启但无候选 → unavailable 且原因标注实验直取未获得源文件', async () => {
    const webview = createWebview(null);
    const result = await manualResolveVideoArtifact(webview, {
      knownVid: VID,
      timeoutMs: 3000,
      experimentalNoWatermark: true,
    });
    expect(result.status).toBe('unavailable');
    expect(result.reason).toContain('实验直取未获得可验证源文件');
  });
});
