import type { Task } from '@doubao-studio/contracts';
import type { TaskEventStream } from './TaskEventStream';

export interface TaskNormalizationResult {
  data: Task[];
  changed: boolean;
  warnings: string[];
}

export interface TaskRepositoryDependencies {
  read: (filename: string, fallback: unknown) => unknown;
  write: (filename: string, data: Task[]) => boolean;
  normalize: (raw: unknown, defaultProjectId: string) => TaskNormalizationResult;
  defaultProjectId: () => string;
  events: TaskEventStream;
  warn?: (message: string, details: string[]) => void;
}

const STORE_FILE = 'tasks.json';

function fingerprint(tasks: Task[]): string {
  return JSON.stringify(tasks);
}

function eventTypeForStatus(status: Task['status']): string {
  if (status === 'done') return 'task.done';
  if (status === 'fail') return 'task.failed';
  if (status === 'paused') return 'task.paused';
  if (status === 'cancelled') return 'task.cancelled';
  if (status === 'executing' || status === 'generating') return 'task.started';
  return 'task.status_changed';
}

/**
 * tasks.json 的唯一写入边界。
 *
 * read() 返回的数组带有不可见的版本基线；replace() 在真正写盘前重新读取，
 * 旧快照一律 fail-closed，避免异步 IPC 把其他操作的新数据整体覆盖。
 */
export class TaskRepository {
  private readonly revisions = new WeakMap<Task[], string>();
  private writing = false;

  constructor(private readonly deps: TaskRepositoryDependencies) {}

  read(): Task[] {
    const raw = this.deps.read(STORE_FILE, []);
    const result = this.deps.normalize(raw, this.deps.defaultProjectId());
    if (result.warnings.length > 0) this.deps.warn?.('[Tasks] 数据归一化告警', result.warnings);
    if (result.changed && !this.deps.write(STORE_FILE, result.data)) {
      throw new Error('任务数据归一化写入失败');
    }
    this.revisions.set(result.data, fingerprint(result.data));
    return result.data;
  }

  replace(tasks: Task[]): boolean {
    if (this.writing) throw new Error('TASK_REPOSITORY_WRITE_IN_PROGRESS');
    const expected = this.revisions.get(tasks);
    if (expected === undefined) throw new Error('TASK_REPOSITORY_UNTRACKED_SNAPSHOT');

    const current = this.deps.normalize(
      this.deps.read(STORE_FILE, []),
      this.deps.defaultProjectId(),
    ).data;
    if (fingerprint(current) !== expected) throw new Error('TASK_REPOSITORY_STALE_SNAPSHOT');

    this.writing = true;
    try {
      if (!this.deps.write(STORE_FILE, tasks)) return false;
      this.publishDiff(current, tasks);
      this.revisions.set(tasks, fingerprint(tasks));
      return true;
    } finally {
      this.writing = false;
    }
  }

  private publishDiff(before: Task[], after: Task[]): void {
    const previous = new Map(before.map((task) => [task.id, task]));
    const next = new Map(after.map((task) => [task.id, task]));
    for (const task of after) {
      const old = previous.get(task.id);
      if (!old) {
        this.deps.events.publish(task.id, 'task.created', { status: task.status });
        continue;
      }
      if (old.status !== task.status) {
        this.deps.events.publish(task.id, eventTypeForStatus(task.status), {
          previousStatus: old.status,
          status: task.status,
        });
      }
      if (old.runtime?.stage !== task.runtime?.stage && task.runtime?.stage) {
        this.deps.events.publish(task.id, 'task.stage_changed', { stage: task.runtime.stage });
      }
      const oldArtifacts = new Set((old.artifacts || []).map((artifact) => artifact.id));
      for (const artifact of task.artifacts || []) {
        if (!oldArtifacts.has(artifact.id)) {
          this.deps.events.publish(task.id, 'artifact.discovered', { artifactId: artifact.id });
        }
      }
    }
    for (const task of before) {
      if (!next.has(task.id)) this.deps.events.publish(task.id, 'task.deleted');
    }
  }
}
