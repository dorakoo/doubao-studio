/**
 * @doubao-studio/contracts — 任务 IPC DTO
 *
 * 任务调度 IPC 的参数和返回值类型。
 * 复用 domain 中的领域模型，不引入运行时值。
 */

import type {
  Task,
  TaskErrorInfo,
  TaskRunSnapshot,
  TaskArtifact,
} from '../domain';
import type {
  GenerationMode,
  TaskStatus,
} from '../enums';

// ==================== 通用返回值 ====================

/** 任务操作简单结果（无数据返回） */
export interface TaskOperationResult {
  success: boolean;
  error?: string;
}

/** 任务操作结果（包含任务数据） */
export interface TaskResult {
  success: boolean;
  task?: Task;
  error?: string;
}

/** 任务批量创建结果 */
export interface TaskAddResult {
  success: boolean;
  tasks?: Task[];
  error?: string;
}

// ==================== IPC 参数 DTO ====================

export interface TaskAddParams {
  prompts: string[];
  mode?: GenerationMode;
  videoConfig?: Task['videoConfig'];
  attachments?: string[];
  audioAttachment?: string;
  projectId?: string;
}

export interface TaskAssignParams {
  taskId: string;
  accountId: string;
}

export interface TaskUpdateStatusParams {
  taskId: string;
  status: TaskStatus;
  result?: string;
  outputs?: string[];
}

export interface TaskUpdateRuntimeParams {
  taskId: string;
  status?: TaskStatus;
  runtime?: Partial<TaskRunSnapshot>;
  errorInfo?: TaskErrorInfo | null;
  result?: string;
}

export interface TaskAcquireLockParams {
  taskId: string;
  ownerId: string;
}

export interface TaskReleaseLockParams {
  taskId: string;
  ownerId?: string;
}

export interface TaskImportCsvParams {
  projectId?: string;
}

/** 编辑并重新运行任务时可更新的完整输入 */
export interface TaskUpdateInput {
  prompt: string;
  videoConfig?: Task['videoConfig'];
  attachments?: string[];
  audioAttachment?: string;
}

export interface TaskUpdateParams {
  taskId: string;
  updates: TaskUpdateInput;
}

export interface TaskIdParams {
  taskId: string;
}

// ==================== CSV 导入 ====================

/** CSV 批量导入结果 */
export interface CsvImportResult {
  success: boolean;
  tasks?: Task[];
  batchId?: string;
  imported?: number;
  skipped?: number;
  errors?: string[];
  error?: string;
}

// ==================== 已完成产物 ====================

/** 已完成任务的产物摘要 */
export interface CompletedOutput {
  taskId: string;
  prompt: string;
  outputs: string[];
  accountId: string | null;
  mode: GenerationMode;
}

export interface TaskDownloadOutputsParams {
  outputs: CompletedOutput[];
  saveDir?: string;
}

export interface TaskDownloadOutputsResult {
  success: boolean;
  count: number;
  failed: number;
  saveDir?: string;
  error?: string;
  jobIds?: string[];
}

// ==================== 文件选择 ====================

export interface FileSelectResult {
  success: boolean;
  filePaths?: string[];
  error?: string;
}

export interface AudioSelectResult {
  success: boolean;
  filePath?: string;
  error?: string;
}

export interface ReadFileAsBase64Result {
  success: boolean;
  data?: string;
  error?: string;
}

export interface SelectSaveDirResult {
  success: boolean;
  dirPath?: string;
  error?: string;
}

// ==================== 产物验证 ====================

export interface TaskValidateArtifactParams {
  taskId: string;
  artifactId: string;
}

export interface TaskValidateArtifactResult {
  success: boolean;
  artifact?: TaskArtifact;
  error?: string;
}

// ==================== 适配器 ====================

export interface TaskSaveAdapterReportParams {
  accountId: string;
  report: Record<string, any>;
}

export interface TaskSelectAdapterRulesResult {
  success: boolean;
  bundle?: Record<string, any>;
  error?: string;
}

/** 适配器自检单项 */
export interface AdapterSelfCheckItem {
  key: string;
  label: string;
  ok: boolean;
  detail: string;
}

/** 适配器自检报告 */
export interface AdapterSelfCheckReport {
  adapterVersion: string;
  pageUrl: string;
  checkedAt: string;
  score: number;
  items: AdapterSelfCheckItem[];
}

/** 适配器规则包 */
export interface AdapterRuleBundle {
  version: string;
  createdAt: string;
  rules: {
    input: string[];
    submit: string[];
    dialogs: string[];
    uploads: string[];
    media: string[];
  };
}

// ==================== 诊断导出 ====================

export interface ExportDiagnosticsResult {
  success: boolean;
  filePath?: string;
  error?: string;
}
