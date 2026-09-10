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

/** 账号所属平台；历史账号缺省按 doubao 处理。 */
export type AccountPlatform = 'doubao' | 'dola';

/**
 * 任务的队列级状态。具体执行位置记录在 runtime.stage。
 */
export type TaskStatus =
  | 'queued'
  | 'executing'
  | 'generating'
  | 'waiting_verification'
  | 'waiting_generation_confirmation'
  | 'manual_submission_observing'
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
  | 'waiting_generation_confirmation'
  | 'manual_submission_observing'
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
  | 'submission_uncertain'
  | 'generation_confirmation_required'
  | 'manual_review_required'
  | 'video_mode_entry_not_ready'
  | 'video_account_not_ready'
  | 'video_new_conversation_not_ready'
  | 'video_model_control_not_ready'
  | 'video_aspect_ratio_control_not_ready'
  | 'video_duration_control_not_ready'
  | 'video_assets_not_ready'
  | 'video_prompt_not_ready'
  | 'video_submission_controls_not_ready'
  | 'video_composite_control_not_ready'
  | 'video_stable_readback_not_ready'
  | 'video_final_readback_not_ready'
  | 'unknown';

/** 视频生成模型 */
export type VideoModel = 'seedance-2.5' | 'seedance-2.0' | 'seedance-2.0-fast' | 'seedance-2.0-mini';

/** 视频时长 */
export type VideoDuration = '4s' | '5s' | '6s' | '7s' | '8s' | '9s' | '10s' | '11s' | '12s' | '13s' | '14s' | '15s';

/** 视频比例 */
export type VideoAspectRatio = '1:1' | '3:4' | '4:3' | '9:16' | '16:9' | '21:9';

/** 任务依赖策略 */
export type DependencyPolicy = 'all_done' | 'all_accepted' | 'all_finished';
