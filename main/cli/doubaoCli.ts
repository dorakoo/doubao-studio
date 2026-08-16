/**
 * DOUBAO-CLI-MCP-BOUNDARY-01：CLI 外部接口边界（纯逻辑，零 Electron 依赖）。
 *
 * 设计约束：
 * - 只读：仅消费 TaskService.getTasks / getCompletedOutputs / buildTaskDiagnostics，零写入。
 * - 依赖注入：TaskService 由调用方构造（CLI 入口注入文件存储、MCP 入口同构），本文件不 import electron。
 * - 返回形状稳定：{ ok: boolean; error?: string; data?: unknown }（JSON 可序列化）。
 */
import { TaskService } from '../core/TaskService';
import type { Task } from '@doubao-studio/contracts';

export interface CliListOptions {
  status?: string;
  keyword?: string;
  limit?: number;
}

export interface CliTaskDetail {
  id: string;
  status: string;
  mode: string;
  prompt: string;
  outputCount: number;
  assignedAccountId?: string;
  createdAt?: string;
  updatedAt?: string;
}

/** 只读 CLI 动作集合：所有方法返回稳定 JSON 形状，不抛业务异常。 */
export function buildCliActions(service: TaskService) {
  function normalize(result: { success: boolean; error?: string; data?: unknown }) {
    if (!result.success) return { ok: false, error: result.error ?? 'UNKNOWN' };
    return { ok: true, data: result.data };
  }

  return {
    /** 列出任务（可选 status/keyword 过滤 + limit 截断）。 */
    listTasks(options: CliListOptions = {}) {
      const result = service.getTasks();
      const base = normalize(result);
      if (!base.ok) return base;
      let tasks = (base.data as Task[]) || [];
      if (options.status) tasks = tasks.filter((t) => t.status === options.status);
      if (options.keyword) {
        const k = options.keyword.toLowerCase();
        tasks = tasks.filter((t) => t.prompt.toLowerCase().includes(k));
      }
      if (options.limit && options.limit > 0) tasks = tasks.slice(0, options.limit);
      return {
        ok: true,
        data: tasks.map((t) => ({
          id: t.id,
          status: t.status,
          mode: t.mode,
          prompt: t.prompt.slice(0, 120),
          outputCount: t.outputs.length,
        })),
      };
    },

    /** 单任务详情（稳定投影，不含产物原始地址）。 */
    taskDetail(taskId: string) {
      const result = service.getTasks();
      const base = normalize(result);
      if (!base.ok) return base;
      const task = (base.data as Task[]).find((t) => t.id === taskId);
      if (!task) return { ok: false, error: 'TASK_NOT_FOUND' };
      const detail: CliTaskDetail = {
        id: task.id,
        status: task.status,
        mode: task.mode,
        prompt: task.prompt,
        outputCount: task.outputs.length,
      };
      if (task.assignedAccountId) detail.assignedAccountId = task.assignedAccountId;
      if (task.createdAt) detail.createdAt = task.createdAt;
      if (task.updatedAt) detail.updatedAt = task.updatedAt;
      return { ok: true, data: detail };
    },

    /** 已完成产物摘要。 */
    completedOutputs() {
      return normalize(service.getCompletedOutputs());
    },

    /** 脱敏诊断投影。 */
    diagnostics() {
      return normalize(service.buildTaskDiagnostics());
    },
  };
}

export type CliActions = ReturnType<typeof buildCliActions>;
