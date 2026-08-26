import { describe, expect, it } from 'vitest';
import { buildAutoAssignmentPlan } from '../../src/utils/autoAssignment';
import type { Account, Task } from '../../src/types';

function account(id: string, usedUnits: number, overrides: Partial<Account> = {}): Account {
  return {
    id, name: id, avatar: '', partition: id, platform: 'doubao', status: 'idle', pinned: false,
    seedanceQuota: { date: '2026-08-24', usedUnits, estimatedTotalUnits: 6, exhausted: usedUnits >= 6, updatedAt: '2026-08-24T00:00:00.000Z' },
    createdAt: '2026-08-24T00:00:00.000Z', updatedAt: '2026-08-24T00:00:00.000Z', ...overrides,
  };
}

function task(id: string, duration: NonNullable<Task['videoConfig']>['duration'] = '10s'): Task {
  return {
    id, prompt: id, assignedAccountId: null, status: 'queued', mode: 'video',
    videoConfig: { model: 'seedance-2.0', duration, aspectRatio: '16:9' }, result: null, outputs: [],
    createdAt: '2026-08-24T00:00:00.000Z', updatedAt: '2026-08-24T00:00:00.000Z',
  };
}

describe('批量自动指派计划', () => {
  it('会预留批内额度，不把三个 10 秒任务都塞给剩余 6 单位的同一账号', () => {
    const plan = buildAutoAssignmentPlan([task('t1'), task('t2'), task('t3'), task('t4')], [], [account('a1', 0)]);
    expect(plan.assignments.map((item) => item.taskId)).toEqual(['t1', 't2', 't3']);
    expect(plan.unassignedTaskIds).toEqual(['t4']);
  });

  it('自动冷却账号不参与自动指派，但任务不会被伪装成已指派', () => {
    const plan = buildAutoAssignmentPlan([task('t1', '5s')], [], [account('a1', 0, {
      health: { loginState: 'ok', verificationRequired: false, consecutiveFailures: 3, successCount: 0, failureCount: 3, cooldownUntil: '2099-01-01T00:00:00.000Z' },
    })], new Date('2026-08-24T00:00:00.000Z').getTime());
    expect(plan.assignments).toEqual([]);
    expect(plan.unassignedTaskIds).toEqual(['t1']);
  });
});
