/**
 * @doubao-studio/contracts
 * 跨进程共享类型契约包 — 仅类型声明，不含运行时 JS。
 *
 * 消费方必须使用 `import type` 导入，禁止普通 import。
 */

export type {
  GenerationMode,
  AccountStatus,
  TaskStatus,
  TaskStage,
  TaskErrorCode,
  VideoModel,
  VideoDuration,
  VideoAspectRatio,
  DependencyPolicy,
} from './enums';

export type {
  SeedanceQuota,
  AccountHealth,
  AccountScheduling,
  Account,
  TaskErrorInfo,
  TaskRunSnapshot,
  TaskRunRecord,
  TaskLock,
  TaskArtifact,
  DownloadJob,
  Task,
  Project,
  LogEntry,
} from './domain';

// ==================== IPC DTO ====================

export type {
  AccountOperationResult,
  AccountResult,
  AccountAddParams,
  AccountUpdateParams,
  AccountIdParams,
  AccountSetStatusParams,
  AccountSetPinnedParams,
  AccountUpdateSeedanceQuotaParams,
  AccountHealthAction,
  AccountUpdateHealthParams,
  AccountUpdateSchedulingParams,
} from './dto/accounts';

export type {
  TaskOperationResult,
  TaskResult,
  TaskAddResult,
  TaskAddParams,
  TaskAssignParams,
  TaskUpdateStatusParams,
  TaskUpdateRuntimeParams,
  TaskAcquireLockParams,
  TaskReleaseLockParams,
  TaskImportCsvParams,
  TaskUpdateInput,
  TaskUpdateParams,
  TaskIdParams,
  CsvImportResult,
  CompletedOutput,
  TaskDownloadOutputsParams,
  TaskDownloadOutputsResult,
  FileSelectResult,
  AudioSelectResult,
  ReadFileAsBase64Result,
  SelectSaveDirResult,
  TaskValidateArtifactParams,
  TaskValidateArtifactResult,
  TaskSaveAdapterReportParams,
  TaskSelectAdapterRulesResult,
  AdapterSelfCheckItem,
  AdapterSelfCheckReport,
  AdapterRuleBundle,
  ExportDiagnosticsResult,
} from './dto/tasks';

export type {
  ProjectOperationResult,
  ProjectResult,
  ProjectAddParams,
  ProjectUpdateParams,
  ProjectIdParams,
} from './dto/projects';

export type {
  IntegrityCheckResult,
  ExportBackupResult,
  RestoreBackupResult,
  ExportProjectResult,
  CheckUpdateResult,
} from './dto/system';

export type {
  LogOperationResult,
  LogAppendParams,
  LogListResult,
} from './dto/logs';

export type { ElectronAPI } from './dto/electron-api';
