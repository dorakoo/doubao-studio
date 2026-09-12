/**
 * src/utils/dependencyEval.ts
 * 任务依赖状态评估纯函数 — 不依赖 DOM/React/Electron 运行时
 */

import type { Task } from '../types';
import { hasPlatformAcceptance } from './acceptedObservation';

export type DependencyBlockCode = 'dependency_failed' | 'dependency_missing' | 'dependency_cycle';

export type DependencyEvaluation = {
  state: 'ready' | 'waiting' | 'missing' | 'failed' | 'invalid';
  message?: string;
  code?: DependencyBlockCode;
  blockedByTaskIds?: string[];
};

export const DEPENDENCY_ERROR_CODES = ['dependency_failed', 'dependency_missing', 'dependency_cycle'] as const;

export function isDependencyErrorCode(code: string | undefined | null): boolean {
  return !!code && (DEPENDENCY_ERROR_CODES as readonly string[]).includes(code);
}

function uniqueSorted(ids: string[]): string[] {
  return [...new Set(ids.filter(Boolean))].sort();
}

function findCycleTaskIds(taskId: string, tasksById: Map<string, Task>): string[] {
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const path: string[] = [];

  const visit = (id: string): string[] | null => {
    if (visiting.has(id)) {
      const start = path.indexOf(id);
      return start >= 0 ? [...path.slice(start), id] : [id];
    }
    if (visited.has(id)) return null;
    visiting.add(id);
    path.push(id);
    for (const dependencyId of tasksById.get(id)?.dependsOnTaskIds || []) {
      if (!tasksById.has(dependencyId)) continue;
      const cycle = visit(dependencyId);
      if (cycle) return cycle;
    }
    path.pop();
    visiting.delete(id);
    visited.add(id);
    return null;
  };

  const cycle = visit(taskId);
  return cycle ? uniqueSorted(cycle) : [];
}

/**
 * 评估任务的依赖状态。
 * @param task 当前任务
 * @param tasks 全部任务列表（用于查找依赖）
 */
export function evaluateDependencies(task: Task, tasks: Task[]): DependencyEvaluation {
  const dependencyIds = task.dependsOnTaskIds || [];
  const tasksById = new Map(tasks.map((item) => [item.id, item]));
  const missingIds = uniqueSorted(dependencyIds.filter((dependencyId) => !tasksById.has(dependencyId)));
  if (missingIds.length > 0) {
    return {
      state: 'missing',
      code: 'dependency_missing',
      blockedByTaskIds: missingIds,
      message: '任务依赖不存在，请检查工作流或 CSV',
    };
  }

  const dependencies = dependencyIds
    .map((dependencyId) => tasksById.get(dependencyId))
    .filter((item): item is Task => !!item);
  const cycleIds = findCycleTaskIds(task.id, tasksById);
  if (cycleIds.length > 0) {
    return {
      state: 'invalid',
      code: 'dependency_cycle',
      blockedByTaskIds: cycleIds,
      message: '任务依赖存在自依赖或循环，当前任务已停止',
    };
  }

  if (task.dependencyPolicy === 'all_done') {
    const failedIds = uniqueSorted(dependencyIds.filter((_dependencyId, index) =>
      ['fail', 'cancelled'].includes(dependencies[index].status),
    ));
    if (failedIds.length > 0) {
      return {
        state: 'failed',
        code: 'dependency_failed',
        blockedByTaskIds: failedIds,
        message: '前置任务未成功，当前任务已停止',
      };
    }
  }

  if (task.dependencyPolicy === 'all_accepted') {
    const unsatisfiedTerminalIds = uniqueSorted(dependencyIds.filter((_dependencyId, index) => {
      const dependency = dependencies[index];
      return ['fail', 'cancelled'].includes(dependency.status) && !hasPlatformAcceptance(dependency);
    }));
    if (unsatisfiedTerminalIds.length > 0) {
      return {
        state: 'failed',
        code: 'dependency_failed',
        blockedByTaskIds: unsatisfiedTerminalIds,
        message: '前置任务已终止且没有可恢复的受理证据，当前任务已停止',
      };
    }
  }

  const ready = task.dependencyPolicy === 'all_finished'
    ? dependencies.every((item) => ['done', 'fail', 'cancelled'].includes(item.status))
    : task.dependencyPolicy === 'all_accepted'
      ? dependencies.every(hasPlatformAcceptance)
      : dependencies.every((item) => item.status === 'done');
  return ready ? { state: 'ready' } : { state: 'waiting', message: '前置任务尚未满足执行条件' };
}
