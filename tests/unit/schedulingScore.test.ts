/**
 * tests/unit/schedulingScore.test.ts
 * 账号调度评分回归测试 — 额度耗尽、冷却状态、优先级
 */

import { describe, it, expect } from 'vitest';
import { getAccountSchedulingScore } from '../../src/utils/schedulingScore';
import type { Account } from '../../src/types';

const NOW = new Date('2025-01-01T12:00:00.000Z').getTime();
const FUTURE_ISO = '2025-01-01T13:00:00.000Z';
const PAST_ISO = '2025-01-01T11:00:00.000Z';

/** 创建最小 Account fixture */
function makeAccount(overrides: Partial<Account>): Account {
  return {
    id: overrides.id || 'acc-1',
    name: overrides.name || '测试账号',
    avatar: '',
    partition: 'persist:test',
    status: overrides.status || 'idle',
    pinned: overrides.pinned ?? false,
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('getAccountSchedulingScore', () => {
  // ---- 不可用条件 → Infinity ----

  it('账号状态 error → Infinity', () => {
    const acc = makeAccount({ status: 'error' });
    expect(getAccountSchedulingScore(acc, 0, 'chat', NOW)).toBe(Number.POSITIVE_INFINITY);
  });

  it('登录过期 → Infinity', () => {
    const acc = makeAccount({ health: { loginState: 'expired', verificationRequired: false, consecutiveFailures: 0, successCount: 0, failureCount: 0 } });
    expect(getAccountSchedulingScore(acc, 0, 'chat', NOW)).toBe(Number.POSITIVE_INFINITY);
  });

  it('冷却未结束 → Infinity', () => {
    const acc = makeAccount({ health: { loginState: 'ok', verificationRequired: false, consecutiveFailures: 0, successCount: 0, failureCount: 0, cooldownUntil: FUTURE_ISO } });
    expect(getAccountSchedulingScore(acc, 0, 'chat', NOW)).toBe(Number.POSITIVE_INFINITY);
  });

  it('冷却已结束 → 有限分数', () => {
    const acc = makeAccount({ health: { loginState: 'ok', verificationRequired: false, consecutiveFailures: 0, successCount: 0, failureCount: 0, cooldownUntil: PAST_ISO } });
    expect(getAccountSchedulingScore(acc, 0, 'chat', NOW)).not.toBe(Number.POSITIVE_INFINITY);
  });

  it('需要验证 → Infinity', () => {
    const acc = makeAccount({ health: { loginState: 'ok', verificationRequired: true, consecutiveFailures: 0, successCount: 0, failureCount: 0 } });
    expect(getAccountSchedulingScore(acc, 0, 'chat', NOW)).toBe(Number.POSITIVE_INFINITY);
  });

  it('video 模式 + 额度耗尽 → Infinity', () => {
    const acc = makeAccount({
      seedanceQuota: { date: '2025-01-01', usedUnits: 10, estimatedTotalUnits: 10, exhausted: true, updatedAt: '2025-01-01T00:00:00.000Z' },
    });
    expect(getAccountSchedulingScore(acc, 0, 'video', NOW)).toBe(Number.POSITIVE_INFINITY);
  });

  it('video 模式 + 额度未耗尽 → 有限分数', () => {
    const acc = makeAccount({
      seedanceQuota: { date: '2025-01-01', usedUnits: 5, estimatedTotalUnits: 10, exhausted: false, updatedAt: '2025-01-01T00:00:00.000Z' },
    });
    expect(getAccountSchedulingScore(acc, 0, 'video', NOW)).not.toBe(Number.POSITIVE_INFINITY);
  });

  it('chat 模式 + 额度耗尽 → 仍可用（额度仅影响 video）', () => {
    const acc = makeAccount({
      seedanceQuota: { date: '2025-01-01', usedUnits: 10, estimatedTotalUnits: 10, exhausted: true, updatedAt: '2025-01-01T00:00:00.000Z' },
    });
    expect(getAccountSchedulingScore(acc, 0, 'chat', NOW)).not.toBe(Number.POSITIVE_INFINITY);
  });

  it('调度未启用 → Infinity', () => {
    const acc = makeAccount({ scheduling: { enabled: false, weight: 1, preferredModes: [] } });
    expect(getAccountSchedulingScore(acc, 0, 'chat', NOW)).toBe(Number.POSITIVE_INFINITY);
  });

  it('手动冷却未结束 → Infinity', () => {
    const acc = makeAccount({ scheduling: { enabled: true, weight: 1, preferredModes: [], manualCooldownUntil: FUTURE_ISO } });
    expect(getAccountSchedulingScore(acc, 0, 'chat', NOW)).toBe(Number.POSITIVE_INFINITY);
  });

  it('手动冷却已结束 → 有限分数', () => {
    const acc = makeAccount({ scheduling: { enabled: true, weight: 1, preferredModes: [], manualCooldownUntil: PAST_ISO } });
    expect(getAccountSchedulingScore(acc, 0, 'chat', NOW)).not.toBe(Number.POSITIVE_INFINITY);
  });

  // ---- 正常评分计算 ----

  it('负载越高分数越高（越不优先）', () => {
    const acc = makeAccount({});
    const score0 = getAccountSchedulingScore(acc, 0, 'chat', NOW);
    const score3 = getAccountSchedulingScore(acc, 3, 'chat', NOW);
    expect(score3).toBeGreaterThan(score0);
  });

  it('连续失败惩罚使分数升高', () => {
    const accOk = makeAccount({ health: { loginState: 'ok', verificationRequired: false, consecutiveFailures: 0, successCount: 0, failureCount: 0 } });
    const accFail = makeAccount({ health: { loginState: 'ok', verificationRequired: false, consecutiveFailures: 3, successCount: 0, failureCount: 3 } });
    expect(getAccountSchedulingScore(accFail, 0, 'chat', NOW)).toBeGreaterThan(getAccountSchedulingScore(accOk, 0, 'chat', NOW));
  });

  it('pinned 账号分数更低（更优先）', () => {
    const accNormal = makeAccount({ pinned: false });
    const accPinned = makeAccount({ pinned: true });
    expect(getAccountSchedulingScore(accPinned, 0, 'chat', NOW)).toBeLessThan(getAccountSchedulingScore(accNormal, 0, 'chat', NOW));
  });

  it('偏好模式加分（video 模式下 preferredModes 含 video 分数更低）', () => {
    const accNoPref = makeAccount({ scheduling: { enabled: true, weight: 1, preferredModes: [] } });
    const accPref = makeAccount({ scheduling: { enabled: true, weight: 1, preferredModes: ['video'] } });
    expect(getAccountSchedulingScore(accPref, 0, 'video', NOW)).toBeLessThan(getAccountSchedulingScore(accNoPref, 0, 'video', NOW));
  });

  it('权重越高分数越低（高权重账号更优先）', () => {
    const accW1 = makeAccount({ scheduling: { enabled: true, weight: 1, preferredModes: [] } });
    const accW2 = makeAccount({ scheduling: { enabled: true, weight: 2, preferredModes: [] } });
    // 使用非零 load 确保分数非零，才能看出权重差异
    expect(getAccountSchedulingScore(accW2, 2, 'chat', NOW)).toBeLessThan(getAccountSchedulingScore(accW1, 2, 'chat', NOW));
  });

  it('video 模式有剩余额度时获得 quotaBonus（分数更低）', () => {
    const accNoQuota = makeAccount({});
    const accWithQuota = makeAccount({
      seedanceQuota: { date: '2025-01-01', usedUnits: 0, estimatedTotalUnits: 10, exhausted: false, updatedAt: '2025-01-01T00:00:00.000Z' },
    });
    expect(getAccountSchedulingScore(accWithQuota, 0, 'video', NOW)).toBeLessThan(getAccountSchedulingScore(accNoQuota, 0, 'video', NOW));
  });

  it('chat 模式不获得 quotaBonus', () => {
    const accNoQuota = makeAccount({});
    const accWithQuota = makeAccount({
      seedanceQuota: { date: '2025-01-01', usedUnits: 0, estimatedTotalUnits: 10, exhausted: false, updatedAt: '2025-01-01T00:00:00.000Z' },
    });
    expect(getAccountSchedulingScore(accWithQuota, 0, 'chat', NOW)).toBe(getAccountSchedulingScore(accNoQuota, 0, 'chat', NOW));
  });
});
