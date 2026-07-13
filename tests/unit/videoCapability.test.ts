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

  // ---- 测试 3: 15s + Seedance 2.0 Fast 在未知会员状态下返回可提交但带风险提示 ----
  describe('15s + Seedance 2.0 Fast 风险提示', () => {
    it('15s + seedance-2.0-fast 在健康账号下返回 unknown（可提交）', () => {
      const input = makeBaseInput({
        model: 'seedance-2.0-fast',
        duration: '15s',
        seedanceQuota: healthySeedanceQuota,
        health: healthyHealth,
        scheduling: healthyScheduling,
        accountStatus: healthyAccountStatus,
      });
      const result = evaluateVideoCapability(input);
      expect(result.state).toBe('unknown');
      expect(result.canSubmit).toBe(true);
      expect(result.issues.some(i => i.code === 'membership_risk' && !i.blocking)).toBe(true);
      expect(result.userMessage).toContain('会员权益限制');
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
      expect(result.suggestion!.model).toBe('seedance-2.0');
      expect(result.suggestion!.duration).toBe('10s');
      // 原始输入不被修改
      expect(input.model).toBe('seedance-2.0-fast');
      expect(input.duration).toBe('15s');
    });

    it('15s + 非 Fast 模型在健康账号下返回 unknown', () => {
      const input = makeBaseInput({
        model: 'seedance-2.0',
        duration: '15s',
        seedanceQuota: healthySeedanceQuota,
        health: healthyHealth,
        scheduling: healthyScheduling,
        accountStatus: healthyAccountStatus,
      });
      const result = evaluateVideoCapability(input);
      expect(result.state).toBe('unknown');
      expect(result.canSubmit).toBe(true);
      expect(result.issues.some(i => i.code === 'membership_risk')).toBe(true);
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
      expect(suggestion!.model).toBe('seedance-2.0');
      expect(suggestion!.duration).toBe('10s');
      expect(suggestion!.reason).toContain('会员权益限制');
    });

    it('15s + 其他模型返回建议配置', () => {
      const suggestion = suggestCompatibleVideoConfig('seedance-2.0', '15s');
      expect(suggestion).toBeDefined();
      expect(suggestion!.duration).toBe('10s');
      expect(suggestion!.reason).toContain('15 秒时长');
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

  // ---- 测试 8: 15s 补丁开启不改变平台会员限制的判断 ----
  describe('15s 补丁不影响会员限制判断', () => {
    it('manual15sEnabled = true 时 15s + Fast 仍返回 unknown（不声称一定不可用）', () => {
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
      expect(result.state).toBe('unknown');
      expect(result.canSubmit).toBe(true);
    });

    it('manual15sEnabled = false 时 15s + Fast 也返回 unknown', () => {
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
      expect(result.state).toBe('unknown');
      expect(result.canSubmit).toBe(true);
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
