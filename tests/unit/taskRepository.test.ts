import { describe, expect, it, vi } from 'vitest';
import type { Task } from '@doubao-studio/contracts';
import { TaskEventStream } from '../../main/core/TaskEventStream';
import { TaskRepository } from '../../main/core/TaskRepository';

function task(id: string, status: Task['status'] = 'queued'): Task {
  return {
    id, prompt: id, assignedAccountId: null, status, mode: 'chat', result: null,
    outputs: [], artifacts: [], createdAt: '2026-08-13T00:00:00.000Z', updatedAt: '2026-08-13T00:00:00.000Z',
  };
}

function fixture(initial: Task[] = []) {
  let stored = structuredClone(initial);
  const events = new TaskEventStream(20);
  const write = vi.fn((_filename: string, value: Task[]) => {
    stored = structuredClone(value);
    return true;
  });
  const repository = new TaskRepository({
    read: () => structuredClone(stored),
    write,
    normalize: (raw) => ({ data: raw as Task[], changed: false, warnings: [] }),
    defaultProjectId: () => 'default',
    events,
  });
  return { repository, events, write, stored: () => stored };
}

describe('TaskRepository 单一写入边界', () => {
  it('成功写入后发布 created 事件，sequence 单调递增', () => {
    const { repository, events } = fixture();
    const tasks = repository.read();
    tasks.push(task('t1'), task('t2'));
    expect(repository.replace(tasks)).toBe(true);
    expect(events.after().map((event) => [event.sequence, event.taskId, event.eventType])).toEqual([
      [1, 't1', 'task.created'], [2, 't2', 'task.created'],
    ]);
  });

  it('拒绝未由 repository read 创建的数组', () => {
    const { repository, write } = fixture();
    expect(() => repository.replace([task('foreign')])).toThrow('TASK_REPOSITORY_UNTRACKED_SNAPSHOT');
    expect(write).not.toHaveBeenCalled();
  });

  it('两个调用者持有快照时，拒绝较晚写回的陈旧快照', () => {
    const { repository, stored } = fixture([task('t1')]);
    const first = repository.read();
    const stale = repository.read();
    first[0].status = 'executing';
    expect(repository.replace(first)).toBe(true);
    stale[0].status = 'paused';
    expect(() => repository.replace(stale)).toThrow('TASK_REPOSITORY_STALE_SNAPSHOT');
    expect(stored()[0].status).toBe('executing');
  });

  it('状态、阶段、产物和删除均产生版本化事件', () => {
    const { repository, events } = fixture([task('t1')]);
    const tasks = repository.read();
    tasks[0].status = 'done';
    tasks[0].runtime = {
      runId: 'r1', attempt: 1, stage: 'completed', message: '完成',
      startedAt: '2026-08-13T00:00:00.000Z', stageStartedAt: '2026-08-13T00:00:00.000Z',
      lastHeartbeatAt: '2026-08-13T00:00:00.000Z',
      input: { prompt: 't1', mode: 'chat', attachments: [] },
    };
    tasks[0].artifacts = [{ id: 'a1', url: 'https://example.invalid/a', kind: 'video', source: 'network', discoveredAt: '2026-08-13T00:00:00.000Z' }];
    expect(repository.replace(tasks)).toBe(true);
    const afterUpdate = events.after();
    expect(afterUpdate.map((event) => event.eventType)).toEqual(['task.done', 'task.stage_changed', 'artifact.discovered']);
    expect(events.version).toBe(1);

    const deleting = repository.read();
    deleting.splice(0, 1);
    expect(repository.replace(deleting)).toBe(true);
    expect(events.after(afterUpdate.at(-1)!.sequence).map((event) => event.eventType)).toEqual(['task.deleted']);
  });

  it('订阅可撤销，游标读取返回副本', () => {
    const stream = new TaskEventStream(2);
    const listener = vi.fn();
    const dispose = stream.subscribe(listener);
    stream.publish('t1', 'task.created');
    dispose();
    stream.publish('t1', 'task.started');
    stream.publish('t1', 'task.done');
    expect(listener).toHaveBeenCalledTimes(1);
    expect(stream.after().map((event) => event.eventType)).toEqual(['task.started', 'task.done']);
    const copy = stream.after(1);
    copy[0].eventType = 'tampered';
    expect(stream.after(1)[0].eventType).toBe('task.started');
  });

  it('订阅者异常被隔离，不反向破坏事件提交', () => {
    const stream = new TaskEventStream();
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    stream.subscribe(() => { throw new Error('listener failed'); });
    expect(() => stream.publish('t1', 'task.created')).not.toThrow();
    expect(stream.after()).toHaveLength(1);
    expect(consoleSpy).toHaveBeenCalledOnce();
    consoleSpy.mockRestore();
  });
});
