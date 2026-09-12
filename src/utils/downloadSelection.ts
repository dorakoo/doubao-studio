import type { GenerationMode, Task } from '../types';

export interface BatchDownloadOutput {
  taskId: string;
  prompt: string;
  outputs: string[];
  accountId: string | null;
  mode: GenerationMode;
  /** 归属项目；下载范围判定要求非空，缺失即 fail-closed */
  projectId: string;
  /** 归属批次；下载范围判定要求非空，缺失即 fail-closed */
  batchId: string;
}

export interface BatchDownloadScope {
  projectName: string;
  batchId: string;
  taskCount: number;
  artifactCount: number;
}

export interface BatchDownloadPayload {
  outputs: BatchDownloadOutput[];
  summary: BatchDownloadScope;
}

/**
 * 下载选择/请求使用的最小结构。
 * `outputs` 必填，`projectId` / `batchId` 必填且必须非空：归属不明的产物一律不可下载。
 */
export type BatchOutputLike = Pick<BatchDownloadOutput, 'outputs' | 'projectId' | 'batchId'>;

/** 归属是否完整（项目与批次都必须是非空字符串） */
function hasOwnership(item: Pick<BatchDownloadOutput, 'projectId' | 'batchId'>): boolean {
  return typeof item.projectId === 'string' && item.projectId.trim().length > 0
    && typeof item.batchId === 'string' && item.batchId.trim().length > 0;
}

/** 有效产物条目：非空字符串；空串或非字符串都不计入，也不能凭它放行下载 */
function effectiveArtifacts(item: Pick<BatchDownloadOutput, 'outputs'>): string[] {
  return Array.isArray(item.outputs)
    ? item.outputs.filter((url) => typeof url === 'string' && url.trim().length > 0)
    : [];
}

/** 按当前选择实时计算任务数和产物数，用于下载按钮与摘要。 */
export function summarizeSelectedOutputs(outputs: readonly Pick<BatchDownloadOutput, 'outputs'>[]): {
  taskCount: number;
  artifactCount: number;
} {
  return {
    taskCount: outputs.length,
    artifactCount: outputs.reduce((sum, item) => sum + effectiveArtifacts(item).length, 0),
  };
}

/**
 * 按当前选择实时计算项目数和批次数。
 * 只统计非空归属；空选择时项目数/批次数为 0，绝不回退为整个批次的静态总数。
 */
export function summarizeSelectionScope(
  outputs: readonly Pick<BatchDownloadOutput, 'projectId' | 'batchId'>[],
): { projectCount: number; batchCount: number } {
  return {
    projectCount: new Set(
      outputs.map((item) => item.projectId?.trim()).filter((value): value is string => !!value),
    ).size,
    batchCount: new Set(
      outputs.map((item) => item.batchId?.trim()).filter((value): value is string => !!value),
    ).size,
  };
}

/** 打开预览时必须从空选择开始，禁止沿用上次全选。 */
export function createInitialOutputSelection(): Set<string> {
  return new Set();
}

/** 选择跨项目或跨批次时返回 true；当前 UI 明确不支持跨批次下载。 */
export function hasCrossBatchSelection(
  outputs: readonly Pick<BatchDownloadOutput, 'projectId' | 'batchId'>[],
): boolean {
  const projectIds = new Set(
    outputs.map((item) => item.projectId?.trim()).filter((value): value is string => !!value),
  );
  const batchIds = new Set(
    outputs.map((item) => item.batchId?.trim()).filter((value): value is string => !!value),
  );
  return projectIds.size > 1 || batchIds.size > 1;
}

export interface BatchDownloadRequest<T extends BatchOutputLike = BatchDownloadOutput> {
  ok: boolean;
  /** 只允许单项目单批次；跨批次或归属不明的输入整体 fail-closed，不下发任何下载调用 */
  outputs: T[];
  taskCount: number;
  artifactCount: number;
  projectCount: number;
  batchCount: number;
  error?: string;
}

/**
 * 下载请求的唯一 fail-closed 入口。
 *
 * 放行条件（全部必须满足）：
 * 1. 每项都有非空的 `projectId` 与 `batchId`（归属不明整体拒绝）；
 * 2. 每项都有至少一个非空产物 URL（零产物不允许占位放行）；
 * 3. 项目数必须精确为 1、批次数必须精确为 1（空值不会被过滤成 0 而误判通过）。
 */
export function buildBatchDownloadRequest<T extends BatchOutputLike>(
  selected: readonly T[],
): BatchDownloadRequest<T> {
  const { taskCount, artifactCount } = summarizeSelectedOutputs(selected);
  const { projectCount, batchCount } = summarizeSelectionScope(selected);
  const empty: BatchDownloadRequest<T> = {
    ok: false, outputs: [], taskCount, artifactCount, projectCount, batchCount,
  };
  if (taskCount === 0) {
    return { ...empty, error: '请至少选择一个产物' };
  }
  if (selected.some((item) => !hasOwnership(item))) {
    return { ...empty, error: '存在缺少项目或批次归属的产物，已拒绝下载' };
  }
  const zeroArtifact = selected.filter((item) => effectiveArtifacts(item).length === 0).length;
  if (zeroArtifact > 0) {
    return { ...empty, error: `所选中有 ${zeroArtifact} 个任务没有可下载产物，已拒绝下载` };
  }
  // 归属完整时 0 项目/0 批次不可能出现；仍显式要求精确等于 1，杜绝过滤后误判。
  if (projectCount !== 1 || batchCount !== 1) {
    return { ...empty, error: '当前版本不支持跨批次下载：请只选择同一项目同一批次内的产物' };
  }
  return { ok: true, outputs: [...selected], taskCount, artifactCount, projectCount, batchCount };
}

/**
 * 下载意图的唯一入口：按钮点击、取消确认和各类拒绝全部收敛到这里。
 * 只有 ok=true 的意图才允许调用真实下载链路；取消或拒绝返回 null。
 */
export function createDownloadIntent<T extends BatchOutputLike>(
  selected: readonly T[],
  decision: 'confirm' | 'cancel',
): BatchDownloadRequest<T> | null {
  if (decision === 'cancel') return null;
  const request = buildBatchDownloadRequest(selected);
  return request.ok ? request : null;
}

/** 下载按钮与摘要使用的实时选择读数（只依赖当前选择，不依赖批次静态总数） */
export interface DownloadSelectionReadout {
  taskCount: number;
  artifactCount: number;
  projectCount: number;
  batchCount: number;
  /** 缺少归属或没有可下载产物的选择项数量；>0 时下载按钮必须禁用 */
  invalidCount: number;
  downloadEnabled: boolean;
}

export function readDownloadSelection(
  selected: readonly BatchOutputLike[],
): DownloadSelectionReadout {
  const { taskCount, artifactCount } = summarizeSelectedOutputs(selected);
  const { projectCount, batchCount } = summarizeSelectionScope(selected);
  const invalidCount = selected.filter((item) => !hasOwnership(item) || effectiveArtifacts(item).length === 0).length;
  return {
    taskCount,
    artifactCount,
    projectCount,
    batchCount,
    invalidCount,
    downloadEnabled: taskCount > 0 && invalidCount === 0,
  };
}

/**
 * 只从当前项目和指定批次构建候选，绝不退化为全部历史任务。
 * 只有同时具备非空项目、非空批次和非空产物的任务才会成为候选。
 */
export function buildBatchDownloadPayload(
  tasks: readonly Task[],
  projectId: string,
  projectName: string,
  batchId: string,
): BatchDownloadPayload {
  const targetBatchId = batchId.trim();
  const outputs: BatchDownloadOutput[] = tasks
    .filter((task) => (task.projectId || 'default-project') === projectId)
    .filter((task) => task.status === 'done')
    .flatMap((task): BatchDownloadOutput[] => {
      const taskBatchId = typeof task.batchId === 'string' ? task.batchId.trim() : '';
      // 归属不明的任务不进入候选：没有非空批次就无法构成明确下载范围。
      if (!taskBatchId || taskBatchId !== targetBatchId) return [];
      const artifacts = task.outputs.filter((url) => typeof url === 'string' && url.trim().length > 0);
      if (artifacts.length === 0) return [];
      return [{
        taskId: task.id,
        prompt: task.prompt,
        outputs: artifacts,
        accountId: task.assignedAccountId,
        mode: task.mode,
        projectId: task.projectId || 'default-project',
        batchId: taskBatchId,
      }];
    });
  return {
    outputs,
    summary: {
      projectName,
      batchId: targetBatchId,
      taskCount: outputs.length,
      artifactCount: outputs.reduce((sum, item) => sum + item.outputs.length, 0),
    },
  };
}
