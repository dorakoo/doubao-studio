/**
 * tests/unit/statusDownloadCloseoutR1Behavior.test.ts
 *
 * DOUBAO-STATUS-DOWNLOAD-CLOSEOUT-01 R1 行为测试
 *
 * 覆盖总架构师复验阻断：
 * - P0-1 依赖写入竞态：必须持久化成功并回读一致后才更新界面或启动
 * - P0-2 依赖错误不得进入批量/普通重试、成功率、账号失败、健康冷却或额度
 * - P0-3 下载选择变化后任务数/产物数实时准确；跨批次 fail-closed 且取消零下载
 *
 * 全部使用真实 store 行为与内存数据，不读取生产账号、任务台账、Cookie 或 Session。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Account, AccountAvailability, Task } from '../../src/types';
import { useAccountStore } from '../../src/store/useAccountStore';
import { useTaskStore, isDependencyBlockedTask } from '../../src/store/useTaskStore';
import { automationEngine } from '../../src/automation/AutomationEngine';
import { TaskService } from '../../main/core/TaskService';
import {
  buildBatchDownloadPayload,
  buildBatchDownloadRequest,
  createDownloadIntent,
  createInitialOutputSelection,
  readDownloadSelection,
} from '../../src/utils/downloadSelection';
import { calculatePlatformSuccessRate, getPlatformTaskStats } from '../../src/utils/taskStats';

type MockFn = ReturnType<typeof vi.fn>;

interface MockWindow {
  electronAPI: {
    tasks: {
      list: MockFn;
      updateRuntime: MockFn;
      acquireLock: MockFn;
      renewLock: MockFn;
      setQualityVerdict: MockFn;
    };
    accounts: { setStatus: MockFn; updateHealth: MockFn; updateSeedanceQuota: MockFn };
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
const actualUpdateTaskRuntime = useTaskStore.getState().updateTaskRuntime;
const NOW = '2026-09-12T00:00:00.000Z';

function account(id: string, availability: AccountAvailability['state'] = 'ready'): Account {
  return {
    id, name: id, platform: 'doubao', avatar: '', partition: `account_${id}`, status: 'idle', pinned: false,
    seedanceQuota: { date: '2026-09-12', usedUnits: 0, estimatedTotalUnits: 6, exhausted: false, updatedAt: NOW },
    health: {
      loginState: 'ok', verificationRequired: false, consecutiveFailures: 0, successCount: 0, failureCount: 0,
      availability: { state: availability, reason: 'test', message: 'x', checkedAt: NOW, source: 'startup' },
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
    result: null, outputs: [], artifacts: [], runHistory: [], dependsOnTaskIds: [], dependencyPolicy: 'all_done',
    projectId: 'default-project', createdAt, updatedAt: NOW,
  };
}

/** updateRuntime 的默认实现：按 patch 合并，模拟主进程写入并回读 */
function defaultUpdateRuntime() {
  return vi.fn(async (taskId: string, patch: Record<string, unknown>) => {
    const current = useTaskStore.getState().tasks.find((item) => item.id === taskId);
    if (!current) return { success: false, error: 'task not found' };
    const next: Task = { ...current };
    if (patch.status) next.status = patch.status as Task['status'];
    if (patch.result !== undefined) next.result = patch.result as string | null;
    if (patch.errorInfo === null) next.errorInfo = undefined;
    else if (patch.errorInfo) next.errorInfo = patch.errorInfo as Task['errorInfo'];
    if (patch.blockedByTaskIds !== undefined) {
      const ids = (patch.blockedByTaskIds as string[]).filter(Boolean);
      next.blockedByTaskIds = ids.length > 0 ? [...new Set(ids)].sort() : undefined;
    }
    if (patch.runtime) next.runtime = { ...(current.runtime || {}), ...(patch.runtime as object) } as Task['runtime'];
    return { success: true, task: next };
  });
}

/**
 * 启动一次后暂停调度，并模拟真实启动的可见效果：
 * 任务进入 executing、账号忙、自动化状态进入 injecting，停止后续调度。
 */
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

describe('DOUBAO-STATUS-DOWNLOAD-CLOSEOUT-01 R1', () => {
  beforeEach(() => {
    globalMocks.window = {
      electronAPI: {
        tasks: {
          list: vi.fn(),
          updateRuntime: defaultUpdateRuntime(),
          acquireLock: vi.fn(async () => ({ success: true })),
          renewLock: vi.fn(async () => ({ success: true })),
          setQualityVerdict: vi.fn(),
        },
        accounts: {
          setStatus: vi.fn(async () => ({ success: true })),
          updateHealth: vi.fn(async () => ({ success: true })),
          updateSeedanceQuota: vi.fn(async () => ({ success: true })),
        },
        logs: { append: vi.fn(async () => ({})) },
      },
      dispatchEvent: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };
    globalMocks.localStorage = { getItem: vi.fn(() => null), setItem: vi.fn() };
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
      processQueue: actualProcessQueue, startAutomation: actualStartAutomation, updateTaskRuntime: actualUpdateTaskRuntime,
    });
  });

  afterEach(async () => {
    // automationEngine 是模块级单例：释放本用例残留的预约，避免用例之间互相污染。
    const releases = useTaskStore.getState().tasks.map((task) => automationEngine.release(task.id));
    await Promise.all(releases);
    vi.useRealTimers();
  });

  // ==================== P0-1 依赖写入竞态 ====================

  describe('P0-1 依赖写入竞态', () => {
    it('阻断写入失败时保持排队原状态，界面不伪报失败', async () => {
      const blocked = { ...baseTask('blocked', 'acc-1', '2026-09-11T22:00:00.000Z'), dependsOnTaskIds: ['missing'] };
      const start = vi.fn<(taskId: string) => Promise<boolean>>(async () => true);
      useTaskStore.setState({ tasks: [blocked], startAutomation: start });
      globalMocks.window.electronAPI.tasks.updateRuntime.mockResolvedValueOnce({ success: false, error: '磁盘写入失败' });

      await useTaskStore.getState().processQueue();

      const current = useTaskStore.getState().tasks.find((task) => task.id === 'blocked');
      expect(current?.status).toBe('queued');
      expect(current?.blockedByTaskIds).toBeUndefined();
      expect(current?.errorInfo).toBeUndefined();
      expect(current?.result).toBeNull();
      expect(useTaskStore.getState().error).toBe('磁盘写入失败');
      expect(start).not.toHaveBeenCalled();
    });

    it('阻断写入回读漂移时保持原状态且不启动任务', async () => {
      const blocked = { ...baseTask('drift', 'acc-1', '2026-09-11T22:00:00.000Z'), dependsOnTaskIds: ['missing'] };
      const start = vi.fn<(taskId: string) => Promise<boolean>>(async () => true);
      useTaskStore.setState({ tasks: [blocked], startAutomation: start });
      // 主进程回读结果没有落地请求的 fail/errorInfo：属于并发漂移，必须 fail-closed。
      globalMocks.window.electronAPI.tasks.updateRuntime.mockResolvedValueOnce({
        success: true,
        task: { ...blocked, status: 'queued' },
      });

      await useTaskStore.getState().processQueue();

      const current = useTaskStore.getState().tasks.find((task) => task.id === 'drift');
      expect(current).toMatchObject({ status: 'queued' });
      expect(current?.errorInfo).toBeUndefined();
      expect(start).not.toHaveBeenCalled();
    });

    it('启动写入回读漂移时不占用账号、不更新界面状态', async () => {
      const ready = baseTask('start-drift', 'acc-1', '2026-09-11T22:00:00.000Z');
      const start = vi.fn<(taskId: string) => Promise<boolean>>(async () => true);
      useTaskStore.setState({ tasks: [ready], startAutomation: start });
      globalMocks.window.electronAPI.tasks.updateRuntime.mockImplementation(async (taskId: string, patch: Record<string, unknown>) => {
        const current = useTaskStore.getState().tasks.find((item) => item.id === taskId)!;
        // 状态写入成功但回读仍是 queued：模拟并发写入覆盖。
        return { success: true, task: { ...current, blockedByTaskIds: undefined, runtime: patch.runtime as Task['runtime'] } };
      });

      await useTaskStore.getState().processQueue();

      const current = useTaskStore.getState().tasks.find((task) => task.id === 'start-drift');
      expect(current).toMatchObject({ status: 'queued' });
      expect(useTaskStore.getState().accountBusy['acc-1']).toBeUndefined();
      expect(useTaskStore.getState().executingTasks['acc-1']).toBeUndefined();
    });

    it('blockedByTaskIds 清理失败时任务保持阻塞且不启动', async () => {
      const recovered = { ...baseTask('clear-fail', 'acc-1', '2026-09-11T22:00:00.000Z'), blockedByTaskIds: ['old-block'] };
      const start = vi.fn<(taskId: string) => Promise<boolean>>(async () => true);
      useTaskStore.setState({ tasks: [recovered], startAutomation: start });
      globalMocks.window.electronAPI.tasks.updateRuntime.mockResolvedValueOnce({ success: false, error: '清理写入失败' });

      await useTaskStore.getState().processQueue();

      const current = useTaskStore.getState().tasks.find((task) => task.id === 'clear-fail');
      expect(current).toMatchObject({ status: 'queued', blockedByTaskIds: ['old-block'] });
      expect(start).not.toHaveBeenCalled();
    });

    it('清理成功并回读一致后只启动一次', async () => {
      const recovered = { ...baseTask('clear-ok', 'acc-1', '2026-09-11T22:00:00.000Z'), blockedByTaskIds: ['old-block'] };
      const { mock: start, calls } = startOnce();
      useTaskStore.setState({ tasks: [recovered], startAutomation: start });

      await useTaskStore.getState().processQueue();

      // 清理写入一次（回读一致），随后只启动一次；任务不再残留阻断。
      const runtimeCalls = globalMocks.window.electronAPI.tasks.updateRuntime.mock.calls as Array<[string, Record<string, unknown>]>;
      expect(runtimeCalls.filter(([, patch]) => patch.blockedByTaskIds !== undefined).map(([, patch]) => patch.blockedByTaskIds))
        .toEqual([[]]);
      expect(calls).toEqual(['clear-ok']);
      expect(start).toHaveBeenCalledTimes(1);
      expect(useTaskStore.getState().tasks[0].blockedByTaskIds).toBeUndefined();
      expect(useTaskStore.getState().error).toBeNull();
    });

    it('清理与启动严格串行：清理写入完成前不发起启动写入', async () => {
      const recovered = { ...baseTask('serial', 'acc-1', '2026-09-11T22:00:00.000Z'), blockedByTaskIds: ['old-block'] };
      const order: string[] = [];
      let releaseClear = () => {};
      const clearGate = new Promise<void>((resolve) => { releaseClear = resolve; });
      globalMocks.window.electronAPI.tasks.updateRuntime.mockImplementation(async (taskId: string, patch: Record<string, unknown>) => {
        const current = useTaskStore.getState().tasks.find((item) => item.id === taskId)!;
        const next: Task = { ...current };
        if (patch.status) next.status = patch.status as Task['status'];
        if (patch.result !== undefined) next.result = patch.result as string | null;
        if (patch.errorInfo === null) next.errorInfo = undefined;
        if (patch.blockedByTaskIds !== undefined) {
          const ids = (patch.blockedByTaskIds as string[]).filter(Boolean);
          next.blockedByTaskIds = ids.length > 0 ? [...new Set(ids)].sort() : undefined;
        }
        if (patch.runtime) next.runtime = { ...(current.runtime || {}), ...(patch.runtime as object) } as Task['runtime'];
        const isStart = patch.status === 'executing';
        order.push(isStart ? 'start-write' : 'clear-write');
        // 清理写入挂起：此时不允许发生任何启动写入。
        if (!isStart) await clearGate;
        return { success: true, task: next };
      });
      const { mock: start, calls } = startOnce();
      // 统一时间线：清理写入、任何启动写入、启动调用按发生顺序记录。
      const startWriteMock = start;
      useTaskStore.setState({
        tasks: [recovered],
        startAutomation: vi.fn(async (taskId: string) => {
          order.push('start-call');
          return startWriteMock(taskId);
        }),
      });

      const queue = useTaskStore.getState().processQueue();
      await new Promise((resolve) => setTimeout(resolve, 0));

      // 清理写入仍未返回：不得发生任何启动写入或启动调用。
      expect(order).toEqual(['clear-write']);
      expect(calls).toEqual([]);
      expect(useTaskStore.getState().tasks[0]).toMatchObject({ status: 'queued', blockedByTaskIds: ['old-block'] });

      releaseClear();
      await queue;

      // 清理完成后才发生启动调用，整个过程中没有第二条写入与清理并发。
      expect(order).toEqual(['clear-write', 'start-call']);
      expect(calls).toEqual(['serial']);
      expect(useTaskStore.getState().error).toBeNull();
    });
  });

  // ==================== P0-2 依赖错误边界 ====================

  describe('P0-2 依赖错误不进入重试与统计', () => {
    const dependencyTasks = (): Task[] => [
      { ...baseTask('dep-failed', 'acc-1', '2026-09-11T22:00:00.000Z'), status: 'fail', errorInfo: { code: 'dependency_failed', message: '前置失败', recoverable: false, detectedAt: NOW }, blockedByTaskIds: ['upstream'] },
      { ...baseTask('dep-missing', 'acc-1', '2026-09-11T22:01:00.000Z'), status: 'fail', errorInfo: { code: 'dependency_missing', message: '依赖缺失', recoverable: false, detectedAt: NOW }, blockedByTaskIds: ['ghost'] },
      { ...baseTask('dep-cycle', 'acc-1', '2026-09-11T22:02:00.000Z'), status: 'fail', errorInfo: { code: 'dependency_cycle', message: '循环依赖', recoverable: false, detectedAt: NOW }, blockedByTaskIds: ['a', 'b'] },
    ];

    it('三种依赖错误都不计入平台成功率与失败率', () => {
      const tasks: Task[] = [
        ...dependencyTasks(),
        { ...baseTask('ok', 'acc-1', '2026-09-11T22:03:00.000Z'), status: 'done' },
        { ...baseTask('real-fail', 'acc-1', '2026-09-11T22:04:00.000Z'), status: 'fail', errorInfo: { code: 'generation_failed', message: '生成失败', recoverable: true, detectedAt: NOW } },
      ];
      const stats = getPlatformTaskStats(tasks);
      expect(stats).toMatchObject({ succeeded: 1, platformFailed: 1, dependencyBlocked: 3 });
      // 1 成功 / (1 成功 + 1 普通失败) = 50%，依赖阻断不参与分子分母
      expect(stats.successRate).toBe(50);
      expect(calculatePlatformSuccessRate(tasks)).toBe(50);

      const onlyDependency = getPlatformTaskStats(dependencyTasks());
      expect(onlyDependency).toMatchObject({ succeeded: 0, platformFailed: 0, dependencyBlocked: 3 });
      expect(onlyDependency.successRate).toBe(0);
    });

    it('三种依赖错误都会被识别为依赖阻断任务', () => {
      for (const task of dependencyTasks()) {
        expect(isDependencyBlockedTask(task)).toBe(true);
      }
      expect(isDependencyBlockedTask({ ...baseTask('x', 'acc-1', NOW), status: 'fail', errorInfo: { code: 'generation_failed', message: 'x', recoverable: true, detectedAt: NOW } })).toBe(false);
    });

    it('TaskService.retry 拒绝三种依赖错误，不重新入队', () => {
      let data = dependencyTasks();
      const service = new TaskService({
        store: { read: () => structuredClone(data), replace: (tasks) => { data = tasks; return true; } },
        defaultProjectId: () => 'default-project', id: () => 'id-1', now: () => NOW,
      });
      for (const task of dependencyTasks()) {
        expect(service.retry(task.id)).toEqual({ success: false, error: '依赖阻断错误不能直接重试，请先修复依赖关系' });
      }
      expect(data.every((task) => task.status === 'fail')).toBe(true);
      expect(data.every((task) => task.blockedByTaskIds!.length > 0)).toBe(true);
    });

    it('依赖阻断不触发账号失败、健康冷却或额度消耗', async () => {
      const blocked = { ...baseTask('blocked', 'acc-1', '2026-09-11T22:00:00.000Z'), dependsOnTaskIds: ['missing'] };
      useTaskStore.setState({ tasks: [blocked], startAutomation: vi.fn(async () => true) });

      await useTaskStore.getState().processQueue();

      expect(useAccountStore.getState().recordAccountOutcome).not.toHaveBeenCalled();
      expect(useAccountStore.getState().markSeedanceExhausted).not.toHaveBeenCalled();
      expect(useAccountStore.getState().recordSeedanceUsage).not.toHaveBeenCalled();
      expect(globalMocks.window.electronAPI.accounts.updateHealth).not.toHaveBeenCalled();
      expect(globalMocks.window.electronAPI.accounts.updateSeedanceQuota).not.toHaveBeenCalled();
    });

    it('依赖错误恢复后重试会清空历史阻断证据', () => {
      let data: Task[] = [
        { ...baseTask('dep', 'acc-1', '2026-09-11T22:00:00.000Z'), status: 'fail', errorInfo: { code: 'generation_failed', message: '生成失败', recoverable: true, detectedAt: NOW }, blockedByTaskIds: ['old'] },
      ];
      const service = new TaskService({
        store: { read: () => structuredClone(data), replace: (tasks) => { data = tasks; return true; } },
        defaultProjectId: () => 'default-project', id: () => 'id-1', now: () => NOW,
      });
      expect(service.retry('dep').success).toBe(true);
      expect(data[0]).toMatchObject({ status: 'queued' });
      expect(data[0].blockedByTaskIds).toBeUndefined();
      expect(data[0].errorInfo).toBeUndefined();
    });
  });

  // ==================== P0-3 下载选择与跨批次 ====================

  describe('P0-3 下载选择实时读数与跨批次 fail-closed', () => {
    const outputs = buildBatchDownloadPayload([
      { ...baseTask('t1', 'acc-1', NOW), status: 'done', outputs: ['u1', 'u2'], batchId: 'batch-1' },
      { ...baseTask('t2', 'acc-1', NOW), status: 'done', outputs: ['u3'], batchId: 'batch-1' },
    ], 'default-project', '项目一', 'batch-1').outputs;

    it('打开预览默认全不选，读数与按钮均为零', () => {
      const selection = createInitialOutputSelection();
      expect([...selection]).toEqual([]);
      const readout = readDownloadSelection([]);
      expect(readout).toMatchObject({ taskCount: 0, artifactCount: 0, projectCount: 0, batchCount: 0, downloadEnabled: false });
      expect(createDownloadIntent([], 'confirm')).toBeNull();
    });

    it('选择变化后任务数、产物数、项目数、批次数实时准确', () => {
      expect(readDownloadSelection([outputs[0]]))
        .toMatchObject({ taskCount: 1, artifactCount: 2, projectCount: 1, batchCount: 1, downloadEnabled: true });
      expect(readDownloadSelection(outputs))
        .toMatchObject({ taskCount: 2, artifactCount: 3, projectCount: 1, batchCount: 1, downloadEnabled: true });
      expect(readDownloadSelection([outputs[1]]))
        .toMatchObject({ taskCount: 1, artifactCount: 1, projectCount: 1, batchCount: 1, downloadEnabled: true });
    });

    it('确认下载返回真实选中范围，而不是批次静态总数', () => {
      const intent = createDownloadIntent([outputs[1]], 'confirm');
      expect(intent).not.toBeNull();
      expect(intent!.taskCount).toBe(1);
      expect(intent!.artifactCount).toBe(1);
      expect(intent!.outputs.map((item) => item.taskId)).toEqual(['t2']);
    });

    it('取消确认时零下载调用', () => {
      expect(createDownloadIntent(outputs, 'cancel')).toBeNull();
    });

    it('跨批次或跨项目输入整体 fail-closed，零下载调用', () => {
      const crossBatch = [
        { ...outputs[0], batchId: 'batch-1' },
        { ...outputs[1], batchId: 'batch-2' },
      ];
      const crossProject = [
        { ...outputs[0], projectId: 'p1' },
        { ...outputs[1], projectId: 'p2' },
      ];
      for (const selection of [crossBatch, crossProject] as Array<typeof crossBatch>) {
        const request = buildBatchDownloadRequest(selection);
        expect(request.ok).toBe(false);
        expect(request.outputs).toEqual([]);
        expect(request.error).toContain('不支持跨批次');
        expect(createDownloadIntent(selection, 'confirm')).toBeNull();
      }
    });

    it('单项目单批次内多任务选择仍然放行', () => {
      const request = buildBatchDownloadRequest(outputs);
      expect(request).toMatchObject({ ok: true, taskCount: 2, artifactCount: 3, projectCount: 1, batchCount: 1 });
    });

    it('候选只来自当前项目当前批次，不包含其他项目、批次或历史任务', () => {
      const tasks: Task[] = [
        { ...baseTask('same', 'acc-1', NOW), status: 'done', outputs: ['u'], batchId: 'batch-1' },
        { ...baseTask('other-batch', 'acc-1', NOW), status: 'done', outputs: ['u'], batchId: 'batch-2' },
        { ...baseTask('other-project', 'acc-1', NOW), status: 'done', outputs: ['u'], batchId: 'batch-1', projectId: 'p2' },
        { ...baseTask('no-batch', 'acc-1', NOW), status: 'done', outputs: ['u'] },
      ];
      const payload = buildBatchDownloadPayload(tasks, 'default-project', '项目一', 'batch-1');
      expect(payload.outputs.map((item) => item.taskId)).toEqual(['same']);
    });
  });

  // ==================== v2.3.7 受保护行为回归 ====================

  describe('v2.3.7 受保护行为不回归', () => {
    /** 前置 waiting_generation_confirmation + 有效受理绑定 */
    function confirmingPredecessor(): Task {
      return {
        ...baseTask('confirming', 'acc-1', '2026-09-11T22:00:00.000Z'),
        status: 'waiting_generation_confirmation',
        runtime: {
          runId: 'run-confirming', attempt: 1, stage: 'waiting_generation_confirmation', message: '等待人工确认',
          startedAt: NOW, stageStartedAt: NOW, lastHeartbeatAt: NOW,
          conversationUrl: 'https://www.doubao.com/chat/1',
          acceptanceObservation: {
            schemaVersion: 1, accountId: 'acc-1', runId: 'run-confirming', conversationUrl: 'https://www.doubao.com/chat/1',
            acceptedAt: NOW, evidence: { kind: 'generation_started' }, cursor: { messageCount: 1, pollCount: 0 },
            expectedArtifact: { kind: 'video', runId: 'run-confirming' },
            lease: { ownerId: 'o', acquiredAt: NOW, expiresAt: NOW, lastHeartbeatAt: NOW }, outcome: 'observing',
          },
          input: { prompt: 'confirming', mode: 'video', attachments: [] },
        },
      };
    }

    it('前置 waiting_generation_confirmation 且绑定有效：不同账号放行、同账号阻塞', async () => {
      const predecessor = confirmingPredecessor();
      const sameAccount = {
        ...baseTask('same-account', 'acc-1', '2026-09-11T22:10:00.000Z'),
        dependsOnTaskIds: ['confirming'], dependencyPolicy: 'all_accepted' as const,
      };
      const crossAccount = {
        ...baseTask('cross-account', 'acc-2', '2026-09-11T22:20:00.000Z'),
        dependsOnTaskIds: ['confirming'], dependencyPolicy: 'all_accepted' as const,
      };
      const { mock: start, calls } = startOnce();
      useTaskStore.setState({ tasks: [predecessor, sameAccount, crossAccount], startAutomation: start });

      await useTaskStore.getState().processQueue();

      expect(calls).toEqual(['cross-account']);
      expect(calls).not.toContain('same-account');
    });

    it('同账号 observing 后继保持阻塞，跨账号 all_accepted 后继自动放行', async () => {
      const observing = confirmingPredecessor();
      const sameAccount = {
        ...baseTask('same-obs', 'acc-1', '2026-09-11T22:30:00.000Z'),
        dependsOnTaskIds: ['confirming'], dependencyPolicy: 'all_accepted' as const,
      };
      const crossAccount = {
        ...baseTask('cross-obs', 'acc-2', '2026-09-11T22:40:00.000Z'),
        dependsOnTaskIds: ['confirming'], dependencyPolicy: 'all_accepted' as const,
      };
      const started: string[] = [];
      useTaskStore.setState({
        tasks: [observing, sameAccount, crossAccount],
        startAutomation: vi.fn(async (taskId: string) => {
          started.push(taskId);
          useTaskStore.setState((state) => {
            const accountId = state.tasks.find((task) => task.id === taskId)?.assignedAccountId || 'unknown';
            return {
              accountAutomationState: { ...state.accountAutomationState, [accountId]: 'injecting' },
              executingTasks: { ...state.executingTasks, [accountId]: taskId },
              accountBusy: { ...state.accountBusy, [accountId]: true },
            };
          });
          return true;
        }),
      });

      await useTaskStore.getState().processQueue();

      // 同账号存在 observing 绑定时必须先跳过；跨账号后继可放行。
      expect(started).toEqual(['cross-obs']);
      expect(started).not.toContain('same-obs');
      expect(useTaskStore.getState().tasks.find((task) => task.id === 'same-obs')).toMatchObject({ status: 'queued' });
      expect(useTaskStore.getState().tasks.find((task) => task.id === 'same-obs')?.errorInfo).toBeUndefined();
    });

    it('依赖错误前缀任务合法等待时不进入失败，也不计账号失败', async () => {
      const pending = { ...baseTask('pending-dep', 'acc-1', '2026-09-11T22:00:00.000Z'), status: 'executing' as const };
      const waiting = {
        ...baseTask('waiting', 'acc-2', '2026-09-11T22:10:00.000Z'),
        dependsOnTaskIds: ['pending-dep'], dependencyPolicy: 'all_accepted' as const,
      };
      useTaskStore.setState({ tasks: [pending, waiting], startAutomation: vi.fn(async () => true) });

      await useTaskStore.getState().processQueue();

      expect(useTaskStore.getState().tasks.find((task) => task.id === 'waiting')).toMatchObject({ status: 'queued' });
      expect(useTaskStore.getState().tasks.find((task) => task.id === 'waiting')?.errorInfo).toBeUndefined();
      expect(useAccountStore.getState().recordAccountOutcome).not.toHaveBeenCalled();
    });

    it('未授权/未指派任务不会因依赖变化被自动启动', async () => {
      const unassigned = baseTask('unassigned', null, '2026-09-11T22:00:00.000Z');
      const { mock: start, calls } = startOnce();
      useTaskStore.setState({ tasks: [unassigned], startAutomation: start });

      await useTaskStore.getState().processQueue();

      expect(calls).toEqual([]);
      expect(useTaskStore.getState().tasks[0]).toMatchObject({ status: 'queued' });
    });
  });
});
