/**
 * 无印豆包视频解析（核心算法移植自 ihmily/doubao-nomark）。
 *
 * 链路：
 * 1. GET /thread/ 分享页 HTML
 * 2. 从 modern-run-router-data-fn / modern-run-window-fn 脚本 JSON 中递归收集 fallback_api
 * 3. 将 fallback_api 改写为 codec_type=8&logo_type=unwatermarked
 * 4. 请求 API 得到 video_info / key_seed / qAAB main_url
 * 5. AES 解密得到真实 CDN 地址
 *
 * 不使用账号 Cookie；不调用登录接口；仅消费公开分享页与公开 media API。
 */
import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { decodeMainUrl } from './qaabVideoCrypto';

export type NomarkParseStatus =
  | 'ok'
  | 'invalid_url'
  | 'unsupported_source'
  | 'fallback_api_missing'
  | 'media_not_found'
  | 'decrypt_failed'
  | 'network_error'
  | 'http_error';

export interface NomarkVideo {
  vid: string;
  url: string;
  width: number;
  height: number;
  definition: string;
  duration: number;
  codecType: string;
  posterUrl: string;
}

export interface NomarkParseResult {
  status: NomarkParseStatus;
  videos: NomarkVideo[];
  error?: string;
  shareUrl?: string;
}

export interface NomarkDownloadResult {
  status: NomarkParseStatus | 'saved' | 'invalid_output';
  filePath?: string;
  bytes?: number;
  contentType?: string;
  video?: NomarkVideo;
  error?: string;
}

export type NomarkFetch = (url: string, init?: RequestInit) => Promise<Response>;

const DEFAULT_HEADERS: Record<string, string> = {
  accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'accept-language': 'zh-CN,zh;q=0.9,en-US;q=0.8',
  'user-agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36 Edg/148.0.0.0',
};

/** 仅允许这些公网媒体 host 上的 /video/fplay/ 作为无水印 fallback_api。 */
const FALLBACK_API_HOST_SUFFIXES = ['.snssdk.com', '.douyinvod.com', '.dola.com', '.byteintlapi.com'] as const;
const FALLBACK_API_PARAMS: Record<string, string> = { codec_type: '8', logo_type: 'unwatermarked' };
const MAX_PAGE_CHARS = 2_500_000;

export function isThreadShareUrl(value: string): boolean {
  try {
    const url = new URL(value.trim());
    const host = url.hostname.toLowerCase();
    const allowedHost =
      host === 'doubao.com' ||
      host.endsWith('.doubao.com') ||
      host === 'dola.com' ||
      host.endsWith('.dola.com');
    return allowedHost && url.pathname.includes('/thread/') && !url.username && !url.password;
  } catch {
    return false;
  }
}

function trustedFallbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return FALLBACK_API_HOST_SUFFIXES.some((suffix) => host === suffix.slice(1) || host.endsWith(suffix));
}

/** 将页面 fallback_api 改写为无水印参数（codec_type=8 + logo_type=unwatermarked）。 */
export function buildUnwatermarkedUrl(url: string): string {
  const parsed = new URL(url);
  const host = parsed.hostname.toLowerCase();
  if (
    parsed.protocol !== 'https:' ||
    !trustedFallbackHost(host) ||
    !parsed.pathname.startsWith('/video/fplay/')
  ) {
    throw new Error('UNTRUSTED_FALLBACK_API');
  }
  parsed.searchParams.delete('codec_type');
  parsed.searchParams.delete('logo_type');
  parsed.searchParams.set('codec_type', FALLBACK_API_PARAMS.codec_type);
  parsed.searchParams.set('logo_type', FALLBACK_API_PARAMS.logo_type);
  return parsed.toString();
}

function walkFallbackApis(value: unknown, apis: Set<string>, depth = 0): void {
  if (depth > 30 || value === null || value === undefined) return;
  if (Array.isArray(value)) {
    for (const child of value) walkFallbackApis(child, apis, depth + 1);
    return;
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const fallback = record.fallback_api;
    if (typeof fallback === 'string') {
      try {
        buildUnwatermarkedUrl(fallback);
        apis.add(fallback);
      } catch {
        // ignore untrusted
      }
    }
    for (const child of Object.values(record)) walkFallbackApis(child, apis, depth + 1);
    return;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        walkFallbackApis(JSON.parse(trimmed), apis, depth + 1);
      } catch {
        // ignore
      }
    }
  }
}

/** 从分享页 HTML 提取并校验 fallback_api 列表。 */
export function extractFallbackApis(pageHtml: string): string[] {
  const apis = new Set<string>();
  let parsedScript = false;
  const sourcePattern = /data-script-src="(?:modern-run-router-data-fn|modern-run-window-fn)"/;
  const scriptRe = /<script\b[^>]*>/gi;
  for (let match = scriptRe.exec(pageHtml); match; match = scriptRe.exec(pageHtml)) {
    const tag = match[0];
    if (!sourcePattern.test(tag)) continue;
    const args = /data-fn-args="(.*?)"/s.exec(tag);
    if (!args) continue;
    try {
      walkFallbackApis(JSON.parse(unescapeHtml(args[1])), apis);
      parsedScript = true;
    } catch {
      // try next script tag
    }
  }
  if (!parsedScript) {
    throw new Error('PAGE_DATA_UNREADABLE');
  }
  return [...apis];
}

function unescapeHtml(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\\u0026/gi, '&')
    .replace(/\\\//g, '/');
}

function numberOr0(value: unknown): number {
  const n = Number(value || 0);
  return Number.isFinite(n) ? n : 0;
}

function pickVideoEntry(data: Record<string, unknown>): Record<string, unknown> | null {
  const videoList = data.video_list;
  let candidates: unknown[] = [];
  if (videoList && typeof videoList === 'object' && !Array.isArray(videoList)) {
    candidates = Object.values(videoList as Record<string, unknown>);
  } else if (Array.isArray(videoList)) {
    candidates = videoList;
  } else {
    candidates = [data];
  }
  const entries = candidates.filter(
    (item): item is Record<string, unknown> =>
      !!item &&
      typeof item === 'object' &&
      (typeof (item as Record<string, unknown>).main_url === 'string' ||
        typeof (item as Record<string, unknown>).play_url === 'string'),
  );
  if (entries.length === 0) return null;
  return entries.reduce((best, item) => {
    const area = numberOr0(item.vwidth || item.width) * numberOr0(item.vheight || item.height);
    const bestArea = numberOr0(best.vwidth || best.width) * numberOr0(best.vheight || best.height);
    if (area !== bestArea) return area > bestArea ? item : best;
    return numberOr0(item.bitrate || item.real_bitrate) > numberOr0(best.bitrate || best.real_bitrate)
      ? item
      : best;
  });
}

function parseVideoResponse(payload: Record<string, unknown>, fallbackApi: string): NomarkVideo | null {
  const videoInfo = (payload.video_info || payload.data || payload) as Record<string, unknown>;
  const data = (videoInfo.data || videoInfo) as Record<string, unknown>;
  if (!data || typeof data !== 'object') return null;

  const entry = pickVideoEntry(data);
  if (!entry) return null;
  const token = String(entry.main_url || entry.play_url || '').trim();
  const keySeed =
    (data.key_seed as string) ||
    (videoInfo.key_seed as string) ||
    (payload.key_seed as string) ||
    '';
  const videoUrl = decodeMainUrl(token, String(keySeed));
  if (!videoUrl) return null;
  return buildNomarkVideoFromEntry(entry, data, videoUrl, fallbackApi);
}

function buildNomarkVideoFromEntry(
  entry: Record<string, unknown>,
  data: Record<string, unknown>,
  videoUrl: string,
  fallbackApi: string,
): NomarkVideo {
  const width = numberOr0(entry.vwidth || entry.width || data.vwidth || data.width);
  const height = numberOr0(entry.vheight || entry.height || data.vheight || data.height);
  return {
    vid: String(data.vid || data.video_id || entry.vid || entry.video_id || fallbackApi),
    url: videoUrl,
    width: Math.trunc(width),
    height: Math.trunc(height),
    definition: String(entry.definition || data.definition || ''),
    duration: numberOr0(entry.duration || data.duration || data.video_duration),
    codecType: String(entry.codec_type || data.codec_type || ''),
    posterUrl: String(data.poster_url || data.poster || ''),
  };
}

/**
 * 解析豆包 / Dola /thread/ 分享页中的无水印视频。
 */
export async function parseNomarkVideos(shareUrl: string, fetchImpl: NomarkFetch = fetch): Promise<NomarkParseResult> {
  const normalized = shareUrl.trim();
  if (!isThreadShareUrl(normalized)) {
    return { status: 'invalid_url', videos: [], error: '仅支持豆包/Dola 对话分享链接（含 /thread/）' };
  }

  let html: string;
  try {
    const pageResponse = await fetchImpl(normalized, {
      method: 'GET',
      redirect: 'follow',
      headers: DEFAULT_HEADERS,
    });
    if (!pageResponse.ok) {
      return {
        status: pageResponse.status >= 500 ? 'http_error' : 'media_not_found',
        videos: [],
        shareUrl: normalized,
        error: `分享页 HTTP ${pageResponse.status}`,
      };
    }
    html = await pageResponse.text();
    if (html.length > MAX_PAGE_CHARS) {
      return { status: 'media_not_found', videos: [], shareUrl: normalized, error: '分享页过大，拒绝解析' };
    }
  } catch (error) {
    return {
      status: 'network_error',
      videos: [],
      shareUrl: normalized,
      error: error instanceof Error ? error.message : '分享页请求失败',
    };
  }

  let fallbackApis: string[];
  try {
    fallbackApis = extractFallbackApis(html);
  } catch (error) {
    return {
      status: 'fallback_api_missing',
      videos: [],
      shareUrl: normalized,
      error: error instanceof Error ? error.message : '无法解析分享页数据',
    };
  }
  if (fallbackApis.length === 0) {
    return {
      status: 'fallback_api_missing',
      videos: [],
      shareUrl: normalized,
      error: '页面中未找到视频 fallback_api，请确认分享链接包含可用视频',
    };
  }

  const videos: NomarkVideo[] = [];
  const seen = new Set<string>();
  const errors: string[] = [];
  for (const fallbackApi of fallbackApis) {
    try {
      const mediaUrl = buildUnwatermarkedUrl(fallbackApi);
      const response = await fetchImpl(mediaUrl, { method: 'GET', headers: DEFAULT_HEADERS });
      if (!response.ok) {
        errors.push(`fallback_api HTTP ${response.status}`);
        continue;
      }
      const payload = (await response.json()) as Record<string, unknown>;
      const video = parseVideoResponse(payload, fallbackApi);
      if (!video) {
        errors.push('main_url 解密失败或响应缺少视频');
        continue;
      }
      const identity = video.vid || video.url;
      if (!seen.has(identity)) {
        seen.add(identity);
        videos.push(video);
      }
    } catch (error) {
      errors.push(error instanceof Error ? error.message : 'fallback_api 调用失败');
    }
  }

  if (videos.length === 0) {
    return {
      status: errors.some((e) => e.includes('解密')) ? 'decrypt_failed' : 'media_not_found',
      videos: [],
      shareUrl: normalized,
      error: errors[0] || '视频解析失败',
    };
  }
  return { status: 'ok', videos, shareUrl: normalized };
}

/** 下载单个无水印视频到 outDir；文件名由 vid/安全字符构成。 */
export async function downloadNomarkVideo(
  video: NomarkVideo,
  outDir: string,
  fetchImpl: NomarkFetch = fetch,
): Promise<NomarkDownloadResult> {
  if (!video?.url || !outDir) {
    return { status: 'invalid_output', error: '缺少视频地址或输出目录' };
  }
  try {
    await mkdir(outDir, { recursive: true });
    const response = await fetchImpl(video.url, {
      method: 'GET',
      headers: { ...DEFAULT_HEADERS, referer: 'https://www.doubao.com/' },
    });
    if (!response.ok || !response.body) {
      return { status: 'http_error', video, error: `媒体下载 HTTP ${response.status}` };
    }
    const contentType = response.headers.get('content-type') || '';
    const safeVid = (video.vid || 'video').replace(/[^\w.-]+/g, '_').slice(0, 80);
    const filePath = join(outDir, `${safeVid}.mp4`);
    const nodeStream = Readable.fromWeb(response.body as import('node:stream/web').ReadableStream);
    let bytes = 0;
    nodeStream.on('data', (chunk: Buffer) => {
      bytes += chunk.length;
    });
    await pipeline(nodeStream, createWriteStream(filePath));
    return { status: 'saved', filePath, bytes, contentType, video };
  } catch (error) {
    return {
      status: 'network_error',
      video,
      error: error instanceof Error ? error.message : '下载失败',
    };
  }
}
