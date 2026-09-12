import type { Task } from '../types';
import { isDependencyErrorCode } from './dependencyEval';

export interface PlatformTaskStats {
  /** 平台生成成功数（done） */
  succeeded: number;
  /** 普通平台生成失败数（fail 且不是依赖阻断） */
  platformFailed: number;
  /** 依赖阻断数：调度阻断，不是平台生成失败 */
  dependencyBlocked: number;
  /** 平台成功率（0–100，无样本时为 0） */
  successRate: number;
}

/**
 * 依赖阻断（dependency_failed / dependency_missing / dependency_cycle）是调度阻断，
 * 不是平台生成失败：必须从平台成功率/失败率的分子分母中完全排除。
 *
 * 依赖阻断任务保持 `queued`（可被调度器重新评估），因此识别依据是结构化错误码，
 * 而不是 `status === 'fail'`。
 */
export function getPlatformTaskStats(tasks: readonly Task[]): PlatformTaskStats {
  const succeeded = tasks.filter((task) => task.status === 'done').length;
  const dependencyBlocked = tasks.filter((task) =>
    task.status !== 'done' && isDependencyErrorCode(task.errorInfo?.code),
  ).length;
  const platformFailed = tasks.filter((task) =>
    task.status === 'fail' && !isDependencyErrorCode(task.errorInfo?.code),
  ).length;
  const denominator = succeeded + platformFailed;
  return {
    succeeded,
    platformFailed,
    dependencyBlocked,
    successRate: denominator > 0 ? Math.round((succeeded / denominator) * 100) : 0,
  };
}

/** 平台成功率的失败分母只包含普通生成失败 */
export function calculatePlatformSuccessRate(tasks: readonly Task[]): number {
  return getPlatformTaskStats(tasks).successRate;
}
