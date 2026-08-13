/**
 * main/ipc/tasks.ts
 * 任务调度 IPC 处理器
 * 负责：任务队列管理、状态流转、批量操作、生成模式
 */

import { ipcMain, dialog, session } from 'electron';
import { readJSON, writeJSON } from '../utils/store';
import { normalizeTasks, normalizeDownloadJobs } from '../utils/persistenceNormalization';
import { validateDownloadResponse, classifyDownloadException } from '../utils/downloadValidation';
import { v4 as uuidv4 } from 'uuid';
import { getDefaultProjectId } from './projects';
import { replaceIpcHandlers } from './lifecycle';
import { recoverInterruptedDownloads, removeExactDownloadPart } from '../utils/downloadRecovery';
import { TaskEventStream } from '../core/TaskEventStream';
import { TaskRepository } from '../core/TaskRepository';
import { TaskService } from '../core/TaskService';
import type {
  Task,
  TaskErrorInfo,
  TaskRunSnapshot,
  TaskRunRecord,
  TaskLock,
  TaskArtifact,
  DownloadJob,
  TaskAddParams,
  TaskAssignParams,
  TaskUpdateStatusParams,
  TaskUpdateRuntimeParams,
  TaskAcquireLockParams,
  TaskRenewLockParams,
  TaskReleaseLockParams,
  TaskImportCsvParams,
  TaskUpdateInput,
  TaskIdParams,
  CompletedOutput,
  TaskDownloadOutputsParams,
  TaskValidateArtifactParams,
  TaskSaveAdapterReportParams,
} from '@doubao-studio/contracts';

// ==================== 类型定义 ====================

// 枚举/联合类型、领域模型接口和 IPC DTO 已迁移至 @doubao-studio/contracts。
// 此处通过 import type 引用，不产生运行时依赖。

export type {
  Task,
  TaskErrorInfo,
  TaskRunSnapshot,
  TaskRunRecord,
  TaskLock,
  TaskArtifact,
  DownloadJob,
};

// ==================== 数据持久化 ====================

const DOWNLOAD_STORE_FILE = 'downloads.json';
let downloadRecoveryApplied = false;
export const taskEventStream = new TaskEventStream();
const taskRepository = new TaskRepository({
  read: (filename, fallback) => readJSON(filename, fallback),
  write: (filename, data) => writeJSON(filename, data),
  normalize: normalizeTasks,
  defaultProjectId: getDefaultProjectId,
  events: taskEventStream,
  warn: (message, details) => console.warn(message, details),
});
const taskService = new TaskService({ store: taskRepository, defaultProjectId: getDefaultProjectId });

/** 读取所有任务（含运行时归一化） */
function loadTasks(): Task[] {
  return taskRepository.read();
}

function saveTasks(tasks: Task[]): boolean {
  return taskRepository.replace(tasks);
}

/** 读取下载记录（含运行时归一化 + 中断恢复） */
function loadDownloadJobs(): DownloadJob[] {
  const raw = readJSON<unknown>(DOWNLOAD_STORE_FILE, []);
  const result = normalizeDownloadJobs(raw);
  // 仅在归一化确实改变数据时写回磁盘
  if (result.changed) {
    writeJSON(DOWNLOAD_STORE_FILE, result.data);
  }
  if (result.warnings.length > 0) {
    console.warn('[Downloads] 数据归一化告警:', result.warnings);
  }
  const jobs = result.data;
  // 下载中断恢复：将上次进程遗留的 'downloading' 状态标记为 'failed'
  if (!downloadRecoveryApplied) {
    downloadRecoveryApplied = true;
    const fs = require('fs') as typeof import('fs');
    const path = require('path') as typeof import('path');
    const recovery = recoverInterruptedDownloads(fs, path, jobs, new Date().toISOString());
    if (recovery.recovered > 0) writeJSON(DOWNLOAD_STORE_FILE, jobs);
  }
  return jobs;
}

function saveDownloadJobs(jobs: DownloadJob[]): boolean {
  return writeJSON(DOWNLOAD_STORE_FILE, jobs.slice(-1000));
}

function getAvailableDownloadPath(fs: typeof import('fs'), path: typeof import('path'), saveDir: string, fileName: string): string {
  const parsed = path.parse(fileName);
  let candidate = path.join(saveDir, fileName);
  for (let suffix = 2; fs.existsSync(candidate); suffix++) {
    candidate = path.join(saveDir, `${parsed.name}-${suffix}${parsed.ext}`);
  }
  return candidate;
}

// ==================== IPC 处理器注册 ====================

const TASK_IPC_CHANNELS = [
  'tasks:list', 'tasks:add', 'tasks:assign', 'tasks:updateStatus', 'tasks:update',
  'tasks:delete', 'tasks:retry', 'tasks:batchPause', 'tasks:updateRuntime',
  'tasks:acquireLock', 'tasks:renewLock', 'tasks:importCsv', 'tasks:releaseLock',
  'tasks:getCompletedOutputs', 'tasks:selectImages', 'tasks:selectAudio',
  'tasks:readFileAsBase64', 'tasks:downloadOutputs', 'tasks:listDownloads',
  'tasks:exportDiagnostics', 'tasks:validateArtifact', 'tasks:saveAdapterReport',
  'tasks:selectAdapterRules', 'settings:get', 'settings:save', 'tasks:selectSaveDir',
] as const;

export function registerTaskIPC(): () => void {
  const dispose = replaceIpcHandlers(ipcMain, TASK_IPC_CHANNELS);
  const recoveryResult = taskService.recoverInterruptedTasks();
  if (!recoveryResult.success) {
    dispose();
    throw new Error('任务恢复失败，请检查数据目录和磁盘状态');
  }
  // 在任何新下载开始前，仅恢复上次进程遗留的下载状态。
  loadDownloadJobs();
  writeJSON('schema.json', { version: 6, appVersion: '2.0.0', updatedAt: new Date().toISOString() });
  // ---- 获取所有任务 ----
  ipcMain.handle('tasks:list', async (): Promise<Task[]> => {
    const tasks = loadTasks();
    return tasks;
  });

  // ---- 添加任务（支持批量 + 指定模式 + 视频配置 + 附件） ----
  ipcMain.handle(
    'tasks:add',
    async (_event, params: TaskAddParams): Promise<{ success: boolean; tasks?: Task[]; error?: string }> => {
      try {
        const result = taskService.create(params);
        return result.success ? { success: true, tasks: result.data } : result;
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    }
  );

  // ---- 指派任务给账号 ----
  ipcMain.handle(
    'tasks:assign',
    async (_event, params: TaskAssignParams): Promise<{ success: boolean; error?: string }> => {
      return taskService.assign(params);
    }
  );

  // ---- 更新任务状态 ----
  ipcMain.handle(
    'tasks:updateStatus',
    async (
      _event,
      params: TaskUpdateStatusParams
    ): Promise<{ success: boolean; error?: string }> => {
      return taskService.updateStatus(params);
    }
  );

  // ---- 编辑任务并重置为待执行 ----
  ipcMain.handle(
    'tasks:update',
    async (
      _event,
      params: {
        taskId: string;
        updates: TaskUpdateInput;
      }
    ): Promise<{ success: boolean; task?: Task; error?: string }> => {
      const result = taskService.update(params);
      return result.success ? { success: true, task: result.data } : result;
    }
  );

  // ---- 删除任务 ----
  ipcMain.handle(
    'tasks:delete',
    async (_event, params: TaskIdParams): Promise<{ success: boolean; error?: string }> => {
      return taskService.delete(params.taskId);
    }
  );

  // ---- 重试任务（失败/已完成任务重置为排队状态） ----
  ipcMain.handle(
    'tasks:retry',
    async (_event, params: TaskIdParams): Promise<{ success: boolean; task?: Task; error?: string }> => {
      const result = taskService.retry(params.taskId);
      return result.success ? { success: true, task: result.data } : result;
    }
  );

  // ---- 批量暂停/继续 ----
  ipcMain.handle(
    'tasks:batchPause',
    async (): Promise<{ success: boolean }> => {
      const result = taskService.batchPause();
      return { success: result.success };
    }
  );

  // ---- 持久化运行阶段、心跳与结构化错误 ----
  ipcMain.handle(
    'tasks:updateRuntime',
    async (_event, params: TaskUpdateRuntimeParams): Promise<{ success: boolean; task?: Task; error?: string }> => {
      const result = taskService.updateRuntime(params);
      return result.success ? { success: true, task: result.data } : result;
    }
  );

  ipcMain.handle(
    'tasks:acquireLock',
    async (_event, params: TaskAcquireLockParams): Promise<{ success: boolean; task?: Task; error?: string }> => {
      const result = taskService.acquireLock(params);
      return result.success ? { success: true, task: result.data } : result;
    }
  );

  ipcMain.handle(
    'tasks:renewLock',
    async (_event, params: TaskRenewLockParams): Promise<{ success: boolean; task?: Task; error?: string }> => {
      const result = taskService.renewLock(params);
      return result.success ? { success: true, task: result.data } : result;
    }
  );

  ipcMain.handle(
    'tasks:importCsv',
    async (_event, params?: TaskImportCsvParams): Promise<{ success: boolean; tasks?: Task[]; batchId?: string; imported?: number; skipped?: number; errors?: string[]; error?: string }> => {
      try {
        const selected = await dialog.showOpenDialog({
          title: '导入 CSV 任务',
          properties: ['openFile'],
          filters: [{ name: 'CSV', extensions: ['csv'] }],
        });
        if (selected.canceled || !selected.filePaths[0]) return { success: false };
        const fs = require('fs');
        const raw = fs.readFileSync(selected.filePaths[0], 'utf-8');
        const accounts = readJSON<Array<{ id: string; name: string }>>('accounts.json', []);
        const result = taskService.importCsv({ text: raw, accounts, projectId: params?.projectId });
        if (result.success) {
          return {
            success: true,
            tasks: result.data.tasks,
            batchId: result.data.batchId,
            imported: result.data.imported,
            skipped: result.data.skipped,
            errors: result.data.errors,
          };
        }
        return { success: false, error: result.error };
      } catch {
        return { success: false, error: 'CSV 导入失败，请检查文件格式和数据目录状态' };
      }
    }
  );

  ipcMain.handle(
    'tasks:releaseLock',
    async (_event, params: TaskReleaseLockParams): Promise<{ success: boolean; error?: string }> => {
      return taskService.releaseLock(params);
    }
  );

  // ---- 批量获取已完成任务的产物 ----
  ipcMain.handle(
    'tasks:getCompletedOutputs',
    async (): Promise<CompletedOutput[]> => {
      const tasks = loadTasks();
      return tasks
        .filter((t) => t.status === 'done' && t.outputs.length > 0)
        .map((t) => ({
          taskId: t.id,
          prompt: t.prompt,
          outputs: t.outputs,
          accountId: t.assignedAccountId,
          mode: t.mode,
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
      params: TaskDownloadOutputsParams
    ): Promise<{ success: boolean; count: number; failed: number; saveDir?: string; error?: string; jobIds?: string[] }> => {
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
        const failures: string[] = [];
        const jobs = loadDownloadJobs();
        const jobIds: string[] = [];
        const accounts = readJSON<Array<{ id: string; partition: string }>>('accounts.json', []);

        for (const task of params.outputs) {
          const account = accounts.find((item) => item.id === task.accountId);
          const accountSession = account
            ? session.fromPartition(`persist:doubao_${account.partition}`)
            : session.defaultSession;
          for (let outputIndex = 0; outputIndex < task.outputs.length; outputIndex++) {
            const url = task.outputs[outputIndex];
            let parsedUrl: URL;
            try {
              parsedUrl = new URL(url);
              if (!['http:', 'https:'].includes(parsedUrl.protocol)) throw new Error('不支持的地址协议');
            } catch {
              failures.push(`${task.taskId.slice(0, 8)}: 产物地址无效`);
              continue;
            }
            const now = new Date().toISOString();
            const job: DownloadJob = {
              id: uuidv4(),
              taskId: task.taskId,
              accountId: task.accountId,
              mode: task.mode,
              url,
              status: 'downloading',
              attempts: 1,
              saveDir,
              createdAt: now,
              updatedAt: now,
            };
            jobs.push(job);
            jobIds.push(job.id);
            saveDownloadJobs(jobs);
            let temporaryPath: string | undefined;
            try {
              const controller = new AbortController();
              const timeout = setTimeout(() => controller.abort(), 60000);
              const response = await accountSession.fetch(url, {
                headers: {
                  Referer: 'https://www.doubao.com/',
                  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
                },
                signal: controller.signal,
              }).finally(() => clearTimeout(timeout));

              const buffer = Buffer.from(await response.arrayBuffer());
              const contentType = response.headers.get('content-type') || '';

              // 统一验证：HTTP 状态、非空文件、视频 content-type
              const validation = validateDownloadResponse(response.status, contentType, buffer.length, task.mode);
              if (!validation.valid) {
                const failure = validation.message || '下载验证失败';
                failures.push(`${task.taskId.slice(0, 8)}: ${failure}`);
                job.status = 'failed';
                job.error = failure;
                job.updatedAt = new Date().toISOString();
                saveDownloadJobs(jobs);
                continue;
              }

              let ext = path.extname(parsedUrl.pathname).toLowerCase();
              if (!ext || ext.length > 6) {
                if (contentType.includes('video/mp4') || task.mode === 'video') ext = '.mp4';
                else if (contentType.includes('webp')) ext = '.webp';
                else if (contentType.includes('jpeg')) ext = '.jpg';
                else ext = '.png';
              }
              const fileName = `${task.taskId.substring(0, 8)}_${outputIndex + 1}${ext}`;
              const filePath = getAvailableDownloadPath(fs, path, saveDir, fileName);
              temporaryPath = `${filePath}.${job.id}.part`;
              fs.writeFileSync(temporaryPath, buffer);
              fs.renameSync(temporaryPath, filePath);
              job.status = 'done';
              job.filePath = filePath;
              job.bytes = buffer.length;
              job.updatedAt = new Date().toISOString();
              saveDownloadJobs(jobs);
              downloadedCount++;
            } catch (e: any) {
              try {
                removeExactDownloadPart(fs, path, saveDir, temporaryPath, job.id);
              } catch {}
              const classified = classifyDownloadException(e);
              failures.push(`${task.taskId.slice(0, 8)}: ${classified.message}`);
              job.status = 'failed';
              job.error = classified.message;
              job.updatedAt = new Date().toISOString();
              saveDownloadJobs(jobs);
              console.warn(`[tasks:downloadOutputs] 下载产物失败 (${classified.type}):`, e.message);
            }
          }
        }

        return {
          success: downloadedCount > 0,
          count: downloadedCount,
          failed: failures.length,
          saveDir,
          error: failures.length ? failures.slice(0, 3).join('；') : undefined,
          jobIds,
        };
      } catch (err: any) {
        return { success: false, count: 0, failed: 0, error: err.message };
      }
    }
  );

  ipcMain.handle('tasks:listDownloads', async (): Promise<DownloadJob[]> => {
    return loadDownloadJobs();
  });

  ipcMain.handle(
    'tasks:exportDiagnostics',
    async (): Promise<{ success: boolean; filePath?: string; error?: string }> => {
      try {
        const fs = require('fs');
        const path = require('path');
        const result = await dialog.showSaveDialog({
          title: '导出诊断包',
          defaultPath: `doubao-studio-diagnostics-${new Date().toISOString().slice(0, 10)}.json`,
          filters: [{ name: 'JSON', extensions: ['json'] }],
        });
        if (result.canceled || !result.filePath) return { success: false };

        const tasks = loadTasks().map((task) => ({
          ...task,
          prompt: `[已脱敏，长度 ${task.prompt.length}]`,
          attachments: (task.attachments || []).map((item) => path.basename(item)),
          audioAttachment: task.audioAttachment ? path.basename(task.audioAttachment) : undefined,
          outputs: task.outputs.map((_, index) => `[产物地址 ${index + 1}]`),
          artifacts: (task.artifacts || []).map((artifact) => ({ ...artifact, url: '[已脱敏]' })),
        }));
        const accounts = readJSON<Array<Record<string, any>>>('accounts.json', []).map((account) => ({
          id: account.id,
          name: account.name,
          status: account.status,
          pinned: account.pinned,
          seedanceQuota: account.seedanceQuota,
          health: account.health,
        }));
        const downloads = loadDownloadJobs().map((job) => ({
          ...job,
          url: '[已脱敏]',
          saveDir: path.basename(job.saveDir),
          filePath: job.filePath ? path.basename(job.filePath) : undefined,
        }));
        const payload = {
          exportedAt: new Date().toISOString(),
          appVersion: require('electron').app.getVersion(),
          platform: process.platform,
          taskCount: tasks.length,
          accountCount: accounts.length,
          tasks,
          accounts,
          downloads,
        };
        fs.writeFileSync(result.filePath, JSON.stringify(payload, null, 2), 'utf-8');
        return { success: true, filePath: result.filePath };
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    }
  );

  ipcMain.handle(
    'tasks:validateArtifact',
    async (_event, params: TaskValidateArtifactParams): Promise<{ success: boolean; artifact?: TaskArtifact; error?: string }> => {
      const tasks = loadTasks();
      const task = tasks.find((item) => item.id === params.taskId);
      const artifact = task?.artifacts?.find((item) => item.id === params.artifactId);
      if (!task || !artifact) return { success: false, error: '产物不存在' };
      const accounts = readJSON<Array<{ id: string; partition: string }>>('accounts.json', []);
      const account = accounts.find((item) => item.id === task.assignedAccountId);
      const accountSession = account ? session.fromPartition(`persist:doubao_${account.partition}`) : session.defaultSession;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15_000);
      try {
        const response = await accountSession.fetch(artifact.url, {
          method: 'GET',
          headers: { Referer: 'https://www.doubao.com/', Range: 'bytes=0-0' },
          signal: controller.signal,
        });
        await response.body?.cancel();
        const statusCode = response.status;
        artifact.validation = {
          state: response.ok || statusCode === 206 ? 'valid' : [401, 403, 404, 410].includes(statusCode) ? 'expired' : 'invalid',
          checkedAt: new Date().toISOString(),
          contentType: response.headers.get('content-type') || undefined,
          contentLength: Number(response.headers.get('content-length') || 0) || undefined,
          statusCode,
        };
      } catch (err: any) {
        artifact.validation = {
          state: err.name === 'AbortError' ? 'unknown' : 'invalid',
          checkedAt: new Date().toISOString(),
          error: err.name === 'AbortError' ? '验证超时' : err.message,
        };
      } finally {
        clearTimeout(timer);
      }
      task.updatedAt = new Date().toISOString();
      saveTasks(tasks);
      return { success: artifact.validation.state === 'valid', artifact, error: artifact.validation.error };
    }
  );

  ipcMain.handle(
    'tasks:saveAdapterReport',
    async (_event, params: TaskSaveAdapterReportParams): Promise<{ success: boolean }> => {
      const reports = readJSON<Array<Record<string, any>>>('adapter-diagnostics.json', []);
      reports.push({ ...params.report, accountId: params.accountId, savedAt: new Date().toISOString() });
      writeJSON('adapter-diagnostics.json', reports.slice(-50));
      return { success: true };
    }
  );

  ipcMain.handle(
    'tasks:selectAdapterRules',
    async (): Promise<{ success: boolean; bundle?: Record<string, any>; error?: string }> => {
      try {
        const selected = await dialog.showOpenDialog({
          title: '导入豆包页面适配规则', properties: ['openFile'],
          filters: [{ name: 'JSON', extensions: ['json'] }],
        });
        if (selected.canceled || !selected.filePaths[0]) return { success: false };
        const fs = require('fs');
        const bundle = JSON.parse(fs.readFileSync(selected.filePaths[0], 'utf-8'));
        return { success: true, bundle };
      } catch (err: any) {
        return { success: false, error: err.message };
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

  console.log('[IPC] 任务调度模块已注册');
  return dispose;
}
