/**
 * main/utils/persistenceNormalization.ts
 *
 * 本地持久化数据运行时归一化层。
 *
 * 为 accounts.json / tasks.json / downloads.json 提供轻量级运行时校验与归一化，
 * 解决历史数据、手工修改、版本迁移或字段异常导致的调度和 UI 不稳定问题。
 *
 * 设计原则：
 * - 读取后安全可用、保留可恢复信息、绝不静默丢弃用户任务。
 * - 纯函数：不修改输入，不产生副作用，可独立测试。
 * - 仅在归一化确实改变数据时标记 changed=true，由调用方决定是否写回磁盘。
 * - 顶层结构错误时返回空数组且 changed=false，绝不覆盖原文件。
 *
 * 不引入 AJV、Zod 等新依赖；不修改 IPC channel 名称、preload API 或磁盘文件名。
 */

import type {
  Account,
  Task,
  DownloadJob,
  SeedanceQuota,
  AccountHealth,
  AccountScheduling,
  TaskArtifact,
  TaskErrorInfo,
  TaskRunSnapshot,
  TaskRunRecord,
  TaskLock,
  GenerationMode,
  AccountStatus,
  TaskStatus,
  TaskStage,
  DependencyPolicy,
} from '@doubao-studio/contracts';

// ==================== 公共类型 ====================

/** 归一化结果 */
export interface NormalizeResult<T> {
  /** 归一化后的数据数组 */
  data: T[];
  /** 归一化是否改变了数据（调用方据此决定是否写回磁盘） */
  changed: boolean;
  /** 诊断告警：被跳过、恢复或修正的项的可读原因 */
  warnings: string[];
}

// ==================== 合法值集合 ====================

const VALID_GENERATION_MODES: readonly GenerationMode[] = ['chat', 'image', 'video', 'music'];
const VALID_ACCOUNT_STATUSES: readonly AccountStatus[] = ['idle', 'busy', 'error'];
const VALID_TASK_STATUSES: readonly TaskStatus[] = [
  'queued', 'executing', 'generating', 'waiting_verification',
  'paused', 'done', 'fail', 'cancelled',
];
const VALID_TASK_STAGES: readonly TaskStage[] = [
  'queued', 'preparing_account', 'new_conversation', 'switching_mode',
  'configuring', 'uploading_assets', 'injecting_prompt', 'submitting',
  'waiting_verification', 'generating', 'extracting_outputs',
  'completed', 'paused', 'failed', 'cancelled',
];
const VALID_DEPENDENCY_POLICIES: readonly DependencyPolicy[] = ['all_done', 'all_finished'];
const VALID_DOWNLOAD_STATUSES = ['queued', 'downloading', 'done', 'failed'] as const;
const VALID_ARTIFACT_KINDS = ['image', 'video', 'file'] as const;
const VALID_ARTIFACT_SOURCES = ['network', 'page', 'manual'] as const;
const VALID_LOGIN_STATES = ['unknown', 'ok', 'expired'] as const;
const VALID_RUN_OUTCOMES = ['done', 'failed', 'paused', 'cancelled'] as const;
const VALID_TASK_SOURCES = ['manual', 'csv', 'workflow'] as const;
const VALID_VIDEO_MODELS = ['seedance-2.0', 'seedance-2.0-fast', 'seedance-2.0-mini'] as const;
const VALID_VIDEO_DURATIONS = ['5s', '10s', '15s'] as const;
const VALID_VIDEO_ASPECT_RATIOS = ['1:1', '3:4', '4:3', '9:16', '16:9', '21:9'] as const;
const VALID_VALIDATION_STATES = ['unknown', 'valid', 'expired', 'invalid'] as const;

const DEFAULT_SEEDANCE_DAILY_UNITS = 10;

// ==================== 基础类型辅助函数 ====================

/** 判断值是否为普通对象（非 null、非数组） */
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 安全取字符串，非法值回退 */
function asString(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

/** 安全取非空字符串 */
function asNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** 安全取布尔值 */
function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

/** 安全取有限数字 */
function asNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** 安全取非负有限数字 */
function asNonNegativeNumber(value: unknown, fallback: number): number {
  const n = asNumber(value, fallback);
  return n >= 0 ? n : fallback;
}

/** 判断字符串是否为有效 ISO 日期 */
function isValidISODate(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0) return false;
  const d = new Date(value);
  return !isNaN(d.getTime());
}

/** 安全取 ISO 日期字符串，非法值回退 */
function asISODate(value: unknown, fallback: string): string {
  return isValidISODate(value) ? value : fallback;
}

/** 判断值是否属于合法值集合，不属于时返回 fallback */
function oneOf<T extends string>(value: unknown, valid: readonly T[], fallback: T): T {
  return typeof value === 'string' && (valid as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

/** 判断值是否属于合法值集合，不属于时返回 undefined */
function optionalOneOf<T extends string>(value: unknown, valid: readonly T[]): T | undefined {
  return typeof value === 'string' && (valid as readonly string[]).includes(value)
    ? (value as T)
    : undefined;
}

/** 安全取字符串数组（过滤非字符串项） */
function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

/**
 * 计算本地日期键（YYYY-MM-DD），与 accounts.ts 中 localDateKey 语义一致。
 */
function localDateKeyFromISO(isoNow: string): string {
  const now = new Date(isoNow);
  const offset = now.getTimezoneOffset() * 60000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}

// ==================== 账号归一化 ====================

/**
 * 归一化账号的 Seedance 额度记录。
 * - 缺失或日期非今日时重置 usedUnits。
 * - 负数 usedUnits / estimatedTotalUnits 安全回退为 0 / 默认值。
 * 直接修改传入的 account 对象（内部使用，由 normalizeAccounts 在深拷贝上调用）。
 */
export function normalizeAccountQuota(account: Account, now: string): void {
  const today = localDateKeyFromISO(now);
  const quota = account.seedanceQuota;

  if (!isObject(quota) || !isValidISODate(quota.date) || quota.date !== today) {
    account.seedanceQuota = {
      date: today,
      usedUnits: 0,
      estimatedTotalUnits: isObject(quota) && typeof quota.estimatedTotalUnits === 'number' && quota.estimatedTotalUnits > 0
        ? quota.estimatedTotalUnits
        : DEFAULT_SEEDANCE_DAILY_UNITS,
      exhausted: false,
      updatedAt: now,
    };
    return;
  }

  // quota 存在且日期为今日 — 修正非法数值
  const fixed: SeedanceQuota = {
    date: today,
    usedUnits: asNonNegativeNumber(quota.usedUnits, 0),
    estimatedTotalUnits: asNonNegativeNumber(quota.estimatedTotalUnits, DEFAULT_SEEDANCE_DAILY_UNITS),
    exhausted: asBoolean(quota.exhausted, false),
    updatedAt: asISODate(quota.updatedAt, now),
  };
  account.seedanceQuota = fixed;
}

/**
 * 归一化账号健康状态。
 * - 补全缺失字段为安全默认值。
 * - lastErrorCode 保持为 string，不收紧为联合类型。
 * - 已过期的 cooldownUntil / manualCooldownUntil 清除。
 */
export function normalizeAccountHealth(account: Account, now: string): void {
  const raw = account.health;
  const nowMs = new Date(now).getTime();
  const lastSuccessAt = raw?.lastSuccessAt;
  const lastFailureAt = raw?.lastFailureAt;
  const cooldownUntil = raw?.cooldownUntil;

  const health: AccountHealth = {
    loginState: oneOf(raw?.loginState, VALID_LOGIN_STATES, 'unknown') as AccountHealth['loginState'],
    verificationRequired: asBoolean(raw?.verificationRequired, false),
    consecutiveFailures: asNonNegativeNumber(raw?.consecutiveFailures, 0),
    successCount: asNonNegativeNumber(raw?.successCount, 0),
    failureCount: asNonNegativeNumber(raw?.failureCount, 0),
    lastSuccessAt: isValidISODate(lastSuccessAt) ? lastSuccessAt : undefined,
    lastFailureAt: isValidISODate(lastFailureAt) ? lastFailureAt : undefined,
    // lastErrorCode 保持 string，不校验为 TaskErrorCode 联合
    lastErrorCode: typeof raw?.lastErrorCode === 'string' ? raw.lastErrorCode : undefined,
    cooldownUntil: isValidISODate(cooldownUntil) ? cooldownUntil : undefined,
  };

  // 已过期的 cooldown 清除
  if (health.cooldownUntil && new Date(health.cooldownUntil).getTime() <= nowMs) {
    health.cooldownUntil = undefined;
    health.verificationRequired = false;
  }

  account.health = health;
}

/**
 * 归一化账号调度配置。
 * - 补全缺失字段为安全默认值。
 * - weight 裁剪到 [0.1, 10]。
 * - 已过期的 manualCooldownUntil 清除。
 */
export function normalizeAccountScheduling(account: Account, now: string): void {
  const raw = account.scheduling;
  const nowMs = new Date(now).getTime();

  const manualCooldownUntil = raw?.manualCooldownUntil;
  const scheduling: AccountScheduling = {
    enabled: asBoolean(raw?.enabled, true),
    weight: Math.max(0.1, Math.min(10, asNumber(raw?.weight, 1))),
    preferredModes: asStringArray(raw?.preferredModes).filter(
      (m): m is GenerationMode => (VALID_GENERATION_MODES as readonly string[]).includes(m),
    ),
    manualCooldownUntil: isValidISODate(manualCooldownUntil) ? manualCooldownUntil : undefined,
  };

  if (scheduling.manualCooldownUntil && new Date(scheduling.manualCooldownUntil).getTime() <= nowMs) {
    scheduling.manualCooldownUntil = undefined;
  }

  account.scheduling = scheduling;
}

/**
 * 在深拷贝的对象上执行账号字段归一化（直接修改传入对象）。
 * 输入必须是 isObject 通过的对象。
 */
function normalizeAccountObject(raw: Record<string, unknown>, now: string): Account {
  const account = raw as unknown as Account;

  // 基础字段
  account.id = asNonEmptyString(raw.id) ?? `recovered-${now}-${Math.random().toString(36).slice(2, 10)}`;
  account.name = asString(raw.name, '');
  account.avatar = asString(raw.avatar, '');
  account.partition = asNonEmptyString(raw.partition) ?? `account_${account.id.slice(0, 8)}`;
  account.status = oneOf(raw.status, VALID_ACCOUNT_STATUSES, 'idle');
  account.pinned = asBoolean(raw.pinned, false);
  account.createdAt = asISODate(raw.createdAt, now);
  account.updatedAt = asISODate(raw.updatedAt, now);

  // 嵌套结构
  normalizeAccountQuota(account, now);
  normalizeAccountHealth(account, now);
  normalizeAccountScheduling(account, now);

  return account;
}

/**
 * 归一化 accounts.json 原始数据。
 *
 * @param raw - readJSON 返回的原始数据
 * @param now - 当前 ISO 时间字符串（默认 new Date().toISOString()）
 * @returns 归一化结果
 */
export function normalizeAccounts(
  raw: unknown,
  now: string = new Date().toISOString(),
): NormalizeResult<Account> {
  // 顶层不是数组 — 安全回退为空数组，不覆盖原文件
  if (!Array.isArray(raw)) {
    return {
      data: [],
      changed: false,
      warnings: ['accounts.json 顶层结构不是数组，已安全回退为空数组（不覆盖原文件）'],
    };
  }

  // 深拷贝以避免修改输入
  const cloned: unknown[] = JSON.parse(JSON.stringify(raw));
  const originalJson = JSON.stringify(raw);
  const warnings: string[] = [];
  const seenIds = new Set<string>();
  const result: Account[] = [];
  let skippedCount = 0;

  for (let i = 0; i < cloned.length; i++) {
    const item = cloned[i];
    if (!isObject(item)) {
      skippedCount++;
      warnings.push(`账号数组索引 ${i} 不是对象，已跳过`);
      continue;
    }
    const account = normalizeAccountObject(item, now);
    if (!account.id || seenIds.has(account.id)) {
      skippedCount++;
      warnings.push(`跳过重复或无效 ID 的账号 (索引 ${i})`);
      continue;
    }
    seenIds.add(account.id);
    result.push(account);
  }

  if (skippedCount > 0 && warnings.length > 0) {
    // warnings 已包含逐项原因，此处不再重复汇总
  }

  const changed = JSON.stringify(result) !== originalJson;
  return { data: result, changed, warnings };
}

// ==================== 任务归一化 ====================

/**
 * 归一化任务产物（TaskArtifact）。
 * 缺少 id 或 url 的产物会被丢弃。
 */
function normalizeArtifacts(raw: unknown, taskMode: GenerationMode, now: string): { artifacts: TaskArtifact[]; changed: boolean } {
  if (!Array.isArray(raw)) return { artifacts: [], changed: true };

  const result: TaskArtifact[] = [];
  let changed = false;
  const seenUrls = new Set<string>();

  for (const item of raw) {
    if (!isObject(item)) {
      changed = true;
      continue;
    }
    const url = asNonEmptyString(item.url);
    const id = asNonEmptyString(item.id);
    if (!url || !id) {
      changed = true;
      continue;
    }
    if (seenUrls.has(url)) {
      changed = true;
      continue;
    }
    seenUrls.add(url);

    const artifact: TaskArtifact = {
      id,
      url,
      kind: oneOf(item.kind, VALID_ARTIFACT_KINDS, taskMode === 'video' ? 'video' : taskMode === 'image' ? 'image' : 'file') as TaskArtifact['kind'],
      source: oneOf(item.source, VALID_ARTIFACT_SOURCES, 'network') as TaskArtifact['source'],
      runId: asNonEmptyString(item.runId) ?? undefined,
      conversationUrl: asNonEmptyString(item.conversationUrl) ?? undefined,
      discoveredAt: asISODate(item.discoveredAt, now),
    };

    // validation 子对象
    if (isObject(item.validation)) {
      const v: Record<string, unknown> = item.validation;
      artifact.validation = {
        state: oneOf(v.state, VALID_VALIDATION_STATES, 'unknown') as NonNullable<TaskArtifact['validation']>['state'],
        checkedAt: asISODate(v.checkedAt, now),
        contentType: asNonEmptyString(v.contentType) ?? undefined,
        contentLength: typeof v.contentLength === 'number' && v.contentLength >= 0 ? v.contentLength : undefined,
        statusCode: typeof v.statusCode === 'number' ? v.statusCode : undefined,
        error: asNonEmptyString(v.error) ?? undefined,
      };
    }

    result.push(artifact);

    // 检测是否与原始数据不同
    if (JSON.stringify(artifact) !== JSON.stringify(item)) {
      changed = true;
    }
  }

  if (result.length !== raw.length) changed = true;
  return { artifacts: result, changed };
}

/**
 * 归一化 TaskErrorInfo。
 * code 保持 string，不收紧为联合类型；未知 code 保留不抛错。
 */
function normalizeErrorInfo(raw: unknown, now: string): TaskErrorInfo | undefined {
  if (!isObject(raw)) return undefined;
  const code = asString(raw.code, 'unknown');
  return {
    code, // 保留原始 string，包括未知错误码
    message: asString(raw.message, ''),
    recoverable: asBoolean(raw.recoverable, true),
    detectedAt: asISODate(raw.detectedAt, now),
  };
}

/**
 * 归一化 TaskRunSnapshot（运行快照）。
 */
function normalizeRuntime(raw: unknown, taskMode: GenerationMode, now: string): TaskRunSnapshot | undefined {
  if (!isObject(raw)) return undefined;
  const r = raw;
  const input = r.input;
  const videoConfig = r.videoConfig ?? (isObject(input) ? input.videoConfig : undefined);

  return {
    runId: asString(r.runId, ''),
    attempt: asNonNegativeNumber(r.attempt, 0),
    stage: oneOf(r.stage, VALID_TASK_STAGES, 'queued'),
    message: asString(r.message, ''),
    startedAt: asISODate(r.startedAt, now),
    stageStartedAt: asISODate(r.stageStartedAt, now),
    lastHeartbeatAt: asISODate(r.lastHeartbeatAt, now),
    submittedAt: (() => { const v = r.submittedAt; return isValidISODate(v) ? v : undefined; })(),
    conversationUrl: asNonEmptyString(r.conversationUrl) ?? undefined,
    input: {
      prompt: asString(isObject(input) ? input.prompt : '', ''),
      mode: oneOf(isObject(input) ? input.mode : taskMode, VALID_GENERATION_MODES, taskMode),
      videoConfig: isObject(videoConfig) ? normalizeVideoConfig(videoConfig) : undefined,
      attachments: asStringArray(isObject(input) ? input.attachments : []),
      audioAttachment: asNonEmptyString(isObject(input) ? input.audioAttachment : undefined) ?? undefined,
    },
  };
}

/**
 * 归一化视频配置。
 */
function normalizeVideoConfig(raw: Record<string, unknown>): Task['videoConfig'] | undefined {
  if (!isObject(raw)) return undefined;
  return {
    model: oneOf(raw.model, VALID_VIDEO_MODELS, 'seedance-2.0') as NonNullable<Task['videoConfig']>['model'],
    duration: oneOf(raw.duration, VALID_VIDEO_DURATIONS, '10s') as NonNullable<Task['videoConfig']>['duration'],
    aspectRatio: oneOf(raw.aspectRatio, VALID_VIDEO_ASPECT_RATIOS, '16:9') as NonNullable<Task['videoConfig']>['aspectRatio'],
  };
}

/**
 * 归一化单条运行历史记录。
 */
function normalizeRunRecord(raw: unknown, _now: string): TaskRunRecord | null {
  if (!isObject(raw)) return null;
  const r = raw;
  const runId = asNonEmptyString(r.runId);
  const startedAtRaw = r.startedAt;
  const startedAt = isValidISODate(startedAtRaw) ? startedAtRaw : null;
  if (!runId || !startedAt) return null;
  const finishedAtRaw = r.finishedAt;

  return {
    runId,
    attempt: asNonNegativeNumber(r.attempt, 0),
    startedAt,
    finishedAt: isValidISODate(finishedAtRaw) ? finishedAtRaw : undefined,
    finalStage: optionalOneOf(r.finalStage, VALID_TASK_STAGES) as TaskRunRecord['finalStage'],
    outcome: optionalOneOf(r.outcome, VALID_RUN_OUTCOMES) as TaskRunRecord['outcome'],
    errorCode: typeof r.errorCode === 'string' ? r.errorCode : undefined,
    durationMs: typeof r.durationMs === 'number' && r.durationMs >= 0 ? r.durationMs : undefined,
  };
}

/**
 * 归一化任务执行锁。
 * 缺少必要字段时返回 undefined（丢弃无效锁）。
 */
function normalizeLock(raw: unknown, _now: string): TaskLock | undefined {
  if (!isObject(raw)) return undefined;
  const ownerId = asNonEmptyString(raw.ownerId);
  const acquiredAtRaw = raw.acquiredAt;
  const expiresAtRaw = raw.expiresAt;
  const acquiredAt = isValidISODate(acquiredAtRaw) ? acquiredAtRaw : null;
  const expiresAt = isValidISODate(expiresAtRaw) ? expiresAtRaw : null;
  if (!ownerId || !acquiredAt || !expiresAt) return undefined;
  return { ownerId, acquiredAt, expiresAt };
}

/**
 * 在深拷贝的对象上执行任务字段归一化（直接修改传入对象）。
 * 输入必须是 isObject 通过的对象。
 */
function normalizeTaskObject(raw: Record<string, unknown>, defaultProjectId: string, now: string): Task {
  const task = raw as unknown as Task;

  // 基础字段
  const id = asNonEmptyString(raw.id);
  task.id = id ?? `recovered-${now}-${Math.random().toString(36).slice(2, 10)}`;
  task.prompt = asString(raw.prompt, '');
  task.assignedAccountId = asNonEmptyString(raw.assignedAccountId) ?? null;
  task.mode = oneOf(raw.mode, VALID_GENERATION_MODES, 'chat');
  task.result = raw.result === null ? null : (typeof raw.result === 'string' ? raw.result : null);
  task.source = oneOf(raw.source, VALID_TASK_SOURCES, 'manual') as Task['source'];
  task.createdAt = asISODate(raw.createdAt, now);
  task.updatedAt = asISODate(raw.updatedAt, now);

  // 视频配置
  task.videoConfig = isObject(raw.videoConfig) ? normalizeVideoConfig(raw.videoConfig) : undefined;

  // 附件
  task.attachments = asStringArray(raw.attachments).length > 0 ? asStringArray(raw.attachments) : undefined;
  task.audioAttachment = asNonEmptyString(raw.audioAttachment) ?? undefined;

  // 产物
  task.outputs = asStringArray(raw.outputs);

  // artifacts 归一化
  const artifactResult = normalizeArtifacts(raw.artifacts, task.mode, now);
  task.artifacts = artifactResult.artifacts;

  // runHistory 归一化
  if (Array.isArray(raw.runHistory)) {
    task.runHistory = raw.runHistory
      .map((item) => normalizeRunRecord(item, now))
      .filter((r): r is TaskRunRecord => r !== null);
  } else {
    task.runHistory = [];
  }

  // 依赖
  task.dependsOnTaskIds = asStringArray(raw.dependsOnTaskIds);
  task.dependencyPolicy = optionalOneOf(raw.dependencyPolicy, VALID_DEPENDENCY_POLICIES) as DependencyPolicy | undefined;

  // 项目 ID
  task.projectId = asNonEmptyString(raw.projectId) ?? defaultProjectId;
  task.batchId = asNonEmptyString(raw.batchId) ?? undefined;

  // runtime / errorInfo / lock
  task.runtime = normalizeRuntime(raw.runtime, task.mode, now);
  task.errorInfo = normalizeErrorInfo(raw.errorInfo, now);
  task.lock = normalizeLock(raw.lock, now);

  // status 归一化：非法状态值标记为 fail 并保留原始状态信息
  const rawStatus = raw.status;
  if (typeof rawStatus === 'string' && (VALID_TASK_STATUSES as readonly string[]).includes(rawStatus)) {
    task.status = rawStatus as TaskStatus;
  } else {
    // 非法状态 — 标记为 fail，保留原始错误信息
    task.status = 'fail';
    if (!task.errorInfo) {
      task.errorInfo = {
        code: 'unknown',
        message: `任务状态异常，原始值「${typeof rawStatus === 'string' ? rawStatus : typeof rawStatus}」已归一化为 fail`,
        recoverable: false,
        detectedAt: now,
      };
    }
  }

  return task;
}

/**
 * 归一化 tasks.json 原始数据。
 *
 * @param raw - readJSON 返回的原始数据
 * @param defaultProjectId - 默认项目 ID（用于补全缺失的 projectId）
 * @param now - 当前 ISO 时间字符串
 * @returns 归一化结果
 */
export function normalizeTasks(
  raw: unknown,
  defaultProjectId: string,
  now: string = new Date().toISOString(),
): NormalizeResult<Task> {
  // 顶层不是数组 — 安全回退为空数组，不覆盖原文件
  if (!Array.isArray(raw)) {
    return {
      data: [],
      changed: false,
      warnings: ['tasks.json 顶层结构不是数组，已安全回退为空数组（不覆盖原文件）'],
    };
  }

  // 深拷贝以避免修改输入
  const cloned: unknown[] = JSON.parse(JSON.stringify(raw));
  const originalJson = JSON.stringify(raw);
  const warnings: string[] = [];
  const seenIds = new Set<string>();
  const result: Task[] = [];
  let skippedCount = 0;

  for (let i = 0; i < cloned.length; i++) {
    const item = cloned[i];
    if (!isObject(item)) {
      skippedCount++;
      warnings.push(`任务数组索引 ${i} 不是对象，已跳过`);
      continue;
    }
    const task = normalizeTaskObject(item, defaultProjectId, now);
    if (seenIds.has(task.id)) {
      skippedCount++;
      warnings.push(`跳过重复任务 ID「${task.id}」(索引 ${i})`);
      continue;
    }
    seenIds.add(task.id);
    result.push(task);
  }

  if (skippedCount > 0) {
    warnings.push(`共跳过 ${skippedCount} 个无效或重复的任务项`);
  }

  const changed = JSON.stringify(result) !== originalJson;
  return { data: result, changed, warnings };
}

// ==================== 下载记录归一化 ====================

/**
 * 在深拷贝的对象上执行下载记录字段归一化（直接修改传入对象）。
 * 输入必须是 isObject 通过的对象。
 */
function normalizeDownloadJobObject(raw: Record<string, unknown>, now: string): DownloadJob {
  const job = raw as unknown as DownloadJob;

  job.id = asNonEmptyString(raw.id) ?? `recovered-${now}-${Math.random().toString(36).slice(2, 10)}`;
  job.taskId = asString(raw.taskId, '');
  job.accountId = asNonEmptyString(raw.accountId) ?? null;
  job.mode = oneOf(raw.mode, VALID_GENERATION_MODES, 'chat');
  job.url = asString(raw.url, '');
  job.status = oneOf(raw.status, VALID_DOWNLOAD_STATUSES, 'failed') as DownloadJob['status'];
  job.attempts = asNonNegativeNumber(raw.attempts, 0);
  job.saveDir = asString(raw.saveDir, '');
  job.filePath = asNonEmptyString(raw.filePath) ?? undefined;
  job.bytes = typeof raw.bytes === 'number' && raw.bytes >= 0 ? raw.bytes : undefined;
  job.error = asNonEmptyString(raw.error) ?? undefined;
  job.createdAt = asISODate(raw.createdAt, now);
  job.updatedAt = asISODate(raw.updatedAt, now);

  return job;
}

/**
 * 归一化 downloads.json 原始数据。
 *
 * 注意：此函数仅做结构和字段归一化，不做下载中断恢复。
 * 下载中断恢复（将 'downloading' 标记为 'failed'）由调用方在归一化后单独执行，
 * 因为该操作是进程级一次性操作。
 *
 * @param raw - readJSON 返回的原始数据
 * @param now - 当前 ISO 时间字符串
 * @returns 归一化结果
 */
export function normalizeDownloadJobs(
  raw: unknown,
  now: string = new Date().toISOString(),
): NormalizeResult<DownloadJob> {
  // 顶层不是数组 — 安全回退为空数组，不覆盖原文件
  if (!Array.isArray(raw)) {
    return {
      data: [],
      changed: false,
      warnings: ['downloads.json 顶层结构不是数组，已安全回退为空数组（不覆盖原文件）'],
    };
  }

  // 深拷贝以避免修改输入
  const cloned: unknown[] = JSON.parse(JSON.stringify(raw));
  const originalJson = JSON.stringify(raw);
  const warnings: string[] = [];
  const seenIds = new Set<string>();
  const result: DownloadJob[] = [];
  let skippedCount = 0;

  for (let i = 0; i < cloned.length; i++) {
    const item = cloned[i];
    if (!isObject(item)) {
      skippedCount++;
      warnings.push(`下载数组索引 ${i} 不是对象，已跳过`);
      continue;
    }
    const job = normalizeDownloadJobObject(item, now);
    if (seenIds.has(job.id)) {
      skippedCount++;
      warnings.push(`跳过重复下载记录 ID「${job.id}」(索引 ${i})`);
      continue;
    }
    seenIds.add(job.id);
    result.push(job);
  }

  if (skippedCount > 0) {
    warnings.push(`共跳过 ${skippedCount} 个无效或重复的下载记录项`);
  }

  const changed = JSON.stringify(result) !== originalJson;
  return { data: result, changed, warnings };
}
