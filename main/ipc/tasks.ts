/**
 * main/ipc/tasks.ts
 * 任务调度 IPC 处理器
 * 负责：任务队列管理、状态流转、批量操作、生成模式
 */

import { ipcMain, dialog, session } from 'electron';
import { readJSON, writeJSON } from '../utils/store';
import { validateDownloadResponse, classifyDownloadException } from '../utils/downloadValidation';
import { v4 as uuidv4 } from 'uuid';
import { getDefaultProjectId } from './projects';

// ==================== 类型定义 ====================

/** 生成模式 */
export type GenerationMode = 'chat' | 'image' | 'video' | 'music';

/** 视频生成模型 */
export type VideoModel = 'seedance-2.0' | 'seedance-2.0-fast' | 'seedance-2.0-mini';

/** 视频时长 */
export type VideoDuration = '5s' | '10s' | '15s';

/** 视频比例 */
export type VideoAspectRatio = '1:1' | '3:4' | '4:3' | '9:16' | '16:9' | '21:9';

export type TaskStatus =
  | 'queued'
  | 'executing'
  | 'generating'
  | 'waiting_verification'
  | 'paused'
  | 'done'
  | 'fail'
  | 'cancelled';

export type TaskStage =
  | 'queued' | 'preparing_account' | 'new_conversation' | 'switching_mode'
  | 'configuring' | 'uploading_assets' | 'injecting_prompt' | 'submitting'
  | 'waiting_verification' | 'generating' | 'extracting_outputs'
  | 'completed' | 'paused' | 'failed' | 'cancelled';

export interface TaskErrorInfo {
  code: string;
  message: string;
  recoverable: boolean;
  detectedAt: string;
}

export interface TaskRunSnapshot {
  runId: string;
  attempt: number;
  stage: TaskStage;
  message: string;
  startedAt: string;
  stageStartedAt: string;
  lastHeartbeatAt: string;
  submittedAt?: string;
  conversationUrl?: string;
  input: {
    prompt: string;
    mode: GenerationMode;
    videoConfig?: Task['videoConfig'];
    attachments: string[];
    audioAttachment?: string;
  };
}

export interface TaskRunRecord {
  runId: string;
  attempt: number;
  startedAt: string;
  finishedAt?: string;
  finalStage?: TaskStage;
  outcome?: 'done' | 'failed' | 'paused' | 'cancelled';
  errorCode?: string;
  durationMs?: number;
}

export interface TaskLock {
  ownerId: string;
  acquiredAt: string;
  expiresAt: string;
}

export interface TaskArtifact {
  id: string;
  url: string;
  kind: 'image' | 'video' | 'file';
  source: 'network' | 'page' | 'manual';
  runId?: string;
  conversationUrl?: string;
  discoveredAt: string;
  validation?: {
    state: 'unknown' | 'valid' | 'expired' | 'invalid';
    checkedAt: string;
    contentType?: string;
    contentLength?: number;
    statusCode?: number;
    error?: string;
  };
}

export interface DownloadJob {
  id: string;
  taskId: string;
  accountId: string | null;
  mode: GenerationMode;
  url: string;
  status: 'queued' | 'downloading' | 'done' | 'failed';
  attempts: number;
  saveDir: string;
  filePath?: string;
  bytes?: number;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

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
  /** 参考音频文件路径 */
  audioAttachment?: string;
  /** 执行结果/产出描述 */
  result: string | null;
  /** 产物的下载链接列表 */
  outputs: string[];
  artifacts?: TaskArtifact[];
  runtime?: TaskRunSnapshot;
  errorInfo?: TaskErrorInfo;
  runHistory?: TaskRunRecord[];
  lock?: TaskLock;
  batchId?: string;
  source?: 'manual' | 'csv' | 'workflow';
  dependsOnTaskIds?: string[];
  dependencyPolicy?: 'all_done' | 'all_finished';
  projectId?: string;
  createdAt: string;
  updatedAt: string;
}

// ==================== 数据持久化 ====================

const STORE_FILE = 'tasks.json';
const DOWNLOAD_STORE_FILE = 'downloads.json';
let downloadRecoveryApplied = false;

function loadTasks(): Task[] {
  const defaultProjectId = getDefaultProjectId();
  const rawTasks = readJSON<Task[]>(STORE_FILE, []);
  let migrated = false;
  const tasks = rawTasks.map((task) => {
    if (!task.projectId) migrated = true;
    return ({
    ...task,
    mode: task.mode || 'chat',
    outputs: Array.isArray(task.outputs) ? task.outputs : [],
    artifacts: Array.isArray(task.artifacts) ? task.artifacts : [],
    runHistory: Array.isArray(task.runHistory) ? task.runHistory : [],
    source: task.source || 'manual',
    dependsOnTaskIds: Array.isArray(task.dependsOnTaskIds) ? task.dependsOnTaskIds : [],
    projectId: task.projectId || defaultProjectId,
  });
  });
  if (migrated) writeJSON(STORE_FILE, tasks);
  return tasks;
}

function artifactId(url: string): string {
  let hash = 5381;
  for (let index = 0; index < url.length; index++) hash = ((hash << 5) + hash) ^ url.charCodeAt(index);
  return `artifact-${(hash >>> 0).toString(16)}`;
}

function appendArtifacts(task: Task, outputs: string[], source: TaskArtifact['source'] = 'network'): void {
  const existing = new Map((task.artifacts || []).map((artifact) => [artifact.url, artifact]));
  for (const url of outputs) {
    if (!url || existing.has(url)) continue;
    const artifact: TaskArtifact = {
      id: artifactId(url),
      url,
      kind: task.mode === 'video' ? 'video' : task.mode === 'image' ? 'image' : 'file',
      source,
      runId: task.runtime?.runId,
      conversationUrl: task.runtime?.conversationUrl,
      discoveredAt: new Date().toISOString(),
    };
    existing.set(url, artifact);
  }
  task.artifacts = [...existing.values()];
}

import { parseCsv, normalizeCsvMode } from '../utils/csv';

function saveTasks(tasks: Task[]): boolean {
  return writeJSON(STORE_FILE, tasks);
}

function saveTasksOrError(tasks: Task[]): { success: true } | { success: false; error: string } {
  return saveTasks(tasks)
    ? { success: true }
    : { success: false, error: '任务数据写入失败，请检查磁盘空间和数据目录权限' };
}

function loadDownloadJobs(): DownloadJob[] {
  const jobs = readJSON<DownloadJob[]>(DOWNLOAD_STORE_FILE, []);
  if (!downloadRecoveryApplied) {
    downloadRecoveryApplied = true;
    let changed = false;
    for (const job of jobs) {
      if (job.status !== 'downloading') continue;
      job.status = 'failed';
      job.error = '程序退出导致下载中断，可重新下载';
      job.updatedAt = new Date().toISOString();
      changed = true;
    }
    if (changed) writeJSON(DOWNLOAD_STORE_FILE, jobs);
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

function resetTaskForQueue(task: Task): void {
  task.status = 'queued';
  task.result = null;
  task.outputs = [];
  task.errorInfo = undefined;
  if (task.runtime) {
    const now = new Date().toISOString();
    task.runtime = {
      ...task.runtime,
      stage: 'queued',
      message: '等待执行',
      stageStartedAt: now,
      lastHeartbeatAt: now,
    };
  }
  task.updatedAt = new Date().toISOString();
}

function recoverInterruptedTasks(): void {
  const tasks = loadTasks();
  let changed = false;
  const now = new Date().toISOString();
  for (const task of tasks) {
    const wasActive = task.status === 'executing' || task.status === 'generating' || task.status === 'waiting_verification';
    if (!wasActive) {
      if (task.lock) {
        task.lock = undefined;
        changed = true;
      }
      continue;
    }
    task.status = 'paused';
    task.result = '程序上次退出时任务仍在运行，可重新执行';
    task.errorInfo = {
      code: 'cancelled',
      message: task.result,
      recoverable: true,
      detectedAt: now,
    };
    if (task.runtime) {
      task.runtime = {
        ...task.runtime,
        stage: 'paused',
        message: '程序重启，任务已安全暂停',
        stageStartedAt: now,
        lastHeartbeatAt: now,
      };
    }
    task.updatedAt = now;
    task.lock = undefined;
    const activeRun = task.runtime && task.runHistory?.find((run) => run.runId === task.runtime!.runId && !run.finishedAt);
    if (activeRun) {
      activeRun.finishedAt = now;
      activeRun.finalStage = 'paused';
      activeRun.outcome = 'paused';
      activeRun.errorCode = 'cancelled';
      activeRun.durationMs = Math.max(0, new Date(now).getTime() - new Date(activeRun.startedAt).getTime());
    }
    changed = true;
  }
  if (changed) saveTasks(tasks);
}

// ==================== IPC 处理器注册 ====================

export function registerTaskIPC(): void {
  recoverInterruptedTasks();
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
    async (_event, params: {
      prompts: string[];
      mode?: GenerationMode;
      videoConfig?: Task['videoConfig'];
      attachments?: string[];
      audioAttachment?: string;
      projectId?: string;
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
            artifacts: [],
            runHistory: [],
            source: 'manual',
            dependsOnTaskIds: [],
            projectId: params.projectId || getDefaultProjectId(),
            errorInfo: undefined,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          }));

        tasks.push(...newTasks);
        const saved = saveTasksOrError(tasks);
        if (!saved.success) return saved;

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
      if (task.status === 'executing' || task.status === 'generating' || task.status === 'waiting_verification') {
        return { success: false, error: '任务正在自动化执行中，无法重新指派' };
      }

      task.assignedAccountId = params.accountId;
      resetTaskForQueue(task);
      const saved = saveTasksOrError(tasks);
      if (!saved.success) return saved;

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
      if (params.outputs !== undefined) {
        task.outputs = [...new Set(params.outputs.filter(Boolean))];
        appendArtifacts(task, task.outputs);
      }
      if (params.status === 'done') task.errorInfo = undefined;
      task.updatedAt = new Date().toISOString();
      saveTasks(tasks);

      return { success: true };
    }
  );

  // ---- 编辑任务并重置为待执行 ----
  ipcMain.handle(
    'tasks:update',
    async (
      _event,
      params: {
        taskId: string;
        updates: {
          prompt: string;
          videoConfig?: Task['videoConfig'];
          attachments?: string[];
          audioAttachment?: string;
        };
      }
    ): Promise<{ success: boolean; task?: Task; error?: string }> => {
      const tasks = loadTasks();
      const task = tasks.find((t) => t.id === params.taskId);
      if (!task) {
        return { success: false, error: '任务不存在' };
      }

      const prompt = params.updates?.prompt?.trim();
      if (!prompt) {
        return { success: false, error: '提示词不能为空' };
      }

      task.prompt = prompt;
      task.videoConfig = params.updates.videoConfig;
      task.attachments = params.updates.attachments?.length ? params.updates.attachments : undefined;
      task.audioAttachment = params.updates.audioAttachment || undefined;
      resetTaskForQueue(task);
      const saved = saveTasksOrError(tasks);
      if (!saved.success) return saved;

      return { success: true, task };
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
      const task = tasks[idx];
      if (['executing', 'generating', 'waiting_verification'].includes(task.status)) {
        return { success: false, error: '任务正在执行，请先暂停后再删除' };
      }
      const dependentCount = tasks.filter((item) => item.dependsOnTaskIds?.includes(task.id)).length;
      if (dependentCount > 0) {
        return { success: false, error: `仍有 ${dependentCount} 个任务依赖此任务，请先调整依赖关系` };
      }

      tasks.splice(idx, 1);
      const saved = saveTasksOrError(tasks);
      if (!saved.success) return saved;
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
      if (task.status === 'executing' || task.status === 'generating' || task.status === 'waiting_verification') {
        return { success: false, error: '任务正在执行中，无法重试' };
      }

      resetTaskForQueue(task);
      const saved = saveTasksOrError(tasks);
      if (!saved.success) return saved;

      return { success: true, task };
    }
  );

  // ---- 批量暂停/继续 ----
  ipcMain.handle(
    'tasks:batchPause',
    async (): Promise<{ success: boolean }> => {
      const tasks = loadTasks();
      for (const task of tasks) {
        if (task.status === 'executing' || task.status === 'generating' || task.status === 'waiting_verification') {
          const now = new Date().toISOString();
          task.status = 'paused';
          task.result = '批量暂停';
          task.errorInfo = { code: 'cancelled', message: '批量暂停', recoverable: true, detectedAt: now };
          if (task.runtime) {
            task.runtime = { ...task.runtime, stage: 'paused', message: '批量暂停', stageStartedAt: now, lastHeartbeatAt: now };
          }
          task.updatedAt = now;
        }
      }
      saveTasks(tasks);
      return { success: true };
    }
  );

  // ---- 持久化运行阶段、心跳与结构化错误 ----
  ipcMain.handle(
    'tasks:updateRuntime',
    async (_event, params: {
      taskId: string;
      status?: TaskStatus;
      runtime?: Partial<TaskRunSnapshot>;
      errorInfo?: TaskErrorInfo | null;
      result?: string;
    }): Promise<{ success: boolean; task?: Task; error?: string }> => {
      const tasks = loadTasks();
      const task = tasks.find((item) => item.id === params.taskId);
      if (!task) return { success: false, error: '任务不存在' };

      if (params.status) task.status = params.status;
      if (params.result !== undefined) task.result = params.result;
      if (params.errorInfo === null) task.errorInfo = undefined;
      else if (params.errorInfo) task.errorInfo = params.errorInfo;
      if (params.runtime) {
        if (!task.runtime && !params.runtime.runId) {
          return { success: false, error: '运行快照尚未初始化' };
        }
        task.runtime = { ...(task.runtime || {}), ...params.runtime } as TaskRunSnapshot;
        const runtime = task.runtime;
        task.runHistory = task.runHistory || [];
        let record = task.runHistory.find((item) => item.runId === runtime.runId);
        if (!record && runtime.runId && runtime.startedAt) {
          record = { runId: runtime.runId, attempt: runtime.attempt, startedAt: runtime.startedAt };
          task.runHistory.push(record);
          task.runHistory = task.runHistory.slice(-20);
        }
        if (record && params.status && ['done', 'fail', 'paused', 'cancelled'].includes(params.status)) {
          const finishedAt = new Date().toISOString();
          record.finishedAt = finishedAt;
          record.finalStage = runtime.stage;
          record.outcome = params.status === 'fail' ? 'failed' : params.status as TaskRunRecord['outcome'];
          record.errorCode = task.errorInfo?.code;
          record.durationMs = Math.max(0, new Date(finishedAt).getTime() - new Date(record.startedAt).getTime());
        }
      }
      task.updatedAt = new Date().toISOString();
      saveTasks(tasks);
      return { success: true, task };
    }
  );

  ipcMain.handle(
    'tasks:acquireLock',
    async (_event, params: { taskId: string; ownerId: string }): Promise<{ success: boolean; task?: Task; error?: string }> => {
      const tasks = loadTasks();
      const task = tasks.find((item) => item.id === params.taskId);
      if (!task) return { success: false, error: '任务不存在' };
      const now = Date.now();
      const accountConflict = task.assignedAccountId && tasks.some((item) =>
        item.id !== task.id &&
        item.assignedAccountId === task.assignedAccountId &&
        item.lock &&
        new Date(item.lock.expiresAt).getTime() > now
      );
      if (accountConflict) return { success: false, error: '该账号已经被其他任务锁定' };
      if (task.lock && task.lock.ownerId !== params.ownerId && new Date(task.lock.expiresAt).getTime() > now) {
        return { success: false, error: '任务已经被其他执行器锁定' };
      }
      task.lock = {
        ownerId: params.ownerId,
        acquiredAt: new Date(now).toISOString(),
        expiresAt: new Date(now + 4 * 60 * 60 * 1000).toISOString(),
      };
      task.updatedAt = new Date().toISOString();
      saveTasks(tasks);
      return { success: true, task };
    }
  );

  ipcMain.handle(
    'tasks:importCsv',
    async (_event, params?: { projectId?: string }): Promise<{ success: boolean; tasks?: Task[]; batchId?: string; imported?: number; skipped?: number; errors?: string[]; error?: string }> => {
      try {
        const selected = await dialog.showOpenDialog({
          title: '导入 CSV 任务',
          properties: ['openFile'],
          filters: [{ name: 'CSV', extensions: ['csv'] }],
        });
        if (selected.canceled || !selected.filePaths[0]) return { success: false };
        const fs = require('fs');
        const raw = fs.readFileSync(selected.filePaths[0], 'utf-8').replace(/^\uFEFF/, '');
        const rows = parseCsv(raw);
        if (rows.length < 2) return { success: false, error: 'CSV 没有可导入的数据行' };
        const headers = rows[0].map((header) => header.trim().toLowerCase());
        const indexOf = (...names: string[]) => names.map((name) => headers.indexOf(name)).find((index) => index >= 0) ?? -1;
        const promptIndex = indexOf('prompt', '提示词');
        if (promptIndex < 0) return { success: false, error: 'CSV 必须包含 prompt 或 提示词 列' };

        const modeIndex = indexOf('mode', '模式');
        const modelIndex = indexOf('model', '模型');
        const durationIndex = indexOf('duration', '时长');
        const ratioIndex = indexOf('aspectratio', 'aspect_ratio', '比例');
        const attachmentsIndex = indexOf('attachments', '参考图片');
        const audioIndex = indexOf('audio', '参考音频');
        const accountIndex = indexOf('account', '账号');
        const dependsIndex = indexOf('depends_on', '依赖行');
        const policyIndex = indexOf('dependency_policy', '依赖策略');
        const accounts = readJSON<Array<{ id: string; name: string }>>('accounts.json', []);
        const existingTasks = loadTasks();
        const batchId = `batch-${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}-${uuidv4().slice(0, 6)}`;
        const imported: Task[] = [];
        const errors: string[] = [];
        const sourceRows: number[] = [];

        for (let dataIndex = 1; dataIndex < rows.length; dataIndex++) {
          const row = rows[dataIndex];
          const prompt = (row[promptIndex] || '').trim();
          if (!prompt) {
            errors.push(`第 ${dataIndex + 1} 行：提示词为空`);
            continue;
          }
          const mode = modeIndex >= 0 ? normalizeCsvMode(row[modeIndex] || '') : 'chat';
          const model = row[modelIndex] as VideoModel;
          const duration = row[durationIndex] as VideoDuration;
          const aspectRatio = row[ratioIndex] as VideoAspectRatio;
          const now = new Date().toISOString();
          const accountName = accountIndex >= 0 ? (row[accountIndex] || '').trim() : '';
          const account = accountName ? accounts.find((item) => item.name === accountName) : undefined;
          if (accountName && !account) errors.push(`第 ${dataIndex + 1} 行：未找到账号「${accountName}」，任务保持未指派`);
          imported.push({
            id: uuidv4(), prompt, assignedAccountId: account?.id || null, status: 'queued', mode,
            videoConfig: mode === 'video' ? {
              model: ['seedance-2.0', 'seedance-2.0-fast', 'seedance-2.0-mini'].includes(model) ? model : 'seedance-2.0',
              duration: ['5s', '10s', '15s'].includes(duration) ? duration : '10s',
              aspectRatio: ['1:1', '3:4', '4:3', '9:16', '16:9', '21:9'].includes(aspectRatio) ? aspectRatio : '16:9',
            } : undefined,
            attachments: attachmentsIndex >= 0 ? (row[attachmentsIndex] || '').split('|').map((item) => item.trim()).filter(Boolean) : undefined,
            audioAttachment: audioIndex >= 0 ? (row[audioIndex] || '').trim() || undefined : undefined,
            result: null, outputs: [], artifacts: [], runHistory: [], batchId, source: 'csv', dependsOnTaskIds: [],
            dependencyPolicy: policyIndex >= 0 && row[policyIndex] === 'all_finished' ? 'all_finished' : 'all_done',
            projectId: params?.projectId || getDefaultProjectId(),
            createdAt: now, updatedAt: now,
          });
          sourceRows.push(dataIndex + 1);
        }

        const taskByCsvRow = new Map(sourceRows.map((rowNumber, index) => [rowNumber, imported[index]]));
        imported.forEach((task, index) => {
          if (dependsIndex < 0) return;
          const rawDependencies = rows[sourceRows[index] - 1]?.[dependsIndex] || '';
          task.dependsOnTaskIds = rawDependencies.split('|')
            .map((item) => Number(item.trim()))
            .map((rowNumber) => taskByCsvRow.get(rowNumber)?.id)
            .filter((id): id is string => !!id);
        });
        existingTasks.push(...imported);
        saveTasks(existingTasks);
        return { success: true, tasks: imported, batchId, imported: imported.length, skipped: rows.length - 1 - imported.length, errors: errors.slice(0, 20) };
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    }
  );

  ipcMain.handle(
    'tasks:releaseLock',
    async (_event, params: { taskId: string; ownerId?: string }): Promise<{ success: boolean }> => {
      const tasks = loadTasks();
      const task = tasks.find((item) => item.id === params.taskId);
      if (task?.lock && (!params.ownerId || task.lock.ownerId === params.ownerId)) {
        task.lock = undefined;
        task.updatedAt = new Date().toISOString();
        saveTasks(tasks);
      }
      return { success: true };
    }
  );

  // ---- 批量获取已完成任务的产物 ----
  ipcMain.handle(
    'tasks:getCompletedOutputs',
    async (): Promise<Array<{ taskId: string; prompt: string; outputs: string[]; accountId: string | null; mode: GenerationMode }>> => {
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
      params: {
        outputs: Array<{ taskId: string; prompt: string; outputs: string[]; accountId: string | null; mode: GenerationMode }>;
        saveDir?: string;
      }
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
              const temporaryPath = `${filePath}.${job.id}.part`;
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
                for (const entry of fs.readdirSync(saveDir)) {
                  if (entry.endsWith(`.${job.id}.part`)) fs.unlinkSync(path.join(saveDir, entry));
                }
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
    const jobs = loadDownloadJobs();
    saveDownloadJobs(jobs);
    return jobs;
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
    async (_event, params: { taskId: string; artifactId: string }): Promise<{ success: boolean; artifact?: TaskArtifact; error?: string }> => {
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
    async (_event, params: { accountId: string; report: Record<string, any> }): Promise<{ success: boolean }> => {
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
}
