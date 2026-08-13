import { randomUUID } from 'crypto';
import type {
  GenerationMode,
  VideoModel,
  VideoDuration,
  VideoAspectRatio,
  Task,
  TaskArtifact,
  TaskAddParams,
  TaskAssignParams,
  TaskUpdateStatusParams,
  TaskUpdateInput,
  TaskUpdateRuntimeParams,
  TaskAcquireLockParams,
  TaskRenewLockParams,
  TaskReleaseLockParams,
  TaskRunSnapshot,
  TaskRunRecord,
  TaskValidateArtifactParams,
  CompletedOutput,
} from '@doubao-studio/contracts';
import { acquireTaskLease, renewTaskLease, canReleaseTaskLease } from '../utils/taskLease';
import { parseCsv, normalizeCsvMode } from '../utils/csv';

export interface TaskStore {
  read(): Task[];
  replace(tasks: Task[]): boolean;
}

export interface TaskServiceDependencies {
  store: TaskStore;
  defaultProjectId: () => string;
  id?: () => string;
  now?: () => string;
  nowMs?: () => number;
  /** 产物网络探针（Electron session 探测由 IPC 层注入，Core 只消费结果） */
  probeArtifact?: ArtifactProbe;
  /** 诊断脱敏用的路径 basename（IPC 注入 path.basename；Core 默认按分隔符截取末段） */
  basename?: (value: string) => string;
}

export type TaskServiceResult<T = undefined> =
  | ({ success: true } & (T extends undefined ? object : { data: T }))
  | { success: false; error: string };

export interface TaskRecoverySummary {
  recoveredTasks: number;
  clearedLocks: number;
}

/** CSV 导入时传入 Core 的最小账号投影 */
export interface TaskCsvAccountProjection {
  id: string;
  name: string;
}

/** CSV 导入命令：纯文本 + 账号投影 + 可选项目 ID */
export interface TaskCsvImportCommand {
  text: string;
  accounts: readonly TaskCsvAccountProjection[];
  projectId?: string;
}

/** CSV 导入成功返回的数据 */
export interface TaskCsvImportResultData {
  tasks: Task[];
  batchId: string;
  imported: number;
  skipped: number;
  errors: string[];
}

/** 产物校验成功返回的数据 */
export interface TaskValidateArtifactResultData {
  valid: boolean;
  artifact: TaskArtifact;
}

/** 产物网络探针结果：由 IPC 层注入的 Electron 探测产生 */
export type ArtifactProbeResult =
  | { kind: 'response'; statusCode: number; contentType?: string; contentLength?: number }
  | { kind: 'timeout' }
  | { kind: 'error'; message: string };

/** 产物探针：Core 只消费结果，网络/session/账号解析由注入实现负责 */
export type ArtifactProbe = (
  artifact: TaskArtifact,
  assignedAccountId: string | null,
) => Promise<ArtifactProbeResult>;

const ACTIVE = new Set<Task['status']>(['executing', 'generating', 'waiting_verification']);
const WRITE_ERROR = '任务数据写入失败，请检查磁盘空间和数据目录权限';
const RENEW_WRITE_ERROR = '任务锁续租写入失败';
const RELEASE_WRITE_ERROR = '任务锁释放写入失败';
const TERMINAL_STATUSES: ReadonlyArray<Task['status']> = ['done', 'fail', 'paused', 'cancelled'];
const VALID_MODELS: readonly VideoModel[] = ['seedance-2.5', 'seedance-2.0', 'seedance-2.0-fast', 'seedance-2.0-mini'];
const VALID_RATIOS: readonly VideoAspectRatio[] = ['1:1', '3:4', '4:3', '9:16', '16:9', '21:9'];

function artifactId(url: string): string {
  let hash = 5381;
  for (let index = 0; index < url.length; index++) hash = ((hash << 5) + hash) ^ url.charCodeAt(index);
  return `artifact-${(hash >>> 0).toString(16)}`;
}

export class TaskService {
  private readonly id: () => string;
  private readonly now: () => string;
  private readonly nowMs: () => number;
  private readonly basename: (value: string) => string;

  constructor(private readonly deps: TaskServiceDependencies) {
    this.id = deps.id || randomUUID;
    this.now = deps.now || (() => new Date().toISOString());
    this.nowMs = deps.nowMs || (() => Date.now());
    this.basename = deps.basename || ((value) => value.split(/[\\/]/).pop() || value);
  }

  private readTasks(): Task[] | null {
    try {
      return this.deps.store.read();
    } catch {
      return null;
    }
  }

  private persist(tasks: Task[]): boolean {
    try {
      return this.deps.store.replace(tasks);
    } catch {
      return false;
    }
  }

  /** 将任务重置为排队状态，清除运行结果、产物列表、错误信息和锁 */
  private resetTaskForQueue(task: Task, timestamp: string): void {
    task.status = 'queued';
    task.result = null;
    task.outputs = [];
    task.errorInfo = undefined;
    // 暂停/中断任务重新入队时不应继承旧运行锁，否则恢复后会被当作仍在执行。
    task.lock = undefined;
    if (task.runtime) {
      task.runtime = {
        ...task.runtime,
        stage: 'queued',
        message: '等待执行',
        stageStartedAt: timestamp,
        lastHeartbeatAt: timestamp,
      };
    }
    task.updatedAt = timestamp;
  }

  create(params: TaskAddParams): TaskServiceResult<Task[]> {
    const prompts = (params.prompts || []).map((prompt) => prompt.trim()).filter(Boolean);
    if (prompts.length === 0) return { success: false, error: '请输入至少一条提示词' };
    const tasks = this.readTasks();
    if (!tasks) return { success: false, error: WRITE_ERROR };
    const mode: GenerationMode = params.mode || 'chat';
    const created = prompts.map((prompt): Task => {
      const timestamp = this.now();
      return {
        id: this.id(), prompt, assignedAccountId: null, status: 'queued', mode,
        videoConfig: params.videoConfig, attachments: params.attachments,
        audioAttachment: params.audioAttachment, result: null, outputs: [], artifacts: [],
        runHistory: [], source: 'manual', dependsOnTaskIds: [],
        projectId: params.projectId || this.deps.defaultProjectId(),
        createdAt: timestamp, updatedAt: timestamp,
      };
    });
    tasks.push(...created);
    if (!this.persist(tasks)) return { success: false, error: WRITE_ERROR };
    return { success: true, data: created };
  }

  assign(params: TaskAssignParams): TaskServiceResult {
    const tasks = this.readTasks();
    if (!tasks) return { success: false, error: WRITE_ERROR };
    const task = tasks.find((item) => item.id === params.taskId);
    if (!task) return { success: false, error: '任务不存在' };
    if (ACTIVE.has(task.status)) return { success: false, error: '任务正在自动化执行中，无法重新指派' };
    task.assignedAccountId = params.accountId;
    this.resetTaskForQueue(task, this.now());
    if (!this.persist(tasks)) return { success: false, error: WRITE_ERROR };
    return { success: true };
  }

  update(params: { taskId: string; updates: TaskUpdateInput }): TaskServiceResult<Task> {
    const tasks = this.readTasks();
    if (!tasks) return { success: false, error: WRITE_ERROR };
    const task = tasks.find((item) => item.id === params.taskId);
    if (!task) return { success: false, error: '任务不存在' };
    const prompt = params.updates?.prompt?.trim();
    if (!prompt) return { success: false, error: '提示词不能为空' };
    task.prompt = prompt;
    task.videoConfig = params.updates.videoConfig;
    task.attachments = params.updates.attachments?.length ? params.updates.attachments : undefined;
    task.audioAttachment = params.updates.audioAttachment || undefined;
    this.resetTaskForQueue(task, this.now());
    if (!this.persist(tasks)) return { success: false, error: WRITE_ERROR };
    return { success: true, data: task };
  }

  updateStatus(params: TaskUpdateStatusParams): TaskServiceResult {
    const tasks = this.readTasks();
    if (!tasks) return { success: false, error: WRITE_ERROR };
    const task = tasks.find((item) => item.id === params.taskId);
    if (!task) return { success: false, error: '任务不存在' };
    task.status = params.status;
    if (params.result !== undefined) task.result = params.result;
    if (params.outputs !== undefined) {
      task.outputs = [...new Set(params.outputs.filter(Boolean))];
      const existing = new Map((task.artifacts || []).map((artifact) => [artifact.url, artifact]));
      for (const url of task.outputs) {
        if (!existing.has(url)) existing.set(url, {
          id: artifactId(url), url,
          kind: task.mode === 'video' ? 'video' : task.mode === 'image' ? 'image' : 'file',
          source: 'network', runId: task.runtime?.runId,
          conversationUrl: task.runtime?.conversationUrl, discoveredAt: this.now(),
        });
      }
      task.artifacts = [...existing.values()];
    }
    if (params.status === 'done') task.errorInfo = undefined;
    task.updatedAt = this.now();
    if (!this.persist(tasks)) return { success: false, error: WRITE_ERROR };
    return { success: true };
  }

  delete(taskId: string): TaskServiceResult {
    const tasks = this.readTasks();
    if (!tasks) return { success: false, error: WRITE_ERROR };
    const index = tasks.findIndex((task) => task.id === taskId);
    if (index < 0) return { success: false, error: '任务不存在' };
    if (ACTIVE.has(tasks[index].status)) return { success: false, error: '任务正在执行，请先暂停后再删除' };
    const dependentCount = tasks.filter((task) => task.dependsOnTaskIds?.includes(taskId)).length;
    if (dependentCount > 0) return { success: false, error: `仍有 ${dependentCount} 个任务依赖此任务，请先调整依赖关系` };
    tasks.splice(index, 1);
    if (!this.persist(tasks)) return { success: false, error: WRITE_ERROR };
    return { success: true };
  }

  retry(taskId: string): TaskServiceResult<Task> {
    const tasks = this.readTasks();
    if (!tasks) return { success: false, error: WRITE_ERROR };
    const task = tasks.find((item) => item.id === taskId);
    if (!task) return { success: false, error: '任务不存在' };
    if (ACTIVE.has(task.status)) return { success: false, error: '任务正在执行中，无法重试' };
    this.resetTaskForQueue(task, this.now());
    if (!this.persist(tasks)) return { success: false, error: WRITE_ERROR };
    return { success: true, data: task };
  }

  batchPause(): TaskServiceResult {
    const tasks = this.readTasks();
    if (!tasks) return { success: false, error: WRITE_ERROR };
    const timestamp = this.now();
    let changed = false;
    for (const task of tasks) {
      if (ACTIVE.has(task.status)) {
        task.status = 'paused';
        task.result = '批量暂停';
        task.errorInfo = { code: 'cancelled', message: '批量暂停', recoverable: true, detectedAt: timestamp };
        if (task.runtime) {
          task.runtime = { ...task.runtime, stage: 'paused', message: '批量暂停', stageStartedAt: timestamp, lastHeartbeatAt: timestamp };
        }
        task.updatedAt = timestamp;
        changed = true;
      }
    }
    if (!changed) return { success: true };
    if (!this.persist(tasks)) return { success: false, error: WRITE_ERROR };
    return { success: true };
  }

  recoverInterruptedTasks(): TaskServiceResult<TaskRecoverySummary> {
    const tasks = this.readTasks();
    if (!tasks) return { success: false, error: WRITE_ERROR };

    const timestamp = this.now();
    let recoveredTasks = 0;
    let clearedLocks = 0;
    let changed = false;

    for (const task of tasks) {
      if (!ACTIVE.has(task.status)) {
        if (task.lock) {
          task.lock = undefined;
          clearedLocks++;
          changed = true;
        }
        continue;
      }

      task.status = 'paused';
      task.result = '程序上次退出时任务仍在运行，可重新执行';
      task.errorInfo = {
        code: 'cancelled',
        message: task.result,
        recoverable: true,
        detectedAt: timestamp,
      };
      if (task.runtime) {
        task.runtime = {
          ...task.runtime,
          stage: 'paused',
          message: '程序重启，任务已安全暂停',
          stageStartedAt: timestamp,
          lastHeartbeatAt: timestamp,
        };
      }
      task.updatedAt = timestamp;
      if (task.lock) clearedLocks++;
      task.lock = undefined;

      if (task.runtime) {
        const runtime = task.runtime;
        const activeRun = task.runHistory?.find(
          (run) => run.runId === runtime.runId && !run.finishedAt,
        );
        if (activeRun) {
          activeRun.finishedAt = timestamp;
          activeRun.finalStage = 'paused';
          activeRun.outcome = 'paused';
          activeRun.errorCode = 'cancelled';
          activeRun.durationMs = Math.max(0, new Date(timestamp).getTime() - new Date(activeRun.startedAt).getTime());
        }
      }

      recoveredTasks++;
      changed = true;
    }

    if (!changed) return { success: true, data: { recoveredTasks: 0, clearedLocks: 0 } };
    if (!this.persist(tasks)) return { success: false, error: WRITE_ERROR };
    return { success: true, data: { recoveredTasks, clearedLocks } };
  }

  updateRuntime(params: TaskUpdateRuntimeParams): TaskServiceResult<Task> {
    const tasks = this.readTasks();
    if (!tasks) return { success: false, error: WRITE_ERROR };
    const task = tasks.find((item) => item.id === params.taskId);
    if (!task) return { success: false, error: '任务不存在' };

    const timestamp = this.now();

    if (params.status) task.status = params.status;
    if (params.result !== undefined) task.result = params.result;
    if (params.errorInfo === null) task.errorInfo = undefined;
    else if (params.errorInfo) task.errorInfo = params.errorInfo;

    if (params.runtime) {
      if (!task.runtime && !params.runtime.runId) {
        return { success: false, error: '运行快照尚未初始化' };
      }
      task.runtime = { ...(task.runtime || {}), ...params.runtime } as TaskRunSnapshot;
      const runtime = task.runtime;
      task.runHistory = task.runHistory || [];
      let record = task.runHistory.find((item) => item.runId === runtime.runId);
      if (!record && runtime.runId && runtime.startedAt) {
        record = { runId: runtime.runId, attempt: runtime.attempt, startedAt: runtime.startedAt };
        task.runHistory.push(record);
        task.runHistory = task.runHistory.slice(-20);
      }
      if (record && params.status && TERMINAL_STATUSES.includes(params.status)) {
        record.finishedAt = timestamp;
        record.finalStage = runtime.stage;
        record.outcome = params.status === 'fail' ? 'failed' : params.status as TaskRunRecord['outcome'];
        record.errorCode = task.errorInfo?.code;
        record.durationMs = Math.max(0, new Date(timestamp).getTime() - new Date(record.startedAt).getTime());
      }
    }

    task.updatedAt = timestamp;
    if (!this.persist(tasks)) return { success: false, error: WRITE_ERROR };
    return { success: true, data: task };
  }

  acquireLock(params: TaskAcquireLockParams): TaskServiceResult<Task> {
    const tasks = this.readTasks();
    if (!tasks) return { success: false, error: WRITE_ERROR };
    const task = tasks.find((item) => item.id === params.taskId);
    if (!task) return { success: false, error: '任务不存在' };

    const nowMs = this.nowMs();
    const accountConflict = task.assignedAccountId && tasks.some((item) =>
      item.id !== task.id &&
      item.assignedAccountId === task.assignedAccountId &&
      item.lock &&
      Date.parse(item.lock.expiresAt) > nowMs,
    );
    if (accountConflict) return { success: false, error: '该账号已经被其他任务锁定' };

    const decision = acquireTaskLease(task.lock, params.ownerId, nowMs);
    if (!decision.success) return decision;

    task.lock = decision.lock;
    task.updatedAt = new Date(nowMs).toISOString();
    if (!this.persist(tasks)) return { success: false, error: WRITE_ERROR };
    return { success: true, data: task };
  }

  renewLock(params: TaskRenewLockParams): TaskServiceResult<Task> {
    const tasks = this.readTasks();
    if (!tasks) return { success: false, error: WRITE_ERROR };
    const task = tasks.find((item) => item.id === params.taskId);
    if (!task) return { success: false, error: '任务不存在' };

    const nowMs = this.nowMs();
    const decision = renewTaskLease(task.lock, params.ownerId, nowMs);
    if (!decision.success) return decision;

    task.lock = decision.lock;
    task.updatedAt = new Date(nowMs).toISOString();
    if (!this.persist(tasks)) return { success: false, error: RENEW_WRITE_ERROR };
    return { success: true, data: task };
  }

  releaseLock(params: TaskReleaseLockParams): TaskServiceResult {
    const tasks = this.readTasks();
    if (!tasks) return { success: false, error: WRITE_ERROR };
    const task = tasks.find((item) => item.id === params.taskId);
    if (!task) return { success: false, error: '任务不存在' };

    if (!canReleaseTaskLease(task.lock, params.ownerId)) {
      return { success: false, error: '任务锁 owner 不匹配' };
    }

    const nowMs = this.nowMs();
    task.lock = undefined;
    task.updatedAt = new Date(nowMs).toISOString();
    if (!this.persist(tasks)) return { success: false, error: RELEASE_WRITE_ERROR };
    return { success: true };
  }

  /** CSV 批量导入：纯文本解析 → 字段规范化 → 账号匹配 → 依赖映射 → 单次 Repository 写入 */
  importCsv(command: TaskCsvImportCommand): TaskServiceResult<TaskCsvImportResultData> {
    // 1. 去除 UTF-8 BOM
    const text = command.text.replace(/^\uFEFF/, '');

    // 2. 纯解析（parseCsv 可能抛出未闭合引号错误）
    let rows: string[][];
    try {
      rows = parseCsv(text);
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }

    // 3. 结构校验：至少包含表头和一行数据
    if (rows.length < 2) return { success: false, error: 'CSV 没有可导入的数据行' };

    // 4. 识别表头列索引
    const headers = rows[0].map((header) => header.trim().toLowerCase());
    const indexOf = (...names: string[]): number =>
      names.map((name) => headers.indexOf(name)).find((index) => index >= 0) ?? -1;
    const promptIndex = indexOf('prompt', '提示词');

    // 5. 结构校验：必须存在 prompt 或 提示词 列
    if (promptIndex < 0) return { success: false, error: 'CSV 必须包含 prompt 或 提示词 列' };

    // 6. 纯行处理：字段规范化、账号匹配、空行跳过（无副作用）
    const modeIndex = indexOf('mode', '模式');
    const modelIndex = indexOf('model', '模型');
    const durationIndex = indexOf('duration', '时长');
    const ratioIndex = indexOf('aspectratio', 'aspect_ratio', '比例');
    const attachmentsIndex = indexOf('attachments', '参考图片');
    const audioIndex = indexOf('audio', '参考音频');
    const accountIndex = indexOf('account', '账号');
    const dependsIndex = indexOf('depends_on', '依赖行');
    const policyIndex = indexOf('dependency_policy', '依赖策略');

    const errors: string[] = [];
    const sourceRows: number[] = [];

    interface CsvPartialTask {
      prompt: string;
      mode: GenerationMode;
      assignedAccountId: string | null;
      videoConfig: Task['videoConfig'];
      attachments: string[] | undefined;
      audioAttachment: string | undefined;
      dependencyPolicy: 'all_done' | 'all_finished';
      dependsOnRaw: string;
    }
    const partialTasks: CsvPartialTask[] = [];

    for (let dataIndex = 1; dataIndex < rows.length; dataIndex++) {
      const row = rows[dataIndex];
      const prompt = (row[promptIndex] || '').trim();
      if (!prompt) {
        errors.push(`第 ${dataIndex + 1} 行：提示词为空`);
        continue;
      }
      const mode: GenerationMode = modeIndex >= 0 ? normalizeCsvMode(row[modeIndex] || '') : 'chat';
      const model = row[modelIndex] as VideoModel;
      const duration = row[durationIndex] as VideoDuration;
      const aspectRatio = row[ratioIndex] as VideoAspectRatio;
      const accountName = accountIndex >= 0 ? (row[accountIndex] || '').trim() : '';
      const account = accountName ? command.accounts.find((item) => item.name === accountName) : undefined;
      if (accountName && !account) errors.push(`第 ${dataIndex + 1} 行：未找到账号「${accountName}」，任务保持未指派`);

      partialTasks.push({
        prompt,
        mode,
        assignedAccountId: account?.id || null,
        videoConfig: mode === 'video' ? {
          model: VALID_MODELS.includes(model) ? model : 'seedance-2.0',
          duration: /^(?:[4-9]|1[0-5])s$/.test(duration) ? duration : '10s',
          aspectRatio: VALID_RATIOS.includes(aspectRatio) ? aspectRatio : '16:9',
        } : undefined,
        attachments: attachmentsIndex >= 0
          ? (row[attachmentsIndex] || '').split('|').map((item) => item.trim()).filter(Boolean)
          : undefined,
        audioAttachment: audioIndex >= 0 ? (row[audioIndex] || '').trim() || undefined : undefined,
        dependencyPolicy: policyIndex >= 0 && row[policyIndex] === 'all_finished' ? 'all_finished' : 'all_done',
        dependsOnRaw: dependsIndex >= 0 ? (row[dependsIndex] || '') : '',
      });
      sourceRows.push(dataIndex + 1);
    }

    // 7. 零有效任务：返回 success，不调用 Repository read、ID、时钟或 replace
    if (partialTasks.length === 0) {
      return {
        success: true,
        data: {
          tasks: [],
          batchId: '',
          imported: 0,
          skipped: rows.length - 1,
          errors: errors.slice(0, 20),
        },
      };
    }

    // 8. Repository read（fail-closed）
    const existingTasks = this.readTasks();
    if (!existingTasks) return { success: false, error: WRITE_ERROR };

    // 9. 单次 now() — 整个批次共享同一时间
    const timestamp = this.now();

    // 10. 生成 batchId（后缀来自注入 ID 生成器）
    const batchId = `batch-${timestamp.replace(/[-:.TZ]/g, '').slice(0, 14)}-${this.id().slice(0, 6)}`;

    // 11. 为每个成功任务生成独立 ID 并构造 Task 对象
    const projectId = command.projectId || this.deps.defaultProjectId();
    const imported: Task[] = partialTasks.map((partial): Task => ({
      id: this.id(),
      prompt: partial.prompt,
      assignedAccountId: partial.assignedAccountId,
      status: 'queued',
      mode: partial.mode,
      videoConfig: partial.videoConfig,
      attachments: partial.attachments,
      audioAttachment: partial.audioAttachment,
      result: null,
      outputs: [],
      artifacts: [],
      runHistory: [],
      batchId,
      source: 'csv',
      dependsOnTaskIds: [],
      dependencyPolicy: partial.dependencyPolicy,
      projectId,
      createdAt: timestamp,
      updatedAt: timestamp,
    }));

    // 12. 构造依赖关系：CSV 行号 → 本次成功导入任务的 ID
    const taskByCsvRow = new Map(sourceRows.map((rowNumber, index) => [rowNumber, imported[index]]));
    imported.forEach((task, index) => {
      const partial = partialTasks[index];
      task.dependsOnTaskIds = partial.dependsOnRaw.split('|')
        .map((item) => Number(item.trim()))
        .map((rowNumber) => taskByCsvRow.get(rowNumber)?.id)
        .filter((id): id is string => !!id);
    });

    // 13. 所有有效任务一次性追加至 Repository 返回的受追踪数组
    existingTasks.push(...imported);

    // 14. 单次 Repository replace（fail-closed）
    if (!this.persist(existingTasks)) return { success: false, error: WRITE_ERROR };

    // 15. 返回结果
    return {
      success: true,
      data: {
        tasks: imported,
        batchId,
        imported: imported.length,
        skipped: rows.length - 1 - imported.length,
        errors: errors.slice(0, 20),
      },
    };
  }

  /** 产物校验：查找 → 注入探针 → 四态判定 → 单次 Repository 写入（fail-closed） */
  async validateArtifact(params: TaskValidateArtifactParams): Promise<TaskServiceResult<TaskValidateArtifactResultData>> {
    // 1. Repository read（fail-closed）
    const tasks = this.readTasks();
    if (!tasks) return { success: false, error: WRITE_ERROR };

    // 2. 查找任务与产物；不存在时零探针/零时钟/零写入
    const task = tasks.find((item) => item.id === params.taskId);
    const artifact = task?.artifacts?.find((item) => item.id === params.artifactId);
    if (!task || !artifact) return { success: false, error: '产物不存在' };

    // 3. 探针依赖注入（Electron 网络探测由 IPC 层提供）
    if (!this.deps.probeArtifact) return { success: false, error: '产物验证不可用' };
    const probe = await this.deps.probeArtifact(artifact, task.assignedAccountId);

    // 4. 单次 now() — validation.checkedAt 与 task.updatedAt 共用
    const timestamp = this.now();

    // 5. 四态判定（保持既有语义：2xx 含 206 为 valid，401/403/404/410 为 expired，其余为 invalid）
    let validation: TaskArtifact['validation'];
    if (probe.kind === 'response') {
      const { statusCode } = probe;
      const state: NonNullable<TaskArtifact['validation']>['state'] =
        statusCode >= 200 && statusCode < 300 ? 'valid'
          : [401, 403, 404, 410].includes(statusCode) ? 'expired'
            : 'invalid';
      validation = {
        state,
        checkedAt: timestamp,
        contentType: probe.contentType,
        contentLength: probe.contentLength,
        statusCode,
      };
    } else if (probe.kind === 'timeout') {
      validation = { state: 'unknown', checkedAt: timestamp, error: '验证超时' };
    } else {
      validation = { state: 'invalid', checkedAt: timestamp, error: probe.message };
    }
    artifact.validation = validation;
    task.updatedAt = timestamp;

    // 6. 单次 Repository replace（fail-closed，写失败不返回成功）
    if (!this.persist(tasks)) return { success: false, error: WRITE_ERROR };

    // 7. 返回：valid 标志由 state 派生，错误消息沿用 validation.error
    return {
      success: true,
      data: { valid: validation.state === 'valid', artifact },
    };
  }

  /** 只读查询：返回全部任务（零写入） */
  getTasks(): TaskServiceResult<Task[]> {
    const tasks = this.readTasks();
    if (!tasks) return { success: false, error: WRITE_ERROR };
    return { success: true, data: tasks };
  }

  /** 只读查询：已完成且有产物的任务摘要（零写入） */
  getCompletedOutputs(): TaskServiceResult<CompletedOutput[]> {
    const tasks = this.readTasks();
    if (!tasks) return { success: false, error: WRITE_ERROR };
    return {
      success: true,
      data: tasks
        .filter((task) => task.status === 'done' && task.outputs.length > 0)
        .map((task) => ({
          taskId: task.id,
          prompt: task.prompt,
          outputs: task.outputs,
          accountId: task.assignedAccountId,
          mode: task.mode,
        })),
    };
  }

  /** 只读查询：导出诊断用的脱敏任务投影（路径名经注入 basename 收敛，零写入） */
  buildTaskDiagnostics(): TaskServiceResult<Task[]> {
    const tasks = this.readTasks();
    if (!tasks) return { success: false, error: WRITE_ERROR };
    return {
      success: true,
      data: tasks.map((task) => ({
        ...task,
        prompt: `[已脱敏，长度 ${task.prompt.length}]`,
        attachments: (task.attachments || []).map((item) => this.basename(item)),
        audioAttachment: task.audioAttachment ? this.basename(task.audioAttachment) : undefined,
        outputs: task.outputs.map((_, index) => `[产物地址 ${index + 1}]`),
        artifacts: (task.artifacts || []).map((artifact) => ({ ...artifact, url: '[已脱敏]' })),
      })),
    };
  }
}
