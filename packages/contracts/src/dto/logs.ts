/**
 * @doubao-studio/contracts — 日志 IPC DTO
 *
 * 日志 IPC 的参数和返回值类型。
 * 复用 domain 中的 LogEntry 模型。
 */

import type { LogEntry } from '../domain';

// ==================== IPC 返回值 ====================

/** 日志操作结果 */
export interface LogOperationResult {
  success: boolean;
}

// ==================== IPC 参数 DTO ====================

/** 追加日志条目的参数（不含自动生成的 id 和 createdAt） */
export type LogAppendParams = Omit<LogEntry, 'id' | 'createdAt'>;

// ==================== 便捷别名 ====================

/** 日志列表返回类型 */
export type LogListResult = LogEntry[];
