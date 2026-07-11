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
  Account,
  Task,
  TaskStatus,
  GenerationMode,
  TaskUpdateInput,
  TaskErrorInfo,
  TaskRunSnapshot,
  TaskStage,
  TaskArtifact,
} from '../types';
import { getAccountSchedulingScore } from '../utils/schedulingScore';
import { evaluateDependencies } from '../utils/dependencyEval';
import { useAccountStore } from './useAccountStore';
import { automationEngine } from '../automation/AutomationEngine';
import { useProjectStore } from './useProjectStore';

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
  importCsv: () => Promise<{ imported: number; skipped: number; errors: string[] } | null>;
  assignTask: (taskId: string, accountId: string) => Promise<boolean>;
  updateTaskStatus: (taskId: string, status: TaskStatus, result?: string, outputs?: string[]) => Promise<void>;
  updateTask: (taskId: string, updates: TaskUpdateInput) => Promise<boolean>;
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
    result?: string;
  }) => Promise<void>;
  completeAutomation: (taskId: string, accountId: string, resultUrl: string, outputs?: string[]) => Promise<void>;
  pauseAutomation: (taskId: string, accountId: string, message?: string) => Promise<void>;
  failAutomation: (taskId: string, accountId: string, errorMsg: string, errorInfo?: TaskErrorInfo) => Promise<void>;

  /** 处理队列：检查待执行任务，分配到空闲账号 */
  processQueue: () => void;
  /** 获取指定账号的下一个排队任务 */
  getNextTaskForAccount: (accountId: string) => Task | null;
}

const runtimePersistState = new Map<string, { stage?: TaskStage; savedAt: number }>();
let queueProcessing = false;

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

function getAccountBlockReason(account: Account | undefined, task: Task): string | null {
  if (!account) return '指派账号不存在';
  if (account.status === 'error') return '指派账号当前异常';
  if (task.mode === 'video' && account.seedanceQuota?.exhausted) return '指派账号今日 Seedance 额度已用尽';
  if (account.health?.verificationRequired) return '指派账号正在等待人工验证';
  if (account.health?.loginState === 'expired') return '指派账号登录已失效';
  if (account.health?.cooldownUntil && new Date(account.health.cooldownUntil).getTime() > Date.now()) return '指派账号处于自动冷却期';
  if (account.scheduling?.enabled === false) return '指派账号已暂停调度';
  if (account.scheduling?.manualCooldownUntil && new Date(account.scheduling.manualCooldownUntil).getTime() > Date.now()) return '指派账号处于手动冷却期';
  return null;
}

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
        const activeTasks = tasks.filter((task) => ['executing', 'generating', 'waiting_verification'].includes(task.status));
        for (const task of activeTasks) {
          const now = new Date().toISOString();
          await window.electronAPI.tasks.updateRuntime(task.id, {
            status: 'paused',
            result: '应用界面重新载入，任务已安全暂停',
            errorInfo: { code: 'cancelled', message: '应用界面重新载入，任务已安全暂停', recoverable: true, detectedAt: now },
            runtime: task.runtime ? { stage: 'paused', message: '应用界面重新载入，任务已安全暂停', stageStartedAt: now, lastHeartbeatAt: now } : undefined,
          });
          await window.electronAPI.tasks.releaseLock(task.id);
        }
        if (activeTasks.length > 0) tasks = await window.electronAPI.tasks.list();
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
      if (result.success) {
        const tasks = get().tasks.map((t) =>
          t.id === taskId
            ? { ...t, assignedAccountId: accountId, updatedAt: new Date().toISOString() }
            : t
        );
        set({ tasks });

        // 指派后由统一队列调度器启动，避免在这里和定时调度同时抢占账号。
        setTimeout(() => get().processQueue(), 0);
        return true;
      } else {
        set({ error: result.error || '指派失败' });
        return false;
      }
    } catch (err: any) {
      set({ error: err.message });
      return false;
    }
  },

  updateTaskStatus: async (taskId: string, status: TaskStatus, result?: string, outputs?: string[]) => {
    await window.electronAPI.tasks.updateStatus(taskId, status, result, outputs);
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
  },

  importCsv: async () => {
    const result = await window.electronAPI.tasks.importCsv(useProjectStore.getState().activeProjectId);
    if (!result.success || !result.tasks) {
      if (result.error) set({ error: result.error });
      return null;
    }
    set({ tasks: [...get().tasks, ...result.tasks] });
    setTimeout(() => get().processQueue(), 0);
    return { imported: result.imported || result.tasks.length, skipped: result.skipped || 0, errors: result.errors || [] };
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
    for (const task of pausedTasks) {
      const result = await window.electronAPI.tasks.retry(task.id);
      if (result.success && result.task) resumed.set(task.id, result.task);
    }
    set({
      schedulerPaused: false,
      tasks: get().tasks.map((task) => resumed.get(task.id) || task),
    });
    setTimeout(() => get().processQueue(), 0);
    return true;
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
    const task = get().tasks.find((t) => t.id === taskId);
    if (!task || !task.assignedAccountId) {
      console.warn('[TaskStore] startAutomation: 任务未指派账号', taskId);
      set({ error: task ? '任务尚未指派账号' : '任务不存在' });
      return false;
    }
    if (task.status !== 'queued') {
      set({ error: '只有排队中的任务可以启动' });
      return false;
    }

    const dependency = evaluateDependencies(task, get().tasks);
    if (dependency.state !== 'ready') {
      set({ error: dependency.message || '任务依赖尚未就绪' });
      setTimeout(() => get().processQueue(), 0);
      return false;
    }

    const accountId = task.assignedAccountId;
    const assignedAccount = useAccountStore.getState().accounts.find((account) => account.id === accountId);
    const accountBlockReason = getAccountBlockReason(assignedAccount, task);
    if (accountBlockReason) {
      console.warn('[TaskStore] 账号不可调度:', accountBlockReason, accountId);
      set({ error: accountBlockReason });
      setTimeout(() => get().processQueue(), 0);
      return false;
    }

    // 检查账号是否忙碌
    if (get().accountBusy[accountId]) {
      console.log('[TaskStore] 账号', accountId, '忙碌，任务排队');
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

    const persisted = await window.electronAPI.tasks.updateRuntime(taskId, {
      status: 'executing',
      runtime: startedTask.runtime,
      errorInfo: null,
      result: '',
    });
    if (!persisted.success) {
      await automationEngine.release(taskId);
      set({ error: persisted.error || '任务运行状态写入失败' });
      return false;
    }

    console.log('[TaskStore] 启动任务', taskId, '在账号', accountId);
    void window.electronAPI.logs.append({ level: 'info', scope: 'automation', message: '任务开始执行', taskId, accountId });

    set({
      tasks: get().tasks.map((item) => item.id === taskId ? (persisted.task || startedTask) : item),
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

  setAccountAutomationState: (accountId: string, state: AutomationState, message?: string, stage?: TaskStage) => {
    const taskId = get().executingTasks[accountId];
    const now = new Date().toISOString();
    const status: TaskStatus | undefined = stage === 'waiting_verification'
      ? 'waiting_verification'
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
              submittedAt: stage === 'submitting' ? now : task.runtime.submittedAt,
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
  },

  updateTaskRuntime: async (taskId, patch) => {
    const result = await window.electronAPI.tasks.updateRuntime(taskId, patch);
    if (result.success && result.task) {
      set({ tasks: get().tasks.map((task) => task.id === taskId ? result.task! : task) });
    }
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

    const tasks = get().tasks.map((t) =>
      t.id === taskId
        ? {
            ...t,
            status: 'done' as TaskStatus,
            result: resultUrl,
            outputs: finalOutputs,
            artifacts: mergeArtifacts(t, finalOutputs),
            errorInfo: undefined,
            runtime: t.runtime ? { ...t.runtime, stage: 'completed' as TaskStage, message: '生成完成' } : t.runtime,
            updatedAt: new Date().toISOString(),
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
    }, 2000);
  },

  pauseAutomation: async (taskId: string, accountId: string, pauseMessage = '用户已暂停') => {
    void window.electronAPI.logs.append({ level: 'warn', scope: 'automation', message: pauseMessage, taskId, accountId });
    const now = new Date().toISOString();
    const errorInfo: TaskErrorInfo = {
      code: 'cancelled',
      message: pauseMessage,
      recoverable: true,
      detectedAt: now,
    };
    await window.electronAPI.tasks.updateRuntime(taskId, {
      status: 'paused',
      result: pauseMessage,
      errorInfo,
      runtime: { stage: 'paused', message: pauseMessage, stageStartedAt: now, lastHeartbeatAt: now },
    });

    const newExecuting = { ...get().executingTasks };
    const newBusy = { ...get().accountBusy };
    delete newExecuting[accountId];
    delete newBusy[accountId];
    set({
      tasks: get().tasks.map((task) => task.id === taskId ? {
        ...task,
        status: 'paused',
        result: pauseMessage,
        errorInfo,
        runtime: task.runtime ? { ...task.runtime, stage: 'paused', message: pauseMessage, stageStartedAt: now, lastHeartbeatAt: now } : task.runtime,
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
    }, 3000);
  },

  // ---- 队列调度 ----

  processQueue: () => {
    if (queueProcessing) return;
    queueProcessing = true;
    const state = get();
    if (state.schedulerPaused) {
      queueProcessing = false;
      return;
    }
    // 找出所有已指派但还在 queued 状态的任务
    const queuedTasks = state.tasks.filter(
      (t) => t.status === 'queued' && t.assignedAccountId
    );

    // 按创建时间排序
    queuedTasks.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

    for (const task of queuedTasks) {
      const dependency = evaluateDependencies(task, state.tasks);
      if (dependency.state === 'missing' || dependency.state === 'failed' || dependency.state === 'invalid') {
        const message = dependency.message!;
        const now = new Date().toISOString();
        set((current) => ({
          tasks: current.tasks.map((item) => item.id === task.id ? {
            ...item,
            status: 'fail' as TaskStatus,
            result: message,
            errorInfo: { code: 'generation_failed', message, recoverable: true, detectedAt: now },
            updatedAt: now,
          } : item),
        }));
        void window.electronAPI.tasks.updateRuntime(task.id, {
          status: 'fail',
          result: message,
          errorInfo: { code: 'generation_failed', message, recoverable: true, detectedAt: now },
        });
        continue;
      }
      if (dependency.state !== 'ready') continue;
      const accountId = task.assignedAccountId!;
      const account = useAccountStore.getState().accounts.find((item) => item.id === accountId);
      if (getAccountBlockReason(account, task)) {
        const candidates = useAccountStore.getState().accounts
          .filter((candidate) => candidate.id !== accountId)
            .map((candidate) => ({ candidate, score: getAccountSchedulingScore(candidate, state.tasks.filter((item) => item.assignedAccountId === candidate.id && ['queued', 'executing', 'generating', 'waiting_verification'].includes(item.status)).length, task.mode) }))
          .filter((item) => Number.isFinite(item.score))
          .sort((a, b) => a.score - b.score);
        if (candidates[0]) {
          void state.assignTask(task.id, candidates[0].candidate.id).finally(() => {
            queueProcessing = false;
            get().processQueue();
          });
          return;
        }
        continue;
      }
      if (!state.accountBusy[accountId]) {
        console.log('[TaskStore] 队列调度：启动任务', task.id, '在账号', accountId);
        void state.startAutomation(task.id).finally(() => {
          queueProcessing = false;
          get().processQueue();
        });
        // 重新获取 state（startAutomation 已经 set 了）
        return; // 每次只启动一个，完成锁定后继续调度其他空闲账号
      }
    }
    queueProcessing = false;
  },

  getNextTaskForAccount: (accountId: string) => {
    const tasks = get().tasks;
    return tasks.find(
      (t) => t.status === 'queued' && t.assignedAccountId === accountId
    ) || null;
  },
}));
