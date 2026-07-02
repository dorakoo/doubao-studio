/**
 * src/store/useTaskStore.ts
 * 任务调度状态（Zustand）
 *
 * 管理任务队列、添加/指派/状态流转、批量操作
 */

import { create } from 'zustand';
import type { Task, TaskStatus } from '../types';

// ==================== 类型 ====================

interface TaskState {
  /** 所有任务列表 */
  tasks: Task[];
  /** 数据是否正在加载 */
  loading: boolean;
  /** 错误信息 */
  error: string | null;

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
}

// ==================== Store ====================

export const useTaskStore = create<TaskState>((set, get) => ({
  tasks: [],
  loading: false,
  error: null,

  // 加载任务列表
  loadTasks: async () => {
    set({ loading: true, error: null });
    try {
      const tasks = await window.electronAPI.tasks.list();
      set({ tasks, loading: false });
    } catch (err: any) {
      set({ error: err.message, loading: false });
    }
  },

  // 批量添加任务
  addTasks: async (text: string) => {
    set({ error: null });
    // 按行拆分，过滤空行
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

  // 指派任务给账号
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

  // 更新任务状态
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

  // 删除任务
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

  // 批量暂停
  batchPause: async () => {
    try {
      const result = await window.electronAPI.tasks.batchPause();
      if (result.success) {
        const tasks = get().tasks.map((t) =>
          t.status === 'running' ? { ...t, status: 'queued' as TaskStatus } : t
        );
        set({ tasks });
        return true;
      }
      return false;
    } catch {
      return false;
    }
  },

  // 获取已完成产物
  getCompletedOutputs: async () => {
    return window.electronAPI.tasks.getCompletedOutputs();
  },

  // 清除错误
  clearError: () => set({ error: null }),
}));
