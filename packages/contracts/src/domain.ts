/**
 * @doubao-studio/contracts — 共享领域模型接口
 *
 * 跨进程（主进程 / 渲染进程 / preload）共享的核心业务实体类型。
 *
 * 纯洁性约束（由 scripts/check-contracts-boundary.mjs 强制检查）：
 * - 禁止导入 electron、react、react-dom、zustand、fs、path、os
 * - 禁止引用 document、window、HTMLElement 等 DOM 全局类型
 * - 仅允许 TypeScript 内置类型和同目录下其他 shared 文件
 */

import type {
  GenerationMode,
  AccountStatus,
  AccountPlatform,
  TaskStatus,
  TaskStage,
  VideoModel,
  VideoDuration,
  VideoAspectRatio,
  TaskExecutionIntent,
  DependencyPolicy,
  QualityVerdict,
} from './enums';

// ==================== 账号相关 ====================

/** Seedance 每日额度的本地预测记录 */
export interface SeedanceQuota {
  date: string;
  usedUnits: number;
  estimatedTotalUnits: number;
  exhausted: boolean;
  updatedAt: string;
}

/** 账号网页自动化可用性状态。 */
export type AccountAvailabilityState =
  | 'unknown'
  | 'ready'
  | 'action_required'
  | 'login_required'
  | 'unavailable';

/** 可用性检测触发点。 */
export type AccountAvailabilitySource =
  | 'startup'
  | 'navigation'
  | 'pre_task'
  | 'pre_submit'
  | 'manual';

/** 最近一次账号网页可用性检测结果。 */
export interface AccountAvailability {
  state: AccountAvailabilityState;
  reason: string;
  message: string;
  checkedAt: string;
  source: AccountAvailabilitySource;
}

/** 账号健康状态 */
export interface AccountHealth {
  loginState: 'unknown' | 'ok' | 'expired';
  verificationRequired: boolean;
  consecutiveFailures: number;
  successCount: number;
  failureCount: number;
  lastSuccessAt?: string;
  lastFailureAt?: string;
  /**
   * 错误码。保持 string 而非 TaskErrorCode，因为历史 JSON 和 IPC 传入的值
   * 可能包含未知错误码，在 G-404 Repository 层具备运行时校验前不收紧。
   */
  lastErrorCode?: string;
  cooldownUntil?: string;
  /** 网页真实状态探测；与历史任务成功/失败计数分离。 */
  availability?: AccountAvailability;
}

/** 账号调度配置 */
export interface AccountScheduling {
  enabled: boolean;
  weight: number;
  preferredModes: GenerationMode[];
  manualCooldownUntil?: string;
}

/** 账号数据结构 */
export interface Account {
  id: string;
  name: string;
  /** 账号所属平台；旧数据缺失时按 doubao 归一化。 */
  platform?: AccountPlatform;
  /** 头像 URL（豆包默认头像） */
  avatar: string;
  /** Session 分区名（每个账号独立） */
  partition: string;
  status: AccountStatus;
  /** 是否手动置顶 */
  pinned: boolean;
  /** Seedance 每日额度的本地预测记录 */
  seedanceQuota?: SeedanceQuota;
  health?: AccountHealth;
  scheduling?: AccountScheduling;
  createdAt: string;
  updatedAt: string;
}

// ==================== 任务相关 ====================

/** 结构化失败原因，供恢复、筛选和统计使用 */
export interface TaskErrorInfo {
  /**
   * 错误码。保持 string 而非 TaskErrorCode，因为历史 JSON 和 IPC 传入的值
   * 可能包含未知错误码，在 G-404 Repository 层具备运行时校验前不收紧。
   * TaskErrorCode 联合可用于错误分类器和新受控 DTO。
   */
  code: string;
  message: string;
  recoverable: boolean;
  detectedAt: string;
}

/** 当前或最近一次执行的可恢复快照 */
export interface TaskRunSnapshot {
  runId: string;
  attempt: number;
  stage: TaskStage;
  message: string;
  startedAt: string;
  stageStartedAt: string;
  lastHeartbeatAt: string;
  submittedAt?: string;
  conversationUrl?: string;
  /** 平台明确受理后的可恢复观察绑定；不包含提示词、素材路径或账号凭据。 */
  acceptanceObservation?: {
    schemaVersion: 1;
    accountId: string;
    runId: string;
    conversationUrl: string;
    acceptedAt: string;
    evidence: {
      kind: 'generation_started' | 'prompt_published' | 'material_authorization_confirmed';
      messageCount?: number;
      generationStartedAt?: number;
    };
    cursor: {
      messageCount: number;
      generationStartedAt?: number;
      pollCount: number;
    };
    expectedArtifact: {
      kind: 'video' | 'image' | 'file';
      runId: string;
      artifactId?: string;
    };
    lease: {
      ownerId: string;
      acquiredAt: string;
      expiresAt: string;
      lastHeartbeatAt: string;
    };
    outcome: 'observing' | 'completed' | 'manual_review';
    completedAt?: string;
  };
  controlReadiness?: {
    schemaVersion?: 1;
    ready?: boolean;
    currentStage?: 'account' | 'new_conversation' | 'video_entry' | 'model' | 'aspect_ratio' | 'duration' | 'assets' | 'prompt' | 'submission_controls';
    modeEntryElapsedMs?: number;
    attempts: number;
    elapsedMs: number;
    stableSamples?: number;
    recoveryAttempts?: number;
    pageStructureVersion?: string;
    missingControl?: 'account_page' | 'conversation_editor' | 'video_entry' | 'model_control' | 'aspect_ratio_control' | 'duration_control' | 'asset_upload' | 'prompt_editor' | 'send_control';
    modelVisibleAtMs?: number;
    aspectRatioVisibleAtMs?: number;
    durationVisibleAtMs?: number;
    compositeVisibleAtMs?: number;
    stableAtMs?: number;
    failureStage?: 'account' | 'new_conversation' | 'video_entry' | 'model' | 'aspect_ratio' | 'duration' | 'assets' | 'prompt' | 'submission_controls' | 'mode_entry' | 'model_control' | 'composite_control' | 'stable_readback' | 'final_readback';
  };
  generationConfirmation?: {
    detectedAt: string;
    marker: 'parameter_confirmation' | 'confirm_before_generation';
    model?: string;
    duration?: string;
    aspectRatio?: string;
  };
  /** 仅保存计数、耗时与机器码，不保存页面文字、提示词或素材路径。 */
  executionDiagnostics?: {
    initializationQueueWaitMs?: number;
    initializationLimit?: number;
    upload?: {
      attempts: number;
      elapsedMs: number;
      expectedCount: number;
      observedCount: number;
      pending: boolean;
      stableSamples: number;
      failure?: 'pending' | 'count_incomplete' | 'count_mismatch' | 'unstable';
    };
    materialAuthorization?: {
      fingerprint: 'doubao-material-authorization-v1';
      detectedAt: string;
      clickedAt?: string;
      verifiedAt?: string;
      outcome: 'detected' | 'confirmed' | 'uncertain';
    };
  };
  manualObservation?: {
    startedAt: string;
    expiresAt: string;
    lastCheckedAt?: string;
    source: 'stored_conversation' | 'user_confirmed_url';
    outcome: 'observing' | 'completed' | 'manual_review';
  };
  input: {
    prompt: string;
    mode: GenerationMode;
    videoConfig?: Task['videoConfig'];
    attachments: string[];
    audioAttachment?: string;
  };
}

/** 单次任务运行的历史记录 */
export interface TaskRunRecord {
  runId: string;
  attempt: number;
  startedAt: string;
  finishedAt?: string;
  finalStage?: TaskStage;
  outcome?: 'done' | 'failed' | 'paused' | 'cancelled';
  /**
   * 错误码。保持 string 而非 TaskErrorCode，原因同 TaskErrorInfo.code。
   */
  errorCode?: string;
  durationMs?: number;
}

/** 任务执行锁（租约） */
export interface TaskLock {
  ownerId: string;
  acquiredAt: string;
  expiresAt: string;
}

/** 任务产物记录 */
export interface TaskArtifact {
  id: string;
  url: string;
  kind: 'image' | 'video' | 'file';
  source: 'network' | 'page' | 'manual';
  runId?: string;
  conversationUrl?: string;
  discoveredAt: string;
  validation?: {
    state: 'unknown' | 'valid' | 'expired' | 'invalid';
    checkedAt: string;
    contentType?: string;
    contentLength?: number;
    statusCode?: number;
    error?: string;
  };
}

/** 下载任务 */
export interface DownloadJob {
  id: string;
  taskId: string;
  accountId: string | null;
  mode: GenerationMode;
  url: string;
  status: 'queued' | 'downloading' | 'done' | 'failed';
  attempts: number;
  saveDir: string;
  filePath?: string;
  bytes?: number;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

/** 任务数据结构 */
export interface Task {
  id: string;
  /** 提示词文本 */
  prompt: string;
  /** 分配的目标账号 ID */
  assignedAccountId: string | null;
  /** 执行意图：hold 不得调度，armed 才允许进入队列调度 */
  executionIntent?: TaskExecutionIntent;
  /** 任务状态 */
  status: TaskStatus;
  /** 生成模式 */
  mode: GenerationMode;
  /** 视频生成配置 */
  videoConfig?: {
    model: VideoModel;
    duration: VideoDuration;
    aspectRatio: VideoAspectRatio;
  };
  /** 参考图片路径列表（图生视频/图生图用） */
  attachments?: string[];
  /** 参考音频文件路径（视频生成配音用） */
  audioAttachment?: string;
  /** 执行结果/产出描述 */
  result: string | null;
  /** 产物的下载链接列表 */
  outputs: string[];
  /** 跨多次运行保留的产物记录；outputs 仅表示最近一次运行 */
  artifacts?: TaskArtifact[];
  /** 当前或最近一次执行的可恢复快照 */
  runtime?: TaskRunSnapshot;
  /** 结构化失败原因，供恢复、筛选和统计使用 */
  errorInfo?: TaskErrorInfo;
  runHistory?: TaskRunRecord[];
  lock?: TaskLock;
  batchId?: string;
  source?: 'manual' | 'csv' | 'workflow';
  dependsOnTaskIds?: string[];
  dependencyPolicy?: DependencyPolicy;
  /** 依赖阻断时持久化的原因任务 ID；去重、稳定排序，不包含提示词或页面信息 */
  blockedByTaskIds?: string[];
  /** 人工质量裁决；只记录人工判断，不自动重试或平台写入 */
  qualityVerdict?: QualityVerdict;
  projectId?: string;
  createdAt: string;
  updatedAt: string;
}

// ==================== 项目相关 ====================

/** 项目数据结构 */
export interface Project {
  id: string;
  name: string;
  description: string;
  color: string;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}

// ==================== 日志相关 ====================

/** 系统日志条目 */
export interface LogEntry {
  id: string;
  level: 'info' | 'warn' | 'error';
  scope: string;
  message: string;
  taskId?: string;
  accountId?: string;
  createdAt: string;
}
