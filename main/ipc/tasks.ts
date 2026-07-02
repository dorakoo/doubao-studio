/**
 * main/ipc/tasks.ts
 * 任务调度 IPC 处理器
 * 负责：任务队列管理、状态流转、批量操作
 */

import { ipcMain } from 'electron';
import { readJSON, writeJSON } from '../utils/store';
import { v4 as uuidv4 } from 'uuid';

// ==================== 类型定义 ====================

/** 任务状态 */
export type TaskStatus = 'queued' | 'running' | 'done' | 'fail';

/** 任务数据结构 */
export interface Task {
  id: string;
  /** 提示词文本 */
  prompt: string;
  /** 分配的目标账号 ID */
  assignedAccountId: string | null;
  /** 任务状态 */
  status: TaskStatus;
  /** 执行结果/产出描述 */
  result: string | null;
  /** 产物的下载链接列表 */
  outputs: string[];
  createdAt: string;
  updatedAt: string;
}

// ==================== 数据持久化 ====================

const STORE_FILE = 'tasks.json';

function loadTasks(): Task[] {
  return readJSON<Task[]>(STORE_FILE, []);
}

function saveTasks(tasks: Task[]): boolean {
  return writeJSON(STORE_FILE, tasks);
}

// ==================== IPC 处理器注册 ====================

export function registerTaskIPC(): void {
  // ---- 获取所有任务 ----
  ipcMain.handle('tasks:list', async (): Promise<Task[]> => {
    return loadTasks();
  });

  // ---- 添加任务（支持批量：多行文本，每行一个任务） ----
  ipcMain.handle(
    'tasks:add',
    async (_event, params: { prompts: string[] }): Promise<{ success: boolean; tasks?: Task[]; error?: string }> => {
      try {
        if (!params.prompts || params.prompts.length === 0) {
          return { success: false, error: '请输入至少一条提示词' };
        }

        const tasks = loadTasks();
        const newTasks: Task[] = params.prompts
          .filter((p) => p.trim().length > 0)
          .map((prompt) => ({
            id: uuidv4(),
            prompt: prompt.trim(),
            assignedAccountId: null,
            status: 'queued' as TaskStatus,
            result: null,
            outputs: [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          }));

        tasks.push(...newTasks);
        saveTasks(tasks);

        return { success: true, tasks: newTasks };
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    }
  );

  // ---- 指派任务给账号 ----
  ipcMain.handle(
    'tasks:assign',
    async (_event, params: { taskId: string; accountId: string }): Promise<{ success: boolean; error?: string }> => {
      const tasks = loadTasks();
      const task = tasks.find((t) => t.id === params.taskId);
      if (!task) {
        return { success: false, error: '任务不存在' };
      }
      if (task.status === 'running') {
        return { success: false, error: '任务正在执行中，无法重新指派' };
      }

      task.assignedAccountId = params.accountId;
      task.status = 'queued';
      task.updatedAt = new Date().toISOString();
      saveTasks(tasks);

      return { success: true };
    }
  );

  // ---- 更新任务状态 ----
  ipcMain.handle(
    'tasks:updateStatus',
    async (
      _event,
      params: { taskId: string; status: TaskStatus; result?: string; outputs?: string[] }
    ): Promise<{ success: boolean; error?: string }> => {
      const tasks = loadTasks();
      const task = tasks.find((t) => t.id === params.taskId);
      if (!task) {
        return { success: false, error: '任务不存在' };
      }

      task.status = params.status;
      if (params.result !== undefined) task.result = params.result;
      if (params.outputs !== undefined) task.outputs = params.outputs;
      task.updatedAt = new Date().toISOString();
      saveTasks(tasks);

      return { success: true };
    }
  );

  // ---- 删除任务 ----
  ipcMain.handle(
    'tasks:delete',
    async (_event, params: { taskId: string }): Promise<{ success: boolean; error?: string }> => {
      const tasks = loadTasks();
      const idx = tasks.findIndex((t) => t.id === params.taskId);
      if (idx === -1) {
        return { success: false, error: '任务不存在' };
      }

      tasks.splice(idx, 1);
      saveTasks(tasks);
      return { success: true };
    }
  );

  // ---- 批量暂停/继续 ----
  ipcMain.handle(
    'tasks:batchPause',
    async (): Promise<{ success: boolean }> => {
      const tasks = loadTasks();
      for (const task of tasks) {
        if (task.status === 'running') {
          task.status = 'queued';
          task.updatedAt = new Date().toISOString();
        }
      }
      saveTasks(tasks);
      return { success: true };
    }
  );

  // ---- 批量获取已完成任务的产物 ----
  ipcMain.handle(
    'tasks:getCompletedOutputs',
    async (): Promise<{ taskId: string; prompt: string; outputs: string[] }[]> => {
      const tasks = loadTasks();
      return tasks
        .filter((t) => t.status === 'done' && t.outputs.length > 0)
        .map((t) => ({
          taskId: t.id,
          prompt: t.prompt,
          outputs: t.outputs,
        }));
    }
  );

  console.log('[IPC] 任务调度模块已注册');
}
