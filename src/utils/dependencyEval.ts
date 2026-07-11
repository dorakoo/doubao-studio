/**
 * src/utils/dependencyEval.ts
 * 任务依赖状态评估纯函数 — 不依赖 DOM/React/Electron 运行时
 */

import type { Task } from '../types';

export type DependencyEvaluation = {
  state: 'ready' | 'waiting' | 'missing' | 'failed';
  message?: string;
};

/**
 * 评估任务的依赖状态。
 * @param task 当前任务
 * @param tasks 全部任务列表（用于查找依赖）
 */
export function evaluateDependencies(task: Task, tasks: Task[]): DependencyEvaluation {
  const dependencyIds = task.dependsOnTaskIds || [];
  const dependencies = dependencyIds
    .map((dependencyId) => tasks.find((item) => item.id === dependencyId))
    .filter((item): item is Task => !!item);
  if (dependencies.length !== dependencyIds.length) {
    return { state: 'missing', message: '任务依赖不存在，请检查工作流或 CSV' };
  }
  if (task.dependencyPolicy !== 'all_finished' && dependencies.some((item) => ['fail', 'cancelled'].includes(item.status))) {
    return { state: 'failed', message: '前置任务未成功，当前任务已停止' };
  }
  const ready = task.dependencyPolicy === 'all_finished'
    ? dependencies.every((item) => ['done', 'fail', 'cancelled'].includes(item.status))
    : dependencies.every((item) => item.status === 'done');
  return ready ? { state: 'ready' } : { state: 'waiting', message: '前置任务尚未满足执行条件' };
}
