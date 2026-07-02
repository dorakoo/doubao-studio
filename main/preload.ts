/**
 * main/preload.ts
 * 预加载脚本 - 在渲染进程加载前执行
 * 通过 contextBridge 安全地暴露 IPC 通信接口给渲染进程
 */

import { contextBridge, ipcRenderer } from 'electron';

// ==================== 类型定义 ====================

export interface Account {
  id: string;
  name: string;
  avatar: string;
  partition: string;
  status: 'idle' | 'busy' | 'error';
  createdAt: string;
  updatedAt: string;
}

export interface Task {
  id: string;
  prompt: string;
  assignedAccountId: string | null;
  status: 'queued' | 'executing' | 'generating' | 'done' | 'fail';
  result: string | null;
  outputs: string[];
  createdAt: string;
  updatedAt: string;
}

// ==================== 暴露 API ====================

contextBridge.exposeInMainWorld('electronAPI', {
  // ---- 账号管理 ----
  accounts: {
    /** 获取所有账号列表 */
    list: (): Promise<Account[]> => ipcRenderer.invoke('accounts:list'),

    /** 添加新账号 */
    add: (name: string): Promise<{ success: boolean; account?: Account; error?: string }> =>
      ipcRenderer.invoke('accounts:add', { name }),

    /** 编辑账号名称 */
    update: (id: string, name: string): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('accounts:update', { id, name }),

    /** 删除账号（同时清除 Session 数据） */
    delete: (id: string): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('accounts:delete', { id }),

    /** 刷新账号（清除缓存后重新加载） */
    refresh: (id: string): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('accounts:refresh', { id }),

    /** 更新账号状态 */
    setStatus: (id: string, status: string): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('accounts:setStatus', { id, status }),

    /** 获取账号的 Session 分区名 */
    getPartition: (id: string): Promise<string | null> =>
      ipcRenderer.invoke('accounts:getPartition', { id }),
  },

  // ---- 任务调度 ----
  tasks: {
    /** 获取所有任务列表 */
    list: (): Promise<Task[]> => ipcRenderer.invoke('tasks:list'),

    /** 批量添加任务（每行一个提示词） */
    add: (prompts: string[]): Promise<{ success: boolean; tasks?: Task[]; error?: string }> =>
      ipcRenderer.invoke('tasks:add', { prompts }),

    /** 将任务指派给指定账号 */
    assign: (taskId: string, accountId: string): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('tasks:assign', { taskId, accountId }),

    /** 更新任务状态 */
    updateStatus: (
      taskId: string,
      status: string,
      result?: string,
      outputs?: string[]
    ): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('tasks:updateStatus', { taskId, status, result, outputs }),

    /** 删除任务 */
    delete: (taskId: string): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('tasks:delete', { taskId }),

    /** 批量暂停所有运行中任务 */
    batchPause: (): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('tasks:batchPause'),

    /** 获取已完成任务的产物列表 */
    getCompletedOutputs: (): Promise<{ taskId: string; prompt: string; outputs: string[] }[]> =>
      ipcRenderer.invoke('tasks:getCompletedOutputs'),
  },

  // ---- 系统操作 ----
  system: {
    /** 获取应用版本 */
    getVersion: (): Promise<string> => ipcRenderer.invoke('system:getVersion'),

    /** 最小化窗口 */
    minimize: (): void => ipcRenderer.send('window:minimize'),

    /** 最大化/还原窗口 */
    toggleMaximize: (): void => ipcRenderer.send('window:toggleMaximize'),

    /** 关闭窗口 */
    close: (): void => ipcRenderer.send('window:close'),
  },
});
