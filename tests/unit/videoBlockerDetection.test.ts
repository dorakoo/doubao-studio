/**
 * tests/unit/videoBlockerDetection.test.ts
 * 视频生成阻断检测的回归测试
 *
 * 验证 detectVideoGenerationBlocker 的短语列表和选择器：
 * - 不包含孤立的泛化词（如"暂不支持""违规""无法生成"）
 * - 不扫描聊天消息容器 [class*="message"]
 * - 会员/权益类短语必须带上下文
 */

import { describe, it, expect } from 'vitest';
import { VIDEO_BLOCKER_PHRASES, VIDEO_BLOCKER_SELECTORS } from '../../src/utils/doubaoBridge';

describe('VIDEO_BLOCKER_PHRASES', () => {
  it('不包含孤立的"暂不支持"', () => {
    // "暂不支持"单独出现可能匹配用户提示词或页面说明
    // 只允许带上下文的组合短语如"暂不支持上传真人脸素材"
    const standalone = VIDEO_BLOCKER_PHRASES.filter(p => p === '暂不支持');
    expect(standalone).toHaveLength(0);
  });

  it('不包含孤立的"违规"', () => {
    // "违规"可能出现在用户提示词中
    const standalone = VIDEO_BLOCKER_PHRASES.filter(p => p === '违规');
    expect(standalone).toHaveLength(0);
  });

  it('不包含孤立的"无法生成"', () => {
    // "无法生成"可能出现在正常对话中
    const standalone = VIDEO_BLOCKER_PHRASES.filter(p => p === '无法生成');
    expect(standalone).toHaveLength(0);
  });

  it('包含"暂不支持上传真人脸素材"（带上下文）', () => {
    expect(VIDEO_BLOCKER_PHRASES).toContain('暂不支持上传真人脸素材');
  });

  it('包含会员限制相关短语', () => {
    expect(VIDEO_BLOCKER_PHRASES).toContain('会员专享');
    expect(VIDEO_BLOCKER_PHRASES).toContain('仅限会员');
    expect(VIDEO_BLOCKER_PHRASES).toContain('仅会员可用');
    expect(VIDEO_BLOCKER_PHRASES).toContain('开通会员');
    expect(VIDEO_BLOCKER_PHRASES).toContain('升级会员');
    expect(VIDEO_BLOCKER_PHRASES).toContain('权益不足');
    expect(VIDEO_BLOCKER_PHRASES).toContain('当前模型仅限会员');
  });

  it('包含额度耗尽相关短语', () => {
    expect(VIDEO_BLOCKER_PHRASES).toContain('今日视频生成免费次数用完了');
    expect(VIDEO_BLOCKER_PHRASES).toContain('次数已用完');
    expect(VIDEO_BLOCKER_PHRASES).toContain('次数不足');
    expect(VIDEO_BLOCKER_PHRASES).toContain('余额不足');
  });

  it('包含生成失败相关短语', () => {
    expect(VIDEO_BLOCKER_PHRASES).toContain('视频生成失败');
    expect(VIDEO_BLOCKER_PHRASES).toContain('生成失败');
    expect(VIDEO_BLOCKER_PHRASES).toContain('生成异常');
    expect(VIDEO_BLOCKER_PHRASES).toContain('豆包已停止生成');
  });

  it('包含内容审核相关短语', () => {
    expect(VIDEO_BLOCKER_PHRASES).toContain('内容未通过');
    expect(VIDEO_BLOCKER_PHRASES).toContain('审核未通过');
  });

  it('所有短语都是非空字符串', () => {
    for (const phrase of VIDEO_BLOCKER_PHRASES) {
      expect(typeof phrase).toBe('string');
      expect(phrase.length).toBeGreaterThan(0);
    }
  });

  it('回归：用户提示词"请生成一个暂不支持的视频"不会被误匹配', () => {
    // 模拟页面文本包含用户提示词，但不含真正的限制短语
    const userPrompt = '请生成一个暂不支持的视频类型';
    const matched = VIDEO_BLOCKER_PHRASES.find(p => userPrompt.includes(p));
    // "暂不支持"不在短语列表中，所以不应该匹配
    expect(matched).toBeUndefined();
  });

  it('回归：历史消息"此内容违规"不会被误匹配', () => {
    // "违规"不在短语列表中
    const historicalMessage = '此内容违规，请修改后重试';
    const matched = VIDEO_BLOCKER_PHRASES.find(p => historicalMessage.includes(p));
    expect(matched).toBeUndefined();
  });

  it('回归：历史消息"无法生成满意的结果"不会被误匹配', () => {
    // "无法生成"不在短语列表中
    const historicalMessage = '无法生成满意的结果，请尝试其他方式';
    const matched = VIDEO_BLOCKER_PHRASES.find(p => historicalMessage.includes(p));
    expect(matched).toBeUndefined();
  });

  it('回归：真正的会员限制"权益不足，请开通会员"会被匹配', () => {
    const blockMessage = '权益不足，请开通会员后使用';
    const matched = VIDEO_BLOCKER_PHRASES.find(p => blockMessage.includes(p));
    expect(matched).toBeDefined();
    // 应该匹配到会员/权益相关的短语
    expect(['权益不足', '开通会员']).toContain(matched);
  });

  it('回归：真正的额度耗尽"今日视频生成免费次数用完了"会被匹配', () => {
    const blockMessage = '今日视频生成免费次数用完了';
    const matched = VIDEO_BLOCKER_PHRASES.find(p => blockMessage.includes(p));
    expect(matched).toBeDefined();
  });
});

describe('VIDEO_BLOCKER_SELECTORS', () => {
  it('不包含 [class*="message"] 选择器', () => {
    // 聊天消息容器不应被扫描，防止历史消息误判
    const hasMessageSelector = VIDEO_BLOCKER_SELECTORS.some(s => s.includes('message'));
    expect(hasMessageSelector).toBe(false);
  });

  it('包含 dialog 和 alert 选择器', () => {
    expect(VIDEO_BLOCKER_SELECTORS).toContain('[role="dialog"]');
    expect(VIDEO_BLOCKER_SELECTORS).toContain('[role="alert"]');
  });

  it('包含 toast 选择器', () => {
    expect(VIDEO_BLOCKER_SELECTORS.some(s => s.includes('toast') || s.includes('Toast'))).toBe(true);
  });

  it('包含 notice 选择器', () => {
    expect(VIDEO_BLOCKER_SELECTORS.some(s => s.includes('notice') || s.includes('Notice'))).toBe(true);
  });

  it('包含 error 选择器', () => {
    expect(VIDEO_BLOCKER_SELECTORS.some(s => s.includes('error') || s.includes('Error'))).toBe(true);
  });

  it('所有选择器都是非空字符串', () => {
    for (const selector of VIDEO_BLOCKER_SELECTORS) {
      expect(typeof selector).toBe('string');
      expect(selector.length).toBeGreaterThan(0);
    }
  });
});
