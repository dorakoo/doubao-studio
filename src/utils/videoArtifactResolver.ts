/**
 * src/utils/videoArtifactResolver.ts
 *
 * 视频产物解析纯函数 — 不依赖 DOM/React/Electron 运行时。
 *
 * 负责将平台响应解析为结构化结果、对候选地址排序、判断 URL 可信度，
 * 并对 HTTP 错误进行分类。所有 webview 上下文操作由 doubaoBridge.ts 调用。
 */

// ==================== 类型定义 ====================

/** 产物地址来源，按可信度从高到低排列 */
export type VideoArtifactSource =
  | 'platform_download_info'   // 创作空间下载信息接口明确返回的地址
  | 'play_info'                // get_play_info 接口返回的 original_media_info / download_url
  | 'captured_response'        // SSE 响应中拦截到的原始媒体地址
  | 'conversation_scan'        // 从对话/Thread 页面结构化数据中提取的地址
  | 'page_fallback';           // 普通 DOM 结果 URL，非原始地址

/** 解析状态 */
export type VideoArtifactStatus =
  | 'resolved'                 // 成功获取到地址
  | 'unavailable'              // 平台未返回可用地址
  | 'expired'                  // 产物已过期
  | 'unauthorized'             // 登录失效或无权限
  | 'retryable_error'          // 网络/超时等可重试错误
  | 'needs_manual_selection';  // 多个候选无法唯一匹配

/** 单次策略尝试记录 */
export interface ArtifactAttempt {
  strategy: string;
  result: 'success' | 'fail' | 'skip';
  reason?: string;
}

/** 解析结果 */
export interface VideoArtifactResolution {
  status: VideoArtifactStatus;
  url?: string;
  source?: VideoArtifactSource;
  vid?: string;
  reason?: string;
  attempts: ArtifactAttempt[];
}

/** 从响应中解析出的视频候选地址 */
export interface VideoCandidate {
  url: string;
  source: VideoArtifactSource;
  vid?: string;
  isOriginal: boolean;
}

// ==================== 响应解析纯函数 ====================

/**
 * 从 get_play_info 接口响应中提取视频地址。
 * 优先使用 original_media_info，其次 download_url / no_watermark_url，最后 play_info。
 */
export function parsePlayInfoResponse(raw: unknown): VideoCandidate | null {
  if (!raw || typeof raw !== 'object') return null;
  const data = (raw as Record<string, unknown>).data;
  if (!data || typeof data !== 'object') return null;
  const obj = data as Record<string, unknown>;

  // 1. original_media_info.main_url / main
  const originalMedia = obj.original_media_info;
  if (originalMedia && typeof originalMedia === 'object') {
    const om = originalMedia as Record<string, unknown>;
    const url = extractUrlFromFields(om, ['main_url', 'main', 'url', 'download_url']);
    if (url) {
      return { url, source: 'play_info', isOriginal: true };
    }
  }

  // 2. download_url
  if (typeof obj.download_url === 'string' && isValidVideoUrl(obj.download_url)) {
    return { url: obj.download_url, source: 'play_info', isOriginal: true };
  }

  // 3. no_watermark_url
  if (typeof obj.no_watermark_url === 'string' && isValidVideoUrl(obj.no_watermark_url)) {
    return { url: obj.no_watermark_url, source: 'play_info', isOriginal: true };
  }

  // 4. play_info.main
  const playInfo = obj.play_info;
  if (playInfo && typeof playInfo === 'object') {
    const pi = playInfo as Record<string, unknown>;
    const url = extractUrlFromFields(pi, ['main_url', 'main', 'url']);
    if (url) {
      return { url, source: 'play_info', isOriginal: false };
    }
  }

  // 5. play_infos[0].main
  if (Array.isArray(obj.play_infos) && obj.play_infos.length > 0) {
    const first = obj.play_infos[0];
    if (first && typeof first === 'object') {
      const url = extractUrlFromFields(first as Record<string, unknown>, ['main_url', 'main', 'url']);
      if (url) {
        return { url, source: 'play_info', isOriginal: false };
      }
    }
  }

  // 6. 深度搜索
  const deepUrl = findVideoUrlDeep(obj, 0);
  if (deepUrl) {
    return { url: deepUrl, source: 'play_info', isOriginal: false };
  }

  return null;
}

/**
 * 从创作空间下载信息接口响应中提取视频地址。
 */
export function parseDownloadInfoResponse(raw: unknown): VideoCandidate | null {
  if (!raw || typeof raw !== 'object') return null;
  const data = (raw as Record<string, unknown>).data;
  if (!data || typeof data !== 'object') return null;
  const obj = data as Record<string, unknown>;

  // 下载信息接口可能返回 download_url_list、download_infos 或直接 download_url
  if (typeof obj.download_url === 'string' && isValidVideoUrl(obj.download_url)) {
    return { url: obj.download_url, source: 'platform_download_info', isOriginal: true };
  }

  // download_infos[].main_url — 创作空间 aispace/get_download_info 常见结构
  if (Array.isArray(obj.download_infos)) {
    for (const item of obj.download_infos) {
      if (item && typeof item === 'object') {
        const url = extractUrlFromFields(item as Record<string, unknown>, ['main_url', 'main', 'url', 'download_url']);
        if (url) {
          return { url, source: 'platform_download_info', isOriginal: true };
        }
      }
      if (typeof item === 'string' && isValidVideoUrl(item)) {
        return { url: item, source: 'platform_download_info', isOriginal: true };
      }
    }
  }

  if (Array.isArray(obj.download_url_list)) {
    for (const item of obj.download_url_list) {
      if (typeof item === 'string' && isValidVideoUrl(item)) {
        return { url: item, source: 'platform_download_info', isOriginal: true };
      }
      if (item && typeof item === 'object') {
        const url = extractUrlFromFields(item as Record<string, unknown>, ['url', 'main_url', 'download_url']);
        if (url) {
          return { url, source: 'platform_download_info', isOriginal: true };
        }
      }
    }
  }

  // original_media_info
  const originalMedia = obj.original_media_info;
  if (originalMedia && typeof originalMedia === 'object') {
    const url = extractUrlFromFields(originalMedia as Record<string, unknown>, ['main_url', 'main', 'url']);
    if (url) {
      return { url, source: 'platform_download_info', isOriginal: true };
    }
  }

  // main_url
  if (typeof obj.main_url === 'string' && isValidVideoUrl(obj.main_url)) {
    return { url: obj.main_url, source: 'platform_download_info', isOriginal: true };
  }

  return null;
}

/**
 * 从 SSE / 拦截响应中解析视频缓存数据。
 */
export function parseCapturedResponse(raw: unknown): VideoCandidate | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;

  // 优先找 original_media_info
  const originalMedia = obj.original_media_info;
  if (originalMedia && typeof originalMedia === 'object') {
    const url = extractUrlFromFields(originalMedia as Record<string, unknown>, ['main_url', 'main', 'url']);
    if (url) {
      return { url, source: 'captured_response', isOriginal: true, vid: findVidDeep(obj, 0) };
    }
  }

  // play_info
  const playInfo = obj.play_info;
  if (playInfo && typeof playInfo === 'object') {
    const pi = playInfo as Record<string, unknown>;
    const url = extractUrlFromFields(pi, ['main_url', 'main', 'url']);
    if (url) {
      return { url, source: 'captured_response', isOriginal: false, vid: findVidDeep(obj, 0) };
    }
  }

  // 直接的 download_url
  if (typeof obj.download_url === 'string' && isValidVideoUrl(obj.download_url)) {
    return { url: obj.download_url, source: 'captured_response', isOriginal: true, vid: findVidDeep(obj, 0) };
  }

  return null;
}

// ==================== 对话页面结构化数据解析 ====================

/**
 * 从对话页面中提取的结构化数据（如 __NEXT_DATA__、全局变量等）。
 * 用于从 Thread 页面响应中提取 vid 或平台明确提供的媒体地址。
 */
export interface ConversationScanResult {
  vid?: string;
  candidates: VideoCandidate[];
}

/**
 * 从对话页面的结构化数据中提取视频候选地址和 vid。
 * 输入为页面上下文中可访问的 JSON 可序列化对象。
 *
 * 关键约束：URL 与 original_media_info 必须属于同一个对象，
 * 不允许从 A 对象取 URL、从 B 对象取 original_media_info 标记。
 */
export function parseConversationScanData(raw: unknown): ConversationScanResult {
  const candidates: VideoCandidate[] = [];
  if (!raw || typeof raw !== 'object') return { candidates };

  const obj = raw as Record<string, unknown>;
  const vid = findVidDeep(obj, 0);
  const foundUrls = new Set<string>();

  // 1. 从 original_media_info 对象内部提取 URL（保证同一对象 → isOriginal: true）
  const originalUrls = collectUrlsFromKey(obj, 'original_media_info');
  for (const url of originalUrls) {
    if (!foundUrls.has(url)) {
      foundUrls.add(url);
      candidates.push({ url, source: 'conversation_scan', vid, isOriginal: true });
    }
  }

  // 2. 从 download_url 字段提取（字段本身就是 URL → isOriginal: true）
  const downloadUrls = collectUrlsFromKey(obj, 'download_url');
  for (const url of downloadUrls) {
    if (!foundUrls.has(url)) {
      foundUrls.add(url);
      candidates.push({ url, source: 'conversation_scan', vid, isOriginal: true });
    }
  }

  // 3. 从 no_watermark_url 字段提取（明确无水印 → isOriginal: true）
  const noWmUrls = collectUrlsFromKey(obj, 'no_watermark_url');
  for (const url of noWmUrls) {
    if (!foundUrls.has(url)) {
      foundUrls.add(url);
      candidates.push({ url, source: 'conversation_scan', vid, isOriginal: true });
    }
  }

  // 4. 从 play_info / play_infos 对象提取 URL（普通播放地址 → isOriginal: false）
  const playInfoUrls = collectUrlsFromKey(obj, 'play_info');
  for (const url of playInfoUrls) {
    if (!foundUrls.has(url)) {
      foundUrls.add(url);
      candidates.push({ url, source: 'conversation_scan', vid, isOriginal: false });
    }
  }
  const playInfosUrls = collectUrlsFromKey(obj, 'play_infos');
  for (const url of playInfosUrls) {
    if (!foundUrls.has(url)) {
      foundUrls.add(url);
      candidates.push({ url, source: 'conversation_scan', vid, isOriginal: false });
    }
  }

  // 5. 深度搜索其他视频 URL（无法证明来自原始字段 → isOriginal: false）
  const deepUrl = findVideoUrlDeep(obj, 0);
  if (deepUrl && !foundUrls.has(deepUrl)) {
    candidates.push({ url: deepUrl, source: 'conversation_scan', vid, isOriginal: false });
  }

  return { vid, candidates };
}

/**
 * 遍历对象树，当找到包含指定 key 的对象时，
 * 从该 key 对应的值中提取视频 URL。
 * 保证 URL 与 key 属于同一个对象，不会串数据。
 */
function collectUrlsFromKey(obj: Record<string, unknown>, keyName: string): string[] {
  const urls: string[] = [];
  function search(node: unknown, depth: number): void {
    if (depth > 12 || !node) return;
    if (Array.isArray(node)) {
      for (const item of node) search(item, depth + 1);
      return;
    }
    if (typeof node !== 'object') return;
    const record = node as Record<string, unknown>;
    // 当前对象包含目标 key → 从该 key 的值中提取 URL
    if (keyName in record) {
      const target = record[keyName];
      if (typeof target === 'string' && isValidVideoUrl(target)) {
        urls.push(target);
      } else if (target && typeof target === 'object') {
        const targetObj = target as Record<string, unknown>;
        const url = extractUrlFromFields(targetObj, ['main_url', 'main', 'url', 'download_url']);
        if (url) {
          urls.push(url);
        } else {
          // 在 target 内部深度搜索
          const deepUrl = findVideoUrlDeep(targetObj, 0);
          if (deepUrl) urls.push(deepUrl);
        }
      }
    }
    // 继续递归子节点（可能有多个同 key 对象，如数组中的多个消息）
    for (const k in record) {
      if (Object.prototype.hasOwnProperty.call(record, k) && k !== keyName) {
        search(record[k], depth + 1);
      }
    }
  }
  search(obj, 0);
  return urls;
}

// ==================== 候选排序 ====================

/** SOURCE 优先级映射，数值越小越优先 */
const SOURCE_PRIORITY: Record<VideoArtifactSource, number> = {
  platform_download_info: 0,
  play_info: 1,
  captured_response: 2,
  conversation_scan: 3,
  page_fallback: 4,
};

/**
 * 按可信度排序候选地址。
 * 1. 原始地址优先于非原始地址
 * 2. 同级别按 source 优先级
 */
export function sortCandidatesByTrust(candidates: VideoCandidate[]): VideoCandidate[] {
  return [...candidates].sort((a, b) => {
    if (a.isOriginal !== b.isOriginal) return a.isOriginal ? -1 : 1;
    const pa = SOURCE_PRIORITY[a.source] ?? 99;
    const pb = SOURCE_PRIORITY[b.source] ?? 99;
    return pa - pb;
  });
}

// ==================== URL 可信度判断 ====================

/**
 * 判断 URL 是否为有效的视频地址。
 */
export function isValidVideoUrl(url: unknown): url is string {
  if (typeof url !== 'string' || url.length < 10) return false;
  if (!url.startsWith('http://') && !url.startsWith('https://')) return false;
  const lower = url.toLowerCase();
  return (
    lower.includes('video') ||
    lower.includes('vod') ||
    lower.includes('.mp4') ||
    lower.includes('tos-') ||
    lower.includes('byteimg') ||
    lower.includes('byteoss') ||
    lower.includes('tosv')
  );
}

/**
 * 判断 URL 是否来自平台明确返回的原始媒体地址。
 * 注意：captured_response 的原始性取决于运行时字段来源（fieldSource），
 * 此函数仅基于 URL 字符串做保守判定，默认返回 false。
 */
export function isOriginalMediaUrl(url: string, source: VideoArtifactSource): boolean {
  if (source === 'platform_download_info') return true;
  if (source === 'captured_response') {
    // 无法从 URL 本身证明字段来源，保守判定为非原始
    const lower = url.toLowerCase();
    if (lower.includes('no_watermark')) return true;
    if (lower.includes('original')) return true;
    return false;
  }
  if (source === 'play_info') {
    // play_info 中的 original_media_info 标记为原始
    const lower = url.toLowerCase();
    if (lower.includes('no_watermark')) return true;
    if (lower.includes('original')) return true;
    return false;
  }
  return false;
}

// ==================== 会话匹配过滤 ====================

/** 用于候选过滤的上下文信息 */
export interface CandidateFilterContext {
  /** 任务自身的对话 URL */
  conversationUrl?: string;
  /** 已知 vid */
  vid?: string;
  /** 任务运行 ID */
  runId?: string;
}

/**
 * 判断两个对话 URL 是否属于同一会话。
 * 比较 pathname 和 search 参数中的 conversation_id。
 */
export function isSameConversation(urlA: string, urlB: string): boolean {
  if (!urlA || !urlB) return false;
  if (urlA === urlB) return true;
  try {
    const a = new URL(urlA);
    const b = new URL(urlB);
    if (a.origin !== b.origin) return false;
    if (a.pathname !== b.pathname) return false;
    // 比较关键查询参数
    const convA = a.searchParams.get('conversation_id') || a.searchParams.get('conv_id') || '';
    const convB = b.searchParams.get('conversation_id') || b.searchParams.get('conv_id') || '';
    if (convA && convB) return convA === convB;
    // 如果都没有 conversation_id，则比较完整 search
    return a.search === b.search;
  } catch {
    return false;
  }
}

/**
 * 按任务上下文过滤候选地址。
 *
 * 核心原则：提供了 conversationUrl 意味着调用方知道当前任务对应哪个会话，
 * 此时必须能证明候选属于该会话才能接受。
 *
 * - 有 vid：仅保留 vid 匹配的候选；无匹配则返回空（不回退到无 vid 候选）
 * - 无 vid 但有 conversationUrl：拒绝所有候选（无法证明归属）
 * - 无 vid 且无 conversationUrl：全部保留（兼容无上下文场景）
 */
export function filterCandidatesByContext(
  candidates: VideoCandidate[],
  ctx: CandidateFilterContext,
): VideoCandidate[] {
  if (candidates.length === 0) return [];

  // 有 vid：仅保留 vid 匹配的候选
  if (ctx.vid) {
    const vidMatches = candidates.filter((c) => c.vid && c.vid === ctx.vid);
    if (vidMatches.length > 0) return vidMatches;

    // vid 不匹配：提供了 conversationUrl 则拒绝全部，否则回退到无 vid 候选
    if (ctx.conversationUrl) return [];

    // 无 conversationUrl 的旧路径兼容
    const noVidCandidates = candidates.filter((c) => !c.vid);
    if (noVidCandidates.length > 0 && noVidCandidates.length < candidates.length) {
      return noVidCandidates;
    }
    if (candidates.every((c) => c.vid)) return [];
  }

  // 无 vid 但有 conversationUrl：拒绝所有候选（无法证明归属）
  if (!ctx.vid && ctx.conversationUrl) {
    return [];
  }

  // 无 vid 且无 conversationUrl：全部保留
  return candidates;
}

// ==================== 错误分类 ====================

/**
 * 根据HTTP状态码和响应体分类视频解析错误。
 */
export function classifyVideoResolutionError(status: number, body: unknown): VideoArtifactStatus {
  if (status === 401 || status === 403) return 'unauthorized';
  if (status === 404 || status === 410) return 'expired';
  if (status === 429) return 'retryable_error';
  if (status >= 500) return 'retryable_error';

  // 检查响应体中的业务错误码
  if (body && typeof body === 'object') {
    const obj = body as Record<string, unknown>;
    const code = obj.code ?? obj.err_no ?? obj.errno;
    const message = typeof obj.message === 'string' ? obj.message : '';
    const codeNum = Number(code);

    // 登录失效
    if (codeNum === 401 || codeNum === 403 || message.includes('登录') || message.includes('login')) {
      return 'unauthorized';
    }
    // 产物过期/不存在
    if (codeNum === 404 || codeNum === 410 || message.includes('过期') || message.includes('不存在') || message.includes('expired')) {
      return 'expired';
    }
    // 额度/会员限制
    if (message.includes('次数') || message.includes('余额') || message.includes('会员') || message.includes('权益')) {
      return 'unauthorized';
    }
  }

  return 'unavailable';
}

// ==================== 辅助函数 ====================

/** 从对象的指定字段中提取第一个有效 URL */
function extractUrlFromFields(obj: Record<string, unknown>, fields: string[]): string | null {
  for (const field of fields) {
    const value = obj[field];
    if (typeof value === 'string' && isValidVideoUrl(value)) {
      return value;
    }
  }
  return null;
}

/** 深度搜索对象中的视频 URL */
function findVideoUrlDeep(obj: Record<string, unknown>, depth: number): string | null {
  if (depth > 12 || !obj) return null;

  if (Array.isArray(obj)) {
    for (const item of obj) {
      const url = findVideoUrlDeep(item as Record<string, unknown>, depth + 1);
      if (url) return url;
    }
    return null;
  }

  if (typeof obj !== 'object') return null;

  const preferredKeys = ['no_watermark_url', 'download_url', 'main_url', 'main', 'play_url', 'url'];
  for (const key of preferredKeys) {
    const value = (obj as Record<string, unknown>)[key];
    if (typeof value === 'string' && isValidVideoUrl(value)) {
      return value;
    }
  }

  const containers = ['original_media_info', 'original', 'source', 'play_info', 'play_infos', 'media_info'];
  for (const key of containers) {
    const nested = (obj as Record<string, unknown>)[key];
    if (nested) {
      const url = findVideoUrlDeep(nested as Record<string, unknown>, depth + 1);
      if (url) return url;
    }
  }

  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key) && !containers.includes(key) && !preferredKeys.includes(key)) {
      const nested = (obj as Record<string, unknown>)[key];
      if (nested && typeof nested === 'object') {
        const url = findVideoUrlDeep(nested as Record<string, unknown>, depth + 1);
        if (url) return url;
      }
    }
  }

  return null;
}

/** 深度搜索对象中的 vid */
function findVidDeep(obj: Record<string, unknown>, depth: number): string | undefined {
  if (depth > 12 || !obj) return undefined;
  if (Array.isArray(obj)) {
    for (const item of obj) {
      const vid = findVidDeep(item as Record<string, unknown>, depth + 1);
      if (vid) return vid;
    }
    return undefined;
  }
  if (typeof obj !== 'object') return undefined;
  const vid = (obj as Record<string, unknown>).vid ?? (obj as Record<string, unknown>).video_id ?? (obj as Record<string, unknown>).videoId;
  if (typeof vid === 'string' && vid.length >= 10) return vid;
  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      const nested = (obj as Record<string, unknown>)[key];
      if (nested && typeof nested === 'object') {
        const found = findVidDeep(nested as Record<string, unknown>, depth + 1);
        if (found) return found;
      }
    }
  }
  return undefined;
}

/**
 * 构建一个失败的解析结果。
 */
export function createFailedResolution(
  status: VideoArtifactStatus,
  reason: string,
  attempts: ArtifactAttempt[],
  vid?: string,
): VideoArtifactResolution {
  return { status, reason, attempts, vid };
}

/**
 * 构建一个成功的解析结果。
 */
export function createResolvedResolution(
  url: string,
  source: VideoArtifactSource,
  vid: string | undefined,
  attempts: ArtifactAttempt[],
): VideoArtifactResolution {
  return { status: 'resolved', url, source, vid, attempts };
}

// ==================== 下载错误分类 ====================

/** 下载失败分类 */
export type DownloadFailureType =
  | 'http_error'        // HTTP 状态码非 2xx
  | 'empty_file'        // 下载文件为空
  | 'invalid_content'   // content-type 不是视频/图片
  | 'network_error'     // 网络错误（超时、断连）
  | 'disk_error'        // 磁盘写入失败
  | 'unknown';

/**
 * 对下载失败进行分类，返回可理解的失败类型和消息。
 */
export function classifyDownloadError(
  statusCode: number | null,
  contentType: string | null,
  fileSize: number | null,
  errorMessage: string | null,
  mode: 'video' | 'image' | 'file',
): { type: DownloadFailureType; message: string } {
  // 网络错误
  if (errorMessage) {
    const lower = errorMessage.toLowerCase();
    if (lower.includes('abort') || lower.includes('超时') || lower.includes('timeout')) {
      return { type: 'network_error', message: '下载超时' };
    }
    if (lower.includes('network') || lower.includes('econnreset') || lower.includes('enetunreach')) {
      return { type: 'network_error', message: '网络连接失败' };
    }
    if (lower.includes('enospc') || lower.includes('disk') || lower.includes('写入')) {
      return { type: 'disk_error', message: '磁盘空间不足或写入失败' };
    }
  }

  // HTTP 错误
  if (statusCode !== null && (statusCode < 200 || statusCode >= 300)) {
    if (statusCode === 401 || statusCode === 403) {
      return { type: 'http_error', message: `HTTP ${statusCode}：登录态失效或无权限` };
    }
    if (statusCode === 404 || statusCode === 410) {
      return { type: 'http_error', message: `HTTP ${statusCode}：产物地址已过期或不存在` };
    }
    return { type: 'http_error', message: `HTTP ${statusCode}` };
  }

  // 空文件
  if (fileSize !== null && fileSize === 0) {
    return { type: 'empty_file', message: '下载文件为空' };
  }

  // content-type 校验
  if (contentType && mode === 'video') {
    const lower = contentType.toLowerCase();
    const isVideo = lower.includes('video/') || lower.includes('octet-stream') || lower.includes('binary/');
    if (!isVideo) {
      return { type: 'invalid_content', message: `非视频类型：${contentType}` };
    }
  }

  return { type: 'unknown', message: errorMessage || '未知错误' };
}
