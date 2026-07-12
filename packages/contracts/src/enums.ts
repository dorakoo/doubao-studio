/**
 * @doubao-studio/contracts — 共享枚举/联合类型
 *
 * 本文件包含跨进程（主进程 / 渲染进程 / preload）共享的枚举/联合类型定义。
 *
 * 纯洁性约束（由 scripts/check-contracts-boundary.mjs 强制检查）：
 * - 禁止导入 electron、react、react-dom、zustand、fs、path、os
 * - 禁止引用 document、window、HTMLElement 等 DOM 全局类型
 * - 仅允许 TypeScript 内置类型和同目录下其他 shared 文件
 */

/** 豆包生成模式 */
export type GenerationMode = 'chat' | 'image' | 'video' | 'music';

/** 账号状态 */
export type AccountStatus = 'idle' | 'busy' | 'error';

/**
 * 任务的队列级状态。具体执行位置记录在 runtime.stage。
 */
export type TaskStatus =
  | 'queued'
  | 'executing'
  | 'generating'
  | 'waiting_verification'
  | 'paused'
  | 'done'
  | 'fail'
  | 'cancelled';

/** 任务执行阶段（细粒度，用于 runtime 快照） */
export type TaskStage =
  | 'queued'
  | 'preparing_account'
  | 'new_conversation'
  | 'switching_mode'
  | 'configuring'
  | 'uploading_assets'
  | 'injecting_prompt'
  | 'submitting'
  | 'waiting_verification'
  | 'generating'
  | 'extracting_outputs'
  | 'completed'
  | 'paused'
  | 'failed'
  | 'cancelled';

/** 任务错误码（结构化失败原因） */
export type TaskErrorCode =
  | 'cancelled'
  | 'verification'
  | 'quota_exhausted'
  | 'membership_required'
  | 'face_restricted'
  | 'content_rejected'
  | 'network'
  | 'timeout'
  | 'page_changed'
  | 'submission_failed'
  | 'generation_failed'
  | 'output_missing'
  | 'unknown';

/** 视频生成模型 */
export type VideoModel = 'seedance-2.0' | 'seedance-2.0-fast' | 'seedance-2.0-mini';

/** 视频时长 */
export type VideoDuration = '5s' | '10s' | '15s';

/** 视频比例 */
export type VideoAspectRatio = '1:1' | '3:4' | '4:3' | '9:16' | '16:9' | '21:9';

/** 任务依赖策略 */
export type DependencyPolicy = 'all_done' | 'all_finished';
