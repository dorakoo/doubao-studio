import type { SeedanceQuota } from '@doubao-studio/contracts';

export const VIDEO_DAILY_UNITS = 6;

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
