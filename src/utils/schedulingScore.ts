/**
 * src/utils/schedulingScore.ts
 * 账号调度评分纯函数 — 不依赖 DOM/React/Electron 运行时
 */

import type { Account, GenerationMode } from '../types';

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
): number {
  const health = account.health;
  if (account.status === 'error' || health?.loginState === 'expired') return Number.POSITIVE_INFINITY;
  if (health?.cooldownUntil && new Date(health.cooldownUntil).getTime() > now) return Number.POSITIVE_INFINITY;
  if (health?.verificationRequired) return Number.POSITIVE_INFINITY;
  if (mode === 'video' && account.seedanceQuota?.exhausted) return Number.POSITIVE_INFINITY;
  if (account.scheduling?.enabled === false) return Number.POSITIVE_INFINITY;
  if (account.scheduling?.manualCooldownUntil && new Date(account.scheduling.manualCooldownUntil).getTime() > now) return Number.POSITIVE_INFINITY;

  const quotaRemaining = account.seedanceQuota
    ? Math.max(0, account.seedanceQuota.estimatedTotalUnits - account.seedanceQuota.usedUnits)
    : 0;
  const failurePenalty = (health?.consecutiveFailures || 0) * 4;
  const quotaBonus = mode === 'video' ? Math.min(quotaRemaining, 10) * 0.25 : 0;
  const preferenceBonus = account.scheduling?.preferredModes.includes(mode) ? 2 : 0;
  const weight = account.scheduling?.weight || 1;
  return (load * 10 + failurePenalty - quotaBonus - preferenceBonus - (account.pinned ? 0.5 : 0)) / weight;
}
