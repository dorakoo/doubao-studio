/**
 * main/ipc/tasks.ts
 * 任务调度 IPC 处理器
 * 负责：任务队列管理、状态流转、批量操作、生成模式
 */

import { ipcMain, dialog } from 'electron';
import { readJSON, writeJSON } from '../utils/store';
import { v4 as uuidv4 } from 'uuid';

// ==================== 类型定义 ====================

/** 生成模式 */
export type GenerationMode = 'chat' | 'image' | 'video' | 'music';

/** 视频生成模型 */
export type VideoModel = 'seedance-2.0' | 'seedance-2.0-fast' | 'seedance-2.0-mini';

/** 视频时长 */
export type VideoDuration = '5s' | '10s';

/** 视频比例 */
export type VideoAspectRatio = '1:1' | '3:4' | '4:3' | '9:16' | '16:9' | '21:9';

/** 任务状态（V2 扩展） */
export type TaskStatus = 'queued' | 'executing' | 'generating' | 'done' | 'fail';

/** 任务数据结构 */
export interface Task {
  id: string;
  /** 提示词文本 */
  prompt: string;
  /** 分配的目标账号 ID */
  assignedAccountId: string | null;
  /** 任务状态 */
  status: TaskStatus;
  /** 生成模式 */
  mode: GenerationMode;
  /** 视频生成配置 */
  videoConfig?: {
    model: VideoModel;
    duration: VideoDuration;
    aspectRatio: VideoAspectRatio;
  };
  /** 参考图片路径列表 */
  attachments?: string[];
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
    const tasks = loadTasks();
    // 兼容旧数据：无 mode 字段默认 chat
    return tasks.map(t => ({ ...t, mode: t.mode || 'chat' as GenerationMode }));
  });

  // ---- 添加任务（支持批量 + 指定模式 + 视频配置 + 附件） ----
  ipcMain.handle(
    'tasks:add',
    async (_event, params: {
      prompts: string[];
      mode?: GenerationMode;
      videoConfig?: Task['videoConfig'];
      attachments?: string[];
      audioAttachment?: string;
    }): Promise<{ success: boolean; tasks?: Task[]; error?: string }> => {
      try {
        if (!params.prompts || params.prompts.length === 0) {
          return { success: false, error: '请输入至少一条提示词' };
        }

        const tasks = loadTasks();
        const mode: GenerationMode = params.mode || 'chat';
        const newTasks: Task[] = params.prompts
          .filter((p) => p.trim().length > 0)
          .map((prompt) => ({
            id: uuidv4(),
            prompt: prompt.trim(),
            assignedAccountId: null,
            status: 'queued' as TaskStatus,
            mode,
            videoConfig: params.videoConfig,
            attachments: params.attachments,
            audioAttachment: params.audioAttachment,
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
      if (task.status === 'executing' || task.status === 'generating') {
        return { success: false, error: '任务正在自动化执行中，无法重新指派' };
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

  // ---- 重试任务（失败/已完成任务重置为排队状态） ----
  ipcMain.handle(
    'tasks:retry',
    async (_event, params: { taskId: string }): Promise<{ success: boolean; task?: Task; error?: string }> => {
      const tasks = loadTasks();
      const task = tasks.find((t) => t.id === params.taskId);
      if (!task) {
        return { success: false, error: '任务不存在' };
      }
      if (task.status === 'executing' || task.status === 'generating') {
        return { success: false, error: '任务正在执行中，无法重试' };
      }

      task.status = 'queued';
      task.result = null;
      task.outputs = [];
      task.updatedAt = new Date().toISOString();
      saveTasks(tasks);

      return { success: true, task };
    }
  );

  // ---- 批量暂停/继续 ----
  ipcMain.handle(
    'tasks:batchPause',
    async (): Promise<{ success: boolean }> => {
      const tasks = loadTasks();
      for (const task of tasks) {
        if (task.status === 'executing' || task.status === 'generating') {
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

  // ---- 选择参考图片（文件对话框） ----
  ipcMain.handle(
    'tasks:selectImages',
    async (): Promise<{ success: boolean; filePaths?: string[]; error?: string }> => {
      try {
        const result = await dialog.showOpenDialog({
          properties: ['openFile', 'multiSelections'],
          filters: [
            { name: '图片文件', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp'] },
          ],
          title: '选择参考图片',
        });
        if (result.canceled) {
          return { success: true, filePaths: [] };
        }
        return { success: true, filePaths: result.filePaths };
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    }
  );

  // ---- 选择参考音频（文件对话框） ----
  ipcMain.handle(
    'tasks:selectAudio',
    async (): Promise<{ success: boolean; filePath?: string; error?: string }> => {
      try {
        const result = await dialog.showOpenDialog({
          properties: ['openFile'],
          filters: [
            { name: '音频文件', extensions: ['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg'] },
          ],
          title: '选择参考音频',
        });
        if (result.canceled || result.filePaths.length === 0) {
          return { success: true };
        }
        return { success: true, filePath: result.filePaths[0] };
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    }
  );

  console.log('[IPC] 任务调度模块已注册');
}

  // ---- 读取文件为 base64（用于缩略图显示） ----
  ipcMain.handle(
    'tasks:readFileAsBase64',
    async (_event, filePath: string): Promise<{ success: boolean; data?: string; error?: string }> => {
      try {
        const fs = require('fs');
        const fileBuffer = fs.readFileSync(filePath);
        const base64 = fileBuffer.toString('base64');
        // 根据文件扩展名推断 MIME 类型
        const ext = filePath.split('.').pop()?.toLowerCase();
        const mimeTypes: Record<string, string> = {
          png: 'image/png',
          jpg: 'image/jpeg',
          jpeg: 'image/jpeg',
          webp: 'image/webp',
          bmp: 'image/bmp',
          mp3: 'audio/mpeg',
          wav: 'audio/wav',
          m4a: 'audio/mp4',
          aac: 'audio/aac',
          flac: 'audio/flac',
          ogg: 'audio/ogg',
        };
        const mime = mimeTypes[ext || ''] || 'image/jpeg';
        return { success: true, data: `data:${mime};base64,${base64}` };
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    }
  );

  // ---- 批量下载产物 ----
  ipcMain.handle(
    'tasks:downloadOutputs',
    async (
      _event,
      params: { outputs: Array<{ taskId: string; prompt: string; outputs: string[] }>; saveDir?: string }
    ): Promise<{ success: boolean; count: number; error?: string }> => {
      try {
        const fs = require('fs');
        const path = require('path');
        const { app } = require('electron');

        // 默认下载目录
        const defaultDir = path.join(app.getPath('downloads'), '豆包工作室产物');
        const saveDir = params.saveDir || defaultDir;

        // 确保目录存在
        if (!fs.existsSync(saveDir)) {
          fs.mkdirSync(saveDir, { recursive: true });
        }

        let downloadedCount = 0;

        for (const task of params.outputs) {
          for (const url of task.outputs) {
            try {
              // 从 URL 推断文件扩展名
              const urlPath = new URL(url).pathname;
              const ext = path.extname(urlPath) || '.png';
              // 生成文件名：taskId_序号.ext
              const fileName = `${task.taskId.substring(0, 8)}_${downloadedCount}${ext}`;
              const filePath = path.join(saveDir, fileName);

              // 下载文件
              const response = await fetch(url);
              if (!response.ok) {
                console.warn(`[tasks:downloadOutputs] 下载失败 ${url}: ${response.status}`);
                continue;
              }

              const buffer = Buffer.from(await response.arrayBuffer());
              fs.writeFileSync(filePath, buffer);
              downloadedCount++;
            } catch (e: any) {
              console.warn(`[tasks:downloadOutputs] 下载产物失败:`, e.message);
            }
          }
        }

        return { success: true, count: downloadedCount };
      } catch (err: any) {
        return { success: false, count: 0, error: err.message };
      }
    }
  );

  // ---- 保存/获取设置 ----
  const settingsPath = require('path').join(
    require('electron').app.getPath('userData'),
    'settings.json'
  );

  ipcMain.handle(
    'settings:get',
    async (): Promise<Record<string, any>> => {
      try {
        const fs = require('fs');
        if (fs.existsSync(settingsPath)) {
          return JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
        }
      } catch (e: any) {
        console.warn('[settings:get] 读取设置失败:', e.message);
      }
      return {};
    }
  );

  ipcMain.handle(
    'settings:save',
    async (_event, settings: Record<string, any>): Promise<{ success: boolean; error?: string }> => {
      try {
        const fs = require('fs');
        const path = require('path');
        const dir = path.dirname(settingsPath);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');
        return { success: true };
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    }
  );

  // ---- 选择下载目录 ----
  ipcMain.handle(
    'tasks:selectSaveDir',
    async (): Promise<{ success: boolean; dirPath?: string; error?: string }> => {
      try {
        const result = await dialog.showOpenDialog({
          properties: ['openDirectory', 'createDirectory'],
          title: '选择下载目录',
        });
        if (result.canceled) {
          return { success: true, dirPath: undefined };
        }
        return { success: true, dirPath: result.filePaths[0] };
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    }
  );
