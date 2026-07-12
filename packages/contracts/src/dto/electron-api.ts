/**
 * @doubao-studio/contracts — ElectronAPI 桌面内部预加载契约
 *
 * 定义 contextBridge.exposeInMainWorld('electronAPI', ...) 暴露的对象类型。
 * 方法名、参数和返回值必须与 main/preload.ts 的实际暴露对象一致。
 *
 * 这是桌面内部契约，不是对外 Agent API。
 * 禁止将 Cookie、Session、文件路径、内部下载 URL 等字段暴露到公共 Capability Schema。
 */

import type {
  Account,
  Task,
  Project,
  TaskErrorInfo,
  TaskRunSnapshot,
  DownloadJob,
  AccountScheduling,
} from '../domain';
import type {
  GenerationMode,
  TaskStatus,
} from '../enums';

import type {
  AccountResult,
  AccountOperationResult,
  AccountHealthAction,
} from './accounts';

import type {
  TaskResult,
  TaskAddResult,
  TaskOperationResult,
  TaskUpdateInput,
  CsvImportResult,
  CompletedOutput,
  TaskDownloadOutputsResult,
  FileSelectResult,
  AudioSelectResult,
  ReadFileAsBase64Result,
  SelectSaveDirResult,
  TaskValidateArtifactResult,
  TaskSelectAdapterRulesResult,
  ExportDiagnosticsResult,
  AdapterSelfCheckReport,
} from './tasks';

import type {
  ProjectResult,
  ProjectOperationResult,
} from './projects';

import type {
  IntegrityCheckResult,
  ExportBackupResult,
  RestoreBackupResult,
  ExportProjectResult,
  CheckUpdateResult,
} from './system';

import type {
  LogOperationResult,
  LogAppendParams,
  LogListResult,
} from './logs';

/**
 * 桌面内部预加载契约。
 *
 * 消费方：
 * - main/preload.ts 通过 `satisfies ElectronAPI` 约束暴露对象
 * - src/types/electron.d.ts 通过 `import type { ElectronAPI }` 声明全局 Window
 */
export interface ElectronAPI {
  // ---- 项目管理 ----
  projects: {
    list: () => Promise<Project[]>;
    add: (name: string, description?: string, color?: string) => Promise<ProjectResult>;
    update: (id: string, updates: Partial<Pick<Project, 'name' | 'description' | 'color' | 'archived'>>) => Promise<ProjectResult>;
    delete: (id: string) => Promise<ProjectOperationResult>;
  };

  // ---- 账号管理 ----
  accounts: {
    list: () => Promise<Account[]>;
    add: (name: string) => Promise<AccountResult>;
    update: (id: string, name: string) => Promise<AccountOperationResult>;
    delete: (id: string) => Promise<AccountOperationResult>;
    refresh: (id: string) => Promise<AccountOperationResult>;
    setStatus: (id: string, status: string) => Promise<{ success: boolean }>;
    setPinned: (id: string, pinned: boolean) => Promise<{ success: boolean }>;
    updateSeedanceQuota: (id: string, action: 'consume' | 'exhausted', units?: number) => Promise<AccountResult>;
    updateHealth: (id: string, action: AccountHealthAction, errorCode?: string) => Promise<AccountResult>;
    updateScheduling: (id: string, updates: Partial<AccountScheduling>) => Promise<AccountResult>;
    getPartition: (id: string) => Promise<string | null>;
  };

  // ---- 任务调度 ----
  tasks: {
    list: () => Promise<Task[]>;
    add: (
      prompts: string[],
      mode?: GenerationMode,
      videoConfig?: Task['videoConfig'],
      attachments?: string[],
      audioAttachment?: string,
      projectId?: string
    ) => Promise<TaskAddResult>;
    assign: (taskId: string, accountId: string) => Promise<TaskOperationResult>;
    updateStatus: (
      taskId: string,
      status: string,
      result?: string,
      outputs?: string[]
    ) => Promise<TaskOperationResult>;
    updateRuntime: (taskId: string, patch: {
      status?: TaskStatus;
      runtime?: Partial<TaskRunSnapshot>;
      errorInfo?: TaskErrorInfo | null;
      result?: string;
    }) => Promise<TaskResult>;
    acquireLock: (taskId: string, ownerId: string) => Promise<TaskResult>;
    releaseLock: (taskId: string, ownerId?: string) => Promise<{ success: boolean }>;
    importCsv: (projectId?: string) => Promise<CsvImportResult>;
    update: (taskId: string, updates: TaskUpdateInput) => Promise<TaskResult>;
    delete: (taskId: string) => Promise<TaskOperationResult>;
    retry: (taskId: string) => Promise<TaskResult>;
    batchPause: () => Promise<{ success: boolean }>;
    getCompletedOutputs: () => Promise<CompletedOutput[]>;
    selectImages: () => Promise<FileSelectResult>;
    selectAudio: () => Promise<AudioSelectResult>;
    readFileAsBase64: (filePath: string) => Promise<ReadFileAsBase64Result>;
    downloadOutputs: (outputs: CompletedOutput[], saveDir?: string) => Promise<TaskDownloadOutputsResult>;
    listDownloads: () => Promise<DownloadJob[]>;
    exportDiagnostics: () => Promise<ExportDiagnosticsResult>;
    validateArtifact: (taskId: string, artifactId: string) => Promise<TaskValidateArtifactResult>;
    saveAdapterReport: (accountId: string, report: AdapterSelfCheckReport) => Promise<{ success: boolean }>;
    selectAdapterRules: () => Promise<TaskSelectAdapterRulesResult>;
    selectSaveDir: () => Promise<SelectSaveDirResult>;
  };

  // ---- 设置 ----
  settings: {
    get: () => Promise<Record<string, any>>;
    save: (settings: Record<string, any>) => Promise<{ success: boolean; error?: string }>;
  };

  // ---- 日志 ----
  logs: {
    list: () => Promise<LogListResult>;
    append: (entry: LogAppendParams) => Promise<LogOperationResult>;
    clear: () => Promise<LogOperationResult>;
  };

  // ---- 系统操作 ----
  system: {
    getVersion: () => Promise<string>;
    checkIntegrity: () => Promise<IntegrityCheckResult>;
    exportBackup: () => Promise<ExportBackupResult>;
    restoreBackup: () => Promise<RestoreBackupResult>;
    exportProject: (projectId: string) => Promise<ExportProjectResult>;
    checkUpdate: () => Promise<CheckUpdateResult>;
    minimize: () => void;
    toggleMaximize: () => void;
    close: () => void;
  };
}
