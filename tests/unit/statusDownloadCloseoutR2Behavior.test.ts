/**
 * tests/unit/statusDownloadCloseoutR2Behavior.test.ts
 *
 * DOUBAO-STATUS-DOWNLOAD-CLOSEOUT-01 R2 行为测试
 *
 * 覆盖总架构师 R1 复验确认的四类真实缺陷：
 * - P0-1 依赖阻断写成 fail 导致永久卡死：必须保持 queued、可被调度器重新评估、恢复后原子转回 queued
 * - P0-2 回读校验字段互串与假“保持原状态”：按字段独立判定，漂移返回权威状态或冲突
 * - P0-3 下载门禁可被空归属绕过：每项必须有非空项目/批次/产物，项目数=批次数=1，拒绝无归属旧事件
 * - P1 非法/缺失 decidedAt 被伪造成当前时间：整体丢弃历史裁决
 *
 * 全部使用真实 store / TaskService 行为与内存数据，不读取生产账号、任务台账、Cookie 或 Session。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Account, Task } from '../../src/types';
import { useAccountStore } from '../../src/store/useAccountStore';
import { useTaskStore } from '../../src/store/useTaskStore';
import { automationEngine } from '../../src/automation/AutomationEngine';
import { TaskService, isTaskServiceFailure } from '../../main/core/TaskService';
import { normalizeTasks } from '../../main/utils/persistenceNormalization';
import {
  buildBatchDownloadRequest,
  createDownloadIntent,
  readDownloadSelection,
} from '../../src/utils/downloadSelection';

type MockFn = ReturnType<typeof vi.fn>;

interface MockWindow {
  electronAPI: {
    tasks: { list: MockFn; updateRuntime: MockFn; acquireLock: MockFn; renewLock: MockFn };
    logs: { append: MockFn };
  };
  dispatchEvent: MockFn;
  addEventListener: MockFn;
  removeEventListener: MockFn;
}

const globalMocks = globalThis as unknown as {
  window: MockWindow;
  localStorage: { getItem: MockFn; setItem: MockFn };
};

const actualProcessQueue = useTaskStore.getState().processQueue;
const actualStartAutomation = useTaskStore.getState().startAutomation;
const NOW = '2026-09-12T00:00:00.000Z';

/** 模拟主进程落盘数据（主进程回读与 Renderer store 分离，才能验证回读语义） */
let persistedTasks: Task[] = [];

function account(id: string): Account {
  return {
    id, name: id, platform: 'doubao', avatar: '', partition: `account_${id}`, status: 'idle', pinned: false,
    seedanceQuota: { date: '2026-09-12', usedUnits: 0, estimatedTotalUnits: 6, exhausted: false, updatedAt: NOW },
    health: {
      loginState: 'ok', verificationRequired: false, consecutiveFailures: 0, successCount: 0, failureCount: 0,
      availability: { state: 'ready', reason: 'ready', message: 'x', checkedAt: NOW, source: 'startup' },
    },
    scheduling: { enabled: true, weight: 1, preferredModes: [] },
    createdAt: NOW, updatedAt: NOW,
  };
}

function baseTask(id: string, assignedAccountId: string | null, createdAt: string): Task {
  return {
    id, prompt: id, assignedAccountId, status: 'queued', mode: 'video',
    // A：调度器只处理显式 armed。
    executionIntent: 'armed',
    videoFormat: undefined,
    result: null, outputs: [], artifacts: [], runHistory: [], dependsOnTaskIds: [], dependencyPolicy: 'all_done',
    projectId: 'default-project', createdAt, updatedAt: NOW,
  } as Task;
}

/** 按补丁影响任务，与 store 的归一化保持一致 */
function applyPatch(task: Task, patch: Record<string, unknown>): Task {
  const next: Task = { ...task };
  if (patch.status) next.status = patch.status as Task['status'];
  if (patch.result !== undefined) next.result = patch.result as string | null;
  if (patch.errorInfo === null) next.errorInfo = undefined;
  else if (patch.errorInfo) next.errorInfo = patch.errorInfo as Task['errorInfo'];
  if (patch.blockedByTaskIds !== undefined) {
    const ids = [...new Set((patch.blockedByTaskIds as string[]).filter(Boolean))].sort();
    next.blockedByTaskIds = ids.length > 0 ? ids : undefined;
  }
  if (patch.runtime) next.runtime = { ...(task.runtime || {}), ...(patch.runtime as object) } as Task['runtime'];
  return next;
}

function startOnce() {
  const calls: string[] = [];
  const mock = vi.fn<(taskId: string) => Promise<boolean>>(async (taskId: string) => {
    calls.push(taskId);
    const accountId = useTaskStore.getState().tasks.find((task) => task.id === taskId)?.assignedAccountId || 'unknown';
    useTaskStore.setState((state) => ({
      schedulerPaused: true,
      tasks: state.tasks.map((task) => task.id === taskId ? { ...task, status: 'executing' as const, blockedByTaskIds: undefined } : task),
      executingTasks: { ...state.executingTasks, [accountId]: taskId },
      accountBusy: { ...state.accountBusy, [accountId]: true },
      accountAutomationState: { ...state.accountAutomationState, [accountId]: 'injecting' },
    }));
    return true;
  });
  return { mock, calls };
}

describe('DOUBAO-STATUS-DOWNLOAD-CLOSEOUT-01 R2', () => {
  beforeEach(() => {
    globalMocks.window = {
      electronAPI: {
        tasks: {
          list: vi.fn(),
          updateRuntime: vi.fn(async (taskId: string, patch: Record<string, unknown>) => {
            const current = persistedTasks.find((item) => item.id === taskId);
            if (!current) return { success: false, error: 'task not found' };
            const next = applyPatch(current, patch);
            persistedTasks = persistedTasks.map((item) => item.id === taskId ? next : item);
            return { success: true, task: next };
          }),
          acquireLock: vi.fn(async () => ({ success: true })),
          renewLock: vi.fn(async () => ({ success: true })),
        },
        logs: { append: vi.fn(async () => ({})) },
      },
      dispatchEvent: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };
    globalMocks.localStorage = { getItem: vi.fn(() => null), setItem: vi.fn() };
    persistedTasks = [];
    useAccountStore.setState({
      accounts: [account('acc-1'), account('acc-2')],
      selectedAccountId: 'acc-1',
      recordAccountOutcome: vi.fn(),
      markSeedanceExhausted: vi.fn(),
      recordSeedanceUsage: vi.fn(),
    });
    useTaskStore.setState({
      tasks: [], executingTasks: {}, accountBusy: {}, accountAutomationState: {}, accountAutoMessage: {},
      schedulerPaused: false, error: null,
      processQueue: actualProcessQueue, startAutomation: actualStartAutomation,
    });
  });

  afterEach(async () => {
    const releases = useTaskStore.getState().tasks.map((task) => automationEngine.release(task.id));
    await Promise.all(releases);
    vi.useRealTimers();
  });

  function seedTasks(tasks: Task[]): void {
    persistedTasks = structuredClone(tasks);
    useTaskStore.setState({ tasks: structuredClone(tasks) });
  }

  // ==================== P0-1 依赖阻断不再永久卡死 ====================

  describe('P0-1 依赖阻断可恢复', () => {
    it('依赖阻断保持 queued 并被调度器重新评估，而不是写成 fail', async () => {
      const blocked = { ...baseTask('blocked', 'acc-1', '2026-09-11T22:00:00.000Z'), dependsOnTaskIds: ['missing'] };
      seedTasks([blocked]);
      useTaskStore.setState({ startAutomation: vi.fn(async () => true) });

      await useTaskStore.getState().processQueue();

      const current = useTaskStore.getState().tasks.find((task) => task.id === 'blocked');
      expect(current?.status).toBe('queued');
      expect(current?.errorInfo?.code).toBe('dependency_missing');
      expect(current?.blockedByTaskIds).toEqual(['missing']);
      // 关键：仍在 queued 扫描范围内，因此下一次调度会再次评估它。
      expect(persistedTasks[0].status).toBe('queued');
    });

    it('前置失败 → 重试成功 → 后继自动恢复并放行', async () => {
      const predecessor = {
        ...baseTask('predecessor', 'acc-2', '2026-09-11T22:00:00.000Z'),
        status: 'fail' as const,
        errorInfo: { code: 'generation_failed', message: '生成失败', recoverable: true, detectedAt: NOW },
      };
      const successor = {
        ...baseTask('successor', 'acc-1', '2026-09-11T22:10:00.000Z'),
        dependsOnTaskIds: ['predecessor'],
        dependencyPolicy: 'all_done' as const,
      };
      seedTasks([predecessor, successor]);
      useTaskStore.setState({ startAutomation: vi.fn(async () => true) });

      // 第 1 轮：前序失败 → 后继进入依赖阻断，但保持可调度。
      await useTaskStore.getState().processQueue();
      const blockedSuccessor = useTaskStore.getState().tasks.find((task) => task.id === 'successor');
      expect(blockedSuccessor).toMatchObject({ status: 'queued' });
      expect(blockedSuccessor?.errorInfo?.code).toBe('dependency_failed');
      expect(blockedSuccessor?.blockedByTaskIds).toEqual(['predecessor']);

      // 前序恢复并重试成功（模拟真实重试链路：转为 queued，final 后变 done）。
      persistedTasks = persistedTasks.map((task) => task.id === 'predecessor'
        ? { ...task, status: 'done', errorInfo: undefined, outputs: ['https://example.com/v.mp4'] }
        : task);
      useTaskStore.setState({
        tasks: useTaskStore.getState().tasks.map((task) => task.id === 'predecessor'
          ? { ...task, status: 'done' as const, errorInfo: undefined }
          : task),
      });

      // 第 2 轮：依赖已满足 → 自动清理阻断并放行。
      const { mock: start, calls } = startOnce();
      useTaskStore.setState({ startAutomation: start });
      await useTaskStore.getState().processQueue();

      expect(calls).toContain('successor');
      const recovered = useTaskStore.getState().tasks.find((task) => task.id === 'successor');
      expect(recovered?.blockedByTaskIds).toBeUndefined();
      expect(recovered?.errorInfo).toBeUndefined();
    });

    it('阻断刷新是幂等的：重复评估不会重复写盘', async () => {
      const blocked = { ...baseTask('idem', 'acc-1', '2026-09-11T22:00:00.000Z'), dependsOnTaskIds: ['missing'] };
      seedTasks([blocked]);
      useTaskStore.setState({ startAutomation: vi.fn(async () => true) });

      await useTaskStore.getState().processQueue();
      const firstRound = (globalMocks.window.electronAPI.tasks.updateRuntime as MockFn).mock.calls.length;
      await useTaskStore.getState().processQueue();
      const secondRound = (globalMocks.window.electronAPI.tasks.updateRuntime as MockFn).mock.calls.length;

      expect(firstRound).toBe(1);
      expect(secondRound).toBe(1);
    });

    it('重新评估入口是持久化的：应用重启后从盘面恢复仍可恢复阻断任务', async () => {
      // 盘面里保留阻断证据的任务（上一进程写入），重启加载后必须留在 queued 并被重新评估。
      const persistedBlocked = {
        ...baseTask('restart', 'acc-1', '2026-09-11T22:00:00.000Z'),
        dependsOnTaskIds: ['missing'],
        blockedByTaskIds: ['missing'],
        errorInfo: { code: 'dependency_missing', message: '任务依赖不存在，请检查工作流或 CSV', recoverable: false, detectedAt: NOW },
      };
      seedTasks([persistedBlocked]);
      globalMocks.window.electronAPI.tasks.list.mockResolvedValue(structuredClone([persistedBlocked]));

      await useTaskStore.getState().loadTasks(true);
      useTaskStore.setState({ startAutomation: vi.fn(async () => true) });
      await useTaskStore.getState().processQueue();

      const current = useTaskStore.getState().tasks.find((task) => task.id === 'restart');
      expect(current?.status).toBe('queued');
      // 依赖仍然缺失：阻断证据保留，任务没有被写成 fail，也没有被丢弃。
      expect(current?.errorInfo?.code).toBe('dependency_missing');
      expect(current?.blockedByTaskIds).toEqual(['missing']);
    });
  });

  // ==================== P0-2 回读校验与并发冲突 ====================

  describe('P0-2 回读校验字段独立与权威状态', () => {
    function serviceFixture(initial: Task[]) {
      let data = structuredClone(initial);
      const service = new TaskService({
        store: { read: () => data, replace: (tasks) => { data = tasks; return true; } },
        defaultProjectId: () => 'default-project', id: () => 'id-1', now: () => NOW,
      });
      return { service, stored: () => data };
    }

    function blockedTask(): Task {
      const task = baseTask('t1', 'acc-1', NOW);
      task.artifacts = [];
      task.runHistory = [];
      task.dependsOnTaskIds = ['up'];
      task.blockedByTaskIds = ['up'];
      task.errorInfo = { code: 'dependency_failed', message: '前置失败', recoverable: false, detectedAt: NOW };
      return task;
    }

    it('清除阻断不会误判未请求的 errorInfo', () => {
      const { service, stored } = serviceFixture([blockedTask()]);
      expect(service.updateRuntime({ taskId: 't1', blockedByTaskIds: [] }).success).toBe(true);
      expect(stored()[0].blockedByTaskIds).toBeUndefined();
      expect(stored()[0].errorInfo?.code).toBe('dependency_failed');
    });

    it('清除 errorInfo 不会误判未请求的 blockedByTaskIds', () => {
      const { service, stored } = serviceFixture([blockedTask()]);
      expect(service.updateRuntime({ taskId: 't1', errorInfo: null }).success).toBe(true);
      expect(stored()[0].errorInfo).toBeUndefined();
      expect(stored()[0].blockedByTaskIds).toEqual(['up']);
    });

    it('并发漂移返回权威落盘状态与冲突原因，不声称已回滚', () => {
      const stale = blockedTask();
      const service = new TaskService({
        store: { read: () => [structuredClone(stale)], replace: () => true },
        defaultProjectId: () => 'default-project', id: () => 'id-1', now: () => NOW,
      });

      const result = service.updateRuntime({ taskId: 't1', blockedByTaskIds: [] });
      if (!isTaskServiceFailure(result)) throw new Error('expected failure result');
      expect(result).toMatchObject({ success: false, error: '任务状态已被并发修改，已返回权威回读状态' });
      // 必须给出真实落盘事实（仍是旧的阻断记录），而不是“已保持原状态”。
      expect(result.task?.blockedByTaskIds).toEqual(['up']);
    });

    it('Renderer 收到并发冲突时同步权威状态并拒绝视为成功', async () => {
      const blocked = { ...baseTask('conflict', 'acc-1', NOW), blockedByTaskIds: ['up'] };
      seedTasks([blocked]);
      // 主进程写盘成功但回读仍是旧快照：返回冲突 + 权威状态。
      globalMocks.window.electronAPI.tasks.updateRuntime.mockResolvedValueOnce({
        success: false,
        error: '任务状态已被并发修改，已返回权威回读状态',
        task: { ...blocked },
      });

      const ok = await useTaskStore.getState().updateTaskRuntime('conflict', { blockedByTaskIds: [] });

      expect(ok).toBe(false);
      // 界面必须反映落盘事实（仍带阻断），而不是假装阻断已清除。
      const current = useTaskStore.getState().tasks.find((task) => task.id === 'conflict');
      expect(current?.blockedByTaskIds).toEqual(['up']);
      expect(useTaskStore.getState().error).toBe('任务状态已被并发修改，已返回权威回读状态');
    });

    it('写盘真实失败且无回读结果时，界面保持写入前原状态', async () => {
      const ready = baseTask('write-fail', 'acc-1', NOW);
      seedTasks([ready]);
      globalMocks.window.electronAPI.tasks.updateRuntime.mockResolvedValueOnce({ success: false, error: '磁盘写入失败' });

      const ok = await useTaskStore.getState().updateTaskRuntime('write-fail', { blockedByTaskIds: ['x'] });

      expect(ok).toBe(false);
      const current = useTaskStore.getState().tasks.find((task) => task.id === 'write-fail');
      expect(current?.blockedByTaskIds).toBeUndefined();
      expect(useTaskStore.getState().error).toBe('磁盘写入失败');
    });
  });

  // ==================== P0-3 下载门禁不可绕过 ====================

  describe('P0-3 下载门禁精确放行', () => {
    function item(overrides: Record<string, unknown> = {}) {
      return {
        taskId: 't1', prompt: 'p', outputs: ['u1'], accountId: 'acc-1', mode: 'video' as const,
        projectId: 'p1', batchId: 'b1', ...overrides,
      } as { outputs: string[]; projectId: string; batchId: string; taskId: string };
    }

    it('归属完整且单项目单批次时放行', () => {
      const request = buildBatchDownloadRequest([item(), item({ taskId: 't2', outputs: ['u2', 'u3'] })]);
      expect(request).toMatchObject({ ok: true, taskCount: 2, artifactCount: 3, projectCount: 1, batchCount: 1 });
    });

    it('项目或批次缺失/空串时整体拒绝，不会退化成 0 项目 0 批次而误放行', () => {
      for (const missing of [
        { projectId: '' }, { projectId: undefined }, { projectId: '   ' }, { projectId: null },
        { batchId: '' }, { batchId: undefined }, { batchId: '   ' }, { batchId: null },
      ]) {
        const selection = [item(missing as Record<string, unknown>)];
        const request = buildBatchDownloadRequest(selection);
        expect(request.ok).toBe(false);
        expect(request.outputs).toEqual([]);
        expect(request.error).toContain('缺少项目或批次归属');
        expect(createDownloadIntent(selection, 'confirm')).toBeNull();
        // 空值不应被当成“0 个项目/批次”而通过精确 1 的判定。
        expect(readDownloadSelection(selection).downloadEnabled).toBe(false);
      }
    });

    it('零可下载产物的任务不允许占位放行', () => {
      for (const outputs of [[], [''], ['   ']]) {
        const selection = [item({ outputs })];
        const request = buildBatchDownloadRequest(selection);
        expect(request.ok).toBe(false);
        expect(request.error).toContain('没有可下载产物');
        expect(createDownloadIntent(selection, 'confirm')).toBeNull();
      }
    });

    it('跨批次与跨项目仍然整体拒绝', () => {
      expect(buildBatchDownloadRequest([item({ batchId: 'b1' }), item({ taskId: 't2', batchId: 'b2' })]).ok).toBe(false);
      expect(buildBatchDownloadRequest([item({ projectId: 'p1' }), item({ taskId: 't2', projectId: 'p2' })]).ok).toBe(false);
    });

    it('读写选择读数同时暴露无效项数量，按钮据此禁用', () => {
      expect(readDownloadSelection([item({ batchId: '' })])).toMatchObject({ invalidCount: 1, downloadEnabled: false });
      expect(readDownloadSelection([item({ outputs: [] })])).toMatchObject({ invalidCount: 1, downloadEnabled: false });
      expect(readDownloadSelection([item()])).toMatchObject({ invalidCount: 0, downloadEnabled: true });
    });

    it('无归属旧事件被拒绝：Toolbar 只接受带真实范围摘要的事件', async () => {
      const { readFileSync } = await import('node:fs');
      const { resolve } = await import('node:path');
      const source = readFileSync(resolve(__dirname, '../../src/components/Toolbar.tsx'), 'utf8');
      // 旧裸数组事件在打开预览前就被拒绝，且提示错误。
      expect(source).toContain('Array.isArray(detail)');
      expect(source).toContain('下载事件缺少项目或批次归属，已拒绝打开预览');
      expect(source).toContain('下载范围缺少项目或批次归属，已拒绝打开预览');
      // 无范围摘要时不得调用 setPreviewOpen(true)。
      const handlerStart = source.indexOf('const handleBatchDownloadOutputs');
      const handlerEnd = source.indexOf('window.addEventListener(\'batch-download-outputs\'', handlerStart);
      const handler = source.slice(handlerStart, handlerEnd);
      const openIndex = handler.indexOf('setPreviewOpen(true)');
      const guardIndex = handler.indexOf('!hasScope');
      expect(guardIndex).toBeGreaterThan(-1);
      expect(guardIndex).toBeLessThan(openIndex);
    });
  });

  // ==================== P1 不得伪造裁决时间 ====================

  describe('P1 历史裁决时间不得伪造', () => {
    function taskWithVerdict(verdict: unknown): Record<string, unknown> {
      const raw = baseTask('v1', 'acc-1', NOW) as unknown as Record<string, unknown>;
      raw.qualityVerdict = verdict;
      return raw;
    }

    it('缺失或非法 decidedAt 的裁决整体丢弃，不补当前时间', () => {
      const cases: unknown[] = [
        { status: 'accepted' },
        { status: 'accepted', decidedAt: '' },
        { status: 'accepted', decidedAt: 'not-a-date' },
        { status: 'accepted', decidedAt: 123 },
        { status: 'rejected', rejectionTags: ['material'] },
        { status: 'rejected', rejectionTags: ['material'], decidedAt: null },
      ];
      for (const verdict of cases) {
        const normalized = normalizeTasks([taskWithVerdict(verdict)], 'default-project', NOW).data[0];
        expect(normalized.qualityVerdict).toBeUndefined();
      }
    });

    it('合法历史裁决保留原始时间，不被当前时间覆盖', () => {
      const decidedAt = '2026-07-01T08:30:00.000Z';
      const normalized = normalizeTasks(
        [taskWithVerdict({ status: 'rejected', rejectionTags: ['material'], decidedAt })],
        'default-project',
        NOW,
      ).data[0];
      expect(normalized.qualityVerdict).toEqual({ status: 'rejected', rejectionTags: ['material'], decidedAt });
    });

    it('非法时间裁决被丢弃时会标记 changed，供调用方清理盘面', () => {
      const result = normalizeTasks([taskWithVerdict({ status: 'accepted', decidedAt: 'garbage' })], 'default-project', NOW);
      expect(result.data[0].qualityVerdict).toBeUndefined();
      expect(result.changed).toBe(true);
    });
  });
});
