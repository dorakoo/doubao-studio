import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Account, Task } from '@doubao-studio/contracts';

const state = vi.hoisted(() => ({
  files: {} as Record<string, unknown>,
  writes: [] as string[],
}));

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn(), removeHandler: vi.fn() },
  dialog: {},
  session: { fromPartition: vi.fn(), defaultSession: {} },
}));

vi.mock('../../main/utils/store', () => ({
  readJSON: vi.fn((filename: string, fallback: unknown) => structuredClone(state.files[filename] ?? fallback)),
  writeJSON: vi.fn((filename: string, value: unknown) => {
    state.files[filename] = structuredClone(value);
    state.writes.push(filename);
    return true;
  }),
}));

vi.mock('../../main/utils/persistenceNormalization', () => ({
  normalizeTasks: (value: unknown) => ({ data: structuredClone(value), changed: false, warnings: [] }),
  normalizeDownloadJobs: (value: unknown) => ({ data: structuredClone(value), changed: false, warnings: [] }),
}));

import { assignTaskForLocalControl } from '../../main/ipc/tasks';

const baseTask: Task = {
  id: 'task-1', projectId: 'project-1', batchId: 'batch-1', prompt: 'secret',
  assignedAccountId: null, status: 'queued', mode: 'video', result: null, outputs: [], artifacts: [],
  createdAt: '2026-09-12T00:00:00.000Z', updatedAt: '2026-09-12T00:00:00.000Z',
};

function account(id: string, platform: Account['platform'] = 'doubao'): Account {
  return {
    id, name: id, platform, avatar: '', partition: id, status: 'idle', pinned: false,
    createdAt: '2026-09-12T00:00:00.000Z', updatedAt: '2026-09-12T00:00:00.000Z',
  };
}

describe('本机控制任务动作正式服务出口', () => {
  beforeEach(() => {
    state.files = {
      'tasks.json': [structuredClone(baseTask)],
      'accounts.json': [account('account-1')],
      'projects.json': [{ id: 'default-project', name: '默认项目', description: '', color: '#fff', archived: false, createdAt: 'now', updatedAt: 'now' }],
    };
    state.writes = [];
  });

  it('只通过 TaskService 持久化指派，不产生执行状态或运行快照', () => {
    const result = assignTaskForLocalControl({ projectId: 'project-1', batchId: 'batch-1', taskId: 'task-1', accountId: 'account-1' });
    expect(result).toEqual({ success: true, code: 'ASSIGNED' });
    const stored = state.files['tasks.json'] as Task[];
    expect(stored[0]).toMatchObject({ assignedAccountId: 'account-1', status: 'queued' });
    expect(stored[0].runtime).toBeUndefined();
    expect(state.writes).toEqual(['tasks.json']);
  });

  it('账号不存在时 fail-closed 且任务台账不写入', () => {
    const result = assignTaskForLocalControl({ projectId: 'project-1', batchId: 'batch-1', taskId: 'task-1', accountId: 'missing' });
    expect(result).toEqual({ success: false, code: 'ACCOUNT_NOT_FOUND' });
    expect(state.writes).toEqual([]);
  });

  it('任务在项目或批次中漂移时 fail-closed', () => {
    const wrongProject = assignTaskForLocalControl({ projectId: 'project-2', batchId: 'batch-1', taskId: 'task-1', accountId: 'account-1' });
    const wrongBatch = assignTaskForLocalControl({ projectId: 'project-1', batchId: 'batch-2', taskId: 'task-1', accountId: 'account-1' });
    expect(wrongProject.code).toBe('TASK_SCOPE_MISMATCH');
    expect(wrongBatch.code).toBe('TASK_SCOPE_MISMATCH');
    expect(state.writes).toEqual([]);
  });

  it('Dola 未完成端到端验收前保持 fail-closed', () => {
    state.files['accounts.json'] = [account('dola-1', 'dola')];
    const result = assignTaskForLocalControl({ projectId: 'project-1', batchId: 'batch-1', taskId: 'task-1', accountId: 'dola-1' });
    expect(result).toEqual({ success: false, code: 'PLATFORM_NOT_VERIFIED' });
    expect(state.writes).toEqual([]);
  });
});
