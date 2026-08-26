import { describe, expect, it } from 'vitest';
import {
  VIDEO_DAILY_UNITS,
  VIDEO_SECONDS_PER_UNIT,
  getVideoQuotaRemaining,
  getVideoQuotaUsageUnits,
} from '../../src/utils/videoQuota';

describe('视频额度规则', () => {
  it('每日 6 单位且每 5 秒消耗 1 单位', () => {
    expect(VIDEO_DAILY_UNITS).toBe(6);
    expect(VIDEO_SECONDS_PER_UNIT).toBe(5);
  });

  it.each([
    ['4s', 1], ['5s', 1], ['6s', 2], ['10s', 2], ['11s', 3], ['15s', 3],
  ])('%s 消耗 %i 单位', (duration, units) => {
    expect(getVideoQuotaUsageUnits(duration)).toBe(units);
  });

  it('剩余额度只由每日 6 单位减去已使用量计算并收敛到零', () => {
    expect(getVideoQuotaRemaining({ usedUnits: 2 })).toBe(4);
    expect(getVideoQuotaRemaining({ usedUnits: 8 })).toBe(0);
  });
});
