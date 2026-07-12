/**
 * tests/unit/downloadValidation.test.ts
 * 下载产物验证与错误分类回归测试
 */

import { describe, it, expect } from 'vitest';
import {
  validateDownloadResponse,
  classifyDownloadException,
} from '../../main/utils/downloadValidation';

// ==================== validateDownloadResponse ====================

describe('validateDownloadResponse', () => {
  it('HTTP 200 + 视频 content-type + 非空文件 = 有效', () => {
    const result = validateDownloadResponse(200, 'video/mp4', 1024 * 1024, 'video');
    expect(result.valid).toBe(true);
  });

  it('HTTP 200 + octet-stream + 非空文件 = 有效', () => {
    const result = validateDownloadResponse(200, 'application/octet-stream', 512, 'video');
    expect(result.valid).toBe(true);
  });

  it('HTTP 200 + 非 video content-type + video 模式 = 无效', () => {
    const result = validateDownloadResponse(200, 'text/html', 1024, 'video');
    expect(result.valid).toBe(false);
    expect(result.failureType).toBe('invalid_content');
    expect(result.message).toContain('text/html');
  });

  it('HTTP 200 + 空文件 = 无效', () => {
    const result = validateDownloadResponse(200, 'video/mp4', 0, 'video');
    expect(result.valid).toBe(false);
    expect(result.failureType).toBe('empty_file');
  });

  it('HTTP 401 = 无效（未授权）', () => {
    const result = validateDownloadResponse(401, '', 0, 'video');
    expect(result.valid).toBe(false);
    expect(result.failureType).toBe('http_error');
    expect(result.message).toContain('登录态失效');
  });

  it('HTTP 403 = 无效（未授权）', () => {
    const result = validateDownloadResponse(403, '', 0, 'video');
    expect(result.valid).toBe(false);
    expect(result.failureType).toBe('http_error');
  });

  it('HTTP 404 = 无效（过期）', () => {
    const result = validateDownloadResponse(404, '', 0, 'video');
    expect(result.valid).toBe(false);
    expect(result.failureType).toBe('http_error');
    expect(result.message).toContain('已过期或不存在');
  });

  it('HTTP 410 = 无效（过期）', () => {
    const result = validateDownloadResponse(410, '', 0, 'video');
    expect(result.valid).toBe(false);
    expect(result.failureType).toBe('http_error');
  });

  it('HTTP 500 = 无效', () => {
    const result = validateDownloadResponse(500, '', 0, 'video');
    expect(result.valid).toBe(false);
    expect(result.failureType).toBe('http_error');
  });

  it('image 模式不校验 content-type', () => {
    const result = validateDownloadResponse(200, 'image/png', 2048, 'image');
    expect(result.valid).toBe(true);
  });

  it('file 模式不校验 content-type', () => {
    const result = validateDownloadResponse(200, 'application/zip', 4096, 'file');
    expect(result.valid).toBe(true);
  });

  it('HTTP 200 + 空 content-type + video 模式 = 有效（跳过校验）', () => {
    const result = validateDownloadResponse(200, '', 1024, 'video');
    expect(result.valid).toBe(true);
  });
});

// ==================== classifyDownloadException ====================

describe('classifyDownloadException', () => {
  it('AbortError 分类为 network_error', () => {
    const result = classifyDownloadException({ name: 'AbortError', message: 'The operation was aborted' });
    expect(result.type).toBe('network_error');
    expect(result.message).toBe('下载超时');
  });

  it('超时消息分类为 network_error', () => {
    const result = classifyDownloadException({ name: 'Error', message: '请求超时' });
    expect(result.type).toBe('network_error');
  });

  it('ECONNRESET 分类为 network_error', () => {
    const result = classifyDownloadException({ name: 'Error', message: 'ECONNRESET: connection reset' });
    expect(result.type).toBe('network_error');
    expect(result.message).toBe('网络连接失败');
  });

  it('ENOSPC 分类为 disk_error', () => {
    const result = classifyDownloadException({ name: 'Error', message: 'ENOSPC: no space left on device' });
    expect(result.type).toBe('disk_error');
    expect(result.message).toContain('磁盘');
  });

  it('未知错误分类为 unknown', () => {
    const result = classifyDownloadException({ name: 'Error', message: 'something weird happened' });
    expect(result.type).toBe('unknown');
    expect(result.message).toBe('something weird happened');
  });

  it('空错误消息分类为 unknown', () => {
    const result = classifyDownloadException({ name: 'Error', message: '' });
    expect(result.type).toBe('unknown');
    expect(result.message).toBe('未知错误');
  });
});
