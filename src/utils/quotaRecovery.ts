import type { Account, Task } from '../types';
import { buildAutoAssignmentPlan } from './autoAssignment';

/** 额度明确耗尽后的替代账号选择；永远排除刚刚被平台拒绝的账号。 */
export function selectQuotaFallbackAccount(
  task: Task,
  allTasks: readonly Task[],
  accounts: readonly Account[],
  exhaustedAccountId: string,
  now: number = Date.now(),
): string | null {
  const candidate: Task = { ...task, assignedAccountId: null, status: 'queued' };
  const plan = buildAutoAssignmentPlan(
    [candidate],
    allTasks.filter((item) => item.id !== task.id),
    accounts.filter((account) => account.id !== exhaustedAccountId),
    now,
  );
  return plan.assignments[0]?.accountId ?? null;
}
