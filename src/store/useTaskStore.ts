/**
 * src/store/useTaskStore.ts
 * 任务调度状态（Zustand） — V2 自动化执行
 *
 * 管理任务队列、添加/指派/状态流转、批量操作、自动化执行
 */

import { create } from 'zustand';
import type { Task, TaskStatus } from '../types';
import { useAccountStore } from './useAccountStore';

// ==================== 类型 ====================

/** 自动化执行状态 */
export type AutomationState = 'idle' | 'injecting' | 'submitting' | 'generating' | 'completed' | 'failed';

interface TaskState {
  /** 所有任务列表 */
  tasks: Task[];
  /** 数据是否正在加载 */
  loading: boolean;
  /** 错误信息 */
  error: string | null;

  /** 当前正在自动化执行的任务 ID */
  activeTaskId: string | null;
  /** 自动化执行状态 */
  automationState: AutomationState;
  /** 自动化轮询定时器引用（用于清理） */
  pollingTimerId: ReturnType<typeof setInterval> | null;

  // Actions
  /** 从主进程加载任务列表 */
  loadTasks: () => Promise<void>;
  /** 批量添加任务（自动按行拆分） */
  addTasks: (text: string) => Promise<boolean>;
  /** 将任务指派给账号 */
  assignTask: (taskId: string, accountId: string) => Promise<boolean>;
  /** 更新任务状态 */
  updateTaskStatus: (taskId: string, status: TaskStatus, result?: string, outputs?: string[]) => Promise<void>;
  /** 删除任务 */
  deleteTask: (taskId: string) => Promise<boolean>;
  /** 批量暂停所有运行中任务 */
  batchPause: () => Promise<boolean>;
  /** 获取已完成任务产物 */
  getCompletedOutputs: () => Promise<{ taskId: string; prompt: string; outputs: string[] }[]>;
  /** 清除错误 */
  clearError: () => void;

  // V2 自动化方法
  /** 启动自动化执行：将任务设为 executing 状态 */
  startAutomation: (taskId: string) => void;
  /** 更新自动化状态 */
  setAutomationState: (state: AutomationState) => void;
  /** 完成任务：记录结果 URL 并更新状态 */
  completeAutomation: (taskId: string, resultUrl: string) => Promise<void>;
  /** 任务失败 */
  failAutomation: (taskId: string, errorMsg: string) => Promise<void>;
  /** 清除自动化状态 */
  clearAutomation: () => void;
  /** 获取下一个排队任务 */
  getNextQueuedTask: () => Task | null;
}

// ==================== Store ====================

export const useTaskStore = create<TaskState>((set, get) => ({
  tasks: [],
  loading: false,
  error: null,
  activeTaskId: null,
  automationState: 'idle',
  pollingTimerId: null,

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

  addTasks: async (text: string) => {
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
      const result = await window.electronAPI.tasks.add(prompts);
      if (result.success && result.tasks) {
        const tasks = [...get().tasks, ...result.tasks];
        set({ tasks });
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
        // 自动切换到被指派的账号
        useAccountStore.getState().selectAccount(accountId);
        // 如果当前没有正在执行的任务，自动启动
        if (get().automationState === 'idle' && !get().activeTaskId) {
          get().startAutomation(taskId);
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
        ? {
            ...t,
            status,
            result: result ?? t.result,
            outputs: outputs ?? t.outputs,
            updatedAt: new Date().toISOString(),
          }
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
        const newState: any = { tasks };
        if (get().activeTaskId === taskId) {
          newState.activeTaskId = null;
          newState.automationState = 'idle';
        }
        set(newState);
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
        set({ tasks });
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

  // ---- V2 自动化方法 ----

  startAutomation: (taskId: string) => {
    const tasks = get().tasks.map((t) =>
      t.id === taskId
        ? { ...t, status: 'executing' as TaskStatus, updatedAt: new Date().toISOString() }
        : t
    );
    // 清除之前的定时器
    const prevTimer = get().pollingTimerId;
    if (prevTimer) clearInterval(prevTimer);

    set({
      tasks,
      activeTaskId: taskId,
      automationState: 'injecting',
    });
  },

  setAutomationState: (state: AutomationState) => {
    set({ automationState: state });
  },

  completeAutomation: async (taskId: string, resultUrl: string) => {
    // 清除轮询定时器
    const timer = get().pollingTimerId;
    if (timer) {
      clearInterval(timer);
    }

    await window.electronAPI.tasks.updateStatus(taskId, 'done', resultUrl, [resultUrl]);
    const tasks = get().tasks.map((t) =>
      t.id === taskId
        ? {
            ...t,
            status: 'done' as TaskStatus,
            result: resultUrl,
            outputs: [resultUrl],
            updatedAt: new Date().toISOString(),
          }
        : t
    );
    set({
      tasks,
      activeTaskId: null,
      automationState: 'completed',
      pollingTimerId: null,
    });

    // 完成后将对应账号状态设回 idle
    const task = tasks.find((t) => t.id === taskId);
    if (task?.assignedAccountId) {
      window.electronAPI.accounts.setStatus(task.assignedAccountId, 'idle');
    }
  },

  failAutomation: async (taskId: string, errorMsg: string) => {
    const timer = get().pollingTimerId;
    if (timer) {
      clearInterval(timer);
    }

    await window.electronAPI.tasks.updateStatus(taskId, 'fail', errorMsg);
    const tasks = get().tasks.map((t) =>
      t.id === taskId
        ? {
            ...t,
            status: 'fail' as TaskStatus,
            result: errorMsg,
            updatedAt: new Date().toISOString(),
          }
        : t
    );
    set({
      tasks,
      activeTaskId: null,
      automationState: 'failed',
      pollingTimerId: null,
    });

    // 失败后将对应账号状态设回 idle
    const task = tasks.find((t) => t.id === taskId);
    if (task?.assignedAccountId) {
      window.electronAPI.accounts.setStatus(task.assignedAccountId, 'idle');
    }
  },

  clearAutomation: () => {
    const timer = get().pollingTimerId;
    if (timer) {
      clearInterval(timer);
    }
    set({
      activeTaskId: null,
      automationState: 'idle',
      pollingTimerId: null,
    });
  },

  getNextQueuedTask: () => {
    const tasks = get().tasks;
    return tasks.find((t) => t.status === 'queued' && t.assignedAccountId !== null) || null;
  },
}));
