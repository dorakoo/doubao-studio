/**
 * main/utils/logger.ts
 * 主进程错误日志辅助
 *
 * 将未捕获异常写入日志文件，写入失败时退回 stderr。
 * 日志文件位于 userData/DoubaoStudioData/crash.log，单文件追加写入，
 * 超过 2MB 时自动截断为最后 512KB，避免无限增长。
 */

import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';

const LOG_FILENAME = 'crash.log';
const MAX_LOG_SIZE = 2 * 1024 * 1024; // 2MB
const TRUNCATED_SIZE = 512 * 1024; // 截断后保留最后 512KB

/** 获取日志文件路径（app ready 前可能不可用，此时返回 null） */
function getLogPath(): string | null {
  try {
    const userDataPath = app.getPath('userData');
    const dataDir = path.join(userDataPath, 'DoubaoStudioData');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    return path.join(dataDir, LOG_FILENAME);
  } catch {
    return null;
  }
}

/** 截断日志文件，保留最后 512KB */
function truncateLog(filePath: string): void {
  try {
    const stat = fs.statSync(filePath);
    if (stat.size <= MAX_LOG_SIZE) return;
    const fd = fs.openSync(filePath, 'r');
    try {
      const buffer = Buffer.alloc(TRUNCATED_SIZE);
      fs.readSync(fd, buffer, 0, TRUNCATED_SIZE, stat.size - TRUNCATED_SIZE);
      fs.writeFileSync(filePath, buffer);
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    // 截断失败时忽略，不影响主流程
  }
}

/**
 * 写入一行错误日志到文件，写入失败时退回 stderr。
 *
 * @param level   - 日志级别（'uncaughtException' | 'unhandledRejection'）
 * @param message - 错误消息
 * @param stack   - 可选的堆栈信息
 */
export function writeCrashLog(level: string, message: string, stack?: string): void {
  const timestamp = new Date().toISOString();
  const pid = process.pid;
  const lines = [
    `[${timestamp}] [pid:${pid}] [${level}] ${message}`,
  ];
  if (stack) {
    lines.push(stack);
  }
  const entry = lines.join('\n') + '\n';

  const logPath = getLogPath();
  if (logPath) {
    try {
      fs.appendFileSync(logPath, entry, 'utf-8');
      truncateLog(logPath);
      // 文件写入成功也输出到 stderr，便于开发时查看
      process.stderr.write(entry);
      return;
    } catch {
      // 文件写入失败，退回 stderr
    }
  }
  process.stderr.write(entry);
}
