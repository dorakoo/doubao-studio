import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Account, AccountAvailability, Task } from '../../src/types';
import { useAccountStore } from '../../src/store/useAccountStore';
import { useTaskStore } from '../../src/store/useTaskStore';

type MockFn = ReturnType<typeof vi.fn>;

interface MockWindow {
  electronAPI: {
    tasks: { list: MockFn; updateRuntime: MockFn; acquireLock: MockFn; renewLock: MockFn; setQualityVerdict: MockFn };
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

/** 模拟主进程落盘数据；由每个用例在 beforeEach 中重置，或用 seedTasks 播种 */
let persistedTasks: Task[] = [];

function account(id: string, availability: AccountAvailability['state'] = 'ready'): Account {
  return {
    id, name: id, platform: 'doubao', avatar: '', partition: `account_${id}`, status: 'idle', pinned: false,
    seedanceQuota: { date: '2026-09-12', usedUnits: 0, estimatedTotalUnits: 6, exhausted: false, updatedAt: NOW },
    health: {
      loginState: 'ok', verificationRequired: false, consecutiveFailures: 0, successCount: 0, failureCount: 0,
      availability: { state: availability, reason: availability === 'ready' ? 'ready' : 'startup_recheck_required', message: 'x', checkedAt: NOW, source: 'startup' },
    },
    scheduling: { enabled: true, weight: 1, preferredModes: [] },
    createdAt: NOW, updatedAt: NOW,
  };
}

function baseTask(id: string, assignedAccountId: string | null, createdAt: string): Task {
  return {
    id, prompt: id, assignedAccountId, status: 'queued', mode: 'video',
    // A：调度器只处理显式 armed；hold 任务由 holdTask 覆盖。
    executionIntent: 'armed',
    videoConfig: { model: 'seedance-2.0-fast', duration: '5s', aspectRatio: '16:9' },
    result: null, outputs: [], artifacts: [], runHistory: [], dependsOnTaskIds: [], dependencyPolicy: 'all_done',
    projectId: 'default-project', createdAt, updatedAt: NOW,
  };
}

/**
 * 断言写入补丁对任务的影响：与 store 的归一化保持一致，
 * 这样主进程回读结果才可能通过 Renderer 的一致校验。
 */
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

function holdTask(id: string, assignedAccountId: string | null, createdAt: string): Task {
  return { ...baseTask(id, assignedAccountId, createdAt), executionIntent: 'hold' } as Task;
}

function observingPredecessor(): Task {
  return {
    ...baseTask('predecessor', 'acc-1', '2026-09-11T22:00:00.000Z'),
    status: 'waiting_generation_confirmation',
    runtime: {
      runId: 'run-predecessor', attempt: 1, stage: 'waiting_generation_confirmation', message: 'waiting',
      startedAt: NOW, stageStartedAt: NOW, lastHeartbeatAt: NOW,
      conversationUrl: 'https://www.doubao.com/chat/1',
      acceptanceObservation: {
        schemaVersion: 1, accountId: 'acc-1', runId: 'run-predecessor', conversationUrl: 'https://www.doubao.com/chat/1',
        acceptedAt: NOW, evidence: { kind: 'generation_started' }, cursor: { messageCount: 1, pollCount: 0 },
        expectedArtifact: { kind: 'video', runId: 'run-predecessor' },
        lease: { ownerId: 'o', acquiredAt: NOW, expiresAt: NOW, lastHeartbeatAt: NOW }, outcome: 'observing',
      },
      input: { prompt: 'predecessor', mode: 'video', attachments: [] },
    },
  };
}

function stopAfterFirstStart() {
  return vi.fn<(taskId: string) => Promise<boolean>>(() => {
    useTaskStore.setState({ schedulerPaused: true });
    return Promise.resolve(true);
  });
}

describe('dependency queue behavior', () => {
  beforeEach(() => {
    globalMocks.window = {
      electronAPI: {
        tasks: {
          list: vi.fn(),
          // 模拟真实主进程：补丁作用在同一份落盘数据上，而不是 Renderer 的 store 快照。
          updateRuntime: vi.fn(async (taskId: string, patch: Record<string, unknown>) => {
            const current = persistedTasks.find((item) => item.id === taskId);
            if (!current) return { success: false, error: 'task not found' };
            const next = applyPatch(current, patch);
            persistedTasks = persistedTasks.map((item) => item.id === taskId ? next : item);
            return { success: true, task: next };
          }),
          acquireLock: vi.fn(async () => ({ success: true })),
          renewLock: vi.fn(async () => ({ success: true })),
          setQualityVerdict: vi.fn(),
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
      schedulerPaused: false, processQueue: actualProcessQueue, startAutomation: actualStartAutomation,
    });
  });

  /** 设定“落盘”任务：主进程回读与 Renderer store 使用同一初始数据 */
  function seedTasks(tasks: Task[]): void {
    persistedTasks = structuredClone(tasks);
    useTaskStore.setState({ tasks: structuredClone(tasks) });
  }

  afterEach(() => {
    vi.useRealTimers();
  });

  it('startup load releases cross-account all_accepted, blocks same-account, skips hold', async () => {
    const predecessor = observingPredecessor();
    const sameAccount = { ...baseTask('same-account', 'acc-1', '2026-09-11T22:10:00.000Z'), dependsOnTaskIds: ['predecessor'], dependencyPolicy: 'all_accepted' as const };
    const crossAccount = { ...baseTask('cross-account', 'acc-2', '2026-09-11T22:20:00.000Z'), dependsOnTaskIds: ['predecessor'], dependencyPolicy: 'all_accepted' as const };
    const hold = holdTask('hold', 'acc-2', '2026-09-11T22:30:00.000Z');
    globalMocks.window.electronAPI.tasks.list.mockResolvedValue([predecessor, sameAccount, crossAccount, hold]);

    await useTaskStore.getState().loadTasks(true);
    const startAutomation = stopAfterFirstStart();
    useTaskStore.setState({ startAutomation });
    await useTaskStore.getState().processQueue();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(startAutomation).toHaveBeenCalledTimes(1);
    expect(startAutomation).toHaveBeenCalledWith('cross-account');
    expect(startAutomation).not.toHaveBeenCalledWith('same-account');
    expect(startAutomation).not.toHaveBeenCalledWith('hold');
  });

  it('writes precise dependency codes and never records account failure for blocked tasks', async () => {
    const missing = { ...baseTask('missing-task', 'acc-1', '2026-09-11T22:00:00.000Z'), dependsOnTaskIds: ['missing'] };
    const failedDep = { ...baseTask('failed-dep', 'acc-1', '2026-09-11T22:01:00.000Z'), status: 'fail' as const };
    const failedTask = { ...baseTask('failed-task', 'acc-1', '2026-09-11T22:02:00.000Z'), dependsOnTaskIds: ['failed-dep'], dependencyPolicy: 'all_done' as const };
    const cycleA = { ...baseTask('cycle-a', 'acc-1', '2026-09-11T22:03:00.000Z'), dependsOnTaskIds: ['cycle-b'] };
    const cycleB = { ...baseTask('cycle-b', 'acc-1', '2026-09-11T22:04:00.000Z'), dependsOnTaskIds: ['cycle-a'] };
    const hold = { ...holdTask('hold-blocked', 'acc-1', '2026-09-11T22:05:00.000Z'), dependsOnTaskIds: ['missing'] };
    const startAutomation = vi.fn<(taskId: string) => Promise<boolean>>(async () => true);
    seedTasks([missing, failedDep, failedTask, cycleA, cycleB, hold]);
    useTaskStore.setState({ startAutomation });

    await useTaskStore.getState().processQueue();

    const calls = globalMocks.window.electronAPI.tasks.updateRuntime.mock.calls as Array<[string, Record<string, unknown>]>;
    const byTask = new Map(calls.map(([taskId, patch]) => [taskId, patch]));
    // 依赖阻断保持 queued（写 fail 会让调度器与重试入口永久跳过它），只记录结构化原因。
    expect(byTask.get('missing-task')).toMatchObject({ status: 'queued', errorInfo: { code: 'dependency_missing' }, blockedByTaskIds: ['missing'] });
    expect(byTask.get('failed-task')).toMatchObject({ status: 'queued', errorInfo: { code: 'dependency_failed' }, blockedByTaskIds: ['failed-dep'] });
    expect(byTask.get('cycle-a')).toMatchObject({ status: 'queued', errorInfo: { code: 'dependency_cycle' }, blockedByTaskIds: ['cycle-a', 'cycle-b'] });
    expect(byTask.get('cycle-b')).toMatchObject({ status: 'queued', errorInfo: { code: 'dependency_cycle' }, blockedByTaskIds: ['cycle-a', 'cycle-b'] });
    expect(byTask.has('hold-blocked')).toBe(false);
    expect(startAutomation).not.toHaveBeenCalled();
    expect(useAccountStore.getState().recordAccountOutcome).not.toHaveBeenCalled();
    expect(useAccountStore.getState().markSeedanceExhausted).not.toHaveBeenCalled();
    expect(useAccountStore.getState().recordSeedanceUsage).not.toHaveBeenCalled();
    // 阻断任务不会被写成 fail，因此既不会进入平台失败统计，也不会被重试门禁永久拒绝。
    // 注意：failed-dep 是前置任务自身的历史失败，不属于本次阻断写入。
    const blockedIds = ['missing-task', 'failed-task', 'cycle-a', 'cycle-b'];
    for (const id of blockedIds) {
      const blockedTask = useTaskStore.getState().tasks.find((task) => task.id === id);
      expect(blockedTask).toMatchObject({ status: 'queued' });
      expect(blockedTask?.errorInfo?.code?.startsWith('dependency_')).toBe(true);
    }
    expect(useTaskStore.getState().tasks.filter((task) => task.id !== 'failed-dep' && task.status === 'fail')).toEqual([]);
  });

  it('clears stale blockedByTaskIds and returns to queued before starting a recovered ready task', async () => {
    const recovered = { ...baseTask('recovered', 'acc-1', '2026-09-11T22:00:00.000Z'), blockedByTaskIds: ['old-block'] };
    const startAutomation = stopAfterFirstStart();
    seedTasks([recovered]);
    useTaskStore.setState({ startAutomation });

    await useTaskStore.getState().processQueue();

    // 恢复必须在一次写入里原子转回 queued、清除阻断与历史结构化错误。
    expect(globalMocks.window.electronAPI.tasks.updateRuntime).toHaveBeenCalledWith('recovered', {
      status: 'queued',
      result: '',
      errorInfo: null,
      blockedByTaskIds: [],
    });
    expect(startAutomation).toHaveBeenCalledWith('recovered');
  });

  it('quality verdict writes do not trigger queue, automation, retry or quota/account updates', async () => {
    const task = baseTask('quality', 'acc-1', '2026-09-11T22:00:00.000Z');
    const verdictTask = { ...task, qualityVerdict: { status: 'accepted' as const, decidedAt: NOW } };
    globalMocks.window.electronAPI.tasks.setQualityVerdict.mockResolvedValue({ success: true, task: verdictTask });
    const processQueue = vi.fn<() => Promise<void>>();
    const startAutomation = vi.fn<(taskId: string) => Promise<boolean>>(async () => true);
    seedTasks([task]);
    useTaskStore.setState({ processQueue, startAutomation });

    await expect(useTaskStore.getState().setQualityVerdict('quality', 'accepted')).resolves.toBe(true);

    expect(processQueue).not.toHaveBeenCalled();
    expect(startAutomation).not.toHaveBeenCalled();
    expect(useAccountStore.getState().recordAccountOutcome).not.toHaveBeenCalled();
    expect(useAccountStore.getState().recordSeedanceUsage).not.toHaveBeenCalled();
    expect(useAccountStore.getState().markSeedanceExhausted).not.toHaveBeenCalled();
  });

  it('dependency persistence failure keeps task queued and never starts', async () => {
    const blocked = { ...baseTask('blocked-persist', 'acc-1', '2026-09-11T22:00:00.000Z'), dependsOnTaskIds: ['missing'] };
    const startAutomation = vi.fn<(taskId: string) => Promise<boolean>>(async () => true);
    seedTasks([blocked]);
    useTaskStore.setState({ startAutomation });
    globalMocks.window.electronAPI.tasks.updateRuntime.mockResolvedValueOnce({ success: false, error: 'write failed' });

    await useTaskStore.getState().processQueue();

    const current = useTaskStore.getState().tasks.find((task) => task.id === 'blocked-persist');
    expect(current).toMatchObject({ status: 'queued' });
    expect(current?.errorInfo).toBeUndefined();
    expect(startAutomation).not.toHaveBeenCalled();
  });

  it('blockedByTaskIds clear failure keeps task queued and never starts', async () => {
    const recovered = { ...baseTask('clear-persist', 'acc-1', '2026-09-11T22:00:00.000Z'), blockedByTaskIds: ['old-block'] };
    const startAutomation = vi.fn<(taskId: string) => Promise<boolean>>(async () => true);
    seedTasks([recovered]);
    useTaskStore.setState({ startAutomation });
    globalMocks.window.electronAPI.tasks.updateRuntime.mockResolvedValueOnce({ success: false, error: 'clear failed' });

    await useTaskStore.getState().processQueue();

    const current = useTaskStore.getState().tasks.find((task) => task.id === 'clear-persist');
    expect(current).toMatchObject({ status: 'queued', blockedByTaskIds: ['old-block'] });
    expect(startAutomation).not.toHaveBeenCalled();
  });

  it('availability unknown uses bounded backoff and starts only non-hold once ready', async () => {
    vi.useFakeTimers();
    useAccountStore.setState({
      accounts: [account('acc-x', 'unknown')],
      selectedAccountId: 'acc-x',
      requestAvailabilityCheck: vi.fn(),
    });
    const hold = holdTask('hold', 'acc-x', '2026-09-11T22:00:00.000Z');
    const ready = baseTask('ready', 'acc-x', '2026-09-11T22:10:00.000Z');
    const startAutomation = stopAfterFirstStart();
    seedTasks([hold, ready]);
    useTaskStore.setState({ startAutomation });

    await useTaskStore.getState().processQueue();
    const requestAvailabilityCheck = useAccountStore.getState().requestAvailabilityCheck as unknown as MockFn;
    expect(startAutomation).not.toHaveBeenCalled();
    expect(requestAvailabilityCheck).toHaveBeenCalledTimes(1);

    for (let i = 0; i < 40; i += 1) {
      await vi.advanceTimersByTimeAsync(31_000);
    }
    expect(requestAvailabilityCheck.mock.calls.length).toBe(30);

    useAccountStore.setState({ accounts: [account('acc-x', 'ready')] });
    await useTaskStore.getState().processQueue();

    expect(startAutomation).toHaveBeenCalledTimes(1);
    expect(startAutomation).toHaveBeenCalledWith('ready');
    expect(startAutomation).not.toHaveBeenCalledWith('hold');
  });
});
