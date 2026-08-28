import type { Account, Task } from '../types';
import { getAccountSchedulingScore } from './schedulingScore';
import { getVideoQuotaUsageUnits } from './videoQuota';

const ACTIVE_STATUSES = new Set<Task['status']>(['queued', 'executing', 'generating', 'waiting_verification', 'waiting_generation_confirmation', 'manual_submission_observing']);

export interface AutoAssignmentPlan {
  assignments: Array<{ taskId: string; accountId: string }>;
  unassignedTaskIds: string[];
}

/** 为一批新任务生成确定性账号计划，并同时预留尚未扣除的视频额度。 */
export function buildAutoAssignmentPlan(
  newTasks: readonly Task[],
  existingTasks: readonly Task[],
  accounts: readonly Account[],
  now: number = Date.now(),
): AutoAssignmentPlan {
  const accountLoad: Record<string, number> = {};
  const reservedVideoUnits: Record<string, number> = {};
  accounts.forEach((account) => {
    accountLoad[account.id] = 0;
    reservedVideoUnits[account.id] = 0;
  });

  const seen = new Set<string>();
  for (const task of [...existingTasks, ...newTasks]) {
    if (seen.has(task.id)) continue;
    seen.add(task.id);
    if (!task.assignedAccountId || !ACTIVE_STATUSES.has(task.status)) continue;
    accountLoad[task.assignedAccountId] = (accountLoad[task.assignedAccountId] || 0) + 1;
    if (task.mode === 'video') {
      reservedVideoUnits[task.assignedAccountId] = (reservedVideoUnits[task.assignedAccountId] || 0) +
        getVideoQuotaUsageUnits(task.videoConfig?.duration);
    }
  }

  const assignments: AutoAssignmentPlan['assignments'] = [];
  const unassignedTaskIds: string[] = [];
  for (const task of newTasks) {
    if (task.assignedAccountId) continue;
    const requiredUnits = task.mode === 'video' ? getVideoQuotaUsageUnits(task.videoConfig?.duration) : 1;
    const ranked = accounts
      .map((account) => ({
        account,
        score: getAccountSchedulingScore(
          account,
          accountLoad[account.id] || 0,
          task.mode,
          now,
          requiredUnits,
          reservedVideoUnits[account.id] || 0,
        ),
      }))
      .filter(({ score }) => Number.isFinite(score))
      .sort((left, right) => left.score - right.score || left.account.id.localeCompare(right.account.id));
    const selected = ranked[0]?.account;
    if (!selected) {
      unassignedTaskIds.push(task.id);
      continue;
    }
    assignments.push({ taskId: task.id, accountId: selected.id });
    accountLoad[selected.id] = (accountLoad[selected.id] || 0) + 1;
    if (task.mode === 'video') reservedVideoUnits[selected.id] = (reservedVideoUnits[selected.id] || 0) + requiredUnits;
  }
  return { assignments, unassignedTaskIds };
}
