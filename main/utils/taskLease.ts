import type { TaskLock } from '@doubao-studio/contracts';

export const TASK_LEASE_DURATION_MS = 2 * 60 * 1000;
export const TASK_LEASE_HEARTBEAT_MS = 30 * 1000;

export type LeaseDecision =
  | { success: true; lock: TaskLock }
  | { success: false; error: string };

function isOwnerIdValid(ownerId: string): boolean {
  return typeof ownerId === 'string' && ownerId.trim().length > 0;
}

export function acquireTaskLease(
  current: TaskLock | undefined,
  ownerId: string,
  nowMs: number,
): LeaseDecision {
  if (!isOwnerIdValid(ownerId)) return { success: false, error: '执行器 ownerId 无效' };
  const currentExpiresAt = current ? Date.parse(current.expiresAt) : Number.NaN;
  if (current && current.ownerId !== ownerId && Number.isFinite(currentExpiresAt) && currentExpiresAt > nowMs) {
    return { success: false, error: '任务已经被其他执行器锁定' };
  }

  return {
    success: true,
    lock: {
      ownerId,
      acquiredAt: current?.ownerId === ownerId && currentExpiresAt > nowMs
        ? current.acquiredAt
        : new Date(nowMs).toISOString(),
      expiresAt: new Date(nowMs + TASK_LEASE_DURATION_MS).toISOString(),
    },
  };
}

export function renewTaskLease(
  current: TaskLock | undefined,
  ownerId: string,
  nowMs: number,
): LeaseDecision {
  if (!current) return { success: false, error: '任务锁不存在或已过期' };
  if (!isOwnerIdValid(ownerId) || current.ownerId !== ownerId) {
    return { success: false, error: '任务锁 owner 不匹配' };
  }
  const expiresAt = Date.parse(current.expiresAt);
  if (!Number.isFinite(expiresAt) || expiresAt <= nowMs) {
    return { success: false, error: '任务锁不存在或已过期' };
  }
  return {
    success: true,
    lock: { ...current, expiresAt: new Date(nowMs + TASK_LEASE_DURATION_MS).toISOString() },
  };
}

export function canReleaseTaskLease(current: TaskLock | undefined, ownerId: string): boolean {
  return !!current && isOwnerIdValid(ownerId) && current.ownerId === ownerId;
}
