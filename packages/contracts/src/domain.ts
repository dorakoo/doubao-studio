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
  TaskStatus,
  TaskStage,
  VideoModel,
  VideoDuration,
  VideoAspectRatio,
  DependencyPolicy,
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
