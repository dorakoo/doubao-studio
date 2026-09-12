/**
 * src/store/useTaskStore.ts
 * 任务调度状态（Zustand） — V3 多账号并行 + 队列调度
 *
 * 改进：
 * - per-account 执行状态，不再全局单任务
 * - 账号忙时自动排队，空闲自动接下一个
 * - 不同账号的任务可以并行执行
 */

import { create } from 'zustand';
import type {
  Task,
  TaskStatus,
  GenerationMode,
  TaskUpdateInput,
  TaskErrorInfo,
  TaskRunSnapshot,
  TaskStage,
  TaskArtifact,
  TaskExecutionIntent,
  QualityRejectionTag,
} from '../types';
import { getAssignedAccountBlockReason } from '../utils/queueAccountDecision';
import { evaluateDependencies, isDependencyErrorCode } from '../utils/dependencyEval';
import { useAccountStore } from './useAccountStore';
import { automationEngine } from '../automation/AutomationEngine';
import { useProjectStore } from './useProjectStore';
import { findInteractiveAccountId } from '../utils/interactiveAccount';
import { completeAcceptedObservation, renewObservationLease, shouldResumeAcceptedObservation } from '../utils/acceptedObservation';

// 账号启动复检可能仍处于 unknown；队列遇到这种软阻断时不能永久停在那里。
// 只对已满足依赖的 queued 任务做有界退避复检，ready 后由现有调度继续。
const availabilityRetryAttempts = new Map<string, number>();
const availabilityRetryTimers = new Map<string, ReturnType<typeof setTimeout>>();

// 依赖阻断任务保持在 queued，因此仍会被队列扫描到。这里只保证在“没有其他调度触发”
// 的情况下也有一个有界的幂等重新评估机会，且同一时刻只排一个定时器。
/** 依赖前置可能在外部（其它窗口、CLI 或时间流逝）恢复，这里做固定周期复检。 */
export const dependencyRecheckDelayMs = 3_000;
let dependencyRecheckTimer: ReturnType<typeof setTimeout> | null = null;
let dependencyRecheckScheduled = false;

function scheduleDependencyRecheck(): void {
  if (dependencyRecheckScheduled) return;
  dependencyRecheckScheduled = true;
  dependencyRecheckTimer = setTimeout(() => {
    dependencyRecheckScheduled = false;
    dependencyRecheckTimer = null;
    void useTaskStore.getState().processQueue();
  }, dependencyRecheckDelayMs);
  const timer = dependencyRecheckTimer as unknown as { unref?: () => void };
  if (typeof timer.unref === 'function') timer.unref();
}


// ==================== 类型 ====================

/** 自动化执行状态 */
export type AutomationState = 'idle' | 'injecting' | 'submitting' | 'generating' | 'completed' | 'failed';

interface TaskState {
  /** 所有任务列表 */
  tasks: Task[];
  loading: boolean;
  error: string | null;
  schedulerPaused: boolean;

  // ---- V3: 多账号并行执行 ----
  /** 每个账号正在执行的任务 ID */
  executingTasks: Record<string, string>;
  /** 每个账号是否正在忙碌 */
  accountBusy: Record<string, boolean>;
  /** 每个账号的自动化阶段（用于 UI 显示） */
  accountAutomationState: Record<string, AutomationState>;
  /** 每个账号的自动化消息 */
  accountAutoMessage: Record<string, string>;

  // 向后兼容（活跃账号的 automation 状态）
  activeTaskId: string | null;
  automationState: AutomationState;

  // ---- Actions ----
  loadTasks: (recoverInterrupted?: boolean) => Promise<void>;
  addTasks: (text: string, mode?: GenerationMode, videoConfig?: Task['videoConfig'], attachments?: string[], audioAttachment?: string) => Promise<Task[] | null>;
  importCsv: (filePath?: string) => Promise<{ tasks: Task[]; imported: number; skipped: number; errors: string[] } | null>;
  assignTask: (taskId: string, accountId: string) => Promise<boolean>;
  /** 将指定任务显式置为 armed；用于 CSV 明确执行和批量启动。 */
  armTasks: (taskIds: string[]) => Promise<{ armed: number; failed: number; error?: string }>;
  updateTaskStatus: (taskId: string, status: TaskStatus, result?: string, outputs?: string[]) => Promise<boolean>;
  updateTask: (taskId: string, updates: TaskUpdateInput) => Promise<boolean>;
  setQualityVerdict: (taskId: string, status: 'accepted' | 'rejected', rejectionTags?: QualityRejectionTag[]) => Promise<boolean>;
  deleteTask: (taskId: string) => Promise<boolean>;
  retryTask: (taskId: string) => Promise<boolean>;
  batchPause: () => Promise<boolean>;
  resumeAll: () => Promise<boolean>;
  getCompletedOutputs: () => Promise<Array<{ taskId: string; prompt: string; outputs: string[]; accountId: string | null; mode: GenerationMode }>>;
  clearError: () => void;

  // V3 自动化方法
  startAutomation: (taskId: string) => Promise<boolean>;
  setAccountAutomationState: (accountId: string, state: AutomationState, message?: string, stage?: TaskStage) => void;
  updateTaskRuntime: (taskId: string, patch: {
    status?: TaskStatus;
    runtime?: Partial<TaskRunSnapshot>;
    errorInfo?: TaskErrorInfo | null;
    executionIntent?: TaskExecutionIntent;
    blockedByTaskIds?: string[];
    result?: string;
  }) => Promise<boolean>;
  completeAutomation: (taskId: string, accountId: string, resultUrl: string, outputs?: string[]) => Promise<void>;
  /** 持久化依赖阻断：写盘成功并回读一致后才更新界面，失败保持原状态 */
  markDependencyBlock: (
    taskId: string,
    block: { code: string; message: string; blockedByTaskIds: string[] },
  ) => Promise<boolean>;
  /** 依赖恢复后通过 Core/Repository 清除历史阻断；写失败返回 false 且保持原状态 */
  clearDependencyBlock: (taskId: string) => Promise<boolean>;
  pauseAutomation: (
    taskId: string,
    accountId: string,
    message?: string,
    options?: {
      status: 'paused' | 'cancelled' | 'waiting_verification' | 'waiting_generation_confirmation' | 'manual_submission_observing';
      code?: string;
      generationConfirmation?: NonNullable<TaskRunSnapshot['generationConfirmation']>;
    },
  ) => Promise<void>;
  failAutomation: (taskId: string, accountId: string, errorMsg: string, errorInfo?: TaskErrorInfo) => Promise<void>;

  /** 处理队列：检查待执行任务，分配到空闲账号 */
  processQueue: () => Promise<void>;
  /** 获取指定账号的下一个排队任务 */
  getNextTaskForAccount: (accountId: string) => Task | null;
}

const runtimePersistState = new Map<string, { stage?: TaskStage; savedAt: number }>();
let queueProcessing = false;

/** 判断任务是否处于依赖阻断态；只用于展示与重试门禁，不改变任务状态 */
export function isDependencyBlockedTask(task: Task | null | undefined): boolean {
  return isDependencyErrorCode(task?.errorInfo?.code);
}

/** 依赖阻断任务的统一用户可见文案 */
export function describeDependencyBlock(task: Task | null | undefined): string {
  const count = task?.blockedByTaskIds?.length || 0;
  const detail = count > 0 ? `（涉及 ${count} 个前置任务）` : '';
  switch (task?.errorInfo?.code) {
    case 'dependency_missing':
      return `依赖阻断：前置任务不存在，请检查工作流或 CSV${detail}`;
    case 'dependency_cycle':
      return `依赖阻断：存在自依赖或循环依赖${detail}`;
    default:
      return `依赖阻断：前置任务未成功，依赖恢复并重新评估后才会继续${detail}`;
  }
}

/** 依赖状态快照，用于序列化写入并检测并发漂移 */
interface DependencyStateSnapshot {
  status: TaskStatus;
  errorInfoCode: string | null | undefined;
  blockedByTaskIds: string[];
}

function dependencySnapshot(task: Task): DependencyStateSnapshot {
  return {
    status: task.status,
    errorInfoCode: task.errorInfo?.code,
    blockedByTaskIds: task.blockedByTaskIds || [],
  };
}

function dependenciesMatch(task: Task, expected: DependencyStateSnapshot): boolean {
  const actual = dependencySnapshot(task);
  if (actual.status !== expected.status) return false;
  if (actual.errorInfoCode !== expected.errorInfoCode) return false;
  if (actual.blockedByTaskIds.length !== expected.blockedByTaskIds.length) return false;
  return actual.blockedByTaskIds.every((id, index) => id === expected.blockedByTaskIds[index]);
}

function artifactId(url: string): string {
  let hash = 5381;
  for (let index = 0; index < url.length; index++) hash = ((hash << 5) + hash) ^ url.charCodeAt(index);
  return `artifact-${(hash >>> 0).toString(16)}`;
}

function mergeArtifacts(task: Task, outputs: string[], source: TaskArtifact['source'] = 'network'): TaskArtifact[] {
  const artifacts = new Map((task.artifacts || []).map((artifact) => [artifact.url, artifact]));
  for (const url of outputs.filter(Boolean)) {
    if (artifacts.has(url)) continue;
    artifacts.set(url, {
      id: artifactId(url),
      url,
      kind: task.mode === 'video' ? 'video' : task.mode === 'image' ? 'image' : 'file',
      source,
      runId: task.runtime?.runId,
      conversationUrl: task.runtime?.conversationUrl,
      discoveredAt: new Date().toISOString(),
    });
  }
  return [...artifacts.values()];
}

// evaluateDependencies 已抽取到 src/utils/dependencyEval.ts

// ==================== Store ====================

export const useTaskStore = create<TaskState>((set, get) => ({
  tasks: [],
  loading: false,
  error: null,
  schedulerPaused: false,
  executingTasks: {},
  accountBusy: {},
  accountAutomationState: {},
  accountAutoMessage: {},
  activeTaskId: null,
  automationState: 'idle',

  // ---- 基础操作 ----

  loadTasks: async (recoverInterrupted = false) => {
    set({ loading: true, error: null });
    try {
      let tasks = await window.electronAPI.tasks.list();
      if (recoverInterrupted) {
        const resumableObservations = tasks.filter(shouldResumeAcceptedObservation);
        for (const task of resumableObservations) {
          const now = new Date().toISOString();
          await window.electronAPI.tasks.updateRuntime(task.id, {
            status: 'manual_submission_observing',
            result: '应用界面重新载入，正在从原会话恢复只读产物观察',
            runtime: { stage: 'manual_submission_observing', message: '正在恢复只读产物观察', stageStartedAt: now, lastHeartbeatAt: now },
          });
          if (task.lock?.ownerId) await window.electronAPI.tasks.releaseLock(task.id, task.lock.ownerId);
        }
        const activeTasks = tasks.filter((task) =>
          ['executing', 'generating', 'waiting_verification'].includes(task.status) && !shouldResumeAcceptedObservation(task),
        );
        for (const task of activeTasks) {
          const now = new Date().toISOString();
          await window.electronAPI.tasks.updateRuntime(task.id, {
            status: 'paused',
            result: '应用界面重新载入，任务已安全暂停',
            errorInfo: { code: 'cancelled', message: '应用界面重新载入，任务已安全暂停', recoverable: true, detectedAt: now },
            runtime: task.runtime ? { stage: 'paused', message: '应用界面重新载入，任务已安全暂停', stageStartedAt: now, lastHeartbeatAt: now } : undefined,
          });
          if (task.lock?.ownerId) {
            await window.electronAPI.tasks.releaseLock(task.id, task.lock.ownerId);
          }
        }
        if (activeTasks.length > 0 || resumableObservations.length > 0) tasks = await window.electronAPI.tasks.list();
      }
      set({ tasks, loading: false, executingTasks: {}, accountBusy: {} });
    } catch (err: any) {
      set({ error: err.message, loading: false });
    }
  },

  addTasks: async (text: string, mode?: GenerationMode, videoConfig?: Task['videoConfig'], attachments?: string[], audioAttachment?: string) => {
    set({ error: null });
    const prompts = text
      .split('%%%%%%%%%%')
      .map((p) => p.trim())
      .filter((p) => p.length > 0);

    if (prompts.length === 0) {
      set({ error: '请输入至少一条提示词' });
      return null;
    }

    try {
      const result = await window.electronAPI.tasks.add(prompts, mode, videoConfig, attachments, audioAttachment, useProjectStore.getState().activeProjectId);
      if (result.success && result.tasks) {
        set({ tasks: [...get().tasks, ...result.tasks] });
        return result.tasks;
      } else {
        set({ error: result.error || '添加失败' });
        return null;
      }
    } catch (err: any) {
      set({ error: err.message });
      return null;
    }
  },

  assignTask: async (taskId: string, accountId: string) => {
    set({ error: null });
    try {
      const result = await window.electronAPI.tasks.assign(taskId, accountId);
      const assignedTask = result.task;
      if (result.success && assignedTask) {
        set({ tasks: get().tasks.map((task) => task.id === taskId ? assignedTask : task) });
        // 指派只改变账号绑定，不得触发队列、页面导航、提示词注入或平台请求。
        return true;
      }
      set({ error: result.error || '指派失败' });
      return false;
    } catch (err: any) {
      set({ error: err.message });
      return false;
    }
  },

  /** 显式执行授权：只持久化 executionIntent=armed，随后交给统一队列门禁。 */
  armTasks: async (taskIds: string[]) => {
    const ids = [...new Set(taskIds.filter(Boolean))];
    if (ids.length === 0) return { armed: 0, failed: 0 };
    const updated = new Map<string, Task>();
    const failures: string[] = [];
    for (const taskId of ids) {
      const result = await window.electronAPI.tasks.updateRuntime(taskId, { executionIntent: 'armed' });
      if (result.success && result.task) updated.set(taskId, result.task);
      else failures.push(result.error || taskId);
    }
    if (updated.size > 0) {
      set({ tasks: get().tasks.map((task) => updated.get(task.id) || task) });
      setTimeout(() => get().processQueue(), 0);
    }
    if (failures.length > 0) {
      set({ error: `部分任务启动授权失败：${failures.slice(0, 2).join('；')}` });
    }
    const failedReason = failures.length > 0 ? failures.slice(0, 2).join('；') : undefined;
    return failedReason
      ? { armed: updated.size, failed: failures.length, error: failedReason }
      : { armed: updated.size, failed: failures.length };
  },

  updateTaskStatus: async (taskId: string, status: TaskStatus, result?: string, outputs?: string[]) => {
    const persisted = await window.electronAPI.tasks.updateStatus(taskId, status, result, outputs);
    if (!persisted.success) {
      set({ error: persisted.error || '任务状态写入失败' });
      return false;
    }
    const tasks = get().tasks.map((t) =>
      t.id === taskId
        ? {
            ...t,
            status,
            result: result ?? t.result,
            outputs: outputs ?? t.outputs,
            artifacts: outputs ? mergeArtifacts(t, outputs, 'manual') : t.artifacts,
            updatedAt: new Date().toISOString(),
          }
        : t
    );
    set({ tasks });
    return true;
  },

  importCsv: async (filePath?: string) => {
    const result = await window.electronAPI.tasks.importCsv(useProjectStore.getState().activeProjectId, filePath);
    if (!result.success || !result.tasks) {
      if (result.error) set({ error: result.error });
      return null;
    }
    set({ tasks: [...get().tasks, ...result.tasks] });
    // CSV 导入只创建 hold 任务；只有 UI 明确勾选导入后执行时才调用 armTasks。
    return { tasks: result.tasks, imported: result.imported || result.tasks.length, skipped: result.skipped || 0, errors: result.errors || [] };
  },

  updateTask: async (taskId: string, updates: TaskUpdateInput) => {
    set({ error: null });
    try {
      const result = await window.electronAPI.tasks.update(taskId, updates);
      if (!result.success || !result.task) {
        set({ error: result.error || '编辑任务失败' });
        return false;
      }
      set({
        tasks: get().tasks.map((task) => task.id === taskId ? result.task! : task),
      });
      return true;
    } catch (err: any) {
      set({ error: err.message });
      return false;
    }
  },

  setQualityVerdict: async (taskId: string, status: 'accepted' | 'rejected', rejectionTags?: QualityRejectionTag[]) => {
    set({ error: null });
    try {
      const result = await window.electronAPI.tasks.setQualityVerdict(taskId, status, rejectionTags);
      const updatedTask = result.task;
      if (result.success && updatedTask) {
        set({ tasks: get().tasks.map((task) => task.id === taskId ? updatedTask : task) });
        return true;
      }
      set({ error: result.error || '人工质量裁决写入失败' });
      return false;
    } catch (err: any) {
      set({ error: err.message });
      return false;
    }
  },

  deleteTask: async (taskId: string) => {
    set({ error: null });
    try {
      const result = await window.electronAPI.tasks.delete(taskId);
      if (result.success) {
        const tasks = get().tasks.filter((t) => t.id !== taskId);
        set({ tasks });
        return true;
      } else {
        set({ error: result.error || '删除失败' });
        return false;
      }
    } catch (err: any) {
      set({ error: err.message });
      return false;
    }
  },

  retryTask: async (taskId: string) => {
    set({ error: null });
    try {
      const result = await window.electronAPI.tasks.retry(taskId);
      if (result.success && result.task) {
        const tasks = get().tasks.map((t) =>
          t.id === taskId ? { ...result.task! } : t
        );
        set({ tasks });

        // 重试后统一由调度器决定是否启动，避免绕过依赖检查、账号健康/额度检查和防重复处理
        setTimeout(() => get().processQueue(), 0);

        return true;
      } else {
        set({ error: result.error || '重试失败' });
        return false;
      }
    } catch (err: any) {
      set({ error: err.message });
      return false;
    }
  },

  batchPause: async () => {
    try {
      Object.values(get().executingTasks).forEach((taskId) => {
        window.dispatchEvent(new CustomEvent('cancel-task-automation', { detail: { taskId } }));
      });
      const result = await window.electronAPI.tasks.batchPause();
      if (result.success) {
        const tasks = get().tasks.map((t) =>
          t.status === 'executing' || t.status === 'generating' || t.status === 'waiting_verification'
            ? {
                ...t,
                status: 'paused' as TaskStatus,
                result: '批量暂停',
                runtime: t.runtime ? { ...t.runtime, stage: 'paused' as TaskStage, message: '批量暂停' } : t.runtime,
              }
            : t
        );
        // 清空所有执行状态
        set({
          tasks,
          executingTasks: {},
          accountBusy: {},
          accountAutomationState: {},
          accountAutoMessage: {},
          activeTaskId: null,
          automationState: 'idle',
          schedulerPaused: true,
        });
        return true;
      }
      return false;
    } catch {
      return false;
    }
  },

  resumeAll: async () => {
    const pausedTasks = get().tasks.filter((task) => task.status === 'paused');
    const resumed = new Map<string, Task>();
    const failures: string[] = [];
    for (const task of pausedTasks) {
      const result = await window.electronAPI.tasks.retry(task.id);
      if (result.success && result.task) {
        resumed.set(task.id, result.task);
      } else {
        failures.push(result.error || `任务 ${task.id.slice(0, 8)} 恢复失败`);
      }
    }
    set({
      schedulerPaused: false,
      tasks: get().tasks.map((task) => resumed.get(task.id) || task),
      error: failures.length > 0 ? `部分任务未恢复：${failures.slice(0, 2).join('；')}` : null,
    });
    setTimeout(() => get().processQueue(), 0);
    return failures.length === 0;
  },

  getCompletedOutputs: async () => {
    return window.electronAPI.tasks.getCompletedOutputs();
  },

  clearError: () => set({ error: null }),

  // ---- V3 自动化方法 ----

  startAutomation: async (taskId: string) => {
    if (get().schedulerPaused) {
      set({ error: '任务调度已暂停' });
      return false;
    }
    const interactiveAccountId = findInteractiveAccountId(get().accountAutomationState);
    if (interactiveAccountId) {
      set({ error: '另一账号正在配置或提交，请等待其进入生成阶段' });
      return false;
    }
    let task = get().tasks.find((t) => t.id === taskId);
    if (!task || !task.assignedAccountId) {
      console.warn('[TaskStore] startAutomation: 任务未指派账号', taskId);
      set({ error: task ? '任务尚未指派账号' : '任务不存在' });
      return false;
    }
    if (task.status !== 'queued') {
      set({ error: '只有排队中的任务可以启动' });
      return false;
    }

    // 显式启动必须先持久化 armed，写失败则绝不进入账号与页面动作。
    if (task.executionIntent !== 'armed') {
      const armResult = await window.electronAPI.tasks.updateRuntime(taskId, { executionIntent: 'armed' });
      if (!armResult.success || !armResult.task) {
        set({ error: armResult.error || '执行意图写入失败' });
        return false;
      }
      const armedTask = armResult.task;
      task = armedTask;
      set({ tasks: get().tasks.map((item) => item.id === taskId ? armedTask : item) });
    }

    if (!task.assignedAccountId) {
      set({ error: '任务尚未指派账号' });
      return false;
    }

    const dependency = evaluateDependencies(task, get().tasks);
    if (dependency.state !== 'ready') {
      set({ error: dependency.message || '任务依赖尚未就绪' });
      setTimeout(() => get().processQueue(), 0);
      return false;
    }

    // 依赖恢复后必须通过 Core/Repository 清空历史阻断；清理写入成功并回读一致才允许启动。
    if (task.blockedByTaskIds?.length) {
      const cleared = await get().clearDependencyBlock(taskId);
      if (!cleared) {
        // 清理失败或并发漂移：保持原状态与原错误，绝不启动，也不并发发起启动写入。
        set({ error: useTaskStore.getState().error || '依赖阻断清理失败，任务保持原状态' });
        return false;
      }
    }
    const refreshed = get().tasks.find((item) => item.id === taskId);
    if (!refreshed || refreshed.status !== 'queued') {
      set({ error: '任务状态在依赖清理后发生变化，已停止启动' });
      return false;
    }
    task = refreshed;

    if (!task.assignedAccountId) {
      set({ error: '任务尚未指派账号' });
      return false;
    }

    const accountId = task.assignedAccountId;
    const assignedAccount = useAccountStore.getState().accounts.find((account) => account.id === accountId);
    const accountBlockReason = getAssignedAccountBlockReason(assignedAccount, task);
    if (accountBlockReason) {
      console.warn('[TaskStore] 账号不可调度:', accountBlockReason, accountId);
      set({ error: accountBlockReason });
      setTimeout(() => get().processQueue(), 0);
      return false;
    }

    // 检查账号是否忙碌
    const reservedTask = get().tasks.find((item) =>
      item.id !== taskId && item.assignedAccountId === accountId &&
      ['executing', 'generating', 'waiting_verification', 'waiting_generation_confirmation', 'manual_submission_observing'].includes(item.status),
    );
    if (reservedTask) {
      set({ error: '该账号仍绑定生成确认或人工提交观察会话；请先完成只读回读或人工取消' });
      return false;
    }
    if (get().accountBusy[accountId]) {
      console.log('[TaskStore] 账号', accountId, '忙碌，任务排队');
      set({ error: '该账号正在执行其他任务' });
      return false;
    }

    const runId = `${taskId}-${Date.now()}`;
    const reservation = await automationEngine.reserve(taskId, accountId, runId);
    if (!reservation.ok) {
      set({ error: reservation.error || '任务锁定失败' });
      return false;
    }

    const now = new Date().toISOString();
    const startedTask: Task = {
      ...task,
      status: 'executing',
      result: null,
      errorInfo: undefined,
      blockedByTaskIds: undefined,
      runtime: {
        runId,
        attempt: (task.runtime?.attempt || 0) + 1,
        stage: 'preparing_account',
        message: '准备执行',
        startedAt: now,
        stageStartedAt: now,
        lastHeartbeatAt: now,
        input: {
          prompt: task.prompt,
          mode: task.mode,
          videoConfig: task.videoConfig,
          attachments: [...(task.attachments || [])],
          audioAttachment: task.audioAttachment,
        },
      },
      updatedAt: now,
    };

    // 启动写入必须持久化成功并回读一致；失败时释放预留、保持排队状态且不更新界面。
    const startWritten = await get().updateTaskRuntime(taskId, {
      status: 'executing',
      runtime: startedTask.runtime,
      errorInfo: null,
      blockedByTaskIds: [],
      result: '',
    });
    if (!startWritten) {
      await automationEngine.release(taskId);
      return false;
    }
    const runningTask = get().tasks.find((item) => item.id === taskId) || startedTask;

    console.log('[TaskStore] 启动任务', taskId, '在账号', accountId);
    void window.electronAPI.logs.append({ level: 'info', scope: 'automation', message: '任务开始执行', taskId, accountId });

    set({
      tasks: get().tasks.map((item) => item.id === taskId ? runningTask : item),
      executingTasks: { ...get().executingTasks, [accountId]: taskId },
      accountBusy: { ...get().accountBusy, [accountId]: true },
      accountAutomationState: { ...get().accountAutomationState, [accountId]: 'injecting' },
      accountAutoMessage: { ...get().accountAutoMessage, [accountId]: '准备执行...' },
      // 向后兼容
      activeTaskId: taskId,
      automationState: 'injecting',
    });

    return true;
  },

  markDependencyBlock: async (taskId, block) => {
    const blockedByTaskIds = [...new Set(block.blockedByTaskIds.filter(Boolean))].sort();
    const now = new Date().toISOString();
    const current = get().tasks.find((task) => task.id === taskId);
    if (!current || current.status !== 'queued') {
      set({ error: '只有排队中的任务可以写入依赖阻断' });
      return false;
    }
    // 幂等：已经处于相同依赖阻断态时不再重复写盘。
    // 依赖阻断保持 queued（不写 fail），否则调度器与重试入口都会永久跳过它。
    if (current.errorInfo?.code === block.code
      && current.errorInfo?.message === block.message
      && dependenciesMatch(current, {
        status: 'queued',
        errorInfoCode: block.code,
        blockedByTaskIds,
      })) {
      return true;
    }
    return get().updateTaskRuntime(taskId, {
      status: 'queued',
      result: block.message,
      errorInfo: { code: block.code, message: block.message, recoverable: false, detectedAt: now },
      blockedByTaskIds,
    });
  },

  clearDependencyBlock: async (taskId) => {
    const current = get().tasks.find((task) => task.id === taskId);
    // 幂等：没有历史阻断时无需写入。
    if (!current?.blockedByTaskIds?.length) return true;
    // 阻断恢复必须在一次写入里原子转回可调度的 queued 并清除阻断证据。
    return get().updateTaskRuntime(taskId, {
      status: 'queued',
      result: '',
      errorInfo: null,
      blockedByTaskIds: [],
    });
  },

  setAccountAutomationState: (accountId: string, state: AutomationState, message?: string, stage?: TaskStage) => {
    const previousState = get().accountAutomationState[accountId];
    const taskId = get().executingTasks[accountId];
    const now = new Date().toISOString();
    const status: TaskStatus | undefined = stage === 'waiting_verification' || stage === 'waiting_generation_confirmation'
      ? stage
      : state === 'generating'
        ? 'generating'
        : state === 'injecting' || state === 'submitting'
          ? 'executing'
          : undefined;
    const tasks = taskId
      ? get().tasks.map((task) => task.id === taskId
        ? {
            ...task,
            status: status || task.status,
            runtime: task.runtime ? {
              ...task.runtime,
              stage: stage || task.runtime.stage,
              message: message ?? task.runtime.message,
              stageStartedAt: stage && stage !== task.runtime.stage ? now : task.runtime.stageStartedAt,
              lastHeartbeatAt: now,
              submittedAt: stage === 'submitting' ? (task.runtime.submittedAt || now) : task.runtime.submittedAt,
              acceptanceObservation: state === 'generating' && task.runtime.acceptanceObservation?.outcome === 'observing'
                ? renewObservationLease(task.runtime.acceptanceObservation, now)
                : task.runtime.acceptanceObservation,
            } : task.runtime,
            updatedAt: now,
          }
        : task)
      : get().tasks;
    set({
      tasks,
      accountAutomationState: { ...get().accountAutomationState, [accountId]: state },
      accountAutoMessage: message !== undefined
        ? { ...get().accountAutoMessage, [accountId]: message }
        : get().accountAutoMessage,
    });
    if (taskId) {
      const task = tasks.find((item) => item.id === taskId);
      const previousPersist = runtimePersistState.get(taskId);
      const shouldPersist = !!task?.runtime && (
        previousPersist?.stage !== task.runtime.stage ||
        Date.now() - (previousPersist?.savedAt || 0) >= 15_000 ||
        state === 'failed' ||
        state === 'completed'
      );
      if (task?.runtime && shouldPersist) {
        runtimePersistState.set(taskId, { stage: task.runtime.stage, savedAt: Date.now() });
        void window.electronAPI.tasks.updateRuntime(taskId, {
          status,
          runtime: task.runtime,
        });
      }
    }
    if (state === 'generating' && previousState !== 'generating') {
      setTimeout(() => get().processQueue(), 0);
    }
  },

  updateTaskRuntime: async (taskId, patch) => {
    const previous = get().tasks.find((task) => task.id === taskId);
    if (!previous) {
      set({ error: '任务不存在' });
      return false;
    }
    let result: { success: boolean; task?: Task; error?: string };
    try {
      result = await window.electronAPI.tasks.updateRuntime(taskId, patch);
    } catch (err: any) {
      set({ error: err?.message || '任务运行状态写入失败' });
      return false;
    }
    const written = result.task;
    // 写盘确实失败且主进程没有回读结果：界面保持写入前的原状态。
    if (!written) {
      set({ error: result.error || '任务运行状态写入失败' });
      return false;
    }
    // 并发冲突：写盘已发生，主进程如实返回权威回读状态。
    // 此时必须让界面与落盘事实一致，并显示冲突错误——不得宣称“已保持原状态”。
    if (!result.success) {
      set({
        tasks: get().tasks.map((task) => task.id === taskId ? written : task),
        error: result.error || '任务状态已被并发修改，已同步落盘状态',
      });
      return false;
    }
    // 只校验本次显式请求的字段（与 TaskService.readBackMatches 同一口径）：
    // 未请求的字段不参与比较，明确请求清空的字段才要求回读为空。
    if (patch.status !== undefined && written.status !== patch.status) {
      set({
        tasks: get().tasks.map((task) => task.id === taskId ? written : task),
        error: '任务状态与请求不一致，已同步落盘状态',
      });
      return false;
    }
    if (patch.errorInfo !== undefined) {
      const expectedCode = patch.errorInfo === null ? null : patch.errorInfo.code;
      if ((written.errorInfo?.code ?? null) !== expectedCode) {
        set({
          tasks: get().tasks.map((task) => task.id === taskId ? written : task),
          error: '任务错误信息与请求不一致，已同步落盘状态',
        });
        return false;
      }
    }
    if (patch.blockedByTaskIds !== undefined) {
      const expectedIds = [...new Set(patch.blockedByTaskIds.filter(Boolean))].sort();
      const actualIds = written.blockedByTaskIds || [];
      if (actualIds.length !== expectedIds.length || actualIds.some((id, index) => id !== expectedIds[index])) {
        set({
          tasks: get().tasks.map((task) => task.id === taskId ? written : task),
          error: '任务依赖阻断记录与请求不一致，已同步落盘状态',
        });
        return false;
      }
    }
    set({ tasks: get().tasks.map((task) => task.id === taskId ? written : task) });
    return true;
  },

  completeAutomation: async (taskId: string, accountId: string, resultUrl: string, outputs?: string[]) => {
    void window.electronAPI.logs.append({ level: 'info', scope: 'automation', message: `任务完成，发现 ${outputs?.length || 1} 个产物`, taskId, accountId });
    const finalOutputs = outputs && outputs.length > 0 ? outputs : [resultUrl];
    await window.electronAPI.tasks.updateStatus(taskId, 'done', resultUrl, finalOutputs);
    await window.electronAPI.tasks.updateRuntime(taskId, {
      status: 'done',
      runtime: {
        stage: 'completed',
        message: '生成完成',
        stageStartedAt: new Date().toISOString(),
        lastHeartbeatAt: new Date().toISOString(),
      },
      errorInfo: null,
    });

    const completedAt = new Date().toISOString();
    const tasks = get().tasks.map((t) =>
      t.id === taskId
        ? {
            ...t,
            status: 'done' as TaskStatus,
            result: resultUrl,
            outputs: finalOutputs,
            artifacts: mergeArtifacts(t, finalOutputs),
            errorInfo: undefined,
            runtime: t.runtime ? {
              ...t.runtime,
              stage: 'completed' as TaskStage,
              message: '生成完成',
              acceptanceObservation: t.runtime.acceptanceObservation
                ? completeAcceptedObservation(t.runtime.acceptanceObservation, artifactId(finalOutputs[0]), completedAt)
                : undefined,
            } : t.runtime,
            updatedAt: completedAt,
          }
        : t
    );

    // 清除该账号的执行状态
    const newExecuting = { ...get().executingTasks };
    const newBusy = { ...get().accountBusy };
    const newAutoState = { ...get().accountAutomationState };
    const newAutoMsg = { ...get().accountAutoMessage };
    delete newExecuting[accountId];
    delete newBusy[accountId];
    newAutoState[accountId] = 'completed';
    newAutoMsg[accountId] = '生成完成！';

    // 向后兼容：如果完成的是活跃任务
    const isActive = get().activeTaskId === taskId;

    set({
      tasks,
      executingTasks: newExecuting,
      accountBusy: newBusy,
      accountAutomationState: newAutoState,
      accountAutoMessage: newAutoMsg,
      activeTaskId: isActive ? null : get().activeTaskId,
      automationState: isActive ? 'completed' : get().automationState,
    });

    // 更新账号状态
    window.electronAPI.accounts.setStatus(accountId, 'idle');

    // 延迟后清理完成状态 + 处理队列
    setTimeout(() => {
      const s = get();
      const cleanState = { ...s.accountAutomationState };
      const cleanMsg = { ...s.accountAutoMessage };
      if (cleanState[accountId] === 'completed') {
        cleanState[accountId] = 'idle';
        cleanMsg[accountId] = '';
      }
      set({
        accountAutomationState: cleanState,
        accountAutoMessage: cleanMsg,
      });
      // 处理队列：检查是否有排队任务可以启动
      get().processQueue();
      // 前序进入终态后，被其阻断的后继必须获得一次重新评估机会。
      scheduleDependencyRecheck();
    }, 2000);
  },

  pauseAutomation: async (
    taskId: string,
    accountId: string,
    pauseMessage = '用户已暂停',
    options?: {
      status: 'paused' | 'cancelled' | 'waiting_verification' | 'waiting_generation_confirmation' | 'manual_submission_observing';
      code?: string;
      generationConfirmation?: NonNullable<TaskRunSnapshot['generationConfirmation']>;
    },
  ) => {
    void window.electronAPI.logs.append({ level: 'warn', scope: 'automation', message: pauseMessage, taskId, accountId });
    const now = new Date().toISOString();
    const targetStatus: TaskStatus = options?.status || 'paused';
    const targetStage: TaskStage = targetStatus === 'waiting_verification'
      ? 'waiting_verification'
      : targetStatus === 'waiting_generation_confirmation'
        ? 'waiting_generation_confirmation'
        : targetStatus === 'manual_submission_observing'
          ? 'manual_submission_observing'
        : 'paused';
    const errorInfo: TaskErrorInfo = {
      code: options?.code || 'cancelled',
      message: pauseMessage,
      recoverable: true,
      detectedAt: now,
    };
    await window.electronAPI.tasks.updateRuntime(taskId, {
      status: targetStatus,
      result: pauseMessage,
      errorInfo,
      runtime: {
        stage: targetStage,
        message: pauseMessage,
        stageStartedAt: now,
        lastHeartbeatAt: now,
        generationConfirmation: options?.generationConfirmation,
      },
    });

    const newExecuting = { ...get().executingTasks };
    const newBusy = { ...get().accountBusy };
    delete newExecuting[accountId];
    delete newBusy[accountId];
    set({
      tasks: get().tasks.map((task) => task.id === taskId ? {
        ...task,
        status: targetStatus,
        result: pauseMessage,
        errorInfo,
        runtime: task.runtime ? {
          ...task.runtime,
          stage: targetStage,
          message: pauseMessage,
          stageStartedAt: now,
          lastHeartbeatAt: now,
          generationConfirmation: options?.generationConfirmation,
        } : task.runtime,
        updatedAt: now,
      } : task),
      executingTasks: newExecuting,
      accountBusy: newBusy,
      accountAutomationState: { ...get().accountAutomationState, [accountId]: 'idle' },
      accountAutoMessage: { ...get().accountAutoMessage, [accountId]: pauseMessage },
      activeTaskId: get().activeTaskId === taskId ? null : get().activeTaskId,
      automationState: get().activeTaskId === taskId ? 'idle' : get().automationState,
    });
    void window.electronAPI.accounts.setStatus(accountId, 'idle');
  },

  failAutomation: async (taskId: string, accountId: string, errorMsg: string, errorInfo?: TaskErrorInfo) => {
    void window.electronAPI.logs.append({ level: 'error', scope: errorInfo?.code || 'automation', message: errorMsg, taskId, accountId });
    const now = new Date().toISOString();
    await window.electronAPI.tasks.updateStatus(taskId, 'fail', errorMsg);
    await window.electronAPI.tasks.updateRuntime(taskId, {
      status: 'fail',
      result: errorMsg,
      errorInfo: errorInfo || null,
      runtime: { stage: 'failed', message: errorMsg, stageStartedAt: now, lastHeartbeatAt: now },
    });

    const tasks = get().tasks.map((t) =>
      t.id === taskId
        ? {
            ...t,
            status: 'fail' as TaskStatus,
            result: errorMsg,
            errorInfo,
            runtime: t.runtime ? { ...t.runtime, stage: 'failed' as TaskStage, message: errorMsg, stageStartedAt: now, lastHeartbeatAt: now } : t.runtime,
            updatedAt: now,
          }
        : t
    );

    const newExecuting = { ...get().executingTasks };
    const newBusy = { ...get().accountBusy };
    const newAutoState = { ...get().accountAutomationState };
    const newAutoMsg = { ...get().accountAutoMessage };
    delete newExecuting[accountId];
    delete newBusy[accountId];
    newAutoState[accountId] = 'failed';
    newAutoMsg[accountId] = errorMsg;

    const isActive = get().activeTaskId === taskId;

    set({
      tasks,
      executingTasks: newExecuting,
      accountBusy: newBusy,
      accountAutomationState: newAutoState,
      accountAutoMessage: newAutoMsg,
      activeTaskId: isActive ? null : get().activeTaskId,
      automationState: isActive ? 'failed' : get().automationState,
    });

    window.electronAPI.accounts.setStatus(accountId, 'idle');

    // 延迟后清理 + 处理队列
    setTimeout(() => {
      const s = get();
      const cleanState = { ...s.accountAutomationState };
      const cleanMsg = { ...s.accountAutoMessage };
      if (cleanState[accountId] === 'failed') {
        cleanState[accountId] = 'idle';
        cleanMsg[accountId] = '';
      }
      set({
        accountAutomationState: cleanState,
        accountAutoMessage: cleanMsg,
      });
      get().processQueue();
      // 前序进入终态后，被其阻断的后继必须获得一次重新评估机会。
      scheduleDependencyRecheck();
    }, 3000);
  },

  // ---- 队列调度 ----

  processQueue: async () => {
    if (queueProcessing) return;
    queueProcessing = true;
    try {
      const initialState = get();
      if (initialState.schedulerPaused) return;
      if (findInteractiveAccountId(initialState.accountAutomationState)) return;

      // A：只处理已指派、queued 且显式 armed 的任务；hold/历史缺失意图 fail-closed。
      const queuedIds = initialState.tasks
        .filter((t) => t.status === 'queued' && t.assignedAccountId && t.executionIntent === 'armed')
        .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
        .map((task) => task.id);

      for (const taskId of queuedIds) {
        const task = get().tasks.find((item) => item.id === taskId);
        if (!task || task.status !== 'queued' || !task.assignedAccountId || task.executionIntent !== 'armed') continue;

        const dependency = evaluateDependencies(task, get().tasks);

        if (dependency.state === 'ready') {
          if (task.blockedByTaskIds?.length) {
            // 恢复：用一次写入原子转回可调度的 queued 并清除阻断证据。
            // 清理与启动严格串行：清理写入成功并回读一致后才继续，失败保持原状态。
            const cleared = await get().clearDependencyBlock(taskId);
            if (!cleared) {
              scheduleDependencyRecheck();
              continue;
            }
          }
        } else if (dependency.state === 'waiting') {
          // 合法等待：不写失败也不写阻断。旧阻断已不成立时清除陈旧证据后继续本轮判断。
          if (task.blockedByTaskIds?.length) {
            if (!(await get().clearDependencyBlock(taskId))) {
              scheduleDependencyRecheck();
              continue;
            }
          } else {
            continue;
          }
        } else {
          // 缺失 / 循环 / 前置不可满足：幂等写入结构化阻断原因。
          // 任务始终保持 queued，依赖恢复后仍会被本调度器重新评估。
          const message = dependency.message || '依赖状态异常';
          const code = dependency.code || 'dependency_failed';
          const blockedByTaskIds = dependency.blockedByTaskIds || [];
          // 先成功写盘并回读，再让界面呈现阻断；写失败保持原状态。
          await get().markDependencyBlock(taskId, { code, message, blockedByTaskIds });
          scheduleDependencyRecheck();
          // 阻断任务绝不能在本轮继续走到启动分支。
          continue;
        }

        const latestTask = get().tasks.find((item) => item.id === taskId);
        if (!latestTask || latestTask.status !== 'queued' || !latestTask.assignedAccountId) continue;
        const accountId = latestTask.assignedAccountId;
        const accountHasObservation = get().tasks.some((item) =>
          item.id !== taskId && item.assignedAccountId === accountId &&
          item.runtime?.acceptanceObservation?.outcome === 'observing',
        );
        if (accountHasObservation) continue;
        const account = useAccountStore.getState().accounts.find((item) => item.id === accountId);
        const availabilityState = account?.health?.availability?.state;
        if (availabilityState === 'unknown') {
          const attempts = availabilityRetryAttempts.get(accountId) || 0;
          if (attempts < 30) {
            availabilityRetryAttempts.set(accountId, attempts + 1);
            useAccountStore.getState().requestAvailabilityCheck(accountId);
            if (!availabilityRetryTimers.has(accountId)) {
              const delay = Math.min(30_000, 2_000 * 2 ** Math.min(attempts, 4));
              const timer = setTimeout(() => {
                availabilityRetryTimers.delete(accountId);
                void get().processQueue();
              }, delay);
              availabilityRetryTimers.set(accountId, timer);
            }
          }
          continue;
        }
        availabilityRetryAttempts.delete(accountId);

        if (getAssignedAccountBlockReason(account, latestTask)) {
          continue;
        }
        if (!get().accountBusy[accountId]) {
          console.log('[TaskStore] 队列调度：启动任务', taskId, '在账号', accountId);
          const started = await get().startAutomation(taskId);
          if (started) {
            setTimeout(() => { void get().processQueue(); }, 0);
            return;
          }
        }
      }
    } catch (err: unknown) {
      const error = err instanceof Error ? err.message : String(err);
      console.error('[TaskStore] 队列调度异常：', err);
      set({ error: `任务调度异常：${error}` });
    } finally {
      queueProcessing = false;
    }
  },

  getNextTaskForAccount: (accountId: string) => {
    const tasks = get().tasks;
    return tasks.find(
        (t) => t.status === 'queued' && t.assignedAccountId === accountId && t.executionIntent === 'armed'
    ) || null;
  },
}));
