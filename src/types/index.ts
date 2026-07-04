/**
 * src/types/index.ts
 * 全局类型定义（渲染进程侧）
 */

/** 账号状态 */
export type AccountStatus = 'idle' | 'busy' | 'error';

/** 账号数据结构 */
export interface Account {
  id: string;
  name: string;
  avatar: string;
  partition: string;
  status: AccountStatus;
  /** 是否手动置顶 */
  pinned: boolean;
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

/** 任务状态（V2 扩展） */
export type TaskStatus = 'queued' | 'executing' | 'generating' | 'done' | 'fail';

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
  createdAt: string;
  updatedAt: string;
}

/** 任务状态标签配置 */
export const TASK_STATUS_CONFIG: Record<TaskStatus, { label: string; color: string; className: string }> = {
  queued: { label: '排队中', color: '#60a5fa', className: 'queued' },
  executing: { label: '注入中', color: '#a78bfa', className: 'executing' },
  generating: { label: '生成中', color: '#fbbf24', className: 'generating' },
  done: { label: '已完成', color: '#34d399', className: 'done' },
  fail: { label: '失败', color: '#fb7185', className: 'fail' },
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
