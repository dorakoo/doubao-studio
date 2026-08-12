/**
 * tests/unit/videoCapability.test.ts
 * 视频能力预检纯逻辑单元测试
 */

import { describe, it, expect } from 'vitest';
import {
  evaluateVideoCapability,
  suggestCompatibleVideoConfig,
  isRestrictionFailure,
  shouldStopVideoPolling,
} from '../../src/utils/videoCapability';
import type { VideoCapabilityInput } from '../../src/utils/videoCapability';
import type { SeedanceQuota, AccountHealth, AccountScheduling, AccountStatus } from '../../src/types';
import { buildDoubaoCapabilitySnapshot, evaluateDryRunSelection } from '../../src/automation/doubaoCapability';
import { inject15sVideoPatch, set15sVideoPatchEnabled } from '../../src/utils/doubaoBridge';

// ==================== 测试数据工厂 ====================

const FIXED_NOW = new Date('2026-07-14T12:00:00.000Z').getTime();

function makeBaseInput(overrides: Partial<VideoCapabilityInput> = {}): VideoCapabilityInput {
  return {
    model: 'seedance-2.0',
    duration: '10s',
    aspectRatio: '16:9',
    manual15sEnabled: false,
    accountStatus: 'idle',
    now: FIXED_NOW,
    ...overrides,
  };
}

const healthySeedanceQuota: SeedanceQuota = {
  date: '2026-07-14',
  usedUnits: 0,
  estimatedTotalUnits: 10,
  exhausted: false,
  updatedAt: '2026-07-14T00:00:00.000Z',
};

const healthyHealth: AccountHealth = {
  loginState: 'ok',
  verificationRequired: false,
  consecutiveFailures: 0,
  successCount: 5,
  failureCount: 0,
  lastSuccessAt: '2026-07-14T10:00:00.000Z',
};

const healthyScheduling: AccountScheduling = {
  enabled: true,
  weight: 1,
  preferredModes: ['video'],
};

const healthyAccountStatus: AccountStatus = 'idle';

// ==================== 测试用例 ====================

describe('evaluateVideoCapability', () => {
  // ---- 测试 1: 本地额度耗尽时阻止视频提交 ----
  describe('额度耗尽阻止提交', () => {
    it('seedanceQuota.exhausted = true 时返回 blocked', () => {
      const input = makeBaseInput({
        seedanceQuota: { ...healthySeedanceQuota, usedUnits: 10, exhausted: true },
      });
      const result = evaluateVideoCapability(input);
      expect(result.state).toBe('blocked');
      expect(result.canSubmit).toBe(false);
      expect(result.issues.some(i => i.code === 'quota_exhausted' && i.blocking)).toBe(true);
      expect(result.userMessage).toContain('额度已耗尽');
    });
  });

  // ---- 测试 2: 账号验证、登录失效、调度暂停、冷却中时阻止视频提交 ----
  describe('账号状态异常阻止提交', () => {
    it('登录失效时返回 blocked', () => {
      const input = makeBaseInput({
        health: { ...healthyHealth, loginState: 'expired', consecutiveFailures: 3 },
      });
      const result = evaluateVideoCapability(input);
      expect(result.state).toBe('blocked');
      expect(result.canSubmit).toBe(false);
      expect(result.issues.some(i => i.code === 'login_expired')).toBe(true);
    });

    it('等待验证时返回 blocked', () => {
      const input = makeBaseInput({
        health: { ...healthyHealth, verificationRequired: true },
      });
      const result = evaluateVideoCapability(input);
      expect(result.state).toBe('blocked');
      expect(result.canSubmit).toBe(false);
      expect(result.issues.some(i => i.code === 'verification_required')).toBe(true);
    });

    it('调度暂停时返回 blocked', () => {
      const input = makeBaseInput({
        scheduling: { ...healthyScheduling, enabled: false },
      });
      const result = evaluateVideoCapability(input);
      expect(result.state).toBe('blocked');
      expect(result.canSubmit).toBe(false);
      expect(result.issues.some(i => i.code === 'scheduling_paused')).toBe(true);
    });

    it('冷却中时返回 blocked', () => {
      const futureTime = new Date(FIXED_NOW + 30 * 60 * 1000).toISOString();
      const input = makeBaseInput({
        health: { ...healthyHealth, cooldownUntil: futureTime, consecutiveFailures: 2 },
      });
      const result = evaluateVideoCapability(input);
      expect(result.state).toBe('blocked');
      expect(result.canSubmit).toBe(false);
      expect(result.issues.some(i => i.code === 'cooldown_active')).toBe(true);
    });

    it('手动冷却中时返回 blocked', () => {
      const futureTime = new Date(FIXED_NOW + 60 * 60 * 1000).toISOString();
      const input = makeBaseInput({
        scheduling: { ...healthyScheduling, manualCooldownUntil: futureTime },
      });
      const result = evaluateVideoCapability(input);
      expect(result.state).toBe('blocked');
      expect(result.canSubmit).toBe(false);
      expect(result.issues.some(i => i.code === 'cooldown_active')).toBe(true);
    });

    it('账号状态为 error 时返回 blocked', () => {
      const input = makeBaseInput({
        accountStatus: 'error' as AccountStatus,
      });
      const result = evaluateVideoCapability(input);
      expect(result.state).toBe('blocked');
      expect(result.canSubmit).toBe(false);
      expect(result.issues.some(i => i.code === 'account_error')).toBe(true);
    });
  });

  describe('11–15s 页面实时能力门禁', () => {
    it('15s + seedance-2.0-fast 缺少实时证据时 fail-closed', () => {
      const input = makeBaseInput({
        model: 'seedance-2.0-fast',
        duration: '15s',
        seedanceQuota: healthySeedanceQuota,
        health: healthyHealth,
        scheduling: healthyScheduling,
        accountStatus: healthyAccountStatus,
      });
      const result = evaluateVideoCapability(input);
      expect(result.state).toBe('blocked');
      expect(result.canSubmit).toBe(false);
      expect(result.issues.some(i => i.code === 'membership_required' && i.blocking)).toBe(true);
    });

    it('15s + seedance-2.0-fast 提供建议配置但不改变原始配置', () => {
      const input = makeBaseInput({
        model: 'seedance-2.0-fast',
        duration: '15s',
        seedanceQuota: healthySeedanceQuota,
        health: healthyHealth,
        scheduling: healthyScheduling,
        accountStatus: healthyAccountStatus,
      });
      const result = evaluateVideoCapability(input);
      expect(result.suggestion).toBeDefined();
      expect(result.suggestion!.model).toBe('seedance-2.0-fast');
      expect(result.suggestion!.duration).toBe('10s');
      // 原始输入不被修改
      expect(input.model).toBe('seedance-2.0-fast');
      expect(input.duration).toBe('15s');
    });

    it('页面明确出现会员动作时返回 blocked', () => {
      const input = makeBaseInput({
        model: 'seedance-2.0',
        duration: '15s',
        seedanceQuota: healthySeedanceQuota,
        health: healthyHealth,
        scheduling: healthyScheduling,
        accountStatus: healthyAccountStatus,
        platformAvailability: 'membership_required',
      });
      const result = evaluateVideoCapability(input);
      expect(result.state).toBe('blocked');
      expect(result.canSubmit).toBe(false);
    });

    it('只有页面实时确认 selectable 时允许 11s', () => {
      const result = evaluateVideoCapability(makeBaseInput({ duration: '11s', platformAvailability: 'selectable' }));
      expect(result.state).toBe('allowed');
      expect(result.canSubmit).toBe(true);
    });
  });

  // ---- 测试 4: 明确会员限制文案分类为 membership_required 且不可恢复 ----
  describe('会员限制错误分类', () => {
    // 这个测试验证 errorClassification 模块，但通过 isRestrictionFailure 间接验证
    it('isRestrictionFailure 对 membership_required 返回 true', () => {
      expect(isRestrictionFailure('membership_required')).toBe(true);
    });

    it('isRestrictionFailure 对 quota_exhausted 返回 true', () => {
      expect(isRestrictionFailure('quota_exhausted')).toBe(true);
    });

    it('isRestrictionFailure 对 face_restricted 返回 true', () => {
      expect(isRestrictionFailure('face_restricted')).toBe(true);
    });

    it('isRestrictionFailure 对 content_rejected 返回 true', () => {
      expect(isRestrictionFailure('content_rejected')).toBe(true);
    });

    it('isRestrictionFailure 对非限制类错误返回 false', () => {
      expect(isRestrictionFailure('network')).toBe(false);
      expect(isRestrictionFailure('timeout')).toBe(false);
      expect(isRestrictionFailure('cancelled')).toBe(false);
      expect(isRestrictionFailure('unknown')).toBe(false);
    });
  });

  // ---- 测试 5: 限制失败不会进入长视频产物等待 ----
  describe('shouldStopVideoPolling', () => {
    it('membership_required 应立即停止轮询', () => {
      expect(shouldStopVideoPolling('membership_required')).toBe(true);
    });

    it('quota_exhausted 应立即停止轮询', () => {
      expect(shouldStopVideoPolling('quota_exhausted')).toBe(true);
    });

    it('face_restricted 应立即停止轮询', () => {
      expect(shouldStopVideoPolling('face_restricted')).toBe(true);
    });

    it('content_rejected 应立即停止轮询', () => {
      expect(shouldStopVideoPolling('content_rejected')).toBe(true);
    });

    it('generation_failed 应立即停止轮询', () => {
      expect(shouldStopVideoPolling('generation_failed')).toBe(true);
    });

    it('network 不应停止轮询（可重试）', () => {
      expect(shouldStopVideoPolling('network')).toBe(false);
    });

    it('timeout 不应停止轮询（可重试）', () => {
      expect(shouldStopVideoPolling('timeout')).toBe(false);
    });
  });

  // ---- 测试 6: 限制失败不会扣减 Seedance 预计额度 ----
  describe('额度扣减安全', () => {
    it('blocked 状态下 canSubmit = false，不会进入提交流程', () => {
      const input = makeBaseInput({
        seedanceQuota: { ...healthySeedanceQuota, usedUnits: 10, exhausted: true },
      });
      const result = evaluateVideoCapability(input);
      // canSubmit 为 false 意味着不会进入提交流程，因此不会调用 recordSeedanceUsage
      expect(result.canSubmit).toBe(false);
    });

    it('所有限制类失败码都不应触发 recordSeedanceUsage', () => {
      // recordSeedanceUsage 仅在 BrowserPanel 成功路径调用
      // 限制类失败的 isRestrictionFailure 返回 true，标记不扣减额度
      const restrictionCodes = ['membership_required', 'quota_exhausted', 'face_restricted', 'content_rejected'];
      for (const code of restrictionCodes) {
        expect(isRestrictionFailure(code)).toBe(true);
      }
    });
  });

  // ---- 测试 7: 建议配置仅作为建议，不改变原始 videoConfig ----
  describe('suggestCompatibleVideoConfig', () => {
    it('15s + seedance-2.0-fast 返回建议配置', () => {
      const suggestion = suggestCompatibleVideoConfig('seedance-2.0-fast', '15s');
      expect(suggestion).toBeDefined();
      expect(suggestion!.model).toBe('seedance-2.0-fast');
      expect(suggestion!.duration).toBe('10s');
      expect(suggestion!.reason).toContain('实时能力证据');
    });

    it('15s + 其他模型返回建议配置', () => {
      const suggestion = suggestCompatibleVideoConfig('seedance-2.0', '15s');
      expect(suggestion).toBeDefined();
      expect(suggestion!.duration).toBe('10s');
      expect(suggestion!.reason).toContain('实时能力证据');
    });

    it('非 15s 配置不返回建议', () => {
      const suggestion = suggestCompatibleVideoConfig('seedance-2.0', '10s');
      expect(suggestion).toBeUndefined();
    });

    it('5s 配置不返回建议', () => {
      const suggestion = suggestCompatibleVideoConfig('seedance-2.0', '5s');
      expect(suggestion).toBeUndefined();
    });

    it('建议配置不修改原始输入值', () => {
      const model = 'seedance-2.0-fast';
      const duration = '15s';
      const suggestion = suggestCompatibleVideoConfig(model, duration);
      expect(suggestion).toBeDefined();
      // 原始值不变
      expect(model).toBe('seedance-2.0-fast');
      expect(duration).toBe('15s');
    });
  });

  describe('旧补丁标记不能绕过会员门禁', () => {
    it('manual15sEnabled = true 时 15s 仍 blocked', () => {
      const input = makeBaseInput({
        model: 'seedance-2.0-fast',
        duration: '15s',
        manual15sEnabled: true,
        seedanceQuota: healthySeedanceQuota,
        health: healthyHealth,
        scheduling: healthyScheduling,
        accountStatus: healthyAccountStatus,
      });
      const result = evaluateVideoCapability(input);
      expect(result.state).toBe('blocked');
      expect(result.canSubmit).toBe(false);
    });

    it('manual15sEnabled = false 时 15s 也 blocked', () => {
      const input = makeBaseInput({
        model: 'seedance-2.0-fast',
        duration: '15s',
        manual15sEnabled: false,
        seedanceQuota: healthySeedanceQuota,
        health: healthyHealth,
        scheduling: healthyScheduling,
        accountStatus: healthyAccountStatus,
      });
      const result = evaluateVideoCapability(input);
      expect(result.state).toBe('blocked');
      expect(result.canSubmit).toBe(false);
    });

    it('manual15sEnabled = true 时额度耗尽仍返回 blocked', () => {
      const input = makeBaseInput({
        model: 'seedance-2.0-fast',
        duration: '15s',
        manual15sEnabled: true,
        seedanceQuota: { ...healthySeedanceQuota, usedUnits: 10, exhausted: true },
      });
      const result = evaluateVideoCapability(input);
      expect(result.state).toBe('blocked');
      expect(result.canSubmit).toBe(false);
    });

    it('manual15sEnabled 不影响 allowed 状态', () => {
      const input = makeBaseInput({
        model: 'seedance-2.0',
        duration: '10s',
        manual15sEnabled: true,
        seedanceQuota: healthySeedanceQuota,
        health: healthyHealth,
        scheduling: healthyScheduling,
        accountStatus: healthyAccountStatus,
      });
      const result = evaluateVideoCapability(input);
      expect(result.state).toBe('allowed');
      expect(result.canSubmit).toBe(true);
      expect(result.issues).toHaveLength(0);
    });
  });

  // ---- 额外测试: 正常配置在健康账号下返回 allowed ----
  describe('正常配置允许提交', () => {
    it('10s + seedance-2.0 在健康账号下返回 allowed', () => {
      const input = makeBaseInput({
        model: 'seedance-2.0',
        duration: '10s',
        seedanceQuota: healthySeedanceQuota,
        health: healthyHealth,
        scheduling: healthyScheduling,
        accountStatus: healthyAccountStatus,
      });
      const result = evaluateVideoCapability(input);
      expect(result.state).toBe('allowed');
      expect(result.canSubmit).toBe(true);
      expect(result.issues).toHaveLength(0);
      expect(result.userMessage).toBe('');
    });

    it('5s + seedance-2.0 在健康账号下返回 allowed', () => {
      const input = makeBaseInput({
        model: 'seedance-2.0',
        duration: '5s',
        seedanceQuota: healthySeedanceQuota,
        health: healthyHealth,
        scheduling: healthyScheduling,
        accountStatus: healthyAccountStatus,
      });
      const result = evaluateVideoCapability(input);
      expect(result.state).toBe('allowed');
      expect(result.canSubmit).toBe(true);
    });
  });

  // ---- 额外测试: 多个阻塞条件同时存在 ----
  describe('多阻塞条件', () => {
    it('登录失效 + 额度耗尽同时存在时返回 blocked', () => {
      const input = makeBaseInput({
        health: { ...healthyHealth, loginState: 'expired', consecutiveFailures: 5 },
        seedanceQuota: { ...healthySeedanceQuota, usedUnits: 10, exhausted: true },
      });
      const result = evaluateVideoCapability(input);
      expect(result.state).toBe('blocked');
      expect(result.canSubmit).toBe(false);
      expect(result.issues.length).toBeGreaterThanOrEqual(2);
    });
  });

  // ---- 额外测试: 冷却已过期不阻塞 ----
  describe('冷却已过期', () => {
    it('cooldownUntil 在过去时不阻塞', () => {
      const pastTime = new Date(FIXED_NOW - 60 * 1000).toISOString();
      const input = makeBaseInput({
        health: { ...healthyHealth, cooldownUntil: pastTime, consecutiveFailures: 1 },
        seedanceQuota: healthySeedanceQuota,
        scheduling: healthyScheduling,
        accountStatus: healthyAccountStatus,
      });
      const result = evaluateVideoCapability(input);
      expect(result.state).not.toBe('blocked');
    });
  });
});

describe('豆包新 UI 只读能力快照与 dry-run', () => {
  const pageText = [
    '快速 视频生成 图像生成 PPT 写作 翻译 深入研究 录音转写 更多',
    'Seedance 2.5 Seedance 2.0 Seedance 2.0 Fast Seedance 2.0 Mini',
    'Seedream 5.0 Pro Seedream 5.0 Lite Seedream 4.5 Seedream 4.0',
    '4秒 5秒 10秒 11秒 15秒 3:4 4:3 9:16 16:9 1:1 21:9 2:3 3:2',
  ].join(' ');

  it('记录时间、账户层级、页面来源和适配器版本', () => {
    const snapshot = buildDoubaoCapabilitySnapshot({
      pageUrl: 'https://www.doubao.com/chat/create-video/',
      bodyText: pageText,
      observedAt: '2026-07-31T10:00:00.000Z',
      accountTier: '免费',
    });
    expect(snapshot.observed_at).toBe('2026-07-31T10:00:00.000Z');
    expect(snapshot.account_tier).toBe('免费');
    expect(snapshot.source.kind).toBe('page');
    expect(snapshot.adapter_version).toMatch(/^2\./);
  });

  it('从页面文字识别新模型、入口、比例和 4–15 秒范围', () => {
    const snapshot = buildDoubaoCapabilitySnapshot({ pageUrl: 'https://www.doubao.com/', bodyText: pageText });
    expect(snapshot.entries).toContain('视频生成');
    expect(snapshot.video.models).toContain('Seedance 2.5');
    expect(snapshot.image.models).toContain('Seedream 5.0 Pro');
    expect(snapshot.video.durations).toEqual([4, 5, 10, 11, 15]);
    expect(snapshot.image.aspect_ratios).toContain('2:3');
  });

  it('元素缺失时返回 unknown，不猜测能力', () => {
    const snapshot = buildDoubaoCapabilitySnapshot({ pageUrl: 'https://www.doubao.com/', bodyText: '' });
    expect(snapshot.status).toBe('unknown');
    expect(snapshot.video.models).toEqual([]);
    expect(snapshot.account_tier).toBe('unknown');
  });

  it('会员窗口记录为 action_required，dry-run 返回 membership_required', () => {
    const snapshot = buildDoubaoCapabilitySnapshot({
      pageUrl: 'https://www.doubao.com/',
      bodyText: pageText,
      membershipDialogText: '升级会员后可使用更长视频',
    });
    expect(snapshot.membership.availability).toBe('action_required');
    expect(evaluateDryRunSelection(snapshot, { model: 'Seedance 2.5', duration: 11, aspectRatio: '16:9' }))
      .toEqual({ ok: false, code: 'membership_required', finalSubmit: false });
  });

  it.each(['购买会员', '升级会员', '会员专享'])('真实会员动作证据 %s 均 fail-closed', (membershipDialogText) => {
    const snapshot = buildDoubaoCapabilitySnapshot({
      pageUrl: 'https://www.doubao.com/',
      bodyText: pageText,
      membershipDialogText,
    });
    expect(snapshot.membership.availability).toBe('action_required');
    expect(evaluateDryRunSelection(snapshot, { model: 'Seedance 2.0 Fast', duration: 15, aspectRatio: '9:16' }))
      .toEqual({ ok: false, code: 'membership_required', finalSubmit: false });
  });

  it.each([
    ['unknown', false, 'membership_required'],
    ['selectable', true, 'ready'],
  ] as const)('11 秒 availability=%s 时按实时证据门禁', (availability, ok, code) => {
    const snapshot = buildDoubaoCapabilitySnapshot({ pageUrl: 'https://www.doubao.com/', bodyText: pageText });
    snapshot.membership.availability = availability;
    expect(evaluateDryRunSelection(snapshot, { model: 'Seedance 2.5', duration: 11, aspectRatio: '16:9' }))
      .toEqual({ ok, code, finalSubmit: false });
  });

  it('dry-run 只验证可见配置，永不提交最终生成', () => {
    const snapshot = buildDoubaoCapabilitySnapshot({ pageUrl: 'https://www.doubao.com/', bodyText: pageText });
    expect(evaluateDryRunSelection(snapshot, { model: 'Seedance 2.5', duration: 10, aspectRatio: '16:9' }))
      .toEqual({ ok: true, code: 'ready', finalSubmit: false });
  });

  it('历史 15 秒请求改写入口固定拒绝启用', async () => {
    const forbiddenWebview = new Proxy({}, { get: () => { throw new Error('不得访问 webview'); } });
    expect(await inject15sVideoPatch(forbiddenWebview as never)).toBe(false);
    expect(await set15sVideoPatchEnabled(forbiddenWebview as never, true)).toBe(false);
  });
});
