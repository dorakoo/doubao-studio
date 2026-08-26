import type { VideoDuration } from '../types';

/** 每个账号每日可用的视频额度单位。 */
export const VIDEO_DAILY_UNITS = 6;

/** 每个额度单位对应的视频秒数。 */
export const VIDEO_SECONDS_PER_UNIT = 5;

/** 按用户确认的规则计算消耗：不足 5 秒也占 1 单位。 */
export function getVideoQuotaUsageUnits(duration: VideoDuration | string | undefined): number {
  const seconds = Number.parseInt(duration || '', 10);
  if (!Number.isFinite(seconds) || seconds <= 0) return 1;
  return Math.max(1, Math.ceil(seconds / VIDEO_SECONDS_PER_UNIT));
}

export function getVideoQuotaRemaining(quota: { usedUnits: number } | undefined): number {
  return Math.max(0, VIDEO_DAILY_UNITS - Math.max(0, quota?.usedUnits || 0));
}
