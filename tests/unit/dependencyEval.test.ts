/**
 * tests/unit/dependencyEval.test.ts
 * 任务依赖状态评估回归测试 — DAG：缺失、自依赖、循环、all_done、all_finished
 */

import { describe, it, expect } from 'vitest';
import { evaluateDependencies } from '../../src/utils/dependencyEval';
import type { Task } from '../../src/types';

/** 创建最小 Task fixture */
function makeTask(overrides: Partial<Task>): Task {
  return {
    id: overrides.id || 'task-1',
    prompt: overrides.prompt || 'test prompt',
    assignedAccountId: null,
    status: overrides.status || 'queued',
    mode: overrides.mode || 'chat',
    result: null,
    outputs: [],
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('evaluateDependencies', () => {
  it('无依赖时直接 ready', () => {
    const task = makeTask({ id: 't1', dependsOnTaskIds: [] });
    expect(evaluateDependencies(task, [task]).state).toBe('ready');
  });

  it('dependsOnTaskIds 为 undefined 时直接 ready', () => {
    const task = makeTask({ id: 't1' });
    expect(evaluateDependencies(task, [task]).state).toBe('ready');
  });

  // ---- all_done 策略（默认）----

  it('all_done: 全部前置 done → ready', () => {
    const dep1 = makeTask({ id: 'd1', status: 'done' });
    const dep2 = makeTask({ id: 'd2', status: 'done' });
    const task = makeTask({ id: 't1', dependsOnTaskIds: ['d1', 'd2'], dependencyPolicy: 'all_done' });
    expect(evaluateDependencies(task, [dep1, dep2, task]).state).toBe('ready');
  });

  it('all_done: 前置有 queued → waiting', () => {
    const dep1 = makeTask({ id: 'd1', status: 'done' });
    const dep2 = makeTask({ id: 'd2', status: 'queued' });
    const task = makeTask({ id: 't1', dependsOnTaskIds: ['d1', 'd2'], dependencyPolicy: 'all_done' });
    expect(evaluateDependencies(task, [dep1, dep2, task]).state).toBe('waiting');
  });

  it('all_done: 前置有 fail → failed', () => {
    const dep1 = makeTask({ id: 'd1', status: 'fail' });
    const task = makeTask({ id: 't1', dependsOnTaskIds: ['d1'], dependencyPolicy: 'all_done' });
    expect(evaluateDependencies(task, [dep1, task]).state).toBe('failed');
  });

  it('all_done: 前置有 cancelled → failed', () => {
    const dep1 = makeTask({ id: 'd1', status: 'cancelled' });
    const task = makeTask({ id: 't1', dependsOnTaskIds: ['d1'], dependencyPolicy: 'all_done' });
    expect(evaluateDependencies(task, [dep1, task]).state).toBe('failed');
  });

  // ---- all_finished 策略 ----

  it('all_finished: 全部前置 done → ready', () => {
    const dep1 = makeTask({ id: 'd1', status: 'done' });
    const task = makeTask({ id: 't1', dependsOnTaskIds: ['d1'], dependencyPolicy: 'all_finished' });
    expect(evaluateDependencies(task, [dep1, task]).state).toBe('ready');
  });

  it('all_finished: 前置有 fail → 仍 ready', () => {
    const dep1 = makeTask({ id: 'd1', status: 'fail' });
    const task = makeTask({ id: 't1', dependsOnTaskIds: ['d1'], dependencyPolicy: 'all_finished' });
    expect(evaluateDependencies(task, [dep1, task]).state).toBe('ready');
  });

  it('all_finished: 前置有 cancelled → 仍 ready', () => {
    const dep1 = makeTask({ id: 'd1', status: 'cancelled' });
    const task = makeTask({ id: 't1', dependsOnTaskIds: ['d1'], dependencyPolicy: 'all_finished' });
    expect(evaluateDependencies(task, [dep1, task]).state).toBe('ready');
  });

  it('all_finished: 前置有 queued → waiting', () => {
    const dep1 = makeTask({ id: 'd1', status: 'queued' });
    const task = makeTask({ id: 't1', dependsOnTaskIds: ['d1'], dependencyPolicy: 'all_finished' });
    expect(evaluateDependencies(task, [dep1, task]).state).toBe('waiting');
  });

  it('all_finished: 混合 done + fail → ready', () => {
    const dep1 = makeTask({ id: 'd1', status: 'done' });
    const dep2 = makeTask({ id: 'd2', status: 'fail' });
    const task = makeTask({ id: 't1', dependsOnTaskIds: ['d1', 'd2'], dependencyPolicy: 'all_finished' });
    expect(evaluateDependencies(task, [dep1, dep2, task]).state).toBe('ready');
  });

  // ---- all_accepted 策略 ----

  it.each([
    ['done 历史任务', makeTask({ id: 'd1', status: 'done' }), 'ready'],
    ['明确受理并观察中', makeTask({ id: 'd1', status: 'generating', runtime: {
      runId: 'run-1', attempt: 1, stage: 'generating', message: '观察中', startedAt: '2025-01-01T00:00:00.000Z',
      stageStartedAt: '2025-01-01T00:00:00.000Z', lastHeartbeatAt: '2025-01-01T00:00:00.000Z',
      conversationUrl: 'https://www.doubao.com/chat/one',
      acceptanceObservation: {
        schemaVersion: 1, accountId: 'a1', runId: 'run-1', conversationUrl: 'https://www.doubao.com/chat/one',
        acceptedAt: '2025-01-01T00:00:00.000Z', evidence: { kind: 'generation_started' },
        cursor: { messageCount: 1, pollCount: 0 }, expectedArtifact: { kind: 'video', runId: 'run-1' },
        lease: { ownerId: 'o1', acquiredAt: '2025-01-01T00:00:00.000Z', expiresAt: '2025-01-01T00:01:00.000Z', lastHeartbeatAt: '2025-01-01T00:00:00.000Z' },
        outcome: 'observing',
      }, input: { prompt: 'x', mode: 'video', attachments: [] },
    } }), 'ready'],
    ['generating 但无绑定', makeTask({ id: 'd1', status: 'generating' }), 'waiting'],
    ['仅有 submittedAt', makeTask({ id: 'd1', status: 'paused', runtime: {
      runId: 'r', attempt: 1, stage: 'paused', message: 'uncertain', startedAt: '2025-01-01T00:00:00.000Z',
      stageStartedAt: '2025-01-01T00:00:00.000Z', lastHeartbeatAt: '2025-01-01T00:00:00.000Z', submittedAt: '2025-01-01T00:00:00.000Z',
      input: { prompt: 'x', mode: 'video', attachments: [] },
    }, errorInfo: { code: 'submission_uncertain', message: 'unknown', recoverable: true, detectedAt: '2025-01-01T00:00:00.000Z' } }), 'waiting'],
  ])('all_accepted: %s → %s', (_label, dependency, expected) => {
    const task = makeTask({ id: 't1', dependsOnTaskIds: ['d1'], dependencyPolicy: 'all_accepted' });
    expect(evaluateDependencies(task, [dependency, task]).state).toBe(expected);
  });

  it('all_accepted: 前置受理后即使后续进入 fail，仍视为已受理且不重复提交', () => {
    const dependency = makeTask({ id: 'd1', status: 'fail', runtime: {
      runId: 'run-accepted', attempt: 1, stage: 'failed', message: '产物观察失败', startedAt: '2025-01-01T00:00:00.000Z',
      stageStartedAt: '2025-01-01T00:00:00.000Z', lastHeartbeatAt: '2025-01-01T00:00:00.000Z',
      conversationUrl: 'https://www.doubao.com/chat/accepted',
      acceptanceObservation: {
        schemaVersion: 1, accountId: 'a1', runId: 'run-accepted', conversationUrl: 'https://www.doubao.com/chat/accepted',
        acceptedAt: '2025-01-01T00:00:00.000Z', evidence: { kind: 'prompt_published' }, cursor: { messageCount: 1, pollCount: 0 },
        expectedArtifact: { kind: 'video', runId: 'run-accepted' }, lease: {
          ownerId: 'o1', acquiredAt: '2025-01-01T00:00:00.000Z', expiresAt: '2025-01-01T00:01:00.000Z', lastHeartbeatAt: '2025-01-01T00:00:00.000Z',
        }, outcome: 'observing',
      }, input: { prompt: 'x', mode: 'video', attachments: [] },
    } });
    const task = makeTask({ id: 't1', dependsOnTaskIds: ['d1'], dependencyPolicy: 'all_accepted' });
    expect(evaluateDependencies(task, [dependency, task]).state).toBe('ready');
  });

  it('all_accepted: observation 与 runtime 会话不一致时保持 waiting', () => {
    const dependency = makeTask({ id: 'd1', status: 'generating', runtime: {
      runId: 'run-1', attempt: 1, stage: 'generating', message: '观察中', startedAt: '2025-01-01T00:00:00.000Z',
      stageStartedAt: '2025-01-01T00:00:00.000Z', lastHeartbeatAt: '2025-01-01T00:00:00.000Z',
      conversationUrl: 'https://www.doubao.com/chat/runtime',
      acceptanceObservation: {
        schemaVersion: 1, accountId: 'a1', runId: 'run-1', conversationUrl: 'https://www.doubao.com/chat/binding',
        acceptedAt: '2025-01-01T00:00:00.000Z', evidence: { kind: 'generation_started' },
        cursor: { messageCount: 1, pollCount: 0 }, expectedArtifact: { kind: 'video', runId: 'run-1' },
        lease: { ownerId: 'o1', acquiredAt: '2025-01-01T00:00:00.000Z', expiresAt: '2025-01-01T00:01:00.000Z', lastHeartbeatAt: '2025-01-01T00:00:00.000Z' },
        outcome: 'observing',
      }, input: { prompt: 'x', mode: 'video', attachments: [] },
    } });
    const task = makeTask({ id: 't1', dependsOnTaskIds: ['d1'], dependencyPolicy: 'all_accepted' });
    expect(evaluateDependencies(task, [dependency, task]).state).toBe('waiting');
  });

  // ---- 缺失依赖 ----

  it('依赖不存在的任务 → missing', () => {
    const task = makeTask({ id: 't1', dependsOnTaskIds: ['nonexistent'] });
    expect(evaluateDependencies(task, [task]).state).toBe('missing');
  });

  it('部分依赖缺失 → missing', () => {
    const dep1 = makeTask({ id: 'd1', status: 'done' });
    const task = makeTask({ id: 't1', dependsOnTaskIds: ['d1', 'missing'], dependencyPolicy: 'all_done' });
    expect(evaluateDependencies(task, [dep1, task]).state).toBe('missing');
  });

  // ---- 自依赖 ----

  it('自依赖（依赖自身 ID）即使状态 done 也判定 invalid', () => {
    const task = makeTask({ id: 't1', status: 'done', dependsOnTaskIds: ['t1'], dependencyPolicy: 'all_done' });
    expect(evaluateDependencies(task, [task]).state).toBe('invalid');
  });

  it('自依赖 — 自身状态 queued 时也判定 invalid', () => {
    const task = makeTask({ id: 't1', status: 'queued', dependsOnTaskIds: ['t1'], dependencyPolicy: 'all_done' });
    expect(evaluateDependencies(task, [task]).state).toBe('invalid');
  });

  // ---- 循环依赖 ----

  it('循环依赖 A→B→A — 两端均判定 invalid', () => {
    const taskA = makeTask({ id: 'A', status: 'queued', dependsOnTaskIds: ['B'], dependencyPolicy: 'all_done' });
    const taskB = makeTask({ id: 'B', status: 'queued', dependsOnTaskIds: ['A'], dependencyPolicy: 'all_done' });
    expect(evaluateDependencies(taskA, [taskA, taskB]).state).toBe('invalid');
    expect(evaluateDependencies(taskB, [taskA, taskB]).state).toBe('invalid');
  });

  // ---- message 验证 ----

  it('missing 状态包含提示消息', () => {
    const task = makeTask({ id: 't1', dependsOnTaskIds: ['missing'] });
    const result = evaluateDependencies(task, [task]);
    expect(result.message).toBeTruthy();
    expect(result.message).toContain('依赖不存在');
  });

  it('failed 状态包含提示消息', () => {
    const dep = makeTask({ id: 'd1', status: 'fail' });
    const task = makeTask({ id: 't1', dependsOnTaskIds: ['d1'], dependencyPolicy: 'all_done' });
    const result = evaluateDependencies(task, [dep, task]);
    expect(result.message).toBeTruthy();
    expect(result.message).toContain('前置任务');
  });

  it('waiting 状态包含提示消息', () => {
    const dep = makeTask({ id: 'd1', status: 'queued' });
    const task = makeTask({ id: 't1', dependsOnTaskIds: ['d1'], dependencyPolicy: 'all_done' });
    const result = evaluateDependencies(task, [dep, task]);
    expect(result.message).toBeTruthy();
    expect(result.message).toContain('尚未满足');
  });
});

describe('dependency error codes and blockedByTaskIds', () => {
  it('missing: dependency_missing + 去重稳定排序的缺失 ID', () => {
    const task = makeTask({ id: 't1', dependsOnTaskIds: ['z', 'a', 'z', 'a', 'm'] });
    const result = evaluateDependencies(task, [task]);
    expect(result.state).toBe('missing');
    expect(result.code).toBe('dependency_missing');
    expect(result.blockedByTaskIds).toEqual(['a', 'm', 'z']);
  });

  it('cycle: dependency_cycle + 稳定排序的循环任务 ID', () => {
    const taskA = makeTask({ id: 'A', dependsOnTaskIds: ['B'] });
    const taskB = makeTask({ id: 'B', dependsOnTaskIds: ['C'] });
    const taskC = makeTask({ id: 'C', dependsOnTaskIds: ['A'] });
    const result = evaluateDependencies(taskA, [taskA, taskB, taskC]);
    expect(result.state).toBe('invalid');
    expect(result.code).toBe('dependency_cycle');
    expect(result.blockedByTaskIds).toEqual(['A', 'B', 'C']);
  });

  it('all_done: dependency_failed + 全部不可满足前置 ID', () => {
    const depA = makeTask({ id: 'b', status: 'cancelled' });
    const depB = makeTask({ id: 'a', status: 'fail' });
    const depC = makeTask({ id: 'c', status: 'queued' });
    const task = makeTask({ id: 't1', dependsOnTaskIds: ['c', 'b', 'a'], dependencyPolicy: 'all_done' });
    const result = evaluateDependencies(task, [depA, depB, depC, task]);
    expect(result.state).toBe('failed');
    expect(result.code).toBe('dependency_failed');
    expect(result.blockedByTaskIds).toEqual(['a', 'b']);
  });

  it('all_accepted: 终止且无绑定 → dependency_failed', () => {
    const dependency = makeTask({ id: 'd1', status: 'fail' });
    const task = makeTask({ id: 't1', dependsOnTaskIds: ['d1'], dependencyPolicy: 'all_accepted' });
    const result = evaluateDependencies(task, [dependency, task]);
    expect(result.state).toBe('failed');
    expect(result.code).toBe('dependency_failed');
    expect(result.blockedByTaskIds).toEqual(['d1']);
  });

  it('all_accepted: waiting_generation_confirmation + 有效绑定 → ready', () => {
    const dependency = makeTask({ id: 'd1', status: 'waiting_generation_confirmation', runtime: {
      runId: 'run-1', attempt: 1, stage: 'waiting_generation_confirmation', message: 'waiting',
      startedAt: '2025-01-01T00:00:00.000Z', stageStartedAt: '2025-01-01T00:00:00.000Z', lastHeartbeatAt: '2025-01-01T00:00:00.000Z',
      conversationUrl: 'https://www.doubao.com/chat/one',
      acceptanceObservation: {
        schemaVersion: 1, accountId: 'a1', runId: 'run-1', conversationUrl: 'https://www.doubao.com/chat/one',
        acceptedAt: '2025-01-01T00:00:00.000Z', evidence: { kind: 'generation_started' }, cursor: { messageCount: 1, pollCount: 0 },
        expectedArtifact: { kind: 'video', runId: 'run-1' }, lease: {
          ownerId: 'o1', acquiredAt: '2025-01-01T00:00:00.000Z', expiresAt: '2025-01-01T00:01:00.000Z', lastHeartbeatAt: '2025-01-01T00:00:00.000Z',
        }, outcome: 'observing',
      },
      input: { prompt: 'x', mode: 'video', attachments: [] },
    } });
    const task = makeTask({ id: 't1', dependsOnTaskIds: ['d1'], dependencyPolicy: 'all_accepted' });
    expect(evaluateDependencies(task, [dependency, task]).state).toBe('ready');
  });

  it('all_finished: 前序失败不产生 dependency_failed', () => {
    const dependency = makeTask({ id: 'd1', status: 'fail' });
    const task = makeTask({ id: 't1', dependsOnTaskIds: ['d1'], dependencyPolicy: 'all_finished' });
    const result = evaluateDependencies(task, [dependency, task]);
    expect(result.state).toBe('ready');
    expect(result.code).toBeUndefined();
  });
});