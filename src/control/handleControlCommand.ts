import type { Task, TaskStatus } from '../types';

export interface RendererControlCommand {
  commandId: string;
  requestId: string;
  action: 'start' | 'pause' | 'cancel' | 'retry';
  projectId: string;
  batchId: string;
  taskId: string;
}

export interface RendererControlResult {
  commandId: string;
  ok: boolean;
  code: string;
  accepted?: boolean;
}

export interface RendererControlDependencies {
  readTasks: () => Promise<Task[]>;
  start: (taskId: string) => Promise<boolean>;
  retry: (taskId: string) => Promise<boolean>;
  getLastError: () => string | null;
  updateStatus: (taskId: string, status: TaskStatus, result: string) => Promise<boolean>;
  abortActive: (taskId: string, targetStatus: 'paused' | 'cancelled') => void;
}

function result(commandId: string, ok: boolean, code: string, accepted = false): RendererControlResult {
  return { commandId, ok, code, accepted };
}

export function classifyControlRejection(message: string | null): string {
  if (!message) return 'ACTION_REJECTED';
  if (message.includes('调度已暂停')) return 'SCHEDULER_PAUSED';
  if (message.includes('未指派账号') || message.includes('尚未指派账号')) return 'ACCOUNT_REQUIRED';
  if (message.includes('依赖')) return 'DEPENDENCY_NOT_READY';
  if (message.includes('额度')) return 'QUOTA_UNAVAILABLE';
  if (message.includes('登录') || message.includes('验证')) return 'ACCOUNT_ACTION_REQUIRED';
  if (message.includes('账号') && (message.includes('忙') || message.includes('绑定') || message.includes('正在执行'))) return 'ACCOUNT_BUSY';
  if (message.includes('锁') || message.includes('锁定')) return 'TASK_LOCKED';
  if (message.includes('写入失败')) return 'TASK_WRITE_FAILED';
  if (message.includes('只有排队') || message.includes('正在执行')) return 'INVALID_TASK_STATUS';
  return 'ACTION_REJECTED';
}

export async function handleControlCommand(
  command: RendererControlCommand,
  deps: RendererControlDependencies,
): Promise<RendererControlResult> {
  try {
    const task = (await deps.readTasks()).find((item) => item.id === command.taskId);
    if (!task) return result(command.commandId, false, 'TASK_NOT_FOUND');
    if ((task.projectId || 'default-project') !== command.projectId) {
      return result(command.commandId, false, 'PROJECT_TASK_MISMATCH');
    }
    if ((task.batchId || '_unbatched') !== command.batchId) {
      return result(command.commandId, false, 'BATCH_TASK_MISMATCH');
    }

    if (command.action === 'start') {
      const ok = await deps.start(task.id);
      return result(command.commandId, ok, ok ? 'START_ACCEPTED' : classifyControlRejection(deps.getLastError()), ok);
    }
    if (command.action === 'retry') {
      const ok = await deps.retry(task.id);
      return result(command.commandId, ok, ok ? 'RETRY_ACCEPTED' : classifyControlRejection(deps.getLastError()), ok);
    }

    const targetStatus = command.action === 'cancel' ? 'cancelled' : 'paused';
    if (task.status === 'queued' || task.status === 'waiting_verification') {
      const updated = await deps.updateStatus(
        task.id,
        targetStatus,
        command.action === 'cancel' ? '任务已由本机控制面取消' : '任务已由本机控制面暂停',
      );
      if (!updated) return result(command.commandId, false, 'TASK_WRITE_FAILED');
      return result(command.commandId, true, command.action === 'cancel' ? 'CANCELLED' : 'PAUSED', true);
    }
    if (!['executing', 'generating'].includes(task.status)) {
      return result(command.commandId, false, 'TASK_NOT_ACTIVE');
    }
    deps.abortActive(task.id, targetStatus);
    return result(command.commandId, true, command.action === 'cancel' ? 'CANCEL_ACCEPTED' : 'PAUSE_ACCEPTED', true);
  } catch {
    return result(command.commandId, false, 'CONTROL_COMMAND_FAILED');
  }
}
