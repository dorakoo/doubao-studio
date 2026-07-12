/**
 * tests/unit/contracts.test.ts
 * @doubao-studio/contracts 类型契约自检
 *
 * 验证共享枚举/联合类型和领域模型可以从 @doubao-studio/contracts 正确导入，
 * 且类型含义与各消费点期望一致。
 */

import { describe, it, expect } from 'vitest';
import type {
  GenerationMode,
  AccountStatus,
  TaskStatus,
  TaskStage,
  TaskErrorCode,
  VideoModel,
  VideoDuration,
  VideoAspectRatio,
  DependencyPolicy,
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
  // IPC DTO
  ElectronAPI,
  AccountAddParams,
  AccountUpdateHealthParams,
  AccountHealthAction,
  TaskAddParams,
  TaskUpdateInput,
  CsvImportResult,
  CompletedOutput,
  ProjectAddParams,
  IntegrityCheckResult,
  LogAppendParams,
} from '@doubao-studio/contracts';

describe('@doubao-studio/contracts', () => {
  it('GenerationMode 包含 chat / image / video / music', () => {
    const mode: GenerationMode = 'chat';
    expect(mode).toBe('chat');
    expect(['chat', 'image', 'video', 'music']).toContain('chat' as GenerationMode);
  });

  it('AccountStatus 包含 idle / busy / error', () => {
    const status: AccountStatus = 'idle';
    expect(status).toBe('idle');
  });

  it('TaskStatus 包含 8 个队列级状态', () => {
    const status: TaskStatus = 'queued';
    expect(status).toBe('queued');
    const allStatuses: TaskStatus[] = [
      'queued', 'executing', 'generating', 'waiting_verification',
      'paused', 'done', 'fail', 'cancelled',
    ];
    expect(allStatuses).toHaveLength(8);
  });

  it('TaskStage 包含 15 个执行阶段', () => {
    const stage: TaskStage = 'queued';
    expect(stage).toBe('queued');
    const allStages: TaskStage[] = [
      'queued', 'preparing_account', 'new_conversation', 'switching_mode',
      'configuring', 'uploading_assets', 'injecting_prompt', 'submitting',
      'waiting_verification', 'generating', 'extracting_outputs',
      'completed', 'paused', 'failed', 'cancelled',
    ];
    expect(allStages).toHaveLength(15);
  });

  it('TaskErrorCode 包含 13 个错误码', () => {
    const code: TaskErrorCode = 'unknown';
    expect(code).toBe('unknown');
    const allCodes: TaskErrorCode[] = [
      'cancelled', 'verification', 'quota_exhausted', 'membership_required',
      'face_restricted', 'content_rejected', 'network', 'timeout',
      'page_changed', 'submission_failed', 'generation_failed',
      'output_missing', 'unknown',
    ];
    expect(allCodes).toHaveLength(13);
  });

  it('VideoModel 包含 3 个模型', () => {
    const model: VideoModel = 'seedance-2.0';
    expect(model).toBe('seedance-2.0');
  });

  it('VideoDuration 包含 5s / 10s / 15s', () => {
    const duration: VideoDuration = '5s';
    expect(duration).toBe('5s');
  });

  it('VideoAspectRatio 包含 6 种比例', () => {
    const ratio: VideoAspectRatio = '1:1';
    expect(ratio).toBe('1:1');
  });

  it('DependencyPolicy 包含 all_done / all_finished', () => {
    const policy: DependencyPolicy = 'all_done';
    expect(policy).toBe('all_done');
  });

  it('所有类型均为字符串字面量联合（运行时仍为 string）', () => {
    const mode: GenerationMode = 'chat';
    const status: AccountStatus = 'idle';
    const taskStatus: TaskStatus = 'queued';
    const stage: TaskStage = 'queued';
    const errorCode: TaskErrorCode = 'unknown';
    const model: VideoModel = 'seedance-2.0';
    const duration: VideoDuration = '5s';
    const ratio: VideoAspectRatio = '1:1';
    const policy: DependencyPolicy = 'all_done';

    expect(typeof mode).toBe('string');
    expect(typeof status).toBe('string');
    expect(typeof taskStatus).toBe('string');
    expect(typeof stage).toBe('string');
    expect(typeof errorCode).toBe('string');
    expect(typeof model).toBe('string');
    expect(typeof duration).toBe('string');
    expect(typeof ratio).toBe('string');
    expect(typeof policy).toBe('string');
  });
});

describe('@doubao-studio/contracts 领域模型', () => {
  it('SeedanceQuota 包含日期、已用/预估额度和更新时间', () => {
    const quota: SeedanceQuota = {
      date: '2025-01-01',
      usedUnits: 3,
      estimatedTotalUnits: 10,
      exhausted: false,
      updatedAt: '2025-01-01T00:00:00.000Z',
    };
    expect(quota.usedUnits).toBe(3);
    expect(quota.exhausted).toBe(false);
  });

  it('AccountHealth 的 lastErrorCode 类型为 string，兼容已知和未知错误码', () => {
    const health: AccountHealth = {
      loginState: 'ok',
      verificationRequired: false,
      consecutiveFailures: 0,
      successCount: 1,
      failureCount: 0,
      lastErrorCode: 'verification',
    };
    expect(health.loginState).toBe('ok');
    expect(health.lastErrorCode).toBe('verification');
  });

  it('AccountHealth.lastErrorCode 可容纳历史/未知错误码', () => {
    // 历史 JSON 中可能存在不属于 TaskErrorCode 联合的错误码字符串。
    // 在 G-404 Repository 层具备运行时校验前，字段保持 string。
    const health: AccountHealth = {
      loginState: 'ok',
      verificationRequired: false,
      consecutiveFailures: 1,
      successCount: 0,
      failureCount: 1,
      lastErrorCode: 'legacy_deprecated_code',
    };
    expect(health.lastErrorCode).toBe('legacy_deprecated_code');
  });

  it('AccountScheduling 包含 enabled、weight、preferredModes', () => {
    const scheduling: AccountScheduling = {
      enabled: true,
      weight: 1,
      preferredModes: ['chat', 'video'],
    };
    expect(scheduling.preferredModes).toHaveLength(2);
  });

  it('Account 包含 id、name、partition、status、pinned 等必填字段', () => {
    const account: Account = {
      id: 'acc-1',
      name: '测试账号',
      avatar: '',
      partition: 'account_abc123',
      status: 'idle',
      pinned: false,
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-01T00:00:00.000Z',
    };
    expect(account.id).toBe('acc-1');
    expect(account.status).toBe('idle');
  });

  it('TaskErrorInfo 的 code 类型为 string，兼容已知和未知错误码', () => {
    const errorInfo: TaskErrorInfo = {
      code: 'timeout',
      message: '操作超时',
      recoverable: true,
      detectedAt: '2025-01-01T00:00:00.000Z',
    };
    expect(errorInfo.code).toBe('timeout');
    expect(errorInfo.recoverable).toBe(true);
  });

  it('TaskErrorInfo.code 可容纳历史/未知错误码', () => {
    // 历史 JSON 或 IPC 传入的错误码可能不属于 TaskErrorCode 联合。
    const errorInfo: TaskErrorInfo = {
      code: 'legacy_unknown_error',
      message: '历史遗留错误',
      recoverable: false,
      detectedAt: '2025-01-01T00:00:00.000Z',
    };
    expect(errorInfo.code).toBe('legacy_unknown_error');
  });

  it('TaskRunSnapshot 包含 runId、attempt、stage、input 等字段', () => {
    const snapshot: TaskRunSnapshot = {
      runId: 'run-1',
      attempt: 1,
      stage: 'queued',
      message: '等待执行',
      startedAt: '2025-01-01T00:00:00.000Z',
      stageStartedAt: '2025-01-01T00:00:00.000Z',
      lastHeartbeatAt: '2025-01-01T00:00:00.000Z',
      input: {
        prompt: '测试提示词',
        mode: 'chat',
        attachments: [],
      },
    };
    expect(snapshot.runId).toBe('run-1');
    expect(snapshot.input.mode).toBe('chat');
  });

  it('TaskRunRecord 的 errorCode 类型为 string，兼容已知和未知错误码', () => {
    const record: TaskRunRecord = {
      runId: 'run-1',
      attempt: 1,
      startedAt: '2025-01-01T00:00:00.000Z',
      finishedAt: '2025-01-01T00:01:00.000Z',
      finalStage: 'failed',
      outcome: 'failed',
      errorCode: 'generation_failed',
      durationMs: 60000,
    };
    expect(record.errorCode).toBe('generation_failed');
    expect(record.outcome).toBe('failed');
  });

  it('TaskRunRecord.errorCode 可容纳历史/未知错误码', () => {
    const record: TaskRunRecord = {
      runId: 'run-1',
      attempt: 1,
      startedAt: '2025-01-01T00:00:00.000Z',
      finishedAt: '2025-01-01T00:01:00.000Z',
      finalStage: 'failed',
      outcome: 'failed',
      errorCode: 'deprecated_historical_code',
      durationMs: 60000,
    };
    expect(record.errorCode).toBe('deprecated_historical_code');
  });

  it('TaskLock 包含 ownerId、acquiredAt、expiresAt', () => {
    const lock: TaskLock = {
      ownerId: 'owner-1',
      acquiredAt: '2025-01-01T00:00:00.000Z',
      expiresAt: '2025-01-01T04:00:00.000Z',
    };
    expect(lock.ownerId).toBe('owner-1');
  });

  it('TaskArtifact 包含 id、url、kind、source、discoveredAt', () => {
    const artifact: TaskArtifact = {
      id: 'artifact-1',
      url: 'https://example.com/video.mp4',
      kind: 'video',
      source: 'network',
      discoveredAt: '2025-01-01T00:00:00.000Z',
    };
    expect(artifact.kind).toBe('video');
  });

  it('DownloadJob 包含 id、taskId、mode、status、saveDir 等字段', () => {
    const job: DownloadJob = {
      id: 'job-1',
      taskId: 'task-1',
      accountId: null,
      mode: 'video',
      url: 'https://example.com/video.mp4',
      status: 'queued',
      attempts: 0,
      saveDir: '/downloads',
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-01T00:00:00.000Z',
    };
    expect(job.status).toBe('queued');
  });

  it('Task 包含 id、prompt、status、mode、outputs 等必填字段', () => {
    const task: Task = {
      id: 'task-1',
      prompt: '测试',
      assignedAccountId: null,
      status: 'queued',
      mode: 'chat',
      result: null,
      outputs: [],
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-01T00:00:00.000Z',
    };
    expect(task.id).toBe('task-1');
    expect(task.outputs).toEqual([]);
  });

  it('Project 包含 id、name、description、color、archived 等字段', () => {
    const project: Project = {
      id: 'proj-1',
      name: '默认项目',
      description: '',
      color: '#6d5dfc',
      archived: false,
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-01T00:00:00.000Z',
    };
    expect(project.name).toBe('默认项目');
  });

  it('LogEntry 包含 id、level、scope、message、createdAt', () => {
    const entry: LogEntry = {
      id: 'log-1',
      level: 'info',
      scope: 'system',
      message: '应用启动',
      createdAt: '2025-01-01T00:00:00.000Z',
    };
    expect(entry.level).toBe('info');
  });

  it('领域模型在运行时擦除为普通对象（不含运行时方法）', () => {
    const account: Account = {
      id: 'x', name: 'x', avatar: '', partition: 'p',
      status: 'idle', pinned: false,
      createdAt: '', updatedAt: '',
    };
    // 类型在运行时被擦除，account 只是普通对象
    expect(typeof account).toBe('object');
    expect(account.constructor).toBe(Object);
  });
});

/**
 * 验证 src/types/index.ts 兼容桥：渲染进程旧导入路径仍可用。
 * 如果此测试编译失败，说明 src/types/index.ts 的 re-export 缺失或类型不匹配。
 */
describe('src/types/index.ts 兼容桥', () => {
  it('从 src/types 可导入领域模型（Account, Task, Project 等）', async () => {
    const types = await import('../../src/types/index');
    // 运行时常量仍可访问
    expect(types.DEFAULT_VIDEO_CONFIG.model).toBe('seedance-2.0');
    expect(types.VIDEO_MODEL_LABELS['seedance-2.0']).toBe('Seedance 2.0');
    expect(types.TASK_STATUS_CONFIG.queued.label).toBe('排队中');
  });

  it('从 src/types 可导入 IPC DTO（TaskUpdateInput, CsvImportResult 等）', async () => {
    // 验证 re-export 路径可用：如果 src/types/index.ts 缺少 re-export，编译会失败
    const { DEFAULT_VIDEO_CONFIG } = await import('../../src/types/index');
    expect(DEFAULT_VIDEO_CONFIG.model).toBe('seedance-2.0');
    // 类型从 contracts re-export，在运行时被擦除
    // 以下类型赋值仅用于编译时检查
    const _input: TaskUpdateInput = { prompt: 'test' };
    const _result: CsvImportResult = { success: true };
    expect(_input.prompt).toBe('test');
    expect(_result.success).toBe(true);
  });
});

/**
 * IPC DTO 类型自检。
 * 验证 DTO 可从 @doubao-studio/contracts 正确导入，
 * 且字段结构与 IPC 消费点期望一致。
 */
describe('@doubao-studio/contracts IPC DTO', () => {
  it('AccountAddParams 包含 name 字段', () => {
    const params: AccountAddParams = { name: '测试账号' };
    expect(params.name).toBe('测试账号');
  });

  it('AccountUpdateHealthParams 的 errorCode 类型为 string', () => {
    const params: AccountUpdateHealthParams = {
      id: 'acc-1',
      action: 'failure',
      errorCode: 'legacy_unknown_error',
    };
    expect(params.errorCode).toBe('legacy_unknown_error');
  });

  it('AccountHealthAction 包含 5 种动作', () => {
    const actions: AccountHealthAction[] = [
      'success', 'failure', 'verification', 'login_expired', 'clear',
    ];
    expect(actions).toHaveLength(5);
  });

  it('TaskAddParams 包含 prompts 数组', () => {
    const params: TaskAddParams = {
      prompts: ['测试提示词1', '测试提示词2'],
      mode: 'video',
    };
    expect(params.prompts).toHaveLength(2);
    expect(params.mode).toBe('video');
  });

  it('TaskUpdateInput 包含 prompt 必填字段', () => {
    const input: TaskUpdateInput = { prompt: '更新后的提示词' };
    expect(input.prompt).toBe('更新后的提示词');
  });

  it('CsvImportResult 包含 success 和可选统计字段', () => {
    const result: CsvImportResult = {
      success: true,
      imported: 5,
      skipped: 2,
      batchId: 'batch-001',
    };
    expect(result.success).toBe(true);
    expect(result.imported).toBe(5);
  });

  it('CompletedOutput 包含 taskId、outputs、mode 等字段', () => {
    const output: CompletedOutput = {
      taskId: 'task-1',
      prompt: '测试',
      outputs: ['https://example.com/video.mp4'],
      accountId: 'acc-1',
      mode: 'video',
    };
    expect(output.taskId).toBe('task-1');
    expect(output.outputs).toHaveLength(1);
  });

  it('ProjectAddParams 包含 name 和可选描述、颜色', () => {
    const params: ProjectAddParams = { name: '新项目', color: '#6d5dfc' };
    expect(params.name).toBe('新项目');
    expect(params.color).toBe('#6d5dfc');
  });

  it('IntegrityCheckResult 包含 success、issues、checkedAt', () => {
    const result: IntegrityCheckResult = {
      success: true,
      issues: [],
      checkedAt: '2025-01-01T00:00:00.000Z',
    };
    expect(result.success).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it('LogAppendParams 是 LogEntry 去除 id 和 createdAt', () => {
    const params: LogAppendParams = {
      level: 'info',
      scope: 'system',
      message: '测试日志',
    };
    expect(params.level).toBe('info');
    expect(params.message).toBe('测试日志');
  });
});

/**
 * ElectronAPI 契约自检。
 * 验证 ElectronAPI 接口包含所有分组和方法名，
 * 且与 preload 暴露对象一致。
 */
describe('@doubao-studio/contracts ElectronAPI', () => {
  it('ElectronAPI 包含 6 个分组', () => {
    // 类型级检查：如果 ElectronAPI 缺少某个分组，编译会失败
    type Groups = keyof ElectronAPI;
    const groups: Groups[] = ['projects', 'accounts', 'tasks', 'settings', 'logs', 'system'];
    expect(groups).toHaveLength(6);
  });

  it('ElectronAPI.projects 包含 list/add/update/delete 方法', () => {
    type ProjectMethods = keyof ElectronAPI['projects'];
    const methods: ProjectMethods[] = ['list', 'add', 'update', 'delete'];
    expect(methods).toHaveLength(4);
  });

  it('ElectronAPI.accounts 包含 11 个方法', () => {
    type AccountMethods = keyof ElectronAPI['accounts'];
    const methods: AccountMethods[] = [
      'list', 'add', 'update', 'delete', 'refresh',
      'setStatus', 'setPinned', 'updateSeedanceQuota',
      'updateHealth', 'updateScheduling', 'getPartition',
    ];
    expect(methods).toHaveLength(11);
  });

  it('ElectronAPI.tasks 包含 23 个方法', () => {
    type TaskMethods = keyof ElectronAPI['tasks'];
    const methods: TaskMethods[] = [
      'list', 'add', 'assign', 'updateStatus', 'updateRuntime',
      'acquireLock', 'releaseLock', 'importCsv', 'update',
      'delete', 'retry', 'batchPause', 'getCompletedOutputs',
      'selectImages', 'selectAudio', 'readFileAsBase64',
      'downloadOutputs', 'listDownloads', 'exportDiagnostics',
      'validateArtifact', 'saveAdapterReport',
      'selectAdapterRules', 'selectSaveDir',
    ];
    expect(methods).toHaveLength(23);
  });

  it('ElectronAPI.system 包含 9 个方法（含 3 个窗口控制）', () => {
    type SystemMethods = keyof ElectronAPI['system'];
    const methods: SystemMethods[] = [
      'getVersion', 'checkIntegrity', 'exportBackup',
      'restoreBackup', 'exportProject', 'checkUpdate',
      'minimize', 'toggleMaximize', 'close',
    ];
    expect(methods).toHaveLength(9);
  });

  it('ElectronAPI.tasks.add 的 mode 参数为 GenerationMode', () => {
    // 类型级检查：验证 mode 参数类型为 GenerationMode 而非 string
    type AddMode = Parameters<ElectronAPI['tasks']['add']>[1];
    const _mode: AddMode = 'video';
    expect(_mode).toBe('video');
  });
});
