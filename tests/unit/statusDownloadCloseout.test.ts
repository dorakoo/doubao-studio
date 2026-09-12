import { describe, expect, it } from 'vitest';
import { TaskService, isTaskServiceFailure } from '../../main/core/TaskService';
import { normalizeTasks } from '../../main/utils/persistenceNormalization';
import type { Task } from '../../src/types';
import {
  buildBatchDownloadPayload,
  createInitialOutputSelection,
  hasCrossBatchSelection,
  summarizeSelectedOutputs,
} from '../../src/utils/downloadSelection';

const NOW = '2026-09-12T00:00:00.000Z';

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1', prompt: 'prompt', assignedAccountId: null, status: 'done', mode: 'video',
    result: null, outputs: ['https://example.com/v.mp4'], artifacts: [], runHistory: [], dependsOnTaskIds: [],
    projectId: 'default-project', batchId: 'batch-1', createdAt: NOW, updatedAt: NOW,
    ...overrides,
  };
}

/**
 * 内存仓库夹具。
 * `replace` 真正落盘；`read` 返回落盘引用，配合 TaskService 内部“读取即深拷贝”的
 * Repository 契约（见 main/core/TaskRepository.ts），模拟真实磁盘读写。
 */
function fixture(initial: Task[] = []) {
  let data = structuredClone(initial);
  const service = new TaskService({
    store: {
      read: () => data,
      replace: (tasks) => { data = tasks; return true; },
    },
    defaultProjectId: () => 'default-project',
    id: () => 'id-1',
    now: () => NOW,
  });
  return { service, stored: () => data };
}

describe('TaskService quality verdict', () => {
  it('accepted 只写状态和时间，不保存拒收标签', () => {
    const { service, stored } = fixture([makeTask()]);
    const result = service.setQualityVerdict({ taskId: 'task-1', status: 'accepted', rejectionTags: ['material'] });
    expect(result.success).toBe(true);
    expect(stored()[0].qualityVerdict).toEqual({ status: 'accepted', rejectionTags: undefined, decidedAt: NOW });
  });

  it('rejected 对合法标签去重并稳定排序', () => {
    const { service, stored } = fixture([makeTask()]);
    const result = service.setQualityVerdict({
      taskId: 'task-1', status: 'rejected',
      rejectionTags: ['material', 'bgm', 'material'],
    });
    expect(result.success).toBe(true);
    expect(stored()[0].qualityVerdict).toEqual({
      status: 'rejected', rejectionTags: ['bgm', 'material'], decidedAt: NOW,
    });
  });

  it('任意非法标签导致整个写入 fail-closed，不静默过滤', () => {
    const { service, stored } = fixture([makeTask()]);
    const result = service.setQualityVerdict({
      taskId: 'task-1', status: 'rejected',
      rejectionTags: ['material', 'made_up'] as never,
    });
    expect(result).toEqual({ success: false, error: '拒收标签包含非法值，写入已拒绝' });
    // R1：混合“合法 + 非法”必须整体拒绝，台账保持完全不变（无裁决、无时间戳、无脏值）。
    expect(stored()[0].qualityVerdict).toBeUndefined();
    expect(stored()[0].updatedAt).toBe(NOW);
  });

  it('多个非法标签同样整体拒绝且零写入', () => {
    const { service, stored } = fixture([makeTask()]);
    const result = service.setQualityVerdict({
      taskId: 'task-1', status: 'rejected',
      rejectionTags: ['product_structure', 'made_up', 'also_fake'] as never,
    });
    expect(result.success).toBe(false);
    expect(stored()[0].qualityVerdict).toBeUndefined();
    expect(stored()[0].updatedAt).toBe(NOW);
  });

  it('全部标签合法时才写入，且去重后稳定排序', () => {
    const { service, stored } = fixture([makeTask()]);
    const result = service.setQualityVerdict({
      taskId: 'task-1', status: 'rejected',
      rejectionTags: ['bgm', 'audio', 'bgm', 'material'],
    });
    expect(result.success).toBe(true);
    expect(stored()[0].qualityVerdict).toEqual({
      status: 'rejected', rejectionTags: ['audio', 'bgm', 'material'], decidedAt: NOW,
    });
  });

  it('rejected 无有效标签时 fail-closed', () => {
    const { service, stored } = fixture([makeTask()]);
    expect(service.setQualityVerdict({ taskId: 'task-1', status: 'rejected', rejectionTags: [] })).toEqual({
      success: false, error: '拒收裁决必须至少选择一个有效标签',
    });
    expect(stored()[0].qualityVerdict).toBeUndefined();
  });

  it('Repository 写入失败返回失败，不伪报成功', () => {
    const service = new TaskService({
      store: { read: () => [makeTask()], replace: () => false },
      defaultProjectId: () => 'default-project', id: () => 'id-1', now: () => NOW,
    });
    expect(service.setQualityVerdict({ taskId: 'task-1', status: 'accepted' })).toEqual({
      success: false, error: '任务数据写入失败，请检查磁盘空间和数据目录权限',
    });
  });
});

describe('blockedByTaskIds persistence', () => {
  it('updateRuntime 去重、排序并可用空数组清除', () => {
    const { service, stored } = fixture([makeTask()]);
    expect(service.updateRuntime({ taskId: 'task-1', blockedByTaskIds: ['b', 'a', 'b', ''] }).success).toBe(true);
    expect(stored()[0].blockedByTaskIds).toEqual(['a', 'b']);
    expect(service.updateRuntime({ taskId: 'task-1', blockedByTaskIds: [] }).success).toBe(true);
    expect(stored()[0].blockedByTaskIds).toBeUndefined();
  });

  it('只清除 blockedByTaskIds 时不会顺带清空未请求校验的 errorInfo', () => {
    // R2 修正：未传入 errorInfo 表示“不校验该字段”，不得被解释为“期望清空”。
    const blocked = makeTask({
      status: 'queued',
      errorInfo: { code: 'dependency_failed', message: '前置失败', recoverable: false, detectedAt: NOW },
      blockedByTaskIds: ['upstream'],
    });
    const { service, stored } = fixture([blocked]);

    expect(service.updateRuntime({ taskId: 'task-1', blockedByTaskIds: [] }).success).toBe(true);
    expect(stored()[0].blockedByTaskIds).toBeUndefined();
    // errorInfo 未被请求修改，必须原样保留。
    expect(stored()[0].errorInfo?.code).toBe('dependency_failed');
  });

  it('只清除 errorInfo 时不会顺带清空未请求校验的 blockedByTaskIds', () => {
    const blocked = makeTask({
      status: 'queued',
      errorInfo: { code: 'dependency_failed', message: '前置失败', recoverable: false, detectedAt: NOW },
      blockedByTaskIds: ['upstream'],
    });
    const { service, stored } = fixture([blocked]);

    expect(service.updateRuntime({ taskId: 'task-1', errorInfo: null }).success).toBe(true);
    expect(stored()[0].errorInfo).toBeUndefined();
    expect(stored()[0].blockedByTaskIds).toEqual(['upstream']);
  });

  it('并发漂移时返回权威回读状态与冲突原因，不宣称已回滚', () => {
    // replace 报告成功，但 read 返回的仍是旧快照（并发写入覆盖）。
    const stale = makeTask({ status: 'queued' });
    const service = new TaskService({
      store: {
        read: () => [structuredClone(stale)],
        replace: () => true,
      },
      defaultProjectId: () => 'default-project', id: () => 'id-1', now: () => NOW,
    });
    const result = service.updateRuntime({
      taskId: 'task-1',
      status: 'fail',
      errorInfo: { code: 'dependency_failed', message: '前置失败', recoverable: false, detectedAt: NOW },
      blockedByTaskIds: ['upstream'],
    });
    if (!isTaskServiceFailure(result)) throw new Error('expected failure result');
    expect(result).toMatchObject({ success: false, error: '任务状态已被并发修改，已返回权威回读状态' });
    // 服务端必须给出落盘事实，而不是声称原状态未变。
    expect(result.task).toMatchObject({ id: 'task-1', status: 'queued' });
  });

  it('回读清除失败时返回权威状态，阻断证据不会被误报为已清理', () => {
    const task = makeTask({ status: 'queued' });
    task.blockedByTaskIds = ['old-block'];
    const service = new TaskService({
      store: { read: () => [structuredClone(task)], replace: () => true },
      defaultProjectId: () => 'default-project', id: () => 'id-1', now: () => NOW,
    });
    const result = service.updateRuntime({ taskId: 'task-1', blockedByTaskIds: [] });
    if (!isTaskServiceFailure(result)) throw new Error('expected failure result');
    expect(result).toMatchObject({ success: false, error: '任务状态已被并发修改，已返回权威回读状态' });
    expect(result.task?.blockedByTaskIds).toEqual(['old-block']);
  });

  it('回读一致时返回真实落盘任务', () => {
    const { service, stored } = fixture([makeTask({ status: 'queued' })]);
    const result = service.updateRuntime({
      taskId: 'task-1',
      errorInfo: { code: 'dependency_missing', message: '依赖不存在', recoverable: false, detectedAt: NOW },
      blockedByTaskIds: ['ghost', 'ghost'],
    });
    expect(result.success).toBe(true);
    expect(stored()[0]).toMatchObject({ blockedByTaskIds: ['ghost'] });
    expect(stored()[0].errorInfo?.code).toBe('dependency_missing');
  });

  it('持久化归一化非法类型、空值、重复值并保留合法裁决', () => {
    const raw = makeTask() as unknown as Record<string, unknown>;
    raw.blockedByTaskIds = [' b ', 'a', 'b', 1, ''];
    raw.qualityVerdict = { status: 'rejected', rejectionTags: ['bgm', 'bgm', 1], decidedAt: NOW };
    const normalized = normalizeTasks([raw], 'default-project', NOW).data[0];
    expect(normalized.blockedByTaskIds).toEqual(['a', 'b']);
    expect(normalized.qualityVerdict).toEqual({ status: 'rejected', rejectionTags: ['bgm'], decidedAt: NOW });
  });

  it('历史盘面中的非法标签被安全清理，但不伪造裁决时间', () => {
    const raw = makeTask() as unknown as Record<string, unknown>;
    const decidedAt = '2026-08-01T00:00:00.000Z';
    raw.qualityVerdict = { status: 'rejected', rejectionTags: ['material', 'made_up', 'material'], decidedAt };
    const normalized = normalizeTasks([raw], 'default-project', NOW).data[0];
    // 非法值从盘面清除，合法值保留，原始裁决时间不被当前时间覆盖。
    expect(normalized.qualityVerdict).toEqual({ status: 'rejected', rejectionTags: ['material'], decidedAt });
  });

  it('缺失或非法 decidedAt 的历史裁决整体丢弃，不补当前时间', () => {
    for (const decidedAt of [undefined, '', 'not-a-date', 123 as never]) {
      const raw = makeTask() as unknown as Record<string, unknown>;
      raw.qualityVerdict = { status: 'accepted', decidedAt };
      const normalized = normalizeTasks([raw], 'default-project', NOW).data[0];
      expect(normalized.qualityVerdict).toBeUndefined();
    }
    const rejectedRaw = makeTask() as unknown as Record<string, unknown>;
    rejectedRaw.qualityVerdict = { status: 'rejected', rejectionTags: ['material'] };
    expect(normalizeTasks([rejectedRaw], 'default-project', NOW).data[0].qualityVerdict).toBeUndefined();
  });
});

describe('batch download selection behavior', () => {
  it('打开预览时默认选择为空', () => {
    expect([...createInitialOutputSelection()]).toEqual([]);
  });

  it('只构建当前项目当前批次的 done 有产物任务', () => {
    const tasks = [
      makeTask({ id: 't1', projectId: 'p1', batchId: 'b1', outputs: ['u1', 'u2'] }),
      makeTask({ id: 't2', projectId: 'p1', batchId: 'b1', status: 'fail', outputs: ['bad'] }),
      makeTask({ id: 't3', projectId: 'p1', batchId: 'b2', outputs: ['other'] }),
      makeTask({ id: 't4', projectId: 'p2', batchId: 'b1', outputs: ['other'] }),
      makeTask({ id: 't5', projectId: 'p1', batchId: 'b1', outputs: [] }),
    ];
    const payload = buildBatchDownloadPayload(tasks, 'p1', '项目一', 'b1');
    expect(payload.outputs.map((item) => item.taskId)).toEqual(['t1']);
    expect(payload.summary).toEqual({ projectName: '项目一', batchId: 'b1', taskCount: 1, artifactCount: 2 });
  });

  it('下载摘要按当前选择实时计算实际任务数和产物数', () => {
    expect(summarizeSelectedOutputs([
      { outputs: ['a', 'b'] },
      { outputs: ['c'] },
    ])).toEqual({ taskCount: 2, artifactCount: 3 });
    expect(summarizeSelectedOutputs([])).toEqual({ taskCount: 0, artifactCount: 0 });
  });

  it('跨项目或跨批次会被识别为当前不支持的选择', () => {
    expect(hasCrossBatchSelection([
      { projectId: 'p1', batchId: 'b1' },
      { projectId: 'p1', batchId: 'b1' },
    ])).toBe(false);
    expect(hasCrossBatchSelection([
      { projectId: 'p1', batchId: 'b1' },
      { projectId: 'p1', batchId: 'b2' },
    ])).toBe(true);
    expect(hasCrossBatchSelection([
      { projectId: 'p1', batchId: 'b1' },
      { projectId: 'p2', batchId: 'b1' },
    ])).toBe(true);
  });
});
