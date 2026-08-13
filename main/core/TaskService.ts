import { randomUUID } from 'crypto';
import type {
  GenerationMode,
  Task,
  TaskAddParams,
  TaskAssignParams,
  TaskUpdateStatusParams,
  TaskUpdateInput,
  TaskUpdateRuntimeParams,
  TaskAcquireLockParams,
  TaskRenewLockParams,
  TaskReleaseLockParams,
  TaskRunSnapshot,
  TaskRunRecord,
} from '@doubao-studio/contracts';
import { acquireTaskLease, renewTaskLease, canReleaseTaskLease } from '../utils/taskLease';

export interface TaskStore {
  read(): Task[];
  replace(tasks: Task[]): boolean;
}

export interface TaskServiceDependencies {
  store: TaskStore;
  defaultProjectId: () => string;
  id?: () => string;
  now?: () => string;
  nowMs?: () => number;
}

export type TaskServiceResult<T = undefined> =
  | ({ success: true } & (T extends undefined ? object : { data: T }))
  | { success: false; error: string };

export interface TaskRecoverySummary {
  recoveredTasks: number;
  clearedLocks: number;
}

const ACTIVE = new Set<Task['status']>(['executing', 'generating', 'waiting_verification']);
const WRITE_ERROR = '任务数据写入失败，请检查磁盘空间和数据目录权限';
const RENEW_WRITE_ERROR = '任务锁续租写入失败';
const RELEASE_WRITE_ERROR = '任务锁释放写入失败';
const TERMINAL_STATUSES: ReadonlyArray<Task['status']> = ['done', 'fail', 'paused', 'cancelled'];

function artifactId(url: string): string {
  let hash = 5381;
  for (let index = 0; index < url.length; index++) hash = ((hash << 5) + hash) ^ url.charCodeAt(index);
  return `artifact-${(hash >>> 0).toString(16)}`;
}

export class TaskService {
  private readonly id: () => string;
  private readonly now: () => string;
  private readonly nowMs: () => number;

  constructor(private readonly deps: TaskServiceDependencies) {
    this.id = deps.id || randomUUID;
    this.now = deps.now || (() => new Date().toISOString());
    this.nowMs = deps.nowMs || (() => Date.now());
  }

  private readTasks(): Task[] | null {
    try {
      return this.deps.store.read();
    } catch {
      return null;
    }
  }

  private persist(tasks: Task[]): boolean {
    try {
      return this.deps.store.replace(tasks);
    } catch {
      return false;
    }
  }

  /** 将任务重置为排队状态，清除运行结果、产物列表、错误信息和锁 */
  private resetTaskForQueue(task: Task, timestamp: string): void {
    task.status = 'queued';
    task.result = null;
    task.outputs = [];
    task.errorInfo = undefined;
    // 暂停/中断任务重新入队时不应继承旧运行锁，否则恢复后会被当作仍在执行。
    task.lock = undefined;
    if (task.runtime) {
      task.runtime = {
        ...task.runtime,
        stage: 'queued',
        message: '等待执行',
        stageStartedAt: timestamp,
        lastHeartbeatAt: timestamp,
      };
    }
    task.updatedAt = timestamp;
  }

  create(params: TaskAddParams): TaskServiceResult<Task[]> {
    const prompts = (params.prompts || []).map((prompt) => prompt.trim()).filter(Boolean);
    if (prompts.length === 0) return { success: false, error: '请输入至少一条提示词' };
    const tasks = this.readTasks();
    if (!tasks) return { success: false, error: WRITE_ERROR };
    const mode: GenerationMode = params.mode || 'chat';
    const created = prompts.map((prompt): Task => {
      const timestamp = this.now();
      return {
        id: this.id(), prompt, assignedAccountId: null, status: 'queued', mode,
        videoConfig: params.videoConfig, attachments: params.attachments,
        audioAttachment: params.audioAttachment, result: null, outputs: [], artifacts: [],
        runHistory: [], source: 'manual', dependsOnTaskIds: [],
        projectId: params.projectId || this.deps.defaultProjectId(),
        createdAt: timestamp, updatedAt: timestamp,
      };
    });
    tasks.push(...created);
    if (!this.persist(tasks)) return { success: false, error: WRITE_ERROR };
    return { success: true, data: created };
  }

  assign(params: TaskAssignParams): TaskServiceResult {
    const tasks = this.readTasks();
    if (!tasks) return { success: false, error: WRITE_ERROR };
    const task = tasks.find((item) => item.id === params.taskId);
    if (!task) return { success: false, error: '任务不存在' };
    if (ACTIVE.has(task.status)) return { success: false, error: '任务正在自动化执行中，无法重新指派' };
    task.assignedAccountId = params.accountId;
    this.resetTaskForQueue(task, this.now());
    if (!this.persist(tasks)) return { success: false, error: WRITE_ERROR };
    return { success: true };
  }

  update(params: { taskId: string; updates: TaskUpdateInput }): TaskServiceResult<Task> {
    const tasks = this.readTasks();
    if (!tasks) return { success: false, error: WRITE_ERROR };
    const task = tasks.find((item) => item.id === params.taskId);
    if (!task) return { success: false, error: '任务不存在' };
    const prompt = params.updates?.prompt?.trim();
    if (!prompt) return { success: false, error: '提示词不能为空' };
    task.prompt = prompt;
    task.videoConfig = params.updates.videoConfig;
    task.attachments = params.updates.attachments?.length ? params.updates.attachments : undefined;
    task.audioAttachment = params.updates.audioAttachment || undefined;
    this.resetTaskForQueue(task, this.now());
    if (!this.persist(tasks)) return { success: false, error: WRITE_ERROR };
    return { success: true, data: task };
  }

  updateStatus(params: TaskUpdateStatusParams): TaskServiceResult {
    const tasks = this.readTasks();
    if (!tasks) return { success: false, error: WRITE_ERROR };
    const task = tasks.find((item) => item.id === params.taskId);
    if (!task) return { success: false, error: '任务不存在' };
    task.status = params.status;
    if (params.result !== undefined) task.result = params.result;
    if (params.outputs !== undefined) {
      task.outputs = [...new Set(params.outputs.filter(Boolean))];
      const existing = new Map((task.artifacts || []).map((artifact) => [artifact.url, artifact]));
      for (const url of task.outputs) {
        if (!existing.has(url)) existing.set(url, {
          id: artifactId(url), url,
          kind: task.mode === 'video' ? 'video' : task.mode === 'image' ? 'image' : 'file',
          source: 'network', runId: task.runtime?.runId,
          conversationUrl: task.runtime?.conversationUrl, discoveredAt: this.now(),
        });
      }
      task.artifacts = [...existing.values()];
    }
    if (params.status === 'done') task.errorInfo = undefined;
    task.updatedAt = this.now();
    if (!this.persist(tasks)) return { success: false, error: WRITE_ERROR };
    return { success: true };
  }

  delete(taskId: string): TaskServiceResult {
    const tasks = this.readTasks();
    if (!tasks) return { success: false, error: WRITE_ERROR };
    const index = tasks.findIndex((task) => task.id === taskId);
    if (index < 0) return { success: false, error: '任务不存在' };
    if (ACTIVE.has(tasks[index].status)) return { success: false, error: '任务正在执行，请先暂停后再删除' };
    const dependentCount = tasks.filter((task) => task.dependsOnTaskIds?.includes(taskId)).length;
    if (dependentCount > 0) return { success: false, error: `仍有 ${dependentCount} 个任务依赖此任务，请先调整依赖关系` };
    tasks.splice(index, 1);
    if (!this.persist(tasks)) return { success: false, error: WRITE_ERROR };
    return { success: true };
  }

  retry(taskId: string): TaskServiceResult<Task> {
    const tasks = this.readTasks();
    if (!tasks) return { success: false, error: WRITE_ERROR };
    const task = tasks.find((item) => item.id === taskId);
    if (!task) return { success: false, error: '任务不存在' };
    if (ACTIVE.has(task.status)) return { success: false, error: '任务正在执行中，无法重试' };
    this.resetTaskForQueue(task, this.now());
    if (!this.persist(tasks)) return { success: false, error: WRITE_ERROR };
    return { success: true, data: task };
  }

  batchPause(): TaskServiceResult {
    const tasks = this.readTasks();
    if (!tasks) return { success: false, error: WRITE_ERROR };
    const timestamp = this.now();
    let changed = false;
    for (const task of tasks) {
      if (ACTIVE.has(task.status)) {
        task.status = 'paused';
        task.result = '批量暂停';
        task.errorInfo = { code: 'cancelled', message: '批量暂停', recoverable: true, detectedAt: timestamp };
        if (task.runtime) {
          task.runtime = { ...task.runtime, stage: 'paused', message: '批量暂停', stageStartedAt: timestamp, lastHeartbeatAt: timestamp };
        }
        task.updatedAt = timestamp;
        changed = true;
      }
    }
    if (!changed) return { success: true };
    if (!this.persist(tasks)) return { success: false, error: WRITE_ERROR };
    return { success: true };
  }

  recoverInterruptedTasks(): TaskServiceResult<TaskRecoverySummary> {
    const tasks = this.readTasks();
    if (!tasks) return { success: false, error: WRITE_ERROR };

    const timestamp = this.now();
    let recoveredTasks = 0;
    let clearedLocks = 0;
    let changed = false;

    for (const task of tasks) {
      if (!ACTIVE.has(task.status)) {
        if (task.lock) {
          task.lock = undefined;
          clearedLocks++;
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
        detectedAt: timestamp,
      };
      if (task.runtime) {
        task.runtime = {
          ...task.runtime,
          stage: 'paused',
          message: '程序重启，任务已安全暂停',
          stageStartedAt: timestamp,
          lastHeartbeatAt: timestamp,
        };
      }
      task.updatedAt = timestamp;
      if (task.lock) clearedLocks++;
      task.lock = undefined;

      if (task.runtime) {
        const runtime = task.runtime;
        const activeRun = task.runHistory?.find(
          (run) => run.runId === runtime.runId && !run.finishedAt,
        );
        if (activeRun) {
          activeRun.finishedAt = timestamp;
          activeRun.finalStage = 'paused';
          activeRun.outcome = 'paused';
          activeRun.errorCode = 'cancelled';
          activeRun.durationMs = Math.max(0, new Date(timestamp).getTime() - new Date(activeRun.startedAt).getTime());
        }
      }

      recoveredTasks++;
      changed = true;
    }

    if (!changed) return { success: true, data: { recoveredTasks: 0, clearedLocks: 0 } };
    if (!this.persist(tasks)) return { success: false, error: WRITE_ERROR };
    return { success: true, data: { recoveredTasks, clearedLocks } };
  }

  updateRuntime(params: TaskUpdateRuntimeParams): TaskServiceResult<Task> {
    const tasks = this.readTasks();
    if (!tasks) return { success: false, error: WRITE_ERROR };
    const task = tasks.find((item) => item.id === params.taskId);
    if (!task) return { success: false, error: '任务不存在' };

    const timestamp = this.now();

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
      if (record && params.status && TERMINAL_STATUSES.includes(params.status)) {
        record.finishedAt = timestamp;
        record.finalStage = runtime.stage;
        record.outcome = params.status === 'fail' ? 'failed' : params.status as TaskRunRecord['outcome'];
        record.errorCode = task.errorInfo?.code;
        record.durationMs = Math.max(0, new Date(timestamp).getTime() - new Date(record.startedAt).getTime());
      }
    }

    task.updatedAt = timestamp;
    if (!this.persist(tasks)) return { success: false, error: WRITE_ERROR };
    return { success: true, data: task };
  }

  acquireLock(params: TaskAcquireLockParams): TaskServiceResult<Task> {
    const tasks = this.readTasks();
    if (!tasks) return { success: false, error: WRITE_ERROR };
    const task = tasks.find((item) => item.id === params.taskId);
    if (!task) return { success: false, error: '任务不存在' };

    const nowMs = this.nowMs();
    const accountConflict = task.assignedAccountId && tasks.some((item) =>
      item.id !== task.id &&
      item.assignedAccountId === task.assignedAccountId &&
      item.lock &&
      Date.parse(item.lock.expiresAt) > nowMs,
    );
    if (accountConflict) return { success: false, error: '该账号已经被其他任务锁定' };

    const decision = acquireTaskLease(task.lock, params.ownerId, nowMs);
    if (!decision.success) return decision;

    task.lock = decision.lock;
    task.updatedAt = new Date(nowMs).toISOString();
    if (!this.persist(tasks)) return { success: false, error: WRITE_ERROR };
    return { success: true, data: task };
  }

  renewLock(params: TaskRenewLockParams): TaskServiceResult<Task> {
    const tasks = this.readTasks();
    if (!tasks) return { success: false, error: WRITE_ERROR };
    const task = tasks.find((item) => item.id === params.taskId);
    if (!task) return { success: false, error: '任务不存在' };

    const nowMs = this.nowMs();
    const decision = renewTaskLease(task.lock, params.ownerId, nowMs);
    if (!decision.success) return decision;

    task.lock = decision.lock;
    task.updatedAt = new Date(nowMs).toISOString();
    if (!this.persist(tasks)) return { success: false, error: RENEW_WRITE_ERROR };
    return { success: true, data: task };
  }

  releaseLock(params: TaskReleaseLockParams): TaskServiceResult {
    const tasks = this.readTasks();
    if (!tasks) return { success: false, error: WRITE_ERROR };
    const task = tasks.find((item) => item.id === params.taskId);
    if (!task) return { success: false, error: '任务不存在' };

    if (!canReleaseTaskLease(task.lock, params.ownerId)) {
      return { success: false, error: '任务锁 owner 不匹配' };
    }

    const nowMs = this.nowMs();
    task.lock = undefined;
    task.updatedAt = new Date(nowMs).toISOString();
    if (!this.persist(tasks)) return { success: false, error: RELEASE_WRITE_ERROR };
    return { success: true };
  }
}
