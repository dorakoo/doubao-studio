/**
 * tests/unit/videoBlockerDetection.test.ts
 * 视频生成阻断检测的回归测试
 *
 * 验证 detectVideoGenerationBlocker 的短语列表和选择器：
 * - 不包含孤立的泛化词（如"暂不支持""违规""无法生成"）
 * - 不扫描聊天消息容器 [class*="message"]
 * - 会员/权益类短语必须带上下文
 * - 时序场景：提示词包含阻断词时不会被误判（基线刷新后增量文本不含用户消息）
 */

import { describe, it, expect } from 'vitest';
import {
  VIDEO_BLOCKER_PHRASES,
  VIDEO_BLOCKER_SELECTORS,
  matchBlockerPhrase,
  matchBlockerFromLayers,
} from '../../src/utils/doubaoBridge';

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

// ==================== 纯函数测试 ====================

describe('matchBlockerPhrase', () => {
  it('匹配"生成失败"', () => {
    // "视频生成失败" 在短语列表中位于 "生成失败" 之前，优先匹配
    expect(matchBlockerPhrase('视频生成失败，请重试')).toBe('视频生成失败');
    // 不含 "视频" 前缀时匹配 "生成失败"
    expect(matchBlockerPhrase('生成失败，请重试')).toBe('生成失败');
  });

  it('匹配"会员专享"', () => {
    expect(matchBlockerPhrase('此功能为会员专享')).toBe('会员专享');
  });

  it('匹配"次数不足"', () => {
    expect(matchBlockerPhrase('今日次数不足')).toBe('次数不足');
  });

  it('不匹配空文本', () => {
    expect(matchBlockerPhrase('')).toBeNull();
  });

  it('不匹配无阻断词的文本', () => {
    expect(matchBlockerPhrase('这是一个正常的对话消息')).toBeNull();
  });

  it('不匹配含"暂不支持"但不属于阻断短语的文本', () => {
    expect(matchBlockerPhrase('请生成一个暂不支持的视频类型')).toBeNull();
  });
});

// ==================== 时序级回归测试 ====================
//
// 模拟 BrowserPanel 的实际执行链路：
// 1. resetVideoCaptureCache → 设置 baseline（此时页面不含用户提示词）
// 2. injectPrompt → 用户提示词写入页面
// 3. submitPrompt → 提交成功
// 4. refreshBlockerBaseline → 刷新 baseline（此时页面已含用户提示词，baseline 跳过它）
// 5. detectVideoGenerationBlocker → 检查 baseline 之后的增量文本 + 可见提示层
//
// 关键：步骤 4 之后，用户提示词不应出现在增量文本中。

describe('时序：基线刷新防止提示词误判', () => {
  // 模拟页面文本状态
  const initialPageText = '豆包 AI 创作平台 欢迎使用';
  const userPrompt = '请帮我生成一个视频，主题是生成失败后的补救方法';
  const platformBlockText = '权益不足，请开通会员后使用';

  it('提示词含"生成失败"——刷新基线后不触发阻断', () => {
    // 步骤 2-3: 用户提示词写入页面
    const pageAfterPrompt = initialPageText + '\n' + userPrompt;

    // 步骤 4: 刷新基线（baseline = pageAfterPrompt.length）
    const baselineAfterRefresh = pageAfterPrompt.length;

    // 步骤 5: 检测——增量文本应为空（baseline 已跳过用户消息）
    const incrementalText = pageAfterPrompt.slice(baselineAfterRefresh);
    const visibleLayers: string[] = [];

    const result = matchBlockerFromLayers(visibleLayers, incrementalText);
    expect(result).toBeNull();
  });

  it('提示词含"生成失败"——未刷新基线时会误判（证明修复的必要性）', () => {
    // 步骤 1: 初始页面文本（baseline = initialPageText.length）
    const oldBaseline = initialPageText.length;

    // 步骤 2-3: 用户提示词写入页面
    const pageAfterPrompt = initialPageText + '\n' + userPrompt;

    // 未执行步骤 4：基线仍是旧的

    // 步骤 5: 检测——增量文本包含用户提示词！
    const incrementalText = pageAfterPrompt.slice(oldBaseline);

    // 这里会误判——正是修复前的问题
    const result = matchBlockerFromLayers([], incrementalText);
    expect(result).not.toBeNull();
    // "视频生成失败" 在短语列表中优先于 "生成失败"
    expect(['视频生成失败', '生成失败']).toContain(result);
  });

  it('提示词含"会员专享"——刷新基线后不触发阻断', () => {
    const promptWithMembership = '请生成一个会员专享风格的视频';
    const pageAfterPrompt = initialPageText + '\n' + promptWithMembership;
    const baselineAfterRefresh = pageAfterPrompt.length;

    const incrementalText = pageAfterPrompt.slice(baselineAfterRefresh);
    const result = matchBlockerFromLayers([], incrementalText);
    expect(result).toBeNull();
  });

  it('提示词含"次数不足"——刷新基线后不触发阻断', () => {
    const promptWithQuota = '视频讲述次数不足时的应对策略';
    const pageAfterPrompt = initialPageText + '\n' + promptWithQuota;
    const baselineAfterRefresh = pageAfterPrompt.length;

    const incrementalText = pageAfterPrompt.slice(baselineAfterRefresh);
    const result = matchBlockerFromLayers([], incrementalText);
    expect(result).toBeNull();
  });

  it('刷新基线后，平台返回的真正限制提示仍能被检测到', () => {
    // 步骤 4 后：页面文本 = 初始 + 用户提示词
    const pageAfterPrompt = initialPageText + '\n' + userPrompt;
    const baselineAfterRefresh = pageAfterPrompt.length;

    // 步骤 5: 平台返回限制提示（作为新的增量文本）
    const pageAfterBlock = pageAfterPrompt + '\n' + platformBlockText;
    const incrementalText = pageAfterBlock.slice(baselineAfterRefresh);

    const result = matchBlockerFromLayers([], incrementalText);
    expect(result).not.toBeNull();
    expect(['权益不足', '开通会员']).toContain(result);
  });

  it('刷新基线后，平台返回"生成失败"提示仍能被检测到', () => {
    const pageAfterPrompt = initialPageText + '\n' + userPrompt;
    const baselineAfterRefresh = pageAfterPrompt.length;

    // 平台返回的生成失败提示
    const pageAfterBlock = pageAfterPrompt + '\n视频生成失败，请重试';
    const incrementalText = pageAfterBlock.slice(baselineAfterRefresh);

    const result = matchBlockerFromLayers([], incrementalText);
    expect(result).not.toBeNull();
    // "视频生成失败" 在短语列表中优先于 "生成失败"
    expect(['视频生成失败', '生成失败']).toContain(result);
  });

  it('刷新基线后，可见提示层中的限制仍能被检测到', () => {
    // 即使增量文本为空，可见提示层（dialog/toast）中的限制也应被检测到
    const pageAfterPrompt = initialPageText + '\n' + userPrompt;
    const baselineAfterRefresh = pageAfterPrompt.length;

    // 增量文本为空
    const incrementalText = pageAfterPrompt.slice(baselineAfterRefresh);

    // 但可见提示层中有限制文本
    const visibleLayers = ['当前模型仅限会员使用'];

    const result = matchBlockerFromLayers(visibleLayers, incrementalText);
    expect(result).not.toBeNull();
    expect(result).toBe('当前模型仅限会员');
  });

  it('多次生成场景：第二次提交后刷新基线，第一次的回复不会误判', () => {
    // 第一次生成完成后的页面
    const pageAfterFirstGeneration = initialPageText + '\n' + userPrompt + '\n[视频已生成完成]';

    // 第二次提交新提示词
    const secondPrompt = '再来一个关于生成异常处理的视频';
    const pageAfterSecondPrompt = pageAfterFirstGeneration + '\n' + secondPrompt;

    // 刷新基线
    const baselineAfterSecondRefresh = pageAfterSecondPrompt.length;

    // 检测——增量文本应为空
    const incrementalText = pageAfterSecondPrompt.slice(baselineAfterSecondRefresh);
    const result = matchBlockerFromLayers([], incrementalText);
    expect(result).toBeNull();
  });
});
