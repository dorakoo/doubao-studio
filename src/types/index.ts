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

/** 任务状态（V2 扩展） */
export type TaskStatus = 'queued' | 'executing' | 'generating' | 'done' | 'fail';

/** 任务数据结构 */
export interface Task {
  id: string;
  prompt: string;
  assignedAccountId: string | null;
  status: TaskStatus;
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
