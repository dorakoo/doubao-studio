/**
 * 实验：源文件直取（绕过官方无水印授权）——用户明确知情授权的对抗性实验功能。
 *
 * ⚠️ 风险与边界（必须遵守）：
 *  - 本模块是用户授权下的实验性能力：默认关闭；仅在显式开启后生效。
 *  - 平台可能校验服务端渲染水印：实验候选**不保证无水印**，下载结果由用户自行确认。
 *  - 使用可能违反豆包服务条款并触发账号风控——仅对用户显式指定的账号操作，不用于自动任务。
 *  - 官方授权通道（get_without_watermark / without_watermark=true）永远优先；
 *    实验候选只作为官方拒绝后的最后手段，且结果明确标注 experimental。
 */
import type { VideoCandidate } from './videoArtifactResolver';

const STORAGE_KEY = 'doubao.experimental.noWatermark.enabled';

/** 实验开关（渲染层 localStorage；无 storage 环境默认关闭）。 */
export function isExperimentalNoWatermarkEnabled(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function setExperimentalNoWatermarkEnabled(enabled: boolean): void {
  try {
    if (enabled) localStorage.setItem(STORAGE_KEY, '1');
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* storage 不可用时开关不持久化（保持默认关闭） */
  }
}

/** 深度扫描任意响应对象中的候选媒体 URL（按键名优先级）。 */
const URL_KEYS = ['no_watermark_url', 'download_url', 'main_url', 'main', 'play_url', 'url'];

export function collectExperimentalUrls(data: unknown, depth = 0, seen = new Set<unknown>()): string[] {
  if (depth > 5 || data === null || typeof data !== 'object' || seen.has(data)) return [];
  seen.add(data);
  const results: string[] = [];
  if (Array.isArray(data)) {
    for (const item of data) results.push(...collectExperimentalUrls(item, depth + 1, seen));
    return results;
  }
  const obj = data as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    const value = obj[key];
    if (URL_KEYS.includes(key) && typeof value === 'string' && /^https?:\/\//.test(value)) {
      results.push(value);
    } else {
      results.push(...collectExperimentalUrls(value, depth + 1, seen));
    }
  }
  return results;
}

/**
 * URL 参数改写：把播放地址的 lr 参数替换为 video_gen_no_watermark。
 * 注：8-13 热修验证该参数对当前平台可能无效（水印为服务端渲染）——实验候选，不保证效果。
 */
export function rewriteLrParam(url: string): string {
  try {
    const u = new URL(url);
    const lr = u.searchParams.get('lr');
    if (lr && lr !== 'video_gen_no_watermark') {
      u.searchParams.set('lr', 'video_gen_no_watermark');
      return u.toString();
    }
    if (!lr) {
      u.searchParams.set('lr', 'video_gen_no_watermark');
      return u.toString();
    }
    return url;
  } catch {
    return url;
  }
}

/** webview 类型（最小面，避免依赖 electron 类型）。 */
interface ExperimentalWebview {
  executeJavaScript: (code: string) => Promise<unknown>;
}

/**
 * 实验直取：无条件读取官方接口原始响应（不检查 without_watermark），
 * 并从响应深度扫描候选地址；附带普通播放地址的参数改写候选。
 */
export async function tryExperimentalDirectExtract(
  webview: ExperimentalWebview,
  vid: string,
  timeoutMs: number,
): Promise<VideoCandidate[]> {
  const candidates: VideoCandidate[] = [];
  if (!vid) return candidates;

  const code = `
    (function() {
      var vid = ${JSON.stringify(vid)};
      var timeoutMs = ${timeoutMs};
      function probe(path, body) {
        var controller = new AbortController();
        var timer = setTimeout(function() { controller.abort(); }, timeoutMs);
        return fetch(path, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'origin': location.origin, 'referer': location.href },
          credentials: 'include',
          body: JSON.stringify(body),
          signal: controller.signal,
        }).then(function(r) { return r.text().then(function(t) { return t; }); })
          .catch(function() { return null; })
          .finally(function() { clearTimeout(timer); });
      }
      return Promise.all([
        probe('/creativity/resource/get_without_watermark', { vid: [vid] }),
        probe('/samantha/media/get_play_info', { vid: vid }),
      ]).then(function(responses) {
        return responses.filter(Boolean);
      });
    })();
  `;

  let rawResponses: unknown;
  try {
    rawResponses = await webview.executeJavaScript(code);
  } catch {
    return candidates;
  }
  if (!Array.isArray(rawResponses)) return candidates;

  const urls: string[] = [];
  for (const raw of rawResponses) {
    if (typeof raw !== 'string') continue;
    try {
      const parsed = JSON.parse(raw);
      urls.push(...collectExperimentalUrls(parsed));
    } catch {
      /* 非 JSON 响应跳过 */
    }
  }
  // 参数改写候选（对普通播放地址附加 lr=video_gen_no_watermark）
  for (const url of urls) {
    const rewritten = rewriteLrParam(url);
    if (rewritten !== url) urls.push(rewritten);
  }
  // 去重（保持顺序）
  const seen = new Set<string>();
  for (const url of urls) {
    if (seen.has(url)) continue;
    seen.add(url);
    candidates.push({ url, source: 'experimental', isOriginal: false, vid });
  }
  return candidates;
}
