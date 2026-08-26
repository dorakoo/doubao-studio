import { describe, expect, it } from 'vitest';
import { applyVideoQuotaAction, VIDEO_DAILY_UNITS } from '../../main/utils/videoQuota';
import type { SeedanceQuota } from '../../src/types';

const quota: SeedanceQuota = {
  date: '2026-08-24', usedUnits: 3, estimatedTotalUnits: 10, exhausted: false, updatedAt: 'old',
};

describe('主进程视频额度写入', () => {
  it('消费后总量固定为 6，达到 6 时自动耗尽', () => {
    const result = applyVideoQuotaAction(quota, 'consume', 3, 'new');
    expect(result).toEqual({ ...quota, usedUnits: 6, estimatedTotalUnits: VIDEO_DAILY_UNITS, exhausted: true, updatedAt: 'new' });
  });

  it('平台报告耗尽时至少推进到 6，不再把总量改成已使用量', () => {
    const result = applyVideoQuotaAction(quota, 'exhausted', undefined, 'new');
    expect(result.usedUnits).toBe(6);
    expect(result.estimatedTotalUnits).toBe(6);
    expect(result.exhausted).toBe(true);
  });
});
