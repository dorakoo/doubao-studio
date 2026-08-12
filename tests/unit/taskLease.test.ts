import { describe, expect, it } from 'vitest';
import {
  TASK_LEASE_DURATION_MS,
  acquireTaskLease,
  canReleaseTaskLease,
  renewTaskLease,
} from '../../main/utils/taskLease';

const NOW = Date.parse('2026-08-13T00:00:00.000Z');

describe('任务短租约', () => {
  it('创建 2 分钟短租约，并由同 owner 续租且保留 acquiredAt', () => {
    const acquired = acquireTaskLease(undefined, 'worker-a', NOW);
    expect(acquired.success).toBe(true);
    if (!acquired.success) return;
    expect(Date.parse(acquired.lock.expiresAt) - NOW).toBe(TASK_LEASE_DURATION_MS);

    const renewed = renewTaskLease(acquired.lock, 'worker-a', NOW + 30_000);
    expect(renewed.success).toBe(true);
    if (!renewed.success) return;
    expect(renewed.lock.acquiredAt).toBe(acquired.lock.acquiredAt);
    expect(Date.parse(renewed.lock.expiresAt)).toBe(NOW + 30_000 + TASK_LEASE_DURATION_MS);
  });

  it('有效租约拒绝其他 owner，过期后允许接管并重置 acquiredAt', () => {
    const current = {
      ownerId: 'worker-a',
      acquiredAt: new Date(NOW).toISOString(),
      expiresAt: new Date(NOW + 1_000).toISOString(),
    };
    expect(acquireTaskLease(current, 'worker-b', NOW + 500)).toEqual({
      success: false,
      error: '任务已经被其他执行器锁定',
    });
    const takeover = acquireTaskLease(current, 'worker-b', NOW + 1_001);
    expect(takeover.success).toBe(true);
    if (takeover.success) expect(takeover.lock.acquiredAt).toBe(new Date(NOW + 1_001).toISOString());

    const reacquired = acquireTaskLease(current, 'worker-a', NOW + 1_001);
    expect(reacquired.success).toBe(true);
    if (reacquired.success) expect(reacquired.lock.acquiredAt).toBe(new Date(NOW + 1_001).toISOString());
  });

  it.each([
    ['缺失锁', undefined, 'worker-a'],
    ['错误 owner', { ownerId: 'worker-a', acquiredAt: new Date(NOW).toISOString(), expiresAt: new Date(NOW + 1_000).toISOString() }, 'worker-b'],
    ['已过期', { ownerId: 'worker-a', acquiredAt: new Date(NOW).toISOString(), expiresAt: new Date(NOW).toISOString() }, 'worker-a'],
  ])('%s 时续租 fail-closed', (_label, lock, ownerId) => {
    expect(renewTaskLease(lock, ownerId, NOW).success).toBe(false);
  });

  it('仅正确 owner 可以释放', () => {
    const lock = { ownerId: 'worker-a', acquiredAt: new Date(NOW).toISOString(), expiresAt: new Date(NOW + 1_000).toISOString() };
    expect(canReleaseTaskLease(lock, 'worker-a')).toBe(true);
    expect(canReleaseTaskLease(lock, 'worker-b')).toBe(false);
    expect(canReleaseTaskLease(lock, '')).toBe(false);
    expect(canReleaseTaskLease(undefined, 'worker-a')).toBe(false);
  });
});
