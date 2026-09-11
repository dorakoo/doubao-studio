import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Account, AccountAvailability, Task } from '../../src/types';
import { useAccountStore } from '../../src/store/useAccountStore';
import { useTaskStore } from '../../src/store/useTaskStore';

type MockFn = ReturnType<typeof vi.fn>;

interface MockTaskApi {
  list: MockFn;
  assign: MockFn;
  updateRuntime: MockFn;
  acquireLock: MockFn;
  renewLock: MockFn;
  releaseLock: MockFn;
}

interface MockWindow {
  electronAPI: {
    tasks: MockTaskApi;
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
const NOW = '2026-09-11T00:00:00.000Z';

function account(id: string, name: string, availability: AccountAvailability['state'] = 'ready'): Account {
  return {
    id, name, platform: 'doubao', avatar: '', partition: `account_${id}`, status: 'idle', pinned: false,
    seedanceQuota: { date: '2026-09-11', usedUnits: 0, estimatedTotalUnits: 6, exhausted: false, updatedAt: NOW },
    health: {
      loginState: 'ok', verificationRequired: false, consecutiveFailures: 0, successCount: 0, failureCount: 0,
      availability: { state: availability, reason: availability === 'ready' ? 'ready' : 'startup_recheck_required', message: 'x', checkedAt: NOW, source: 'startup' },
    },
    scheduling: { enabled: true, weight: 1, preferredModes: [] },
    createdAt: NOW, updatedAt: NOW,
  };
}

function queuedTask(id: string, accountId: string | null, intent: Task['executionIntent'], createdAt: string): Task {
  return {
    id, prompt: id, assignedAccountId: accountId, status: 'queued', mode: 'video',
    executionIntent: intent,
    videoConfig: { model: 'seedance-2.0-fast', duration: '5s', aspectRatio: '16:9' },
    result: null, outputs: [], artifacts: [], runHistory: [], dependsOnTaskIds: [], dependencyPolicy: 'all_done',
    projectId: 'default-project', createdAt, updatedAt: NOW,
  };
}

function observingTask(id: string, accountId: string): Task {
  return {
    ...queuedTask(id, accountId, 'armed', '2026-09-10T23:00:00.000Z'),
    status: 'waiting_generation_confirmation',
    runtime: {
      runId: 'run-observing', attempt: 1, stage: 'waiting_generation_confirmation', message: 'waiting',
      startedAt: NOW, stageStartedAt: NOW, lastHeartbeatAt: NOW,
      acceptanceObservation: {
        schemaVersion: 1, accountId, runId: 'run-observing', conversationUrl: 'https://www.doubao.com/chat/1',
        acceptedAt: NOW, evidence: { kind: 'generation_started' }, cursor: { messageCount: 1, pollCount: 0 },
        expectedArtifact: { kind: 'video', runId: 'run-observing' },
        lease: { ownerId: 'owner', acquiredAt: NOW, expiresAt: NOW, lastHeartbeatAt: NOW },
        outcome: 'observing',
      },
      input: { prompt: id, mode: 'video', attachments: [] },
    },
  };
}

function stopAfterFirstStart() {
  return vi.fn<(taskId: string) => Promise<boolean>>(() => {
    useTaskStore.setState({ schedulerPaused: true });
    return Promise.resolve(true);
  });
}

describe('execution intent safety behavior', () => {
  beforeEach(() => {
    globalMocks.window = {
      electronAPI: {
        tasks: {
          list: vi.fn(),
          assign: vi.fn(),
          updateRuntime: vi.fn(),
          acquireLock: vi.fn(async () => ({ success: true })),
          renewLock: vi.fn(async () => ({ success: true })),
          releaseLock: vi.fn(async () => ({ success: true })),
        },
        logs: { append: vi.fn(async () => ({})) },
      },
      dispatchEvent: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };
    globalMocks.localStorage = { getItem: vi.fn(() => null), setItem: vi.fn() };
    useAccountStore.setState({ accounts: [account('acc-1', 'A'), account('acc-2', 'B')], selectedAccountId: 'acc-1' });
    useTaskStore.setState({
      tasks: [], executingTasks: {}, accountBusy: {}, accountAutomationState: {}, accountAutoMessage: {},
      schedulerPaused: false, processQueue: actualProcessQueue, startAutomation: actualStartAutomation,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('assignTask only persists assignment and never triggers queue or automation', async () => {
    const assignedTask = queuedTask('task-1', 'acc-1', 'hold', NOW);
    globalMocks.window.electronAPI.tasks.assign.mockResolvedValue({ success: true, task: assignedTask });
    const processQueue = vi.fn<() => void>();
    const startAutomation = stopAfterFirstStart();
    useTaskStore.setState({ tasks: [queuedTask('task-1', null, 'hold', NOW)], processQueue, startAutomation });

    await expect(useTaskStore.getState().assignTask('task-1', 'acc-1')).resolves.toBe(true);

    expect(globalMocks.window.electronAPI.tasks.assign).toHaveBeenCalledWith('task-1', 'acc-1');
    expect(processQueue).not.toHaveBeenCalled();
    expect(startAutomation).not.toHaveBeenCalled();
    expect(useTaskStore.getState().tasks[0].executionIntent).toBe('hold');
  });

  it('armTasks persists armed and explicitly schedules the queue', async () => {
    const task = queuedTask('task-1', 'acc-1', 'hold', NOW);
    const armed = { ...task, executionIntent: 'armed' as const };
    globalMocks.window.electronAPI.tasks.updateRuntime.mockResolvedValue({ success: true, task: armed });
    const processQueue = vi.fn<() => void>();
    useTaskStore.setState({ tasks: [task], processQueue });

    await expect(useTaskStore.getState().armTasks(['task-1'])).resolves.toEqual({ armed: 1, failed: 0 });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(globalMocks.window.electronAPI.tasks.updateRuntime).toHaveBeenCalledWith('task-1', { executionIntent: 'armed' });
    expect(useTaskStore.getState().tasks[0].executionIntent).toBe('armed');
    expect(processQueue).toHaveBeenCalledTimes(1);
  });

  it('startAutomation keeps hold when arming persistence fails', async () => {
    const task = queuedTask('task-1', 'acc-1', 'hold', NOW);
    globalMocks.window.electronAPI.tasks.updateRuntime.mockResolvedValue({ success: false, error: 'write failed' });
    useTaskStore.setState({ tasks: [task] });

    await expect(useTaskStore.getState().startAutomation('task-1')).resolves.toBe(false);
    expect(globalMocks.window.electronAPI.tasks.acquireLock).not.toHaveBeenCalled();
    expect(useTaskStore.getState().tasks[0]).toMatchObject({ status: 'queued', executionIntent: 'hold' });
  });

  it('startup load evaluation releases cross-account all_accepted but blocks same-account and hold', async () => {
    const predecessor = observingTask('predecessor', 'acc-1');
    const sameAccount = {
      ...queuedTask('same-account', 'acc-1', 'armed', '2026-09-10T22:10:00.000Z'),
      dependsOnTaskIds: ['predecessor'], dependencyPolicy: 'all_accepted' as const,
    };
    const crossAccount = {
      ...queuedTask('cross-account', 'acc-2', 'armed', '2026-09-10T22:20:00.000Z'),
      dependsOnTaskIds: ['predecessor'], dependencyPolicy: 'all_accepted' as const,
    };
    const hold = queuedTask('hold', 'acc-2', 'hold', '2026-09-10T22:30:00.000Z');
    globalMocks.window.electronAPI.tasks.list.mockResolvedValue([predecessor, sameAccount, crossAccount, hold]);

    await useTaskStore.getState().loadTasks(true);
    const startAutomation = stopAfterFirstStart();
    useTaskStore.setState({ startAutomation });
    useTaskStore.getState().processQueue();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(useTaskStore.getState().tasks).toHaveLength(4);
    expect(startAutomation).toHaveBeenCalledTimes(1);
    expect(startAutomation).toHaveBeenCalledWith('cross-account');
    expect(startAutomation).not.toHaveBeenCalledWith('same-account');
    expect(startAutomation).not.toHaveBeenCalledWith('hold');
  });

  it('processQueue starts only armed tasks and blocks same-account observing successors', async () => {
    const hold = queuedTask('hold', 'acc-1', 'hold', '2026-09-10T22:00:00.000Z');
    const sameAccount = queuedTask('same-account', 'acc-1', 'armed', '2026-09-10T22:10:00.000Z');
    const crossAccount = queuedTask('cross-account', 'acc-2', 'armed', '2026-09-10T22:20:00.000Z');
    const observing = observingTask('observing', 'acc-1');
    const startAutomation = stopAfterFirstStart();
    useTaskStore.setState({
      tasks: [hold, sameAccount, crossAccount, observing],
      startAutomation,
      accountBusy: {},
      accountAutomationState: {},
      schedulerPaused: false,
    });

    useTaskStore.getState().processQueue();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(startAutomation).toHaveBeenCalledTimes(1);
    expect(startAutomation).toHaveBeenCalledWith('cross-account');
    expect(startAutomation).not.toHaveBeenCalledWith('hold');
    expect(startAutomation).not.toHaveBeenCalledWith('same-account');
  });

  it('unknown availability uses bounded backoff and starts only armed tasks once ready', async () => {
    vi.useFakeTimers();
    useAccountStore.setState({
      accounts: [account('acc-x', 'X', 'unknown')],
      selectedAccountId: 'acc-x',
      requestAvailabilityCheck: vi.fn(),
    });
    const hold = queuedTask('hold', 'acc-x', 'hold', '2026-09-10T22:00:00.000Z');
    const armed = queuedTask('armed', 'acc-x', 'armed', '2026-09-10T22:10:00.000Z');
    const startAutomation = stopAfterFirstStart();
    useTaskStore.setState({ tasks: [hold, armed], startAutomation });

    useTaskStore.getState().processQueue();
    const requestAvailabilityCheck = useAccountStore.getState().requestAvailabilityCheck as unknown as MockFn;
    expect(startAutomation).not.toHaveBeenCalled();
    expect(requestAvailabilityCheck).toHaveBeenCalledTimes(1);

    for (let i = 0; i < 40; i += 1) {
      await vi.advanceTimersByTimeAsync(31_000);
    }
    expect(requestAvailabilityCheck.mock.calls.length).toBe(30);
    expect(startAutomation).not.toHaveBeenCalled();

    useAccountStore.setState({ accounts: [account('acc-x', 'X', 'ready')] });
    useTaskStore.getState().processQueue();

    expect(startAutomation).toHaveBeenCalledTimes(1);
    expect(startAutomation).toHaveBeenCalledWith('armed');
    expect(startAutomation).not.toHaveBeenCalledWith('hold');
  });
});
