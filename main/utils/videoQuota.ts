import type { SeedanceQuota } from '@doubao-studio/contracts';

export const VIDEO_DAILY_UNITS = 6;

/** 本机时区自然日键；跨过本地 00:00 即进入新一日。 */
export function localDateKey(now: Date = new Date()): string {
  const offset = now.getTimezoneOffset() * 60000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}

export function applyVideoQuotaAction(
  quota: SeedanceQuota,
  action: 'consume' | 'exhausted',
  units: number | undefined,
  updatedAt: string,
): SeedanceQuota {
  const usedUnits = action === 'exhausted'
    ? Math.max(quota.usedUnits, VIDEO_DAILY_UNITS)
    : quota.usedUnits + Math.max(1, Math.round(units || 1));
  return {
    ...quota,
    usedUnits,
    estimatedTotalUnits: VIDEO_DAILY_UNITS,
    exhausted: action === 'exhausted' || usedUnits >= VIDEO_DAILY_UNITS,
    updatedAt,
  };
}
