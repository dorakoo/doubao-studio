/**
 * @doubao-studio/contracts — 系统 IPC DTO
 *
 * 系统操作 IPC 的参数和返回值类型。
 */

// ==================== 完整性检查 ====================

export interface IntegrityCheckResult {
  success: boolean;
  issues: string[];
  checkedAt: string;
}

// ==================== 备份 ====================

export interface ExportBackupResult {
  success: boolean;
  filePath?: string;
  error?: string;
}

export interface RestoreBackupResult {
  success: boolean;
  requiresRestart?: boolean;
  error?: string;
}

// ==================== 项目导出 ====================

export interface ExportProjectResult {
  success: boolean;
  filePath?: string;
  error?: string;
}

// ==================== 更新检查 ====================

export interface CheckUpdateResult {
  success: boolean;
  currentVersion?: string;
  latestVersion?: string;
  hasUpdate?: boolean;
  url?: string;
  name?: string;
  error?: string;
}
