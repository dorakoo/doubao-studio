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
  pinned: boolean;
  seedanceQuota?: {
    date: string;
    usedUnits: number;
    estimatedTotalUnits: number;
    exhausted: boolean;
    updatedAt: string;
  };
  health?: any;
  createdAt: string;
  updatedAt: string;
}

export type GenerationMode = 'chat' | 'image' | 'video' | 'music';

export interface Task {
  id: string;
  prompt: string;
  assignedAccountId: string | null;
  status: 'queued' | 'executing' | 'generating' | 'waiting_verification' | 'paused' | 'done' | 'fail' | 'cancelled';
  mode: GenerationMode;
  videoConfig?: any;
  attachments?: string[];
  audioAttachment?: string;
  result: string | null;
  outputs: string[];
  runtime?: any;
  errorInfo?: any;
  createdAt: string;
  updatedAt: string;
}

// ==================== 暴露 API ====================

contextBridge.exposeInMainWorld('electronAPI', {
  // ---- 账号管理 ----
  accounts: {
    list: (): Promise<Account[]> => ipcRenderer.invoke('accounts:list'),
    add: (name: string): Promise<{ success: boolean; account?: Account; error?: string }> =>
      ipcRenderer.invoke('accounts:add', { name }),
    update: (id: string, name: string): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('accounts:update', { id, name }),
    delete: (id: string): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('accounts:delete', { id }),
    refresh: (id: string): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('accounts:refresh', { id }),
    setStatus: (id: string, status: string): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('accounts:setStatus', { id, status }),
    setPinned: (id: string, pinned: boolean): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('accounts:setPinned', { id, pinned }),
    updateSeedanceQuota: (id: string, action: 'consume' | 'exhausted', units?: number): Promise<{ success: boolean; account?: Account }> =>
      ipcRenderer.invoke('accounts:updateSeedanceQuota', { id, action, units }),
    updateHealth: (id: string, action: 'success' | 'failure' | 'verification' | 'login_expired' | 'clear', errorCode?: string): Promise<{ success: boolean; account?: Account }> =>
      ipcRenderer.invoke('accounts:updateHealth', { id, action, errorCode }),
    getPartition: (id: string): Promise<string | null> =>
      ipcRenderer.invoke('accounts:getPartition', { id }),
  },

  // ---- 任务调度 ----
  tasks: {
    list: (): Promise<Task[]> => ipcRenderer.invoke('tasks:list'),
    add: (prompts: string[], mode?: GenerationMode, videoConfig?: any, attachments?: string[], audioAttachment?: string): Promise<{ success: boolean; tasks?: Task[]; error?: string }> =>
      ipcRenderer.invoke('tasks:add', { prompts, mode, videoConfig, attachments, audioAttachment }),
    assign: (taskId: string, accountId: string): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('tasks:assign', { taskId, accountId }),
    updateStatus: (
      taskId: string,
      status: string,
      result?: string,
      outputs?: string[]
    ): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('tasks:updateStatus', { taskId, status, result, outputs }),
    updateRuntime: (taskId: string, patch: {
      status?: string;
      runtime?: Record<string, any>;
      errorInfo?: Record<string, any> | null;
      result?: string;
    }): Promise<{ success: boolean; task?: Task; error?: string }> =>
      ipcRenderer.invoke('tasks:updateRuntime', { taskId, ...patch }),
    update: (taskId: string, updates: {
      prompt: string;
      videoConfig?: any;
      attachments?: string[];
      audioAttachment?: string;
    }): Promise<{ success: boolean; task?: Task; error?: string }> =>
      ipcRenderer.invoke('tasks:update', { taskId, updates }),
    delete: (taskId: string): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('tasks:delete', { taskId }),
    retry: (taskId: string): Promise<{ success: boolean; task?: Task; error?: string }> =>
      ipcRenderer.invoke('tasks:retry', { taskId }),
    batchPause: (): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('tasks:batchPause'),
    getCompletedOutputs: (): Promise<Array<{ taskId: string; prompt: string; outputs: string[]; accountId: string | null; mode: GenerationMode }>> =>
      ipcRenderer.invoke('tasks:getCompletedOutputs'),
    selectImages: (): Promise<{ success: boolean; filePaths?: string[]; error?: string }> =>
      ipcRenderer.invoke('tasks:selectImages'),
    selectAudio: (): Promise<{ success: boolean; filePath?: string; error?: string }> =>
      ipcRenderer.invoke('tasks:selectAudio'),
    readFileAsBase64: (filePath: string): Promise<{ success: boolean; data?: string; error?: string }> =>
      ipcRenderer.invoke('tasks:readFileAsBase64', filePath),
    downloadOutputs: (
      outputs: Array<{ taskId: string; prompt: string; outputs: string[]; accountId: string | null; mode: GenerationMode }>,
      saveDir?: string
    ): Promise<{ success: boolean; count: number; failed: number; saveDir?: string; error?: string; jobIds?: string[] }> =>
      ipcRenderer.invoke('tasks:downloadOutputs', { outputs, saveDir }),
    listDownloads: (): Promise<any[]> => ipcRenderer.invoke('tasks:listDownloads'),
    exportDiagnostics: (): Promise<{ success: boolean; filePath?: string; error?: string }> =>
      ipcRenderer.invoke('tasks:exportDiagnostics'),
    selectSaveDir: (): Promise<{ success: boolean; dirPath?: string; error?: string }> =>
      ipcRenderer.invoke('tasks:selectSaveDir'),
  },

  // ---- 设置 ----
  settings: {
    get: (): Promise<Record<string, any>> => ipcRenderer.invoke('settings:get'),
    save: (settings: Record<string, any>): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('settings:save', settings),
  },

  // ---- 系统操作 ----
  system: {
    getVersion: (): Promise<string> => ipcRenderer.invoke('system:getVersion'),
    minimize: (): void => ipcRenderer.send('window:minimize'),
    toggleMaximize: (): void => ipcRenderer.send('window:toggleMaximize'),
    close: (): void => ipcRenderer.send('window:close'),
  },
});
