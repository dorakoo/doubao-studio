/**
 * 公开分享媒体解析。
 *
 * 这里只读取豆包公开分享页在 HTML 中实际声明的媒体地址；不调用隐藏接口、
 * 不修改地址参数，也不使用账号 Cookie。
 */

export type PublicShareMediaStatus =
  | 'resolved'
  | 'invalid_url'
  | 'unsupported_source'
  | 'media_not_found'
  | 'invalid_media'
  | 'network_error';

export interface PublicShareMediaResult {
  status: PublicShareMediaStatus;
  shareUrl?: string;
  finalShareUrl?: string;
  mediaUrl?: string;
  sourceHost?: string;
  contentType?: string;
  contentLength?: number;
  error?: string;
}

export interface PublicShareFetchResponse {
  ok: boolean;
  status: number;
  url: string;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
  body?: { cancel(): Promise<void> } | null;
}

export type PublicShareFetch = (url: string, init?: Record<string, unknown>) => Promise<PublicShareFetchResponse>;

const MAX_SHARE_HTML_BYTES = 1_500_000;

export function isAllowedPublicShareUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return isHttpUrl(url) && isDoubaoHost(url.hostname) && !url.username && !url.password;
  } catch {
    return false;
  }
}

/** 只允许豆包公开页面作为解析入口；媒体 CDN 必须为公网 HTTP(S) 地址。 */
export function isPublicMediaUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return isHttpUrl(url) && !url.username && !url.password && !isPrivateHost(url.hostname);
  } catch {
    return false;
  }
}

export function extractDeclaredPublicMediaUrls(html: string): string[] {
  const values = new Set<string>();
  const patterns = [
    /<meta[^>]+(?:property|name)=["'](?:og:video(?::url)?|twitter:player:stream)["'][^>]+content=["']([^"']+)["']/gi,
    /<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["'](?:og:video(?::url)?|twitter:player:stream)["']/gi,
    /<(?:video|source)[^>]+src=["']([^"']+)["']/gi,
    /["'](?:contentUrl|content_url|play_url|playUrl|video_url|videoUrl)["']\s*:\s*["']([^"']+)["']/gi,
  ];
  for (const pattern of patterns) {
    for (const match of html.matchAll(pattern)) {
      const value = decodeHtmlUrl(match[1]);
      if (isPublicMediaUrl(value)) values.add(value);
    }
  }
  return [...values];
}

/**
 * 解析并用一个 Range 探针校验页面实际公开的媒体流。
 * 调用方必须注入无 Cookie 的临时会话 fetch。
 */
export async function resolvePublicShareMedia(
  shareUrl: string,
  fetchPublic: PublicShareFetch,
): Promise<PublicShareMediaResult> {
  const normalized = shareUrl.trim();
  if (!isAllowedPublicShareUrl(normalized)) {
    return { status: 'unsupported_source', error: '仅支持豆包公开分享链接' };
  }

  const pageResult = await fetchAllowedSharePage(normalized, fetchPublic);
  if (!pageResult.ok) return pageResult.result;
  const { page, finalShareUrl } = pageResult;
  const length = Number(page.headers.get('content-length') || 0);
  if (Number.isFinite(length) && length > MAX_SHARE_HTML_BYTES) {
    return { status: 'invalid_media', error: '分享页响应过大，已拒绝解析' };
  }

  let html: string;
  try {
    html = await page.text();
  } catch {
    return { status: 'network_error', error: '无法读取公开分享页' };
  }
  if (html.length > MAX_SHARE_HTML_BYTES) {
    return { status: 'invalid_media', error: '分享页内容过大，已拒绝解析' };
  }

  const mediaUrl = extractDeclaredPublicMediaUrls(html)[0];
  if (!mediaUrl) {
    return { status: 'media_not_found', shareUrl: normalized, finalShareUrl, error: '页面未公开声明可下载的视频流' };
  }

  let probe: PublicShareFetchResponse;
  try {
    probe = await fetchPublic(mediaUrl, {
      method: 'GET',
      credentials: 'omit',
      headers: { Range: 'bytes=0-0', Referer: finalShareUrl },
    });
  } catch {
    return { status: 'network_error', shareUrl: normalized, finalShareUrl, error: '公开媒体流无法访问' };
  }
  try {
    await probe.body?.cancel();
  } catch {
    // 取消探针流失败不影响已完成的 HTTP/类型验证。
  }
  const contentType = probe.headers.get('content-type') || '';
  if (!probe.ok || !isPublicMediaUrl(probe.url) || !isVideoContentType(contentType)) {
    return { status: 'invalid_media', shareUrl: normalized, finalShareUrl, error: '页面声明的地址不是可验证的公开视频流' };
  }
  return {
    status: 'resolved',
    shareUrl: normalized,
    finalShareUrl,
    mediaUrl: probe.url,
    sourceHost: new URL(probe.url).hostname,
    contentType,
    contentLength: parseContentLength(probe.headers.get('content-length')),
  };
}

/** 手动跟随跳转，确保每一步都留在豆包公开域名。Electron 的 Response.url 为空时也不误判。 */
async function fetchAllowedSharePage(
  initialUrl: string,
  fetchPublic: PublicShareFetch,
): Promise<{ ok: true; page: PublicShareFetchResponse; finalShareUrl: string } | { ok: false; result: PublicShareMediaResult }> {
  let nextUrl = initialUrl;
  for (let redirects = 0; redirects <= 3; redirects += 1) {
    let page: PublicShareFetchResponse;
    try {
      page = await fetchPublic(nextUrl, { method: 'GET', credentials: 'omit', redirect: 'manual' });
    } catch {
      return { ok: false, result: { status: 'network_error', error: '公开分享页无法访问' } };
    }
    if (page.status >= 300 && page.status < 400) {
      const location = page.headers.get('location');
      if (!location) {
        return { ok: false, result: { status: 'unsupported_source', error: '分享页跳转地址无效' } };
      }
      try {
        nextUrl = new URL(location, nextUrl).toString();
      } catch {
        return { ok: false, result: { status: 'unsupported_source', error: '分享页跳转地址无效' } };
      }
      if (!isAllowedPublicShareUrl(nextUrl)) {
        return { ok: false, result: { status: 'unsupported_source', error: '分享页跳转到了非允许域名' } };
      }
      continue;
    }
    if (!page.ok) {
      return { ok: false, result: { status: 'network_error', error: '公开分享页无法访问' } };
    }
    return { ok: true, page, finalShareUrl: nextUrl };
  }
  return { ok: false, result: { status: 'unsupported_source', error: '分享页跳转次数过多' } };
}

function isHttpUrl(url: URL): boolean {
  return url.protocol === 'https:' || url.protocol === 'http:';
}

function isDoubaoHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === 'doubao.com' || host.endsWith('.doubao.com');
}

function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.local') || host === '::1' || host === '[::1]') return true;
  if (/^127\./.test(host) || /^0\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host)) return true;
  const match = /^172\.(\d+)\./.exec(host);
  return !!match && Number(match[1]) >= 16 && Number(match[1]) <= 31;
}

function isVideoContentType(value: string): boolean {
  const contentType = value.toLowerCase();
  return contentType.includes('video/') || contentType.includes('application/octet-stream') || contentType.includes('binary/');
}

function decodeHtmlUrl(value: string): string {
  return value.replace(/&amp;/g, '&').replace(/\\u002F/gi, '/').replace(/\\\//g, '/');
}

function parseContentLength(value: string | null): number | undefined {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}
