/**
 * main/utils/downloadValidation.ts
 *
 * 下载产物验证与错误分类工具（主进程侧）。
 * 独立于渲染进程的 videoArtifactResolver，避免跨进程导入。
 */

/** 下载失败分类 */
export type DownloadFailureType =
  | 'http_error'
  | 'empty_file'
  | 'invalid_content'
  | 'network_error'
  | 'disk_error'
  | 'unknown';

/** 下载验证结果 */
export interface DownloadValidationResult {
  valid: boolean;
  failureType?: DownloadFailureType;
  message?: string;
}

/**
 * 验证下载响应的基本合法性。
 * - HTTP 状态码 2xx
 * - 非空文件
 * - 视频模式下 content-type 合理
 */
export function validateDownloadResponse(
  statusCode: number,
  contentType: string,
  fileSize: number,
  mode: string,
): DownloadValidationResult {
  if (statusCode < 200 || statusCode >= 300) {
    if (statusCode === 401 || statusCode === 403) {
      return { valid: false, failureType: 'http_error', message: `HTTP ${statusCode}：登录态失效或无权限` };
    }
    if (statusCode === 404 || statusCode === 410) {
      return { valid: false, failureType: 'http_error', message: `HTTP ${statusCode}：产物地址已过期或不存在` };
    }
    return { valid: false, failureType: 'http_error', message: `HTTP ${statusCode}` };
  }

  if (fileSize === 0) {
    return { valid: false, failureType: 'empty_file', message: '下载文件为空' };
  }

  if (mode === 'video' && contentType) {
    const lower = contentType.toLowerCase();
    const isVideo =
      lower.includes('video/') ||
      lower.includes('octet-stream') ||
      lower.includes('binary/');
    if (!isVideo) {
      return { valid: false, failureType: 'invalid_content', message: `非视频类型：${contentType}` };
    }
  }

  return { valid: true };
}

/**
 * 对下载异常进行分类。
 */
export function classifyDownloadException(
  error: { name?: string; message?: string },
): { type: DownloadFailureType; message: string } {
  const msg = error.message || '';
  const lower = msg.toLowerCase();
  if (lower.includes('abort') || lower.includes('超时') || lower.includes('timeout')) {
    return { type: 'network_error', message: '下载超时' };
  }
  if (lower.includes('network') || lower.includes('econnreset') || lower.includes('enetunreach')) {
    return { type: 'network_error', message: '网络连接失败' };
  }
  if (lower.includes('enospc') || lower.includes('disk') || lower.includes('写入')) {
    return { type: 'disk_error', message: '磁盘空间不足或写入失败' };
  }
  return { type: 'unknown', message: msg || '未知错误' };
}
