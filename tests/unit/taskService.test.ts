import { describe, expect, it } from 'vitest';
import type { Task } from '@doubao-studio/contracts';
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
