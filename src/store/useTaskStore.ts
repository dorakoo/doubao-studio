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
import type { Task, TaskStatus, GenerationMode } from '../types';

// ==================== 类型 ====================

/** 自动化执行状态 */
export type AutomationState = 'idle' | 'injecting' | 'submitting' | 'generating' | 'completed' | 'failed';

interface TaskState {
  /** 所有任务列表 */
  tasks: Task[];
  loading: boolean;
  error: string | null;

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
  loadTasks: () => Promise<void>;
  addTasks: (text: string, mode?: GenerationMode, videoConfig?: Task['videoConfig'], attachments?: string[], audioAttachment?: string) => Promise<boolean>;
  assignTask: (taskId: string, accountId: string) => Promise<boolean>;
  updateTaskStatus: (taskId: string, status: TaskStatus, result?: string, outputs?: string[]) => Promise<void>;
  deleteTask: (taskId: string) => Promise<boolean>;
  batchPause: () => Promise<boolean>;
  getCompletedOutputs: () => Promise<{ taskId: string; prompt: string; outputs: string[] }[]>;
  clearError: () => void;

  // V3 自动化方法
  startAutomation: (taskId: string) => void;
  setAccountAutomationState: (accountId: string, state: AutomationState, message?: string) => void;
  completeAutomation: (taskId: string, accountId: string, resultUrl: string, outputs?: string[]) => Promise<void>;
  failAutomation: (taskId: string, accountId: string, errorMsg: string) => Promise<void>;

  /** 处理队列：检查待执行任务，分配到空闲账号 */
  processQueue: () => void;
  /** 获取指定账号的下一个排队任务 */
  getNextTaskForAccount: (accountId: string) => Task | null;
}

// ==================== Store ====================

export const useTaskStore = create<TaskState>((set, get) => ({
  tasks: [],
  loading: false,
  error: null,
  executingTasks: {},
  accountBusy: {},
  accountAutomationState: {},
  accountAutoMessage: {},
  activeTaskId: null,
  automationState: 'idle',

  // ---- 基础操作 ----

  loadTasks: async () => {
    set({ loading: true, error: null });
    try {
      const tasks = await window.electronAPI.tasks.list();
      set({ tasks, loading: false });
    } catch (err: any) {
      set({ error: err.message, loading: false });
    }
  },

  addTasks: async (text: string, mode?: GenerationMode, videoConfig?: Task['videoConfig'], attachments?: string[], audioAttachment?: string) => {
    set({ error: null });
    const prompts = text
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    if (prompts.length === 0) {
      set({ error: '请输入至少一条提示词' });
      return false;
    }

    try {
      const result = await window.electronAPI.tasks.add(prompts, mode, videoConfig, attachments, audioAttachment);
      if (result.success && result.tasks) {
        set({ tasks: [...get().tasks, ...result.tasks] });
        return true;
      } else {
        set({ error: result.error || '添加失败' });
        return false;
      }
    } catch (err: any) {
      set({ error: err.message });
      return false;
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

        // 不再强制切换账号页面
        // 如果目标账号空闲，自动启动；否则排入队列等待
        if (!get().accountBusy[accountId]) {
          get().startAutomation(taskId);
        } else {
          console.log('[TaskStore] 账号', accountId, '忙碌中，任务', taskId, '排队等待');
        }
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
        ? { ...t, status, result: result ?? t.result, outputs: outputs ?? t.outputs, updatedAt: new Date().toISOString() }
        : t
    );
    set({ tasks });
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

  batchPause: async () => {
    try {
      const result = await window.electronAPI.tasks.batchPause();
      if (result.success) {
        const tasks = get().tasks.map((t) =>
          t.status === 'executing' || t.status === 'generating'
            ? { ...t, status: 'queued' as TaskStatus }
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
        });
        return true;
      }
      return false;
    } catch {
      return false;
    }
  },

  getCompletedOutputs: async () => {
    return window.electronAPI.tasks.getCompletedOutputs();
  },

  clearError: () => set({ error: null }),

  // ---- V3 自动化方法 ----

  startAutomation: (taskId: string) => {
    const task = get().tasks.find((t) => t.id === taskId);
    if (!task || !task.assignedAccountId) {
      console.warn('[TaskStore] startAutomation: 任务未指派账号', taskId);
      return;
    }

    const accountId = task.assignedAccountId;

    // 检查账号是否忙碌
    if (get().accountBusy[accountId]) {
      console.log('[TaskStore] 账号', accountId, '忙碌，任务排队');
      return;
    }

    console.log('[TaskStore] 启动任务', taskId, '在账号', accountId);

    // 更新任务状态
    const tasks = get().tasks.map((t) =>
      t.id === taskId
        ? { ...t, status: 'executing' as TaskStatus, updatedAt: new Date().toISOString() }
        : t
    );

    set({
      tasks,
      executingTasks: { ...get().executingTasks, [accountId]: taskId },
      accountBusy: { ...get().accountBusy, [accountId]: true },
      accountAutomationState: { ...get().accountAutomationState, [accountId]: 'injecting' },
      accountAutoMessage: { ...get().accountAutoMessage, [accountId]: '准备执行...' },
      // 向后兼容
      activeTaskId: taskId,
      automationState: 'injecting',
    });
  },

  setAccountAutomationState: (accountId: string, state: AutomationState, message?: string) => {
    set({
      accountAutomationState: { ...get().accountAutomationState, [accountId]: state },
      accountAutoMessage: message !== undefined
        ? { ...get().accountAutoMessage, [accountId]: message }
        : get().accountAutoMessage,
    });
  },

  completeAutomation: async (taskId: string, accountId: string, resultUrl: string, outputs?: string[]) => {
    const finalOutputs = outputs && outputs.length > 0 ? outputs : [resultUrl];
    await window.electronAPI.tasks.updateStatus(taskId, 'done', resultUrl, finalOutputs);

    const tasks = get().tasks.map((t) =>
      t.id === taskId
        ? { ...t, status: 'done' as TaskStatus, result: resultUrl, outputs: finalOutputs, updatedAt: new Date().toISOString() }
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

  failAutomation: async (taskId: string, accountId: string, errorMsg: string) => {
    await window.electronAPI.tasks.updateStatus(taskId, 'fail', errorMsg);

    const tasks = get().tasks.map((t) =>
      t.id === taskId
        ? { ...t, status: 'fail' as TaskStatus, result: errorMsg, updatedAt: new Date().toISOString() }
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
    const state = get();
    // 找出所有已指派但还在 queued 状态的任务
    const queuedTasks = state.tasks.filter(
      (t) => t.status === 'queued' && t.assignedAccountId
    );

    // 按创建时间排序
    queuedTasks.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

    for (const task of queuedTasks) {
      const accountId = task.assignedAccountId!;
      if (!state.accountBusy[accountId]) {
        console.log('[TaskStore] 队列调度：启动任务', task.id, '在账号', accountId);
        state.startAutomation(task.id);
        // 重新获取 state（startAutomation 已经 set 了）
        break; // 每次只启动一个，启动后状态已变，等下次 processQueue
      }
    }
  },

  getNextTaskForAccount: (accountId: string) => {
    const tasks = get().tasks;
    return tasks.find(
      (t) => t.status === 'queued' && t.assignedAccountId === accountId
    ) || null;
  },
}));
