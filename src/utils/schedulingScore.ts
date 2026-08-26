/**
 * src/utils/schedulingScore.ts
 * 账号调度评分纯函数 — 不依赖 DOM/React/Electron 运行时
 */

import type { Account, GenerationMode } from '../types';
import { getVideoQuotaRemaining } from './videoQuota';
import { getAvailabilityBlockReason } from './accountAvailability';

export function getAutomaticSchedulingBlockReason(
  account: Account,
  mode: GenerationMode,
  requiredVideoUnits: number = 1,
  reservedVideoUnits: number = 0,
  now: number = Date.now(),
): string | null {
  const health = account.health;
  if (account.status === 'error') return '账号状态异常';
  const availabilityBlock = getAvailabilityBlockReason(health?.availability);
  if (availabilityBlock) return availabilityBlock;
  if (health?.loginState === 'expired') return '登录已失效';
  if (health?.cooldownUntil && new Date(health.cooldownUntil).getTime() > now) return '自动冷却中';
  if (health?.verificationRequired) return '等待人工验证';
  if (account.scheduling?.enabled === false) return '自动调度已暂停';
  if (account.scheduling?.manualCooldownUntil && new Date(account.scheduling.manualCooldownUntil).getTime() > now) return '手动冷却中';
  if (mode === 'video') {
    const remaining = getVideoQuotaRemaining(account.seedanceQuota) - Math.max(0, reservedVideoUnits);
    if (account.seedanceQuota?.exhausted || remaining < requiredVideoUnits) {
      return `额度不足（需 ${requiredVideoUnits}，可用 ${Math.max(0, remaining)}）`;
    }
  }
  return null;
}

/**
 * 计算账号在指定模式下的调度评分。
 * 分数越低越优先；Number.POSITIVE_INFINITY 表示不可用。
 *
 * @param account 候选账号
 * @param load 当前已分配的任务数
 * @param mode 生成模式
 * @param now 当前时间戳，默认 Date.now()，测试时可注入
 */
export function getAccountSchedulingScore(
  account: Account,
  load: number,
  mode: GenerationMode,
  now: number = Date.now(),
  requiredVideoUnits: number = 1,
  reservedVideoUnits: number = 0,
): number {
  if (getAutomaticSchedulingBlockReason(account, mode, requiredVideoUnits, reservedVideoUnits, now)) {
    return Number.POSITIVE_INFINITY;
  }

  const quotaRemaining = getVideoQuotaRemaining(account.seedanceQuota) - Math.max(0, reservedVideoUnits);
  const failurePenalty = (account.health?.consecutiveFailures || 0) * 4;
  const quotaBonus = mode === 'video' ? Math.min(quotaRemaining, 10) * 0.25 : 0;
  const preferenceBonus = account.scheduling?.preferredModes.includes(mode) ? 2 : 0;
  const weight = account.scheduling?.weight || 1;
  return (load * 10 + failurePenalty - quotaBonus - preferenceBonus - (account.pinned ? 0.5 : 0)) / weight;
}
