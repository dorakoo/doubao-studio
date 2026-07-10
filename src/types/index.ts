/**
 * src/types/index.ts
 * 全局类型定义（渲染进程侧）
 */

/** 账号状态 */
export type AccountStatus = 'idle' | 'busy' | 'error';

export interface SeedanceQuota {
  date: string;
  usedUnits: number;
  estimatedTotalUnits: number;
  exhausted: boolean;
  updatedAt: string;
}

export interface AccountHealth {
  loginState: 'unknown' | 'ok' | 'expired';
  verificationRequired: boolean;
  consecutiveFailures: number;
  successCount: number;
  failureCount: number;
  lastSuccessAt?: string;
  lastFailureAt?: string;
  lastErrorCode?: TaskErrorCode;
  cooldownUntil?: string;
}

/** 账号数据结构 */
export interface Account {
  id: string;
  name: string;
  avatar: string;
  partition: string;
  status: AccountStatus;
  /** 是否手动置顶 */
  pinned: boolean;
  /** Seedance 每日额度的本地预测记录。 */
  seedanceQuota?: SeedanceQuota;
  health?: AccountHealth;
  createdAt: string;
  updatedAt: string;
}

/** 豆包生成模式 */
export type GenerationMode = 'chat' | 'image' | 'video' | 'music';

/** 视频生成模型 */
export type VideoModel = 'seedance-2.0' | 'seedance-2.0-fast' | 'seedance-2.0-mini';

/** 视频时长 */
export type VideoDuration = '5s' | '10s' | '15s';

/** 视频比例 */
export type VideoAspectRatio = '1:1' | '3:4' | '4:3' | '9:16' | '16:9' | '21:9';

/** 视频配置默认值 */
export const DEFAULT_VIDEO_CONFIG = {
  model: 'seedance-2.0' as VideoModel,
  duration: '15s' as VideoDuration,
  aspectRatio: '16:9' as VideoAspectRatio,
};

/** 视频模型显示名映射 */
export const VIDEO_MODEL_LABELS: Record<VideoModel, string> = {
  'seedance-2.0': 'Seedance 2.0',
  'seedance-2.0-fast': 'Seedance 2.0 Fast',
  'seedance-2.0-mini': 'Seedance 2.0 Mini',
};

/** 视频模型消耗说明 */
export const VIDEO_MODEL_COST: Record<VideoModel, string> = {
  'seedance-2.0': '2 倍消耗',
  'seedance-2.0-fast': '快速出片',
  'seedance-2.0-mini': '日常使用',
};

/** 生成模式配置 */
export const GENERATION_MODE_CONFIG: Record<GenerationMode, {
  label: string;
  icon: string;
  color: string;
  url: string;
  description: string;
}> = {
  chat: {
    label: '对话',
    icon: '💬',
    color: '#60a5fa',
    url: 'https://www.doubao.com/chat/',
    description: '智能对话、问答、写作',
  },
  image: {
    label: '图片',
    icon: '🎨',
    color: '#a78bfa',
    url: 'https://www.doubao.com/chat/create-image/',
    description: 'AI 绘画、文生图、图生图',
  },
  video: {
    label: '视频',
    icon: '🎬',
    color: '#f472b6',
    url: 'https://www.doubao.com/chat/create-video/',
    description: 'AI 视频、文生视频、图生视频',
  },
  music: {
    label: '音乐',
    icon: '🎵',
    color: '#34d399',
    url: 'https://www.doubao.com/chat/create-music/',
    description: 'AI 作曲、音乐生成',
  },
};

/** 任务的队列级状态。具体执行位置记录在 runtime.stage。 */
export type TaskStatus =
  | 'queued'
  | 'executing'
  | 'generating'
  | 'waiting_verification'
  | 'paused'
  | 'done'
  | 'fail'
  | 'cancelled';

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

export interface TaskErrorInfo {
  code: TaskErrorCode;
  message: string;
  recoverable: boolean;
  detectedAt: string;
}

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

export interface TaskArtifact {
  id: string;
  url: string;
  kind: 'image' | 'video' | 'file';
  source: 'network' | 'page' | 'manual';
  runId?: string;
  conversationUrl?: string;
  discoveredAt: string;
}

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
  prompt: string;
  assignedAccountId: string | null;
  status: TaskStatus;
  /** 生成模式（默认 chat） */
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
  result: string | null;
  outputs: string[];
  /** 跨多次运行保留的产物记录；outputs 仅表示最近一次运行。 */
  artifacts?: TaskArtifact[];
  /** 当前或最近一次执行的可恢复快照。 */
  runtime?: TaskRunSnapshot;
  /** 结构化失败原因，供恢复、筛选和统计使用。 */
  errorInfo?: TaskErrorInfo;
  createdAt: string;
  updatedAt: string;
}

/** 编辑并重新运行任务时可更新的完整输入。 */
export interface TaskUpdateInput {
  prompt: string;
  videoConfig?: Task['videoConfig'];
  attachments?: string[];
  audioAttachment?: string;
}

/** 任务状态标签配置 */
export const TASK_STATUS_CONFIG: Record<TaskStatus, { label: string; color: string; className: string }> = {
  queued: { label: '排队中', color: '#60a5fa', className: 'queued' },
  executing: { label: '注入中', color: '#a78bfa', className: 'executing' },
  generating: { label: '生成中', color: '#fbbf24', className: 'generating' },
  waiting_verification: { label: '等待验证', color: '#fb923c', className: 'waiting-verification' },
  paused: { label: '已暂停', color: '#94a3b8', className: 'paused' },
  done: { label: '已完成', color: '#34d399', className: 'done' },
  fail: { label: '失败', color: '#fb7185', className: 'fail' },
  cancelled: { label: '已取消', color: '#94a3b8', className: 'cancelled' },
};

export const TASK_STAGE_LABELS: Record<TaskStage, string> = {
  queued: '等待执行',
  preparing_account: '准备账号',
  new_conversation: '创建新对话',
  switching_mode: '切换生成模式',
  configuring: '配置生成参数',
  uploading_assets: '上传参考素材',
  injecting_prompt: '填写提示词',
  submitting: '提交任务',
  waiting_verification: '等待人工验证',
  generating: '豆包生成中',
  extracting_outputs: '识别任务产物',
  completed: '已完成',
  paused: '已暂停',
  failed: '执行失败',
  cancelled: '已取消',
};

/** 账号状态标签配置 */
export const ACCOUNT_STATUS_CONFIG: Record<AccountStatus, { label: string; color: string }> = {
  idle: { label: '空闲', color: '#4ade80' },
  busy: { label: '忙碌', color: '#fbbf24' },
  error: { label: '异常', color: '#f87171' },
};

/** 自动化阶段 → UI 展示 */
export const AUTO_STATE_DISPLAY: Record<string, { label: string; color: string; animated: boolean }> = {
  idle: { label: '空闲', color: '#4ade80', animated: false },
  injecting: { label: '注入中…', color: '#a78bfa', animated: true },
  submitting: { label: '提交中…', color: '#818cf8', animated: true },
  generating: { label: '生成中…', color: '#fbbf24', animated: true },
  completed: { label: '已完成', color: '#34d399', animated: false },
  failed: { label: '失败', color: '#f87171', animated: false },
};
