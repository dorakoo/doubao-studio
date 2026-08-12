import { randomUUID } from 'crypto';
import type { GenerationMode, Task, TaskAddParams, TaskUpdateStatusParams } from '@doubao-studio/contracts';

export interface TaskStore {
  read(): Task[];
  replace(tasks: Task[]): boolean;
}

export interface TaskServiceDependencies {
  store: TaskStore;
  defaultProjectId: () => string;
  id?: () => string;
  now?: () => string;
}

export type TaskServiceResult<T = undefined> =
  | ({ success: true } & (T extends undefined ? object : { data: T }))
  | { success: false; error: string };

const ACTIVE = new Set<Task['status']>(['executing', 'generating', 'waiting_verification']);

function artifactId(url: string): string {
  let hash = 5381;
  for (let index = 0; index < url.length; index++) hash = ((hash << 5) + hash) ^ url.charCodeAt(index);
  return `artifact-${(hash >>> 0).toString(16)}`;
}

export class TaskService {
  private readonly id: () => string;
  private readonly now: () => string;

  constructor(private readonly deps: TaskServiceDependencies) {
    this.id = deps.id || randomUUID;
    this.now = deps.now || (() => new Date().toISOString());
  }

  private persist(tasks: Task[]): boolean {
    try {
      return this.deps.store.replace(tasks);
    } catch {
      return false;
    }
  }

  create(params: TaskAddParams): TaskServiceResult<Task[]> {
    const prompts = (params.prompts || []).map((prompt) => prompt.trim()).filter(Boolean);
    if (prompts.length === 0) return { success: false, error: '请输入至少一条提示词' };
    const tasks = this.deps.store.read();
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
    if (!this.persist(tasks)) return { success: false, error: '任务数据写入失败，请检查磁盘空间和数据目录权限' };
    return { success: true, data: created };
  }

  updateStatus(params: TaskUpdateStatusParams): TaskServiceResult {
    const tasks = this.deps.store.read();
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
    if (!this.persist(tasks)) return { success: false, error: '任务数据写入失败，请检查磁盘空间和数据目录权限' };
    return { success: true };
  }

  delete(taskId: string): TaskServiceResult {
    const tasks = this.deps.store.read();
    const index = tasks.findIndex((task) => task.id === taskId);
    if (index < 0) return { success: false, error: '任务不存在' };
    if (ACTIVE.has(tasks[index].status)) return { success: false, error: '任务正在执行，请先暂停后再删除' };
    const dependentCount = tasks.filter((task) => task.dependsOnTaskIds?.includes(taskId)).length;
    if (dependentCount > 0) return { success: false, error: `仍有 ${dependentCount} 个任务依赖此任务，请先调整依赖关系` };
    tasks.splice(index, 1);
    if (!this.persist(tasks)) return { success: false, error: '任务数据写入失败，请检查磁盘空间和数据目录权限' };
    return { success: true };
  }

  retry(taskId: string): TaskServiceResult<Task> {
    const tasks = this.deps.store.read();
    const task = tasks.find((item) => item.id === taskId);
    if (!task) return { success: false, error: '任务不存在' };
    if (ACTIVE.has(task.status)) return { success: false, error: '任务正在执行中，无法重试' };
    const timestamp = this.now();
    task.status = 'queued'; task.result = null; task.outputs = []; task.errorInfo = undefined; task.lock = undefined;
    if (task.runtime) task.runtime = { ...task.runtime, stage: 'queued', message: '等待执行', stageStartedAt: timestamp, lastHeartbeatAt: timestamp };
    task.updatedAt = timestamp;
    if (!this.persist(tasks)) return { success: false, error: '任务数据写入失败，请检查磁盘空间和数据目录权限' };
    return { success: true, data: task };
  }
}
