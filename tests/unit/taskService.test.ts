import { describe, expect, it } from 'vitest';
import type { Task, TaskStage, TaskLock } from '@doubao-studio/contracts';
import { TaskService } from '../../main/core/TaskService';

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
