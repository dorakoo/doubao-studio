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
  createdAt: string;
  updatedAt: string;
}

/** 任务状态 */
export type TaskStatus = 'queued' | 'running' | 'done' | 'fail';

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
  running: { label: '执行中', color: '#fbbf24', className: 'running' },
  done: { label: '已完成', color: '#34d399', className: 'done' },
  fail: { label: '失败', color: '#fb7185', className: 'fail' },
};

/** 账号状态标签配置 */
export const ACCOUNT_STATUS_CONFIG: Record<AccountStatus, { label: string; color: string }> = {
  idle: { label: '空闲', color: '#4ade80' },
  busy: { label: '忙碌', color: '#fbbf24' },
  error: { label: '异常', color: '#f87171' },
};
