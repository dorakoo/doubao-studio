/**
 * tests/unit/errorClassification.test.ts
 * 任务错误分类回归测试
 */

import { describe, it, expect } from 'vitest';
import { classifyTaskError } from '../../src/utils/errorClassification';

describe('classifyTaskError', () => {
  const FIXED_TIME = '2025-01-01T00:00:00.000Z';

  it('匹配 cancelled — 取消/中止', () => {
    const result = classifyTaskError('任务已取消', FIXED_TIME);
    expect(result.code).toBe('cancelled');
    expect(result.recoverable).toBe(true);
    expect(result.detectedAt).toBe(FIXED_TIME);
  });

  it('匹配 cancelled — abort', () => {
    const result = classifyTaskError('Request was aborted by user', FIXED_TIME);
    expect(result.code).toBe('cancelled');
  });

  it('匹配 quota_exhausted — 次数用完（不可恢复）', () => {
    const result = classifyTaskError('免费次数已用完', FIXED_TIME);
    expect(result.code).toBe('quota_exhausted');
    expect(result.recoverable).toBe(false);
  });

  it('匹配 quota_exhausted — 余额不足', () => {
    const result = classifyTaskError('账户余额不足', FIXED_TIME);
    expect(result.code).toBe('quota_exhausted');
    expect(result.recoverable).toBe(false);
  });

  it('匹配 membership_required', () => {
    const result = classifyTaskError('此功能仅限会员', FIXED_TIME);
    expect(result.code).toBe('membership_required');
    expect(result.recoverable).toBe(true);
  });

  it('匹配 face_restricted', () => {
    const result = classifyTaskError('检测到真人脸，肖像保护', FIXED_TIME);
    expect(result.code).toBe('face_restricted');
    expect(result.recoverable).toBe(false);
  });

  it('匹配 content_rejected', () => {
    const result = classifyTaskError('内容未通过审核', FIXED_TIME);
    expect(result.code).toBe('content_rejected');
  });

  it('匹配 verification', () => {
    const result = classifyTaskError('请完成机器人验证', FIXED_TIME);
    expect(result.code).toBe('verification');
  });

  it('匹配 output_missing', () => {
    const result = classifyTaskError('产物下载地址超时', FIXED_TIME);
    expect(result.code).toBe('output_missing');
  });

  it('匹配 submission_failed', () => {
    const result = classifyTaskError('提交失败，请重试', FIXED_TIME);
    expect(result.code).toBe('submission_failed');
  });

  it('匹配 page_changed', () => {
    const result = classifyTaskError('未找到输入框，注入失败', FIXED_TIME);
    expect(result.code).toBe('page_changed');
  });

  it('匹配 network', () => {
    const result = classifyTaskError('network error', FIXED_TIME);
    expect(result.code).toBe('network');
  });

  it('匹配 timeout', () => {
    const result = classifyTaskError('请求超时', FIXED_TIME);
    expect(result.code).toBe('timeout');
  });

  it('匹配 generation_failed', () => {
    const result = classifyTaskError('生成失败，请重试', FIXED_TIME);
    expect(result.code).toBe('generation_failed');
  });

  it('未匹配时返回 unknown，默认可恢复', () => {
    const result = classifyTaskError('一个完全无法识别的错误消息', FIXED_TIME);
    expect(result.code).toBe('unknown');
    expect(result.recoverable).toBe(true);
    expect(result.message).toBe('一个完全无法识别的错误消息');
  });

  it('保留原始消息', () => {
    const msg = '免费次数已用完，请明天再来';
    const result = classifyTaskError(msg, FIXED_TIME);
    expect(result.message).toBe(msg);
  });

  it('detectedAt 默认使用当前时间', () => {
    const before = new Date().toISOString();
    const result = classifyTaskError('timeout');
    const after = new Date().toISOString();
    expect(result.detectedAt >= before).toBe(true);
    expect(result.detectedAt <= after).toBe(true);
  });
});
