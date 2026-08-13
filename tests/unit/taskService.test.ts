import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import type { Task, TaskStage, TaskLock } from '@doubao-studio/contracts';
import { TaskService } from '../../main/core/TaskService';
import type { ArtifactProbe } from '../../main/core/TaskService';

function base(id: string, status: Task['status'] = 'queued'): Task {
  return { id, prompt: id, assignedAccountId: null, status, mode: 'video', result: null, outputs: [], artifacts: [], createdAt: 'old', updatedAt: 'old' };
}

function fixture(initial: Task[] = []) {
  let stored = structuredClone(initial);
  const store = { read: () => structuredClone(stored), replace: (tasks: Task[]) => { stored = structuredClone(tasks); return true; } };
  let id = 0;
  const service = new TaskService({ store, defaultProjectId: () => 'default', id: () => `id-${++id}`, now: () => 'now' });
  return { service, stored: () => stored };
}

describe('TaskService 核心用例', () => {
  it('过滤空提示词并创建规范任务', () => {
    const { service, stored } = fixture();
    const result = service.create({ prompts: [' A ', ' ', 'B'], mode: 'video' });
    expect(result.success && result.data.map((task) => task.prompt)).toEqual(['A', 'B']);
    expect(stored().map((task) => [task.id, task.projectId, task.status])).toEqual([['id-1', 'default', 'queued'], ['id-2', 'default', 'queued']]);
  });

  it('空输入 fail-closed 且不写入', () => {
    const { service, stored } = fixture();
    expect(service.create({ prompts: [' '] })).toEqual({ success: false, error: '请输入至少一条提示词' });
    expect(stored()).toEqual([]);
  });

  it('状态更新去重产物并清除成功任务错误', () => {
    const item = base('t1', 'fail'); item.errorInfo = { code: 'timeout', message: 'x', recoverable: true, detectedAt: 'old' };
    const { service, stored } = fixture([item]);
    expect(service.updateStatus({ taskId: 't1', status: 'done', outputs: ['u', 'u'] }).success).toBe(true);
    expect(stored()[0].outputs).toEqual(['u']); expect(stored()[0].artifacts).toHaveLength(1); expect(stored()[0].errorInfo).toBeUndefined();
  });

  it('执行中或存在下游依赖时禁止删除', () => {
    expect(fixture([base('t1', 'executing')]).service.delete('t1').success).toBe(false);
    const child = base('child'); child.dependsOnTaskIds = ['t1'];
    expect(fixture([base('t1'), child]).service.delete('t1')).toEqual({ success: false, error: '仍有 1 个任务依赖此任务，请先调整依赖关系' });
  });

  it('安全删除无依赖的非活动任务', () => {
    const { service, stored } = fixture([base('t1', 'done')]);
    expect(service.delete('t1')).toEqual({ success: true }); expect(stored()).toEqual([]);
  });

  it('重试清除结果、输出、错误和锁并恢复运行阶段', () => {
    const item = base('t1', 'fail'); item.result = 'x'; item.outputs = ['u']; item.lock = { ownerId: 'o', acquiredAt: 'old', expiresAt: 'old' };
    item.errorInfo = { code: 'timeout', message: 'x', recoverable: true, detectedAt: 'old' };
    item.runtime = { runId: 'r', attempt: 1, stage: 'failed', message: 'x', startedAt: 'old', stageStartedAt: 'old', lastHeartbeatAt: 'old', input: { prompt: 't1', mode: 'video', attachments: [] } };
    const { service, stored } = fixture([item]);
    expect(service.retry('t1').success).toBe(true);
    expect(stored()[0]).toMatchObject({ status: 'queued', result: null, outputs: [], updatedAt: 'now', runtime: { stage: 'queued', message: '等待执行' } });
    expect(stored()[0].lock).toBeUndefined(); expect(stored()[0].errorInfo).toBeUndefined();
  });

  it('Repository 冲突或写盘异常统一返回安全失败', () => {
    const service = new TaskService({
      store: { read: () => [], replace: () => { throw new Error('TASK_REPOSITORY_STALE_SNAPSHOT'); } },
      defaultProjectId: () => 'default', id: () => 'id', now: () => 'now',
    });
    expect(service.create({ prompts: ['A'] })).toEqual({
      success: false, error: '任务数据写入失败，请检查磁盘空间和数据目录权限',
    });
  });
});

// ==================== assign ====================

function withRuntime(task: Task, stage: TaskStage = 'queued'): Task {
  task.runtime = {
    runId: 'r', attempt: 1, stage, message: 'x', startedAt: 'old',
    stageStartedAt: 'old', lastHeartbeatAt: 'old',
    input: { prompt: task.prompt, mode: task.mode, attachments: [] },
  };
  return task;
}

describe('TaskService assign', () => {
  it('指派成功并完整重置队列状态', () => {
    const item = withRuntime(base('t1', 'paused'), 'paused');
    item.result = 'old';
    item.outputs = ['old'];
    item.errorInfo = { code: 'timeout', message: 'x', recoverable: true, detectedAt: 'old' };
    item.lock = { ownerId: 'o', acquiredAt: 'old', expiresAt: 'old' };
    const { service, stored } = fixture([item]);
    expect(service.assign({ taskId: 't1', accountId: 'acc-1' })).toEqual({ success: true });
    const task = stored()[0];
    expect(task.assignedAccountId).toBe('acc-1');
    expect(task.status).toBe('queued');
    expect(task.result).toBeNull();
    expect(task.outputs).toEqual([]);
    expect(task.errorInfo).toBeUndefined();
    expect(task.lock).toBeUndefined();
    expect(task.runtime?.stage).toBe('queued');
    expect(task.runtime?.message).toBe('等待执行');
    expect(task.runtime?.stageStartedAt).toBe('now');
    expect(task.runtime?.lastHeartbeatAt).toBe('now');
    expect(task.updatedAt).toBe('now');
  });

  it.each(['executing', 'generating', 'waiting_verification'] as const)(
    '活动状态 %s 禁止指派且零写入',
    (status) => {
      const { service, stored } = fixture([base('t1', status)]);
      expect(service.assign({ taskId: 't1', accountId: 'acc' })).toEqual({
        success: false, error: '任务正在自动化执行中，无法重新指派',
      });
      expect(stored()[0].assignedAccountId).toBeNull();
      expect(stored()[0].status).toBe(status);
    },
  );

  it('指派目标不存在', () => {
    const { service, stored } = fixture([base('t1')]);
    expect(service.assign({ taskId: 'missing', accountId: 'acc' })).toEqual({
      success: false, error: '任务不存在',
    });
    expect(stored()).toHaveLength(1);
  });
});

// ==================== update ====================

describe('TaskService update', () => {
  it('编辑成功并规范化字段', () => {
    const item = withRuntime(base('t1', 'fail'), 'failed');
    const { service, stored } = fixture([item]);
    const result = service.update({
      taskId: 't1',
      updates: { prompt: '  new  ', videoConfig: { model: 'seedance-2.0', duration: '10s', aspectRatio: '16:9' }, attachments: ['a.jpg'], audioAttachment: 'b.mp3' },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.prompt).toBe('new');
      expect(result.data.videoConfig).toEqual({ model: 'seedance-2.0', duration: '10s', aspectRatio: '16:9' });
      expect(result.data.attachments).toEqual(['a.jpg']);
      expect(result.data.audioAttachment).toBe('b.mp3');
    }
    const task = stored()[0];
    expect(task.prompt).toBe('new');
    expect(task.status).toBe('queued');
    expect(task.runtime?.stage).toBe('queued');
    expect(task.updatedAt).toBe('now');
  });

  it('空提示词拒绝且零写入', () => {
    const { service, stored } = fixture([base('t1', 'queued')]);
    expect(service.update({ taskId: 't1', updates: { prompt: '  ' } })).toEqual({
      success: false, error: '提示词不能为空',
    });
    expect(stored()[0].prompt).toBe('t1');
  });

  it('空 attachments 规范为 undefined', () => {
    const { service, stored } = fixture([base('t1')]);
    service.update({ taskId: 't1', updates: { prompt: 'new', attachments: [] } });
    expect(stored()[0].attachments).toBeUndefined();
  });

  it('空 audioAttachment 规范为 undefined', () => {
    const { service, stored } = fixture([base('t1')]);
    service.update({ taskId: 't1', updates: { prompt: 'new', audioAttachment: '' } });
    expect(stored()[0].audioAttachment).toBeUndefined();
  });
});

// ==================== batchPause ====================

describe('TaskService batchPause', () => {
  it('只暂停活动状态，其他状态保持不变', () => {
    const tasks: Task[] = [
      ...(['executing', 'generating', 'waiting_verification'] as const).map((s, i) => withRuntime(base(`a${i}`, s), 'generating')),
      ...(['queued', 'paused', 'done', 'fail', 'cancelled'] as const).map((s, i) => base(`i${i}`, s)),
    ];
    const { service, stored } = fixture(tasks);
    expect(service.batchPause().success).toBe(true);
    const result = stored();
    expect(result[0].status).toBe('paused');
    expect(result[1].status).toBe('paused');
    expect(result[2].status).toBe('paused');
    expect(result[3].status).toBe('queued');
    expect(result[4].status).toBe('paused');
    expect(result[5].status).toBe('done');
    expect(result[6].status).toBe('fail');
    expect(result[7].status).toBe('cancelled');
  });

  it('runtime、errorInfo 和 updatedAt 使用同一注入时间', () => {
    const item = withRuntime(base('t1', 'executing'), 'generating');
    const { service, stored } = fixture([item]);
    service.batchPause();
    const task = stored()[0];
    expect(task.errorInfo).toEqual({ code: 'cancelled', message: '批量暂停', recoverable: true, detectedAt: 'now' });
    expect(task.runtime?.stage).toBe('paused');
    expect(task.runtime?.message).toBe('批量暂停');
    expect(task.runtime?.stageStartedAt).toBe('now');
    expect(task.runtime?.lastHeartbeatAt).toBe('now');
    expect(task.updatedAt).toBe('now');
    expect(task.result).toBe('批量暂停');
  });

  it('无关字段保持不变', () => {
    const item = withRuntime(base('t1', 'executing'), 'generating');
    item.runHistory = [{ runId: 'r', attempt: 1, startedAt: 'old' }];
    item.artifacts = [{ id: 'a1', url: 'http://x', kind: 'video', source: 'network', discoveredAt: 'old' }];
    item.outputs = ['old-output'];
    item.batchId = 'batch-1';
    item.source = 'csv';
    item.dependsOnTaskIds = ['dep-1'];
    const { service, stored } = fixture([item]);
    service.batchPause();
    const task = stored()[0];
    expect(task.runHistory).toEqual([{ runId: 'r', attempt: 1, startedAt: 'old' }]);
    expect(task.artifacts).toEqual([{ id: 'a1', url: 'http://x', kind: 'video', source: 'network', discoveredAt: 'old' }]);
    expect(task.outputs).toEqual(['old-output']);
    expect(task.batchId).toBe('batch-1');
    expect(task.source).toBe('csv');
    expect(task.dependsOnTaskIds).toEqual(['dep-1']);
    expect(task.runtime?.runId).toBe('r');
    expect(task.runtime?.attempt).toBe(1);
    expect(task.runtime?.startedAt).toBe('old');
    expect(task.runtime?.input).toEqual({ prompt: 't1', mode: 'video', attachments: [] });
  });

  it('无活动任务时返回成功且不写入', () => {
    const initial = [base('t1', 'queued'), base('t2', 'done')];
    let stored = structuredClone(initial);
    let writeCount = 0;
    const store = {
      read: () => structuredClone(stored),
      replace: (t: Task[]) => { writeCount++; stored = structuredClone(t); return true; },
    };
    const service = new TaskService({ store, defaultProjectId: () => 'default', now: () => 'now' });
    expect(service.batchPause()).toEqual({ success: true });
    expect(writeCount).toBe(0);
  });
});

// ==================== fail-closed ====================

describe('TaskService fail-closed', () => {
  const WRITE_ERROR = '任务数据写入失败，请检查磁盘空间和数据目录权限';

  it('assign 在 Repository replace=false 时 fail-closed', () => {
    const service = new TaskService({
      store: { read: () => [structuredClone(base('t1', 'queued'))], replace: () => false },
      defaultProjectId: () => 'default', now: () => 'now',
    });
    expect(service.assign({ taskId: 't1', accountId: 'acc' })).toEqual({ success: false, error: WRITE_ERROR });
  });

  it('assign 在 Repository 抛出陈旧快照异常时 fail-closed', () => {
    const service = new TaskService({
      store: { read: () => [structuredClone(base('t1', 'queued'))], replace: () => { throw new Error('TASK_REPOSITORY_STALE_SNAPSHOT'); } },
      defaultProjectId: () => 'default', now: () => 'now',
    });
    expect(service.assign({ taskId: 't1', accountId: 'acc' })).toEqual({ success: false, error: WRITE_ERROR });
  });

  it('update 在 Repository replace=false 时 fail-closed', () => {
    const service = new TaskService({
      store: { read: () => [structuredClone(base('t1', 'queued'))], replace: () => false },
      defaultProjectId: () => 'default', now: () => 'now',
    });
    expect(service.update({ taskId: 't1', updates: { prompt: 'new' } })).toEqual({ success: false, error: WRITE_ERROR });
  });

  it('update 在 Repository 抛出陈旧快照异常时 fail-closed', () => {
    const service = new TaskService({
      store: { read: () => [structuredClone(base('t1', 'queued'))], replace: () => { throw new Error('TASK_REPOSITORY_STALE_SNAPSHOT'); } },
      defaultProjectId: () => 'default', now: () => 'now',
    });
    expect(service.update({ taskId: 't1', updates: { prompt: 'new' } })).toEqual({ success: false, error: WRITE_ERROR });
  });

  it('batchPause 在 Repository replace=false 时 fail-closed', () => {
    const service = new TaskService({
      store: { read: () => [structuredClone(base('t1', 'executing'))], replace: () => false },
      defaultProjectId: () => 'default', now: () => 'now',
    });
    expect(service.batchPause()).toEqual({ success: false, error: WRITE_ERROR });
  });

  it('batchPause 在 Repository 抛出陈旧快照异常时 fail-closed', () => {
    const service = new TaskService({
      store: { read: () => [structuredClone(base('t1', 'executing'))], replace: () => { throw new Error('TASK_REPOSITORY_STALE_SNAPSHOT'); } },
      defaultProjectId: () => 'default', now: () => 'now',
    });
    expect(service.batchPause()).toEqual({ success: false, error: WRITE_ERROR });
  });
});

// ==================== updateRuntime ====================

const NOW_ISO = '2026-08-13T00:00:00.000Z';
const NOW_MS = Date.parse(NOW_ISO);
const RUNTIME_WRITE_ERROR = '任务数据写入失败，请检查磁盘空间和数据目录权限';

function runtimeFixture(initial: Task[] = []) {
  let stored = structuredClone(initial);
  let writeCount = 0;
  const store = {
    read: () => structuredClone(stored),
    replace: (tasks: Task[]) => { writeCount++; stored = structuredClone(tasks); return true; },
  };
  const service = new TaskService({
    store, defaultProjectId: () => 'default', now: () => NOW_ISO,
  });
  return { service, stored: () => stored, writeCount: () => writeCount };
}

describe('TaskService updateRuntime', () => {
  it('任务不存在', () => {
    const { service, writeCount } = runtimeFixture([base('t1')]);
    expect(service.updateRuntime({ taskId: 'missing', status: 'done' })).toEqual({
      success: false, error: '任务不存在',
    });
    expect(writeCount()).toBe(0);
  });

  it('未初始化 runtime 且 patch 缺少 runId 时拒绝并零写入', () => {
    const { service, writeCount } = runtimeFixture([base('t1')]);
    expect(service.updateRuntime({ taskId: 't1', runtime: { stage: 'generating' } })).toEqual({
      success: false, error: '运行快照尚未初始化',
    });
    expect(writeCount()).toBe(0);
  });

  it('合并现有 runtime patch 并不重复建立 runHistory 记录', () => {
    const item = base('t1', 'executing');
    item.runtime = {
      runId: 'r1', attempt: 1, stage: 'queued', message: 'old',
      startedAt: '2026-08-12T00:00:00.000Z',
      stageStartedAt: 'old', lastHeartbeatAt: 'old',
      input: { prompt: 't1', mode: 'video', attachments: [] },
    };
    item.runHistory = [{ runId: 'r1', attempt: 1, startedAt: '2026-08-12T00:00:00.000Z' }];
    const { service, stored } = runtimeFixture([item]);
    expect(service.updateRuntime({
      taskId: 't1', runtime: { stage: 'generating', message: '生成中' },
    }).success).toBe(true);
    const task = stored()[0];
    expect(task.runtime?.stage).toBe('generating');
    expect(task.runtime?.message).toBe('生成中');
    expect(task.runtime?.runId).toBe('r1');
    expect(task.runHistory).toHaveLength(1);
  });

  it('首次 runtime 创建 runHistory 记录', () => {
    const { service, stored } = runtimeFixture([base('t1', 'executing')]);
    service.updateRuntime({
      taskId: 't1',
      runtime: {
        runId: 'r1', attempt: 1, stage: 'queued', message: '开始',
        startedAt: '2026-08-12T00:00:00.000Z',
      },
    });
    expect(stored()[0].runHistory).toEqual([
      { runId: 'r1', attempt: 1, startedAt: '2026-08-12T00:00:00.000Z' },
    ]);
  });

  it('runHistory 最多保留 20 条', () => {
    const item = base('t1', 'executing');
    item.runHistory = Array.from({ length: 20 }, (_, i) => ({
      runId: `old-${i}`, attempt: i + 1, startedAt: '2026-08-01T00:00:00.000Z',
    }));
    const { service, stored } = runtimeFixture([item]);
    service.updateRuntime({
      taskId: 't1',
      runtime: {
        runId: 'new-r', attempt: 21, stage: 'queued', message: 'new',
        startedAt: '2026-08-12T00:00:00.000Z',
      },
    });
    const task = stored()[0];
    expect(task.runHistory).toHaveLength(20);
    expect(task.runHistory![19].runId).toBe('new-r');
    expect(task.runHistory![0].runId).toBe('old-1');
  });

  it.each([
    ['done', 'done'],
    ['fail', 'failed'],
    ['paused', 'paused'],
    ['cancelled', 'cancelled'],
  ] as const)('终态 %s 设置正确的 outcome/finalStage/errorCode/duration 且时间一致', (status, expectedOutcome) => {
    const startedAt = '2026-08-12T00:00:00.000Z';
    const item = base('t1', 'executing');
    item.runtime = {
      runId: 'r1', attempt: 1, stage: 'generating', message: '生成中',
      startedAt, stageStartedAt: startedAt, lastHeartbeatAt: startedAt,
      input: { prompt: 't1', mode: 'video', attachments: [] },
    };
    item.runHistory = [{ runId: 'r1', attempt: 1, startedAt }];
    item.errorInfo = { code: 'timeout', message: '超时', recoverable: true, detectedAt: startedAt };
    const { service, stored } = runtimeFixture([item]);
    service.updateRuntime({
      taskId: 't1', status,
      runtime: { stage: status === 'done' ? 'completed' : status === 'fail' ? 'failed' : status },
    });
    const task = stored()[0];
    const record = task.runHistory![0];
    expect(record.outcome).toBe(expectedOutcome);
    expect(record.finalStage).toBe(task.runtime?.stage);
    expect(record.errorCode).toBe('timeout');
    expect(record.durationMs).toBe(new Date(NOW_ISO).getTime() - new Date(startedAt).getTime());
    expect(record.durationMs).toBeGreaterThanOrEqual(0);
    expect(record.finishedAt).toBe(NOW_ISO);
    expect(task.updatedAt).toBe(NOW_ISO);
  });

  it('errorInfo=null 清除错误', () => {
    const item = base('t1', 'fail');
    item.errorInfo = { code: 'timeout', message: '超时', recoverable: true, detectedAt: 'old' };
    const { service, stored } = runtimeFixture([item]);
    service.updateRuntime({ taskId: 't1', errorInfo: null });
    expect(stored()[0].errorInfo).toBeUndefined();
  });

  it.each([
    ['read 失败', () => { throw new Error('read failed'); }, () => true],
    ['replace=false', () => [structuredClone(base('t1', 'executing'))], () => false],
    ['陈旧快照异常', () => [structuredClone(base('t1', 'executing'))], () => { throw new Error('TASK_REPOSITORY_STALE_SNAPSHOT'); }],
  ])('updateRuntime 在 Repository %s 时 fail-closed', (_label, readFn, replaceFn) => {
    const service = new TaskService({
      store: { read: readFn as () => Task[], replace: replaceFn as () => boolean },
      defaultProjectId: () => 'default', now: () => NOW_ISO,
    });
    expect(service.updateRuntime({ taskId: 't1', status: 'done' })).toEqual({
      success: false, error: RUNTIME_WRITE_ERROR,
    });
  });
});

// ==================== lease ====================

function leaseFixture(initial: Task[] = []) {
  let stored = structuredClone(initial);
  let writeCount = 0;
  const store = {
    read: () => structuredClone(stored),
    replace: (tasks: Task[]) => { writeCount++; stored = structuredClone(tasks); return true; },
  };
  const service = new TaskService({
    store, defaultProjectId: () => 'default',
    now: () => new Date(NOW_MS).toISOString(), nowMs: () => NOW_MS,
  });
  return { service, stored: () => stored, writeCount: () => writeCount };
}

function withLock(task: Task, ownerId = 'owner-1'): Task {
  task.lock = {
    ownerId,
    acquiredAt: new Date(NOW_MS).toISOString(),
    expiresAt: new Date(NOW_MS + 60_000).toISOString(),
  };
  return task;
}

describe('TaskService lease', () => {
  it('acquire 成功并写入正确锁', () => {
    const item = base('t1', 'queued');
    item.assignedAccountId = 'acc-1';
    const { service, stored } = leaseFixture([item]);
    const result = service.acquireLock({ taskId: 't1', ownerId: 'owner-1' });
    expect(result.success).toBe(true);
    const task = stored()[0];
    expect(task.lock?.ownerId).toBe('owner-1');
    expect(task.lock?.acquiredAt).toBe(new Date(NOW_MS).toISOString());
    expect(Date.parse(task.lock!.expiresAt)).toBe(NOW_MS + 2 * 60 * 1000);
    expect(task.updatedAt).toBe(new Date(NOW_MS).toISOString());
  });

  it('有效同账号冲突拒绝且零写入', () => {
    const t1 = base('t1', 'queued');
    t1.assignedAccountId = 'acc-1';
    const t2 = base('t2', 'executing');
    t2.assignedAccountId = 'acc-1';
    t2.lock = { ownerId: 'other', acquiredAt: new Date(NOW_MS).toISOString(), expiresAt: new Date(NOW_MS + 60_000).toISOString() };
    const { service, stored, writeCount } = leaseFixture([t1, t2]);
    expect(service.acquireLock({ taskId: 't1', ownerId: 'owner-1' })).toEqual({
      success: false, error: '该账号已经被其他任务锁定',
    });
    expect(writeCount()).toBe(0);
    expect(stored()[0].lock).toBeUndefined();
  });

  it('不同账号不互相阻塞且无效 expiresAt 不形成账号冲突', () => {
    const t1 = base('t1', 'queued'); t1.assignedAccountId = 'acc-1';
    const t2 = base('t2', 'executing'); t2.assignedAccountId = 'acc-2';
    t2.lock = { ownerId: 'other', acquiredAt: new Date(NOW_MS).toISOString(), expiresAt: new Date(NOW_MS + 60_000).toISOString() };
    expect(leaseFixture([t1, t2]).service.acquireLock({ taskId: 't1', ownerId: 'owner-1' }).success).toBe(true);

    const t3 = base('t3', 'queued'); t3.assignedAccountId = 'acc-1';
    const t4 = base('t4', 'executing'); t4.assignedAccountId = 'acc-1';
    t4.lock = { ownerId: 'other', acquiredAt: 'old', expiresAt: 'not-a-date' };
    expect(leaseFixture([t3, t4]).service.acquireLock({ taskId: 't3', ownerId: 'owner-1' }).success).toBe(true);
  });

  it('renew 成功并更新锁', () => {
    const item = withLock(base('t1', 'executing'), 'owner-1');
    const { service, stored } = leaseFixture([item]);
    const result = service.renewLock({ taskId: 't1', ownerId: 'owner-1' });
    expect(result.success).toBe(true);
    const task = stored()[0];
    expect(task.lock?.ownerId).toBe('owner-1');
    expect(Date.parse(task.lock!.expiresAt)).toBe(NOW_MS + 2 * 60 * 1000);
    expect(task.lock?.acquiredAt).toBe(new Date(NOW_MS).toISOString());
    expect(task.updatedAt).toBe(new Date(NOW_MS).toISOString());
  });

  it.each<{
    label: string; lock: TaskLock | undefined; ownerId: string; expectedError: string;
  }>([
    { label: '缺失锁', lock: undefined, ownerId: 'owner-1', expectedError: '任务锁不存在或已过期' },
    { label: '已过期', lock: { ownerId: 'owner-1', acquiredAt: 'old', expiresAt: new Date(NOW_MS - 1).toISOString() }, ownerId: 'owner-1', expectedError: '任务锁不存在或已过期' },
    { label: 'owner 不匹配', lock: { ownerId: 'other', acquiredAt: 'old', expiresAt: new Date(NOW_MS + 60_000).toISOString() }, ownerId: 'owner-1', expectedError: '任务锁 owner 不匹配' },
  ])('renew $label 时失败', ({ lock, ownerId, expectedError }) => {
    const item = base('t1', 'executing');
    item.lock = lock;
    const { service, writeCount } = leaseFixture([item]);
    expect(service.renewLock({ taskId: 't1', ownerId })).toEqual({ success: false, error: expectedError });
    expect(writeCount()).toBe(0);
  });

  it('release 正确 owner 成功', () => {
    const item = withLock(base('t1', 'executing'), 'owner-1');
    const { service, stored } = leaseFixture([item]);
    expect(service.releaseLock({ taskId: 't1', ownerId: 'owner-1' })).toEqual({ success: true });
    expect(stored()[0].lock).toBeUndefined();
    expect(stored()[0].updatedAt).toBe(new Date(NOW_MS).toISOString());
  });

  it('release 错误 owner 拒绝且零写入', () => {
    const item = withLock(base('t1', 'executing'), 'owner-1');
    const { service, stored, writeCount } = leaseFixture([item]);
    expect(service.releaseLock({ taskId: 't1', ownerId: 'wrong' })).toEqual({
      success: false, error: '任务锁 owner 不匹配',
    });
    expect(writeCount()).toBe(0);
    expect(stored()[0].lock?.ownerId).toBe('owner-1');
  });

  it.each<[string, (s: TaskService) => { success: boolean; error?: string }]>([
    ['acquireLock', (s) => s.acquireLock({ taskId: 'missing', ownerId: 'o' })],
    ['renewLock', (s) => s.renewLock({ taskId: 'missing', ownerId: 'o' })],
    ['releaseLock', (s) => s.releaseLock({ taskId: 'missing', ownerId: 'o' })],
  ])('%s 任务不存在', (_op, call) => {
    const { service, writeCount } = leaseFixture([base('t1')]);
    expect(call(service)).toEqual({ success: false, error: '任务不存在' });
    expect(writeCount()).toBe(0);
  });
});

describe('TaskService lease fail-closed', () => {
  const WRITE_ERROR = '任务数据写入失败，请检查磁盘空间和数据目录权限';
  const RENEW_WRITE_ERROR = '任务锁续租写入失败';
  const RELEASE_WRITE_ERROR = '任务锁释放写入失败';

  function acquireTask(): Task {
    const t = base('t1', 'queued');
    t.assignedAccountId = 'acc-1';
    return t;
  }
  function lockedTask(): Task {
    const t = base('t1', 'executing');
    t.assignedAccountId = 'acc-1';
    t.lock = { ownerId: 'owner-1', acquiredAt: new Date(NOW_MS).toISOString(), expiresAt: new Date(NOW_MS + 60_000).toISOString() };
    return t;
  }

  type LeaseCall = (s: TaskService) => { success: boolean; error?: string };

  it.each<[string, () => Task, LeaseCall, string]>([
    ['acquireLock', acquireTask, (s) => s.acquireLock({ taskId: 't1', ownerId: 'owner-1' }), WRITE_ERROR],
    ['renewLock', lockedTask, (s) => s.renewLock({ taskId: 't1', ownerId: 'owner-1' }), RENEW_WRITE_ERROR],
    ['releaseLock', lockedTask, (s) => s.releaseLock({ taskId: 't1', ownerId: 'owner-1' }), RELEASE_WRITE_ERROR],
  ])('%s 在 Repository replace=false 时 fail-closed', (_op, makeTask, call, expectedError) => {
    const service = new TaskService({
      store: { read: () => [structuredClone(makeTask())], replace: () => false },
      defaultProjectId: () => 'default', nowMs: () => NOW_MS,
    });
    expect(call(service)).toEqual({ success: false, error: expectedError });
  });

  it.each<[string, () => Task, LeaseCall, string]>([
    ['acquireLock', acquireTask, (s) => s.acquireLock({ taskId: 't1', ownerId: 'owner-1' }), WRITE_ERROR],
    ['renewLock', lockedTask, (s) => s.renewLock({ taskId: 't1', ownerId: 'owner-1' }), RENEW_WRITE_ERROR],
    ['releaseLock', lockedTask, (s) => s.releaseLock({ taskId: 't1', ownerId: 'owner-1' }), RELEASE_WRITE_ERROR],
  ])('%s 在 Repository 抛出陈旧快照异常时 fail-closed', (_op, makeTask, call, expectedError) => {
    const service = new TaskService({
      store: { read: () => [structuredClone(makeTask())], replace: () => { throw new Error('TASK_REPOSITORY_STALE_SNAPSHOT'); } },
      defaultProjectId: () => 'default', nowMs: () => NOW_MS,
    });
    expect(call(service)).toEqual({ success: false, error: expectedError });
  });
});

// ==================== recoverInterruptedTasks ====================

const RECOVERY_NOW = '2026-08-13T12:00:00.000Z';
const RECOVERY_WRITE_ERROR = '任务数据写入失败，请检查磁盘空间和数据目录权限';
const RECOVERY_STARTED_AT = '2026-08-12T00:00:00.000Z';

function recoveryFixture(initial: Task[] = []) {
  let stored = structuredClone(initial);
  let writeCount = 0;
  const store = {
    read: () => structuredClone(stored),
    replace: (tasks: Task[]) => { writeCount++; stored = structuredClone(tasks); return true; },
  };
  const service = new TaskService({
    store, defaultProjectId: () => 'default', now: () => RECOVERY_NOW,
  });
  return { service, stored: () => stored, writeCount: () => writeCount };
}

function activeTask(id: string, status: Task['status']): Task {
  const task = withRuntime(base(id, status), 'generating');
  task.runtime!.startedAt = RECOVERY_STARTED_AT;
  task.lock = { ownerId: 'old-owner', acquiredAt: 'old', expiresAt: 'old' };
  task.runHistory = [{ runId: 'r', attempt: 1, startedAt: RECOVERY_STARTED_AT }];
  return task;
}

describe('TaskService recoverInterruptedTasks', () => {
  it.each(['executing', 'generating', 'waiting_verification'] as const)(
    '活动状态 %s 恢复为 paused 且 result/errorInfo/runtime/updatedAt/lock 正确',
    (status) => {
      const item = activeTask('t1', status);
      const { service, stored } = recoveryFixture([item]);
      const result = service.recoverInterruptedTasks();
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.recoveredTasks).toBe(1);
        expect(result.data.clearedLocks).toBe(1);
      }
      const task = stored()[0];
      expect(task.status).toBe('paused');
      expect(task.result).toBe('程序上次退出时任务仍在运行，可重新执行');
      expect(task.errorInfo).toEqual({
        code: 'cancelled',
        message: '程序上次退出时任务仍在运行，可重新执行',
        recoverable: true,
        detectedAt: RECOVERY_NOW,
      });
      expect(task.runtime?.stage).toBe('paused');
      expect(task.runtime?.message).toBe('程序重启，任务已安全暂停');
      expect(task.runtime?.stageStartedAt).toBe(RECOVERY_NOW);
      expect(task.runtime?.lastHeartbeatAt).toBe(RECOVERY_NOW);
      expect(task.updatedAt).toBe(RECOVERY_NOW);
      expect(task.lock).toBeUndefined();
      expect(task.runtime?.runId).toBe('r');
      expect(task.runtime?.attempt).toBe(1);
      expect(task.runtime?.input).toEqual({ prompt: 't1', mode: 'video', attachments: [] });
    },
  );

  it('非活动任务只清除遗留 lock，无 lock 时完全不变', () => {
    const withLock = base('t1', 'done');
    withLock.lock = { ownerId: 'old', acquiredAt: 'old', expiresAt: 'old' };
    const withoutLock = base('t2', 'queued');
    const { service, stored, writeCount } = recoveryFixture([withLock, withoutLock]);
    const result = service.recoverInterruptedTasks();
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.recoveredTasks).toBe(0);
      expect(result.data.clearedLocks).toBe(1);
    }
    expect(stored()[0].lock).toBeUndefined();
    expect(stored()[0].status).toBe('done');
    expect(stored()[0].updatedAt).toBe('old');
    expect(stored()[1]).toEqual(base('t2', 'queued'));
    expect(writeCount()).toBe(1);
  });

  it('当前未结束 runHistory 正确收口', () => {
    const { service, stored } = recoveryFixture([activeTask('t1', 'executing')]);
    service.recoverInterruptedTasks();
    const record = stored()[0].runHistory![0];
    expect(record.finishedAt).toBe(RECOVERY_NOW);
    expect(record.finalStage).toBe('paused');
    expect(record.outcome).toBe('paused');
    expect(record.errorCode).toBe('cancelled');
    expect(record.durationMs).toBe(new Date(RECOVERY_NOW).getTime() - new Date(RECOVERY_STARTED_AT).getTime());
  });

  it('已 finished 的 runHistory 不改写', () => {
    const item = activeTask('t1', 'executing');
    item.runHistory = [{
      runId: 'r', attempt: 1, startedAt: RECOVERY_STARTED_AT,
      finishedAt: '2026-08-12T06:00:00.000Z', finalStage: 'completed',
      outcome: 'done', durationMs: 21600000,
    }];
    const { service, stored } = recoveryFixture([item]);
    service.recoverInterruptedTasks();
    expect(stored()[0].runHistory![0]).toEqual({
      runId: 'r', attempt: 1, startedAt: RECOVERY_STARTED_AT,
      finishedAt: '2026-08-12T06:00:00.000Z', finalStage: 'completed',
      outcome: 'done', durationMs: 21600000,
    });
  });

  it('非当前 runId 的历史记录不改写', () => {
    const item = activeTask('t1', 'executing');
    item.runHistory = [
      { runId: 'old-run', attempt: 0, startedAt: '2026-08-10T00:00:00.000Z' },
      { runId: 'r', attempt: 1, startedAt: RECOVERY_STARTED_AT },
    ];
    const { service, stored } = recoveryFixture([item]);
    service.recoverInterruptedTasks();
    const records = stored()[0].runHistory!;
    expect(records).toHaveLength(2);
    expect(records[0].finishedAt).toBeUndefined();
    expect(records[0].outcome).toBeUndefined();
    expect(records[1].finishedAt).toBe(RECOVERY_NOW);
    expect(records[1].outcome).toBe('paused');
  });

  it('没有 runtime 时不创建历史记录', () => {
    const item = base('t1', 'executing');
    item.runHistory = [];
    const { service, stored } = recoveryFixture([item]);
    service.recoverInterruptedTasks();
    expect(stored()[0].runHistory).toEqual([]);
  });

  it('未来 startedAt 的 durationMs 收敛为 0', () => {
    const item = activeTask('t1', 'executing');
    item.runHistory = [{ runId: 'r', attempt: 1, startedAt: '2027-01-01T00:00:00.000Z' }];
    const { service, stored } = recoveryFixture([item]);
    service.recoverInterruptedTasks();
    expect(stored()[0].runHistory![0].durationMs).toBe(0);
  });

  it('无变化时零写入', () => {
    const { service, writeCount } = recoveryFixture([base('t1', 'queued'), base('t2', 'done'), base('t3', 'paused')]);
    const result = service.recoverInterruptedTasks();
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.recoveredTasks).toBe(0);
      expect(result.data.clearedLocks).toBe(0);
    }
    expect(writeCount()).toBe(0);
  });

  it('多任务恢复只执行一次 replace 且同一批次时间严格一致', () => {
    const { service, stored, writeCount } = recoveryFixture([
      activeTask('t1', 'executing'), activeTask('t2', 'generating'), activeTask('t3', 'waiting_verification'),
    ]);
    const result = service.recoverInterruptedTasks();
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.recoveredTasks).toBe(3);
      expect(result.data.clearedLocks).toBe(3);
    }
    expect(writeCount()).toBe(1);
    const tasks = stored();
    const allTimes = tasks.flatMap((t) => [
      t.errorInfo!.detectedAt,
      t.runtime!.stageStartedAt,
      t.runtime!.lastHeartbeatAt,
      t.updatedAt,
      t.runHistory![0].finishedAt!,
    ]);
    expect(new Set(allTimes).size).toBe(1);
    expect(allTimes[0]).toBe(RECOVERY_NOW);
  });

  it.each([
    ['read 失败', () => { throw new Error('read failed'); }, () => true],
    ['replace=false', () => [structuredClone(activeTask('t1', 'executing'))], () => false],
    ['陈旧快照异常', () => [structuredClone(activeTask('t1', 'executing'))], () => { throw new Error('TASK_REPOSITORY_STALE_SNAPSHOT'); }],
  ])('recoverInterruptedTasks 在 Repository %s 时 fail-closed', (_label, readFn, replaceFn) => {
    const service = new TaskService({
      store: { read: readFn as () => Task[], replace: replaceFn as () => boolean },
      defaultProjectId: () => 'default', now: () => RECOVERY_NOW,
    });
    expect(service.recoverInterruptedTasks()).toEqual({ success: false, error: RECOVERY_WRITE_ERROR });
  });
});

// ==================== read fail-closed (create/updateStatus/delete/retry) ====================

describe('TaskService read fail-closed (前序方法)', () => {
  const WRITE_ERROR = '任务数据写入失败，请检查磁盘空间和数据目录权限';

  it.each<[string, (s: TaskService) => { success: boolean; error?: string }]>([
    ['create', (s) => s.create({ prompts: ['A'] })],
    ['updateStatus', (s) => s.updateStatus({ taskId: 't1', status: 'done' })],
    ['delete', (s) => s.delete('t1')],
    ['retry', (s) => s.retry('t1')],
  ])('%s read 抛错返回 WRITE_ERROR 且 replace 调用次数为 0', (_op, call) => {
    let replaceCount = 0;
    const service = new TaskService({
      store: {
        read: () => { throw new Error('read failed'); },
        replace: () => { replaceCount++; return true; },
      },
      defaultProjectId: () => 'default', id: () => 'id', now: () => 'now',
    });
    expect(call(service)).toEqual({ success: false, error: WRITE_ERROR });
    expect(replaceCount).toBe(0);
  });

  it('create read 失败时 id 与 now 调用次数均为 0', () => {
    const idFn = vi.fn(() => 'id');
    const nowFn = vi.fn(() => 'now');
    const service = new TaskService({
      store: { read: () => { throw new Error('read failed'); }, replace: () => true },
      defaultProjectId: () => 'default', id: idFn, now: nowFn,
    });
    expect(service.create({ prompts: ['A'] })).toEqual({ success: false, error: WRITE_ERROR });
    expect(idFn).not.toHaveBeenCalled();
    expect(nowFn).not.toHaveBeenCalled();
  });
});

// ==================== IPC 接线源码契约检查 ====================

// registerTaskIPC 依赖 Electron 的 ipcMain、dialog、session 等运行时 API，
// 无法在不新增 IPC 测试基础设施的情况下做稳定行为测试。
// 因此使用最小源码契约检查验证接线正确性，符合任务规格第 24-25 项的允许方案。

describe('IPC 接线源码契约检查', () => {
  const source = readFileSync(resolve(__dirname, '../../main/ipc/tasks.ts'), 'utf-8');

  it('tasks.ts 不再定义本地恢复业务函数', () => {
    expect(source).not.toMatch(/function\s+recoverInterruptedTasks\s*\(/);
    expect(source).toMatch(/taskService\.recoverInterruptedTasks\(\)/);
  });

  it('registerTaskIPC 恢复失败时调用 disposer 并抛稳定错误，不继续后续初始化', () => {
    const recoveryIdx = source.indexOf('taskService.recoverInterruptedTasks()');
    const disposeCallIdx = source.indexOf('dispose()', recoveryIdx);
    const throwIdx = source.indexOf("throw new Error('任务恢复失败，请检查数据目录和磁盘状态')");
    const loadDownloadIdx = source.indexOf('loadDownloadJobs()', recoveryIdx);
    const schemaIdx = source.indexOf("writeJSON('schema.json'", recoveryIdx);

    expect(recoveryIdx).toBeGreaterThan(-1);
    expect(disposeCallIdx).toBeGreaterThan(recoveryIdx);
    expect(throwIdx).toBeGreaterThan(disposeCallIdx);
    expect(loadDownloadIdx).toBeGreaterThan(throwIdx);
    expect(schemaIdx).toBeGreaterThan(throwIdx);
  });

  it('tasks:importCsv 不再包含旧 CSV 业务实现，只保留薄适配', () => {
    expect(source).not.toMatch(/import\s*\{[^}]*parseCsv/);
    expect(source).not.toMatch(/import\s*\{[^}]*normalizeCsvMode/);
    // 使用第二次出现，跳过 TASK_IPC_CHANNELS 数组中的第一次
    const firstCsv = source.indexOf("'tasks:importCsv'");
    const handlerStart = source.indexOf("'tasks:importCsv'", firstCsv + 1);
    const firstLock = source.indexOf("'tasks:releaseLock'");
    const handlerEnd = source.indexOf("'tasks:releaseLock'", firstLock + 1);
    const handlerBody = source.slice(handlerStart, handlerEnd);
    expect(handlerBody).not.toMatch(/\bparseCsv\b/);
    expect(handlerBody).not.toMatch(/\bnormalizeCsvMode\b/);
    expect(handlerBody).not.toMatch(/\bheaders\b/);
    expect(handlerBody).not.toMatch(/\bpromptIndex\b/);
    expect(handlerBody).not.toMatch(/\bloadTasks\b/);
    expect(handlerBody).not.toMatch(/\bsaveTasks\b/);
    expect(handlerBody).toMatch(/taskService\.importCsv\(/);
  });

  it('tasks:importCsv 文件读取异常使用固定脱敏错误', () => {
    expect(source).toMatch(/'CSV 导入失败，请检查文件格式和数据目录状态'/);
    const firstCsv = source.indexOf("'tasks:importCsv'");
    const handlerStart = source.indexOf("'tasks:importCsv'", firstCsv + 1);
    const firstLock = source.indexOf("'tasks:releaseLock'");
    const handlerEnd = source.indexOf("'tasks:releaseLock'", firstLock + 1);
    const handlerBody = source.slice(handlerStart, handlerEnd);
    expect(handlerBody).toMatch(/catch\s*\{/);
    expect(handlerBody).not.toMatch(/err\.message/);
  });
});

// ==================== importCsv ====================

const CSV_NOW = '2026-08-13T12:00:00.000Z';
const CSV_WRITE_ERROR = '任务数据写入失败，请检查磁盘空间和数据目录权限';

function csvFixture(initial: Task[] = []) {
  let stored = structuredClone(initial);
  let readCount = 0;
  let writeCount = 0;
  let idCount = 0;
  let nowCount = 0;
  const store = {
    read: (): Task[] => { readCount++; return structuredClone(stored); },
    replace: (tasks: Task[]): boolean => { writeCount++; stored = structuredClone(tasks); return true; },
  };
  let id = 0;
  const service = new TaskService({
    store, defaultProjectId: () => 'default',
    id: (): string => { idCount++; return `uuid-${++id}`; },
    now: (): string => { nowCount++; return CSV_NOW; },
  });
  return { service, stored: () => stored, readCount: () => readCount, writeCount: () => writeCount, idCount: () => idCount, nowCount: () => nowCount };
}

function csv(text: string, accounts: { id: string; name: string }[] = [], projectId?: string) {
  return { text, accounts, projectId };
}

describe('TaskService importCsv', () => {
  it('BOM 被移除后正常解析', () => {
    const { service } = csvFixture();
    const result = service.importCsv(csv('\uFEFFprompt\nHello'));
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.tasks[0].prompt).toBe('Hello');
  });

  it('数据行不足时明确失败', () => {
    const { service, readCount, idCount, nowCount, writeCount } = csvFixture();
    expect(service.importCsv(csv('prompt'))).toEqual({ success: false, error: 'CSV 没有可导入的数据行' });
    expect(service.importCsv(csv(''))).toEqual({ success: false, error: 'CSV 没有可导入的数据行' });
    expect(readCount()).toBe(0);
    expect(idCount()).toBe(0);
    expect(nowCount()).toBe(0);
    expect(writeCount()).toBe(0);
  });

  it('缺 prompt 表头时明确失败', () => {
    const { service, readCount, idCount, nowCount, writeCount } = csvFixture();
    expect(service.importCsv(csv('mode\nvideo'))).toEqual({ success: false, error: 'CSV 必须包含 prompt 或 提示词 列' });
    expect(readCount()).toBe(0);
    expect(idCount()).toBe(0);
    expect(nowCount()).toBe(0);
    expect(writeCount()).toBe(0);
  });

  it('未闭合引号返回明确 CSV 错误', () => {
    const { service, readCount, idCount, nowCount, writeCount } = csvFixture();
    const result = service.importCsv(csv('prompt\n"broken'));
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBe('CSV 格式错误：存在未闭合的引号');
    expect(readCount()).toBe(0);
    expect(idCount()).toBe(0);
    expect(nowCount()).toBe(0);
    expect(writeCount()).toBe(0);
  });

  it.each([
    ['prompt', 'prompt'],
    ['提示词', '提示词'],
    ['Prompt', 'prompt'],
    [' 提示词 ', '提示词'],
  ])('表头别名「%s」被正确识别', (header) => {
    const { service } = csvFixture();
    const result = service.importCsv(csv(`${header}\nHello`));
    expect(result.success).toBe(true);
  });

  it.each([
    ['chat', 'chat'],
    ['image', 'image'],
    ['图片', 'image'],
    ['video', 'video'],
    ['视频', 'video'],
    ['music', 'music'],
    ['音乐', 'music'],
    ['', 'chat'],
    ['unknown', 'chat'],
  ])('模式「%s」规范化为 %s', (input, expected) => {
    const { service } = csvFixture();
    const result = service.importCsv(csv(`prompt,mode\nHello,${input}`));
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.tasks[0].mode).toBe(expected);
  });

  it('合法视频参数保留', () => {
    const { service } = csvFixture();
    const result = service.importCsv(csv('prompt,mode,model,duration,aspectratio\nHello,video,seedance-2.5,5s,9:16'));
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.tasks[0].videoConfig).toEqual({ model: 'seedance-2.5', duration: '5s', aspectRatio: '9:16' });
  });

  it.each([
    ['seedance-1.0', 'seedance-2.0'],
    ['invalid', 'seedance-2.0'],
  ])('非法模型「%s」回退为 %s', (input, expected) => {
    const { service } = csvFixture();
    const result = service.importCsv(csv(`prompt,mode,model\nHello,video,${input}`));
    if (result.success) expect(result.data.tasks[0].videoConfig!.model).toBe(expected);
  });

  it.each([
    ['3s', '10s'],
    ['16s', '10s'],
    ['abc', '10s'],
  ])('非法时长「%s」回退为 %s', (input, expected) => {
    const { service } = csvFixture();
    const result = service.importCsv(csv(`prompt,mode,duration\nHello,video,${input}`));
    if (result.success) expect(result.data.tasks[0].videoConfig!.duration).toBe(expected);
  });

  it.each([
    ['2:1', '16:9'],
    ['invalid', '16:9'],
  ])('非法比例「%s」回退为 %s', (input, expected) => {
    const { service } = csvFixture();
    const result = service.importCsv(csv(`prompt,mode,aspectratio\nHello,video,${input}`));
    if (result.success) expect(result.data.tasks[0].videoConfig!.aspectRatio).toBe(expected);
  });

  it('非视频任务无 videoConfig', () => {
    const { service } = csvFixture();
    const result = service.importCsv(csv('prompt,mode,model\nHello,chat,seedance-2.5'));
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.tasks[0].videoConfig).toBeUndefined();
  });

  it('attachments 分隔、trim 和过滤', () => {
    const { service } = csvFixture();
    const result = service.importCsv(csv('prompt,attachments\nHello, a.jpg | b.jpg | | c.jpg '));
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.tasks[0].attachments).toEqual(['a.jpg', 'b.jpg', 'c.jpg']);
  });

  it('audioAttachment 空值规范化为 undefined', () => {
    const { service } = csvFixture();
    const result = service.importCsv(csv('prompt,audio\nHello,  '));
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.tasks[0].audioAttachment).toBeUndefined();
  });

  it('账号精确匹配', () => {
    const { service } = csvFixture();
    const result = service.importCsv(csv('prompt,account\nHello,测试账号', [{ id: 'acc-1', name: '测试账号' }]));
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.tasks[0].assignedAccountId).toBe('acc-1');
  });

  it('未知账号保持未指派并记录错误', () => {
    const { service } = csvFixture();
    const result = service.importCsv(csv('prompt,account\nHello,未知', [{ id: 'acc-1', name: '测试账号' }]));
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.tasks[0].assignedAccountId).toBeNull();
      expect(result.data.errors).toContain('第 2 行：未找到账号「未知」，任务保持未指派');
    }
  });

  it('空 prompt 行跳过', () => {
    const { service } = csvFixture();
    // Row 3 has empty prompt but non-empty second field, so parseCsv keeps it
    const result = service.importCsv(csv('prompt,depends_on\nHello\n,x\nWorld'));
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.tasks).toHaveLength(2);
      expect(result.data.imported).toBe(2);
      expect(result.data.skipped).toBe(1);
      expect(result.data.errors).toContain('第 3 行：提示词为空');
    }
  });

  it('errors 最多 20 条', () => {
    const { service } = csvFixture();
    // 25 valid rows + 25 empty-prompt rows (with non-empty second field so parseCsv keeps them)
    const rows = 'prompt,depends_on\n' + Array.from({ length: 25 }, (_, i) => `row${i}`).join('\n') + '\n' + Array.from({ length: 25 }, () => ',x').join('\n');
    const result = service.importCsv(csv(rows));
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.errors.length).toBeLessThanOrEqual(20);
  });

  it.each([
    ['all_finished', 'all_finished'],
    ['all_done', 'all_done'],
    ['other', 'all_done'],
    ['', 'all_done'],
  ])('dependencyPolicy「%s」映射为 %s', (input, expected) => {
    const { service } = csvFixture();
    const result = service.importCsv(csv(`prompt,dependency_policy\nHello,${input}`));
    if (result.success) expect(result.data.tasks[0].dependencyPolicy).toBe(expected);
  });

  it('依赖行正确映射', () => {
    const { service } = csvFixture();
    const result = service.importCsv(csv('prompt,depends_on\nA\nB,2'));
    expect(result.success).toBe(true);
    if (result.success) {
      const taskA = result.data.tasks[0];
      const taskB = result.data.tasks[1];
      expect(taskB.dependsOnTaskIds).toEqual([taskA.id]);
    }
  });

  it('被跳过的行不能成为依赖', () => {
    const { service } = csvFixture();
    // Row 2 has empty prompt (skipped), Row 3 depends on row 2 (which was skipped)
    const result = service.importCsv(csv('prompt,depends_on\n,3\nA,2'));
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.tasks).toHaveLength(1);
      expect(result.data.tasks[0].dependsOnTaskIds).toEqual([]);
    }
  });

  it('无效、越界和非数字依赖被过滤', () => {
    const { service } = csvFixture();
    const result = service.importCsv(csv('prompt,depends_on\nA\nB,abc|2|99|1'));
    expect(result.success).toBe(true);
    if (result.success) {
      const taskA = result.data.tasks[0];
      const taskB = result.data.tasks[1];
      expect(taskB.dependsOnTaskIds).toEqual([taskA.id]);
    }
  });

  it('projectId 显式值和默认值', () => {
    const { service: s1 } = csvFixture();
    const r1 = s1.importCsv(csv('prompt\nHello', [], 'custom-project'));
    if (r1.success) expect(r1.data.tasks[0].projectId).toBe('custom-project');
    const { service: s2 } = csvFixture();
    const r2 = s2.importCsv(csv('prompt\nHello'));
    if (r2.success) expect(r2.data.tasks[0].projectId).toBe('default');
  });

  it('单批次所有任务时间一致', () => {
    const { service } = csvFixture();
    const result = service.importCsv(csv('prompt\nA\nB\nC'));
    expect(result.success).toBe(true);
    if (result.success) {
      for (const task of result.data.tasks) {
        expect(task.createdAt).toBe(CSV_NOW);
        expect(task.updatedAt).toBe(CSV_NOW);
      }
    }
  });

  it('任务 ID 与 batchId 唯一且格式正确', () => {
    const { service } = csvFixture();
    const result = service.importCsv(csv('prompt\nA\nB\nC'));
    expect(result.success).toBe(true);
    if (result.success) {
      const ids = result.data.tasks.map((t) => t.id);
      expect(new Set(ids).size).toBe(3);
      for (const id of ids) expect(id).toMatch(/^uuid-/);
      expect(result.data.batchId).toMatch(/^batch-20260813120000-uuid-/);
      expect(result.data.tasks.every((t) => t.batchId === result.data.batchId)).toBe(true);
    }
  });

  it('多任务只调用一次 Repository replace', () => {
    const { service, writeCount } = csvFixture();
    service.importCsv(csv('prompt\nA\nB\nC'));
    expect(writeCount()).toBe(1);
  });
});

describe('TaskService importCsv fail-closed', () => {
  it.each([
    ['数据行不足', 'prompt', 'CSV 没有可导入的数据行'],
    ['缺 prompt 列', 'mode\nvideo', 'CSV 必须包含 prompt 或 提示词 列'],
    ['未闭合引号', 'prompt\n"broken', 'CSV 格式错误：存在未闭合的引号'],
  ])('纯结构校验失败「%s」时零 read/id/now/replace', (_label, text) => {
    const { service, readCount, idCount, nowCount, writeCount } = csvFixture();
    service.importCsv(csv(text));
    expect(readCount()).toBe(0);
    expect(idCount()).toBe(0);
    expect(nowCount()).toBe(0);
    expect(writeCount()).toBe(0);
  });

  it('Repository read 失败时零 id/now/replace', () => {
    let idCount = 0;
    let nowCount = 0;
    let writeCount = 0;
    const service = new TaskService({
      store: {
        read: (): Task[] => { throw new Error('read failed'); },
        replace: (): boolean => { writeCount++; return true; },
      },
      defaultProjectId: () => 'default',
      id: (): string => { idCount++; return 'id'; },
      now: (): string => { nowCount++; return CSV_NOW; },
    });
    expect(service.importCsv(csv('prompt\nHello'))).toEqual({ success: false, error: CSV_WRITE_ERROR });
    expect(idCount).toBe(0);
    expect(nowCount).toBe(0);
    expect(writeCount).toBe(0);
  });

  it('Repository replace=false 时 fail-closed', () => {
    const service = new TaskService({
      store: { read: (): Task[] => [], replace: (): boolean => false },
      defaultProjectId: () => 'default', id: () => 'id', now: () => CSV_NOW,
    });
    expect(service.importCsv(csv('prompt\nHello'))).toEqual({ success: false, error: CSV_WRITE_ERROR });
  });

  it('Repository 陈旧快照异常时 fail-closed', () => {
    const service = new TaskService({
      store: { read: (): Task[] => [], replace: (): boolean => { throw new Error('TASK_REPOSITORY_STALE_SNAPSHOT'); } },
      defaultProjectId: () => 'default', id: () => 'id', now: () => CSV_NOW,
    });
    expect(service.importCsv(csv('prompt\nHello'))).toEqual({ success: false, error: CSV_WRITE_ERROR });
  });

  it('零有效任务成功且零 Repository/ID/时钟调用', () => {
    const { service, readCount, idCount, nowCount, writeCount } = csvFixture();
    // Row 2 has empty prompt but non-empty second field, so parseCsv keeps it
    const result = service.importCsv(csv('prompt,depends_on\n,x'));
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.imported).toBe(0);
      expect(result.data.tasks).toEqual([]);
      expect(result.data.batchId).toBe('');
    }
    expect(readCount()).toBe(0);
    expect(idCount()).toBe(0);
    expect(nowCount()).toBe(0);
    expect(writeCount()).toBe(0);
  });
});

// ==================== validateArtifact ====================

const VA_NOW = '2026-08-13T23:00:00.000Z';
const VA_WRITE_ERROR = '任务数据写入失败，请检查磁盘空间和数据目录权限';

function vaTask(artifactId = 'a1'): Task {
  const task = base('t1', 'done');
  task.assignedAccountId = 'acc-1';
  task.artifacts = [{
    id: artifactId,
    url: 'https://example.com/output.mp4',
    kind: 'video',
    source: 'network',
    discoveredAt: 'old',
  }];
  return task;
}

function vaFixture(initial: Task[] = [vaTask()], probe: ArtifactProbe = async () => ({ kind: 'response', statusCode: 200 })) {
  let stored = structuredClone(initial);
  let readCount = 0;
  let writeCount = 0;
  let nowCount = 0;
  const store = {
    read: (): Task[] => { readCount++; return structuredClone(stored); },
    replace: (tasks: Task[]): boolean => { writeCount++; stored = structuredClone(tasks); return true; },
  };
  const service = new TaskService({
    store, defaultProjectId: () => 'default',
    id: () => 'id', now: () => { nowCount++; return VA_NOW; },
    probeArtifact: probe,
  });
  return { service, stored: () => stored, readCount: () => readCount, writeCount: () => writeCount, nowCount: () => nowCount };
}

describe('TaskService validateArtifact', () => {
  it.each([200, 201, 206, 299])('HTTP %s 判定为 valid', async (statusCode) => {
    const { service, stored } = vaFixture([vaTask()], async () => ({ kind: 'response', statusCode }));
    const result = await service.validateArtifact({ taskId: 't1', artifactId: 'a1' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.valid).toBe(true);
    expect(stored()[0].artifacts![0].validation?.state).toBe('valid');
  });

  it.each([401, 403, 404, 410])('HTTP %s 判定为 expired', async (statusCode) => {
    const { service, stored } = vaFixture([vaTask()], async () => ({ kind: 'response', statusCode }));
    const result = await service.validateArtifact({ taskId: 't1', artifactId: 'a1' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.valid).toBe(false);
    expect(stored()[0].artifacts![0].validation?.state).toBe('expired');
  });

  it.each([400, 418, 500, 503, 301, 0])('HTTP %s 判定为 invalid', async (statusCode) => {
    const { service, stored } = vaFixture([vaTask()], async () => ({ kind: 'response', statusCode }));
    const result = await service.validateArtifact({ taskId: 't1', artifactId: 'a1' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.valid).toBe(false);
    expect(stored()[0].artifacts![0].validation?.state).toBe('invalid');
  });

  it('响应元数据 contentType/contentLength/statusCode 落盘', async () => {
    const { service, stored } = vaFixture([vaTask()], async () => ({ kind: 'response', statusCode: 200, contentType: 'video/mp4', contentLength: 12345 }));
    await service.validateArtifact({ taskId: 't1', artifactId: 'a1' });
    expect(stored()[0].artifacts![0].validation).toMatchObject({ state: 'valid', contentType: 'video/mp4', contentLength: 12345, statusCode: 200 });
  });

  it('timeout 判定为 unknown 并记录验证超时', async () => {
    const { service, stored } = vaFixture([vaTask()], async () => ({ kind: 'timeout' }));
    const result = await service.validateArtifact({ taskId: 't1', artifactId: 'a1' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.valid).toBe(false);
    expect(stored()[0].artifacts![0].validation).toMatchObject({ state: 'unknown', error: '验证超时' });
  });

  it('网络错误判定为 invalid 并记录消息', async () => {
    const { service, stored } = vaFixture([vaTask()], async () => ({ kind: 'error', message: 'net::ERR_FAILED' }));
    const result = await service.validateArtifact({ taskId: 't1', artifactId: 'a1' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.valid).toBe(false);
    expect(stored()[0].artifacts![0].validation).toMatchObject({ state: 'invalid', error: 'net::ERR_FAILED' });
  });

  it('任务不存在返回产物不存在且零探针/零写入', async () => {
    const probe = vi.fn<ArtifactProbe>(async () => ({ kind: 'response', statusCode: 200 }));
    const { service, writeCount } = vaFixture([vaTask()], probe);
    expect(await service.validateArtifact({ taskId: 'nope', artifactId: 'a1' })).toEqual({ success: false, error: '产物不存在' });
    expect(probe).not.toHaveBeenCalled();
    expect(writeCount()).toBe(0);
  });

  it('产物不存在返回产物不存在且零探针/零写入', async () => {
    const probe = vi.fn<ArtifactProbe>(async () => ({ kind: 'response', statusCode: 200 }));
    const { service, writeCount } = vaFixture([vaTask()], probe);
    expect(await service.validateArtifact({ taskId: 't1', artifactId: 'nope' })).toEqual({ success: false, error: '产物不存在' });
    expect(probe).not.toHaveBeenCalled();
    expect(writeCount()).toBe(0);
  });

  it('validation.checkedAt 与 task.updatedAt 共用单一时钟', async () => {
    const { service, stored, nowCount } = vaFixture();
    await service.validateArtifact({ taskId: 't1', artifactId: 'a1' });
    expect(nowCount()).toBe(1);
    expect(stored()[0].artifacts![0].validation?.checkedAt).toBe(VA_NOW);
    expect(stored()[0].updatedAt).toBe(VA_NOW);
  });

  it('探针收到产物与账号指派参数', async () => {
    const probe = vi.fn<ArtifactProbe>(async () => ({ kind: 'response', statusCode: 200 }));
    const { service } = vaFixture([vaTask()], probe);
    await service.validateArtifact({ taskId: 't1', artifactId: 'a1' });
    expect(probe).toHaveBeenCalledTimes(1);
    expect(probe.mock.calls[0][0]).toMatchObject({ id: 'a1', url: 'https://example.com/output.mp4' });
    expect(probe.mock.calls[0][1]).toBe('acc-1');
  });

  it('成功路径只调用一次 Repository replace', async () => {
    const { service, writeCount } = vaFixture();
    await service.validateArtifact({ taskId: 't1', artifactId: 'a1' });
    expect(writeCount()).toBe(1);
  });
});

describe('TaskService validateArtifact fail-closed', () => {
  it('read 失败返回 WRITE_ERROR 且零探针/零时钟/零写', async () => {
    const probe = vi.fn<ArtifactProbe>(async () => ({ kind: 'response', statusCode: 200 }));
    const nowFn = vi.fn(() => VA_NOW);
    let writeCount = 0;
    const service = new TaskService({
      store: { read: () => { throw new Error('read failed'); }, replace: () => { writeCount++; return true; } },
      defaultProjectId: () => 'default', id: () => 'id', now: nowFn, probeArtifact: probe,
    });
    expect(await service.validateArtifact({ taskId: 't1', artifactId: 'a1' })).toEqual({ success: false, error: VA_WRITE_ERROR });
    expect(probe).not.toHaveBeenCalled();
    expect(nowFn).not.toHaveBeenCalled();
    expect(writeCount).toBe(0);
  });

  it('replace=false 时 fail-closed 返回 WRITE_ERROR', async () => {
    const service = new TaskService({
      store: { read: () => structuredClone([vaTask()]), replace: () => false },
      defaultProjectId: () => 'default', id: () => 'id', now: () => VA_NOW,
      probeArtifact: async () => ({ kind: 'response', statusCode: 200 }),
    });
    expect(await service.validateArtifact({ taskId: 't1', artifactId: 'a1' })).toEqual({ success: false, error: VA_WRITE_ERROR });
  });

  it('Repository 陈旧快照异常时 fail-closed 返回 WRITE_ERROR', async () => {
    const service = new TaskService({
      store: { read: () => structuredClone([vaTask()]), replace: () => { throw new Error('TASK_REPOSITORY_STALE_SNAPSHOT'); } },
      defaultProjectId: () => 'default', id: () => 'id', now: () => VA_NOW,
      probeArtifact: async () => ({ kind: 'response', statusCode: 200 }),
    });
    expect(await service.validateArtifact({ taskId: 't1', artifactId: 'a1' })).toEqual({ success: false, error: VA_WRITE_ERROR });
  });

  it('未注入探针时返回产物验证不可用且零写入', async () => {
    const service = new TaskService({
      store: { read: () => structuredClone([vaTask()]), replace: () => true },
      defaultProjectId: () => 'default', id: () => 'id', now: () => VA_NOW,
    });
    expect(await service.validateArtifact({ taskId: 't1', artifactId: 'a1' })).toEqual({ success: false, error: '产物验证不可用' });
  });
});

describe('IPC 接线源码契约检查：validateArtifact', () => {
  const source = readFileSync(resolve(__dirname, '../../main/ipc/tasks.ts'), 'utf-8');

  it('tasks:validateArtifact 不再包含四态业务实现，只保留薄适配', () => {
    const firstVa = source.indexOf("'tasks:validateArtifact'");
    const handlerStart = source.indexOf("'tasks:validateArtifact'", firstVa + 1);
    const firstSar = source.indexOf("'tasks:saveAdapterReport'");
    const handlerEnd = source.indexOf("'tasks:saveAdapterReport'", firstSar + 1);
    const handlerBody = source.slice(handlerStart, handlerEnd);
    expect(handlerBody).toMatch(/taskService\.validateArtifact\(/);
    expect(handlerBody).not.toMatch(/\[401, 403, 404, 410\]/);
    expect(handlerBody).not.toMatch(/statusCode === 206/);
    expect(handlerBody).not.toMatch(/\bloadTasks\b/);
    expect(handlerBody).not.toMatch(/\bsaveTasks\b/);
    expect(handlerBody).not.toMatch(/\bAbortController\b/);
  });

  it('tasks:validateArtifact 使用固定脱敏兜底且 saveTasks 已删除', () => {
    expect(source).toMatch(/'产物验证失败，请检查网络和数据目录状态'/);
    expect(source).not.toMatch(/function\s+saveTasks\s*\(/);
    const firstVa = source.indexOf("'tasks:validateArtifact'");
    const handlerStart = source.indexOf("'tasks:validateArtifact'", firstVa + 1);
    const firstSar = source.indexOf("'tasks:saveAdapterReport'");
    const handlerEnd = source.indexOf("'tasks:saveAdapterReport'", firstSar + 1);
    const handlerBody = source.slice(handlerStart, handlerEnd);
    expect(handlerBody).toMatch(/catch\s*\{/);
    expect(handlerBody).not.toMatch(/err\.message/);
  });
});

// ==================== 只读任务查询 ====================

const Q_WRITE_ERROR = '任务数据写入失败，请检查磁盘空间和数据目录权限';

function qTask(id: string, status: Task['status'], outputs: string[] = []): Task {
  const task = base(id, status);
  task.outputs = outputs;
  return task;
}

function queryFixture(initial: Task[] = [], basename?: (value: string) => string) {
  let stored = structuredClone(initial);
  let writeCount = 0;
  const store = {
    read: (): Task[] => structuredClone(stored),
    replace: (tasks: Task[]): boolean => { writeCount++; stored = structuredClone(tasks); return true; },
  };
  const service = new TaskService({
    store, defaultProjectId: () => 'default', id: () => 'id', now: () => 'now',
    basename,
  });
  return { service, stored: () => stored, writeCount: () => writeCount };
}

describe('TaskService 只读查询 getTasks', () => {
  it('返回全部任务且保持顺序', () => {
    const { service } = queryFixture([qTask('t1', 'queued'), qTask('t2', 'done')]);
    const result = service.getTasks();
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.map((task) => task.id)).toEqual(['t1', 't2']);
  });

  it('read 失败返回 WRITE_ERROR', () => {
    const service = new TaskService({
      store: { read: () => { throw new Error('read failed'); }, replace: () => true },
      defaultProjectId: () => 'default', id: () => 'id', now: () => 'now',
    });
    expect(service.getTasks()).toEqual({ success: false, error: Q_WRITE_ERROR });
  });

  it('零写入', () => {
    const { service, writeCount } = queryFixture([qTask('t1', 'queued')]);
    service.getTasks();
    expect(writeCount()).toBe(0);
  });
});

describe('TaskService 只读查询 getCompletedOutputs', () => {
  it('只返回 done 且有产物的任务', () => {
    const { service } = queryFixture([
      qTask('t1', 'done', ['u1']),
      qTask('t2', 'done'),
      qTask('t3', 'queued', ['u2']),
      qTask('t4', 'fail', ['u3']),
    ]);
    const result = service.getCompletedOutputs();
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.map((item) => item.taskId)).toEqual(['t1']);
  });

  it('投影字段完整且保持顺序', () => {
    const first = qTask('t1', 'done', ['u1', 'u2']);
    first.assignedAccountId = 'acc-9';
    first.mode = 'video';
    first.prompt = '你好';
    const second = qTask('t2', 'done', ['u3']);
    const { service } = queryFixture([first, second]);
    const result = service.getCompletedOutputs();
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data[0]).toEqual({ taskId: 't1', prompt: '你好', outputs: ['u1', 'u2'], accountId: 'acc-9', mode: 'video' });
      expect(result.data.map((item) => item.taskId)).toEqual(['t1', 't2']);
    }
  });

  it('read 失败返回 WRITE_ERROR', () => {
    const service = new TaskService({
      store: { read: () => { throw new Error('read failed'); }, replace: () => true },
      defaultProjectId: () => 'default', id: () => 'id', now: () => 'now',
    });
    expect(service.getCompletedOutputs()).toEqual({ success: false, error: Q_WRITE_ERROR });
  });

  it('零写入', () => {
    const { service, writeCount } = queryFixture([qTask('t1', 'done', ['u1'])]);
    service.getCompletedOutputs();
    expect(writeCount()).toBe(0);
  });
});

describe('TaskService 只读查询 buildTaskDiagnostics', () => {
  function diagTask(): Task {
    const task = qTask('t1', 'done', ['u1', 'u2']);
    task.prompt = 'secret prompt';
    task.assignedAccountId = 'acc-9';
    task.attachments = ['C:\\dir\\a.png', 'D:\\x\\b.jpg'];
    task.audioAttachment = 'C:\\dir\\au.mp3';
    task.artifacts = [{ id: 'art-1', url: 'https://x/v.mp4', kind: 'video', source: 'network', discoveredAt: 'old' }];
    return task;
  }

  it('prompt 脱敏为长度标记且其他字段原样保留', () => {
    const { service } = queryFixture([diagTask()], (value) => `BASE:${value}`);
    const result = service.buildTaskDiagnostics();
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data[0].prompt).toBe('[已脱敏，长度 13]');
      expect(result.data[0]).toMatchObject({ id: 't1', status: 'done', assignedAccountId: 'acc-9' });
    }
  });

  it('attachments 使用注入 basename', () => {
    const { service } = queryFixture([diagTask()], (value) => `BASE:${value}`);
    const result = service.buildTaskDiagnostics();
    if (result.success) {
      expect(result.data[0].attachments).toEqual(['BASE:C:\\dir\\a.png', 'BASE:D:\\x\\b.jpg']);
    }
  });

  it('audioAttachment 使用注入 basename，空值规范为 undefined', () => {
    const withAudio = diagTask();
    const withoutAudio = diagTask();
    withoutAudio.audioAttachment = undefined;
    const { service } = queryFixture([withAudio, withoutAudio], (value) => `BASE:${value}`);
    const result = service.buildTaskDiagnostics();
    if (result.success) {
      expect(result.data[0].audioAttachment).toBe('BASE:C:\\dir\\au.mp3');
      expect(result.data[1].audioAttachment).toBeUndefined();
    }
  });

  it('outputs 掩码为序号标记', () => {
    const { service } = queryFixture([diagTask()], (value) => `BASE:${value}`);
    const result = service.buildTaskDiagnostics();
    if (result.success) expect(result.data[0].outputs).toEqual(['[产物地址 1]', '[产物地址 2]']);
  });

  it('artifacts 的 url 掩码，其余字段保留', () => {
    const { service } = queryFixture([diagTask()], (value) => `BASE:${value}`);
    const result = service.buildTaskDiagnostics();
    if (result.success) {
      expect(result.data[0].artifacts![0]).toMatchObject({ id: 'art-1', url: '[已脱敏]', kind: 'video' });
    }
  });

  it('默认 basename 按分隔符截取末段', () => {
    const { service } = queryFixture([diagTask()]);
    const result = service.buildTaskDiagnostics();
    if (result.success) {
      expect(result.data[0].attachments).toEqual(['a.png', 'b.jpg']);
      expect(result.data[0].audioAttachment).toBe('au.mp3');
    }
  });

  it('read 失败返回 WRITE_ERROR', () => {
    const service = new TaskService({
      store: { read: () => { throw new Error('read failed'); }, replace: () => true },
      defaultProjectId: () => 'default', id: () => 'id', now: () => 'now',
    });
    expect(service.buildTaskDiagnostics()).toEqual({ success: false, error: Q_WRITE_ERROR });
  });

  it('零写入', () => {
    const { service, writeCount } = queryFixture([diagTask()], (value) => `BASE:${value}`);
    service.buildTaskDiagnostics();
    expect(writeCount()).toBe(0);
  });
});

describe('IPC 接线源码契约检查：只读查询', () => {
  const source = readFileSync(resolve(__dirname, '../../main/ipc/tasks.ts'), 'utf-8');

  it('tasks:list / tasks:getCompletedOutputs 退化为薄适配且 loadTasks 已删除', () => {
    expect(source).not.toMatch(/function\s+loadTasks\s*\(/);
    expect(source).toMatch(/basename: \(value\) => require\('path'\)\.basename\(value\)/);
    const listStart = source.indexOf("'tasks:list'", source.indexOf("'tasks:list'") + 1);
    const listEnd = source.indexOf("'tasks:add'", source.indexOf("'tasks:add'") + 1);
    const listBody = source.slice(listStart, listEnd);
    expect(listBody).toMatch(/taskService\.getTasks\(\)/);
    expect(listBody).not.toMatch(/\bloadTasks\b/);
    const coStart = source.indexOf("'tasks:getCompletedOutputs'", source.indexOf("'tasks:getCompletedOutputs'") + 1);
    const coEnd = source.indexOf("'tasks:selectImages'", source.indexOf("'tasks:selectImages'") + 1);
    const coBody = source.slice(coStart, coEnd);
    expect(coBody).toMatch(/taskService\.getCompletedOutputs\(\)/);
    expect(coBody).not.toMatch(/\bloadTasks\b/);
    expect(coBody).not.toMatch(/\.filter\(/);
  });

  it('exportDiagnostics 任务部分调用 buildTaskDiagnostics，脱敏逻辑不在 handler', () => {
    const exStart = source.indexOf("'tasks:exportDiagnostics'", source.indexOf("'tasks:exportDiagnostics'") + 1);
    const exEnd = source.indexOf("'tasks:validateArtifact'", source.indexOf("'tasks:validateArtifact'") + 1);
    const exBody = source.slice(exStart, exEnd);
    expect(exBody).toMatch(/taskService\.buildTaskDiagnostics\(\)/);
    expect(exBody).not.toMatch(/\bloadTasks\b/);
    expect(exBody).not.toMatch(/已脱敏，长度/);
    expect(exBody).not.toMatch(/\[产物地址/);
  });
});
