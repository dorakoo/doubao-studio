/**
 * 无印豆包图片解析（核心算法移植自 ihmily/doubao-nomark image.py）。
 *
 * 从 /thread/ 分享页 HTML 的 modern-run 脚本 JSON 中提取
 * creation_block.creations[].image.image_ori_raw（原图地址），不做登录、不传 Cookie。
 */

import { isThreadShareUrl } from './nomarkVideo';

export type NomarkImageParseStatus =
  | 'ok'
  | 'invalid_url'
  | 'page_not_found'
  | 'page_data_unreadable'
  | 'image_not_found'
  | 'network_error';

export interface NomarkImage {
  url: string;
  width?: number;
  height?: number;
  /** 其它 image_ori_raw 原始字段（脱敏后仍保留宽高类元数据）。 */
  extra?: Record<string, unknown>;
}

export interface NomarkImageParseResult {
  status: NomarkImageParseStatus;
  images: NomarkImage[];
  shareUrl?: string;
  error?: string;
}

export interface NomarkImageDownloadResult {
  status: 'saved' | 'network_error' | 'http_error' | 'invalid_output';
  filePath?: string;
  bytes?: number;
  contentType?: string;
  image?: NomarkImage;
  error?: string;
}

export type NomarkFetch = (url: string, init?: RequestInit) => Promise<Response>;

const DEFAULT_HEADERS: Record<string, string> = {
  accept: 'text/html,application/xhtml+xml,*/*;q=0.8',
  'accept-language': 'zh-CN,zh;q=0.9,en-US;q=0.8',
  'user-agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36 Edg/148.0.0.0',
};

const MAX_PAGE_CHARS = 2_500_000;
const MAX_IMAGES = 50;

export { isThreadShareUrl };

function isPublicImageUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;
    if (url.username || url.password) return false;
    const host = url.hostname.toLowerCase();
    if (host === 'localhost' || host.endsWith('.local')) return false;
    if (/^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host)) return false;
    const m = /^172\.(\d+)\./.exec(host);
    if (m && Number(m[1]) >= 16 && Number(m[1]) <= 31) return false;
    return true;
  } catch {
    return false;
  }
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

function asNumber(value: unknown): number | undefined {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : undefined;
}

function collectImageOriRaw(value: unknown, images: NomarkImage[], depth = 0): void {
  if (depth > 40 || images.length >= MAX_IMAGES) return;
  if (Array.isArray(value)) {
    for (const child of value) {
      collectImageOriRaw(child, images, depth + 1);
      if (images.length >= MAX_IMAGES) return;
    }
    return;
  }
  if (!value || typeof value !== 'object') {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
        try {
          collectImageOriRaw(JSON.parse(trimmed), images, depth + 1);
        } catch {
          // ignore
        }
      }
    }
    return;
  }
  const record = value as Record<string, unknown>;
  const image = record.image;
  if (image && typeof image === 'object') {
    const ori = (image as Record<string, unknown>).image_ori_raw;
    if (ori && typeof ori === 'object') {
      const raw = ori as Record<string, unknown>;
      const url = String(raw.url || '').replace(/&amp;/g, '&');
      if (url && isPublicImageUrl(url)) {
        const entry: NomarkImage = { url };
        const w = asNumber(raw.width);
        const h = asNumber(raw.height);
        if (w !== undefined) entry.width = w;
        if (h !== undefined) entry.height = h;
        images.push(entry);
        if (images.length >= MAX_IMAGES) return;
      }
    }
  }
  for (const child of Object.values(record)) {
    collectImageOriRaw(child, images, depth + 1);
    if (images.length >= MAX_IMAGES) return;
  }
}

/** 从分享页 HTML 提取 image_ori_raw 列表。 */
export function extractNomarkImagesFromHtml(pageHtml: string): NomarkImage[] {
  const images: NomarkImage[] = [];
  const sourcePattern = /data-script-src="(?:modern-run-router-data-fn|modern-run-window-fn)"/;
  const scriptRe = /<script\b[^>]*>/gi;
  let parsedScript = false;
  for (let match = scriptRe.exec(pageHtml); match; match = scriptRe.exec(pageHtml)) {
    const tag = match[0];
    if (!sourcePattern.test(tag)) continue;
    const args = /data-fn-args="(.*?)"/s.exec(tag);
    if (!args) continue;
    try {
      collectImageOriRaw(JSON.parse(unescapeHtml(args[1])), images);
      parsedScript = true;
    } catch {
      // next script
    }
  }
  if (!parsedScript) {
    throw new Error('PAGE_DATA_UNREADABLE');
  }
  const seen = new Set<string>();
  return images.filter((item) => {
    if (seen.has(item.url)) return false;
    seen.add(item.url);
    return true;
  });
}

export async function parseNomarkImages(
  shareUrl: string,
  fetchImpl: NomarkFetch = fetch,
): Promise<NomarkImageParseResult> {
  const normalized = shareUrl.trim();
  if (!isThreadShareUrl(normalized)) {
    return { status: 'invalid_url', images: [], error: '仅支持豆包/Dola 对话分享链接（含 /thread/）' };
  }
  let html: string;
  try {
    const response = await fetchImpl(normalized, { method: 'GET', redirect: 'follow', headers: DEFAULT_HEADERS });
    if (!response.ok) {
      return { status: 'page_not_found', images: [], shareUrl: normalized, error: `分享页 HTTP ${response.status}` };
    }
    html = await response.text();
    if (html.length > MAX_PAGE_CHARS) {
      return { status: 'page_not_found', images: [], shareUrl: normalized, error: '分享页过大，拒绝解析' };
    }
  } catch (error) {
    return {
      status: 'network_error',
      images: [],
      shareUrl: normalized,
      error: error instanceof Error ? error.message : '分享页请求失败',
    };
  }
  try {
    const images = extractNomarkImagesFromHtml(html);
    if (images.length === 0) {
      return {
        status: 'image_not_found',
        images: [],
        shareUrl: normalized,
        error: '页面中未找到原图资源',
      };
    }
    return { status: 'ok', images, shareUrl: normalized };
  } catch (error) {
    return {
      status: 'page_data_unreadable',
      images: [],
      shareUrl: normalized,
      error: error instanceof Error ? error.message : '无法解析分享页数据',
    };
  }
}

function extensionFromContentType(contentType: string, url: string): string {
  const ct = contentType.toLowerCase();
  if (ct.includes('png')) return '.png';
  if (ct.includes('webp')) return '.webp';
  if (ct.includes('jpeg') || ct.includes('jpg')) return '.jpg';
  if (ct.includes('gif')) return '.gif';
  try {
    const ext = new URL(url).pathname.match(/\.(png|jpe?g|webp|gif)$/i)?.[0];
    if (ext) return ext.toLowerCase();
  } catch {
    // ignore
  }
  return '.jpg';
}

export async function downloadNomarkImage(
  image: NomarkImage,
  outDir: string,
  fileNameBase: string,
  fetchImpl: NomarkFetch = fetch,
): Promise<NomarkImageDownloadResult> {
  if (!image?.url || !outDir || !fileNameBase) {
    return { status: 'invalid_output', error: '缺少图片地址、输出目录或文件名' };
  }
  try {
    const { mkdir, writeFile } = await import('node:fs/promises');
    const { join } = await import('node:path');
    await mkdir(outDir, { recursive: true });
    const response = await fetchImpl(image.url, {
      method: 'GET',
      headers: { ...DEFAULT_HEADERS, referer: 'https://www.doubao.com/' },
    });
    if (!response.ok) {
      return { status: 'http_error', image, error: `图片下载 HTTP ${response.status}` };
    }
    const contentType = response.headers.get('content-type') || '';
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length === 0) {
      return { status: 'http_error', image, error: '图片内容为空' };
    }
    const ext = extensionFromContentType(contentType, image.url);
    const safe = fileNameBase.replace(/[^\w.-]+/g, '_').slice(0, 60);
    const filePath = join(outDir, `${safe}${ext}`);
    await writeFile(filePath, buffer);
    return { status: 'saved', filePath, bytes: buffer.length, contentType, image };
  } catch (error) {
    return {
      status: 'network_error',
      image,
      error: error instanceof Error ? error.message : '图片下载失败',
    };
  }
}
