/**
 * tests/unit/persistenceNormalization.test.ts
 * 本地持久化数据运行时归一化回归测试
 *
 * 覆盖 accounts.json / tasks.json / downloads.json 的归一化逻辑：
 * - 完整正常数据不产生变更
 * - 缺失旧字段可补全为安全默认值
 * - TaskErrorInfo.code 未知字符串保留
 * - 非法 status、非法日期、负数额度的归一化
 * - 顶层结构错误安全回退
 * - 历史任务缺少字段可恢复读取
 * - 重复 ID 去重
 * - 归一化后对象满足所需字段
 * - 不改变合法数据
 * - 无变化不写盘、有变化才写盘
 */

import { describe, it, expect } from 'vitest';
import {
  normalizeAccounts,
  normalizeTasks,
  normalizeDownloadJobs,
  normalizeAccountQuota,
  normalizeAccountHealth,
  normalizeAccountScheduling,
} from '../../main/utils/persistenceNormalization';
import type { Account, Task, DownloadJob } from '@doubao-studio/contracts';

// ==================== 测试常量 ====================

const NOW = '2025-01-15T12:00:00.000Z';

/** 与 persistenceNormalization 内部 localDateKeyFromISO 语义一致 */
const nowDate = new Date(NOW);
const TODAY = new Date(nowDate.getTime() - nowDate.getTimezoneOffset() * 60000)
  .toISOString()
  .slice(0, 10);

const PAST_ISO = '2025-01-14T10:00:00.000Z';
const FUTURE_ISO = '2025-01-16T10:00:00.000Z';
const DEFAULT_PROJECT_ID = 'default-project';

// ==================== Fixture 工厂 ====================

/** 创建一个完整合法的 Account 对象（可被安全删除字段） */
function makeValidAccount(): Account {
  return {
    id: 'acc-1',
    name: '测试账号',
    avatar: '',
    partition: 'account_abc12345',
    status: 'idle',
    pinned: false,
    seedanceQuota: {
      date: TODAY,
      usedUnits: 3,
      estimatedTotalUnits: 10,
      exhausted: false,
      updatedAt: NOW,
    },
    health: {
      loginState: 'ok',
      verificationRequired: false,
      consecutiveFailures: 0,
      successCount: 5,
      failureCount: 1,
      lastSuccessAt: PAST_ISO,
      lastFailureAt: PAST_ISO,
      lastErrorCode: 'timeout',
    },
    scheduling: {
      enabled: true,
      weight: 1,
      preferredModes: ['video'],
    },
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: NOW,
  };
}

/** 创建一个完整合法的 Task 对象 */
function makeValidTask(): Task {
  return {
    id: 'task-1',
    prompt: '测试提示词',
    assignedAccountId: null,
    status: 'queued',
    mode: 'chat',
    result: null,
    outputs: [],
    artifacts: [],
    runHistory: [],
    dependsOnTaskIds: [],
    source: 'manual',
    projectId: DEFAULT_PROJECT_ID,
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: NOW,
  };
}

/** 创建一个完整合法的 DownloadJob 对象 */
function makeValidDownloadJob(): DownloadJob {
  return {
    id: 'dl-1',
    taskId: 'task-1',
    accountId: 'acc-1',
    mode: 'video',
    url: 'https://example.com/video.mp4',
    status: 'done',
    attempts: 1,
    saveDir: '/downloads',
    filePath: '/downloads/video.mp4',
    bytes: 1024,
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: NOW,
  };
}

// ==================== normalizeAccounts ====================

describe('normalizeAccounts', () => {
  // ---- 测试 1: 完整正常数据不产生变更 ----
  it('完整正常数据不产生变更', () => {
    const account = makeValidAccount();
    const result = normalizeAccounts([account], NOW);
    expect(result.changed).toBe(false);
    expect(result.warnings).toHaveLength(0);
    expect(result.data).toHaveLength(1);
  });

  it('归一化幂等性：对已归一化数据再次归一化不产生变更', () => {
    const account = makeValidAccount();
    const first = normalizeAccounts([account], NOW);
    const second = normalizeAccounts(first.data, NOW);
    expect(second.changed).toBe(false);
  });

  // ---- 测试 2: 缺失旧字段可补全为安全默认值 ----
  it('缺失 seedanceQuota 时补全为今日空额度', () => {
    const account = makeValidAccount();
    delete (account as Partial<Account>).seedanceQuota;
    const result = normalizeAccounts([account], NOW);
    expect(result.changed).toBe(true);
    expect(result.data[0].seedanceQuota).toBeDefined();
    expect(result.data[0].seedanceQuota!.date).toBe(TODAY);
    expect(result.data[0].seedanceQuota!.usedUnits).toBe(0);
    expect(result.data[0].seedanceQuota!.estimatedTotalUnits).toBe(10);
  });

  it('缺失 health 时补全为安全默认值', () => {
    const account = makeValidAccount();
    delete (account as Partial<Account>).health;
    const result = normalizeAccounts([account], NOW);
    expect(result.changed).toBe(true);
    expect(result.data[0].health).toBeDefined();
    expect(result.data[0].health!.loginState).toBe('unknown');
    expect(result.data[0].health!.consecutiveFailures).toBe(0);
  });

  it('缺失 scheduling 时补全为安全默认值', () => {
    const account = makeValidAccount();
    delete (account as Partial<Account>).scheduling;
    const result = normalizeAccounts([account], NOW);
    expect(result.changed).toBe(true);
    expect(result.data[0].scheduling).toBeDefined();
    expect(result.data[0].scheduling!.enabled).toBe(true);
    expect(result.data[0].scheduling!.weight).toBe(1);
  });

  it('缺失 partition 时从 id 生成', () => {
    const account = makeValidAccount();
    account.id = 'acc-abc123';
    delete (account as Partial<Account>).partition;
    const result = normalizeAccounts([account], NOW);
    expect(result.changed).toBe(true);
    expect(result.data[0].partition).toBe('account_acc-abc1');
  });

  it('缺失 id 时生成 recovered ID', () => {
    const account = makeValidAccount();
    delete (account as Partial<Account>).id;
    const result = normalizeAccounts([account], NOW);
    expect(result.changed).toBe(true);
    expect(result.data[0].id).toMatch(/^recovered-/);
  });

  // ---- 测试 4: 非法日期、负数额度归一化 ----
  it('负数 usedUnits 归一化为 0', () => {
    const account = makeValidAccount();
    account.seedanceQuota = { date: TODAY, usedUnits: -5, estimatedTotalUnits: 10, exhausted: false, updatedAt: NOW };
    const result = normalizeAccounts([account], NOW);
    expect(result.changed).toBe(true);
    expect(result.data[0].seedanceQuota!.usedUnits).toBe(0);
  });

  it('负数 estimatedTotalUnits 归一化为默认值', () => {
    const account = makeValidAccount();
    account.seedanceQuota = { date: TODAY, usedUnits: 3, estimatedTotalUnits: -1, exhausted: false, updatedAt: NOW };
    const result = normalizeAccounts([account], NOW);
    expect(result.changed).toBe(true);
    expect(result.data[0].seedanceQuota!.estimatedTotalUnits).toBe(10);
  });

  it('额度日期为昨日时重置 usedUnits 为 0', () => {
    const account = makeValidAccount();
    account.seedanceQuota = { date: '2025-01-14', usedUnits: 8, estimatedTotalUnits: 10, exhausted: true, updatedAt: PAST_ISO };
    const result = normalizeAccounts([account], NOW);
    expect(result.changed).toBe(true);
    expect(result.data[0].seedanceQuota!.date).toBe(TODAY);
    expect(result.data[0].seedanceQuota!.usedUnits).toBe(0);
    expect(result.data[0].seedanceQuota!.exhausted).toBe(false);
  });

  it('过期的 cooldownUntil 被清除', () => {
    const account = makeValidAccount();
    account.health = {
      loginState: 'ok',
      verificationRequired: true,
      consecutiveFailures: 3,
      successCount: 0,
      failureCount: 3,
      cooldownUntil: PAST_ISO,
    };
    const result = normalizeAccounts([account], NOW);
    expect(result.changed).toBe(true);
    expect(result.data[0].health!.cooldownUntil).toBeUndefined();
    expect(result.data[0].health!.verificationRequired).toBe(false);
  });

  it('未过期的 cooldownUntil 保留', () => {
    const account = makeValidAccount();
    account.health = {
      loginState: 'ok',
      verificationRequired: true,
      consecutiveFailures: 3,
      successCount: 0,
      failureCount: 3,
      cooldownUntil: FUTURE_ISO,
    };
    const result = normalizeAccounts([account], NOW);
    expect(result.data[0].health!.cooldownUntil).toBe(FUTURE_ISO);
  });

  it('非法 account status 归一化为 idle', () => {
    const account: Record<string, unknown> = { ...makeValidAccount(), status: 'invalid_status' };
    const result = normalizeAccounts([account], NOW);
    expect(result.changed).toBe(true);
    expect(result.data[0].status).toBe('idle');
  });

  it('非法 scheduling weight 裁剪到 [0.1, 10]', () => {
    const account = makeValidAccount();
    account.scheduling = { enabled: true, weight: 100, preferredModes: [] };
    const result = normalizeAccounts([account], NOW);
    expect(result.changed).toBe(true);
    expect(result.data[0].scheduling!.weight).toBe(10);
  });

  it('非法 preferredModes 被过滤', () => {
    const account: Record<string, unknown> = {
      ...makeValidAccount(),
      scheduling: { enabled: true, weight: 1, preferredModes: ['video', 'invalid_mode'] },
    };
    const result = normalizeAccounts([account], NOW);
    expect(result.changed).toBe(true);
    expect(result.data[0].scheduling!.preferredModes).toEqual(['video']);
  });

  it('非法 createdAt 归一化为 now', () => {
    const account: Record<string, unknown> = { ...makeValidAccount(), createdAt: 'not-a-date' };
    const result = normalizeAccounts([account], NOW);
    expect(result.changed).toBe(true);
    expect(result.data[0].createdAt).toBe(NOW);
  });

  // ---- 测试 5: 顶层不是数组、数组项不是对象 ----
  it('顶层不是数组时安全回退为空数组且不覆盖原文件', () => {
    const result = normalizeAccounts({ foo: 'bar' }, NOW);
    expect(result.data).toEqual([]);
    expect(result.changed).toBe(false);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('数组项不是对象时安全跳过', () => {
    const result = normalizeAccounts(['string', 42, null, makeValidAccount()], NOW);
    expect(result.data).toHaveLength(1);
    expect(result.data[0].id).toBe('acc-1');
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  // ---- 测试 7: 重复账号 ID 去重 ----
  it('重复账号 ID 只保留第一个', () => {
    const acc1 = makeValidAccount();
    acc1.id = 'dup-id'; acc1.name = '账号1';
    const acc2 = makeValidAccount();
    acc2.id = 'dup-id'; acc2.name = '账号2';
    const result = normalizeAccounts([acc1, acc2], NOW);
    expect(result.data).toHaveLength(1);
    expect(result.data[0].name).toBe('账号1');
    expect(result.warnings.some((w) => w.includes('重复'))).toBe(true);
  });

  // ---- 测试 8: 归一化后对象满足所需字段 ----
  it('归一化后账号满足 Account 接口所有必填字段', () => {
    const minimal: Record<string, unknown> = { id: 'acc-min' };
    const result = normalizeAccounts([minimal], NOW);
    const acc = result.data[0];
    expect(typeof acc.id).toBe('string');
    expect(typeof acc.name).toBe('string');
    expect(typeof acc.avatar).toBe('string');
    expect(typeof acc.partition).toBe('string');
    expect(typeof acc.status).toBe('string');
    expect(typeof acc.pinned).toBe('boolean');
    expect(typeof acc.createdAt).toBe('string');
    expect(typeof acc.updatedAt).toBe('string');
    expect(acc.seedanceQuota).toBeDefined();
    expect(acc.health).toBeDefined();
    expect(acc.scheduling).toBeDefined();
  });

  // ---- 测试 9: 不改变合法数据 ----
  it('不改变合法账号名称、头像、partition', () => {
    const account = makeValidAccount();
    account.name = '我的账号';
    account.avatar = 'https://example.com/avatar.png';
    account.partition = 'account_mypartition';
    const result = normalizeAccounts([account], NOW);
    expect(result.data[0].name).toBe('我的账号');
    expect(result.data[0].avatar).toBe('https://example.com/avatar.png');
    expect(result.data[0].partition).toBe('account_mypartition');
  });

  // ---- 测试 10: 无变化不写盘、有变化才写盘 ----
  it('完整正常数据 changed=false（不触发写盘）', () => {
    const result = normalizeAccounts([makeValidAccount()], NOW);
    expect(result.changed).toBe(false);
  });

  it('缺失字段时 changed=true（触发写盘）', () => {
    const account = makeValidAccount();
    delete (account as Partial<Account>).seedanceQuota;
    const result = normalizeAccounts([account], NOW);
    expect(result.changed).toBe(true);
  });
});

// ==================== normalizeAccountQuota / Health / Scheduling 导出函数 ====================

describe('normalizeAccountQuota', () => {
  it('日期非今日时重置额度', () => {
    const account = makeValidAccount();
    account.seedanceQuota = { date: '2025-01-10', usedUnits: 5, estimatedTotalUnits: 10, exhausted: true, updatedAt: PAST_ISO };
    normalizeAccountQuota(account, NOW);
    expect(account.seedanceQuota!.date).toBe(TODAY);
    expect(account.seedanceQuota!.usedUnits).toBe(0);
    expect(account.seedanceQuota!.exhausted).toBe(false);
  });

  it('保留正数 estimatedTotalUnits 在跨日重置时', () => {
    const account = makeValidAccount();
    account.seedanceQuota = { date: '2025-01-10', usedUnits: 5, estimatedTotalUnits: 20, exhausted: false, updatedAt: PAST_ISO };
    normalizeAccountQuota(account, NOW);
    expect(account.seedanceQuota!.estimatedTotalUnits).toBe(20);
  });
});

describe('normalizeAccountHealth', () => {
  it('lastErrorCode 为未知字符串时保留', () => {
    const account = makeValidAccount();
    account.health = {
      loginState: 'ok',
      verificationRequired: false,
      consecutiveFailures: 1,
      successCount: 0,
      failureCount: 1,
      lastErrorCode: 'some_unknown_error_code',
    };
    normalizeAccountHealth(account, NOW);
    expect(account.health!.lastErrorCode).toBe('some_unknown_error_code');
  });

  it('非法 loginState 归一化为 unknown', () => {
    const account = makeValidAccount();
    account.health = {
      loginState: 'invalid' as 'unknown',
      verificationRequired: false,
      consecutiveFailures: 0,
      successCount: 0,
      failureCount: 0,
    };
    normalizeAccountHealth(account, NOW);
    expect(account.health!.loginState).toBe('unknown');
  });

  it('负数 consecutiveFailures 归一化为 0', () => {
    const account = makeValidAccount();
    account.health = {
      loginState: 'ok',
      verificationRequired: false,
      consecutiveFailures: -3,
      successCount: -1,
      failureCount: -2,
    };
    normalizeAccountHealth(account, NOW);
    expect(account.health!.consecutiveFailures).toBe(0);
    expect(account.health!.successCount).toBe(0);
    expect(account.health!.failureCount).toBe(0);
  });
});

describe('normalizeAccountScheduling', () => {
  it('过期的 manualCooldownUntil 被清除', () => {
    const account = makeValidAccount();
    account.scheduling = { enabled: true, weight: 1, preferredModes: [], manualCooldownUntil: PAST_ISO };
    normalizeAccountScheduling(account, NOW);
    expect(account.scheduling!.manualCooldownUntil).toBeUndefined();
  });

  it('未过期的 manualCooldownUntil 保留', () => {
    const account = makeValidAccount();
    account.scheduling = { enabled: true, weight: 1, preferredModes: [], manualCooldownUntil: FUTURE_ISO };
    normalizeAccountScheduling(account, NOW);
    expect(account.scheduling!.manualCooldownUntil).toBe(FUTURE_ISO);
  });
});

// ==================== normalizeTasks ====================

describe('normalizeTasks', () => {
  // ---- 测试 1: 完整正常数据不产生变更 ----
  it('完整正常数据不产生变更', () => {
    const task = makeValidTask();
    const result = normalizeTasks([task], DEFAULT_PROJECT_ID, NOW);
    expect(result.changed).toBe(false);
    expect(result.warnings).toHaveLength(0);
    expect(result.data).toHaveLength(1);
  });

  it('归一化幂等性', () => {
    const task = makeValidTask();
    const first = normalizeTasks([task], DEFAULT_PROJECT_ID, NOW);
    const second = normalizeTasks(first.data, DEFAULT_PROJECT_ID, NOW);
    expect(second.changed).toBe(false);
  });

  // ---- 测试 2: 缺失旧字段可补全 ----
  it('缺失 mode 时补全为 chat', () => {
    const task = makeValidTask();
    delete (task as Partial<Task>).mode;
    const result = normalizeTasks([task], DEFAULT_PROJECT_ID, NOW);
    expect(result.changed).toBe(true);
    expect(result.data[0].mode).toBe('chat');
  });

  it('缺失 source 时补全为 manual', () => {
    const task = makeValidTask();
    delete (task as Partial<Task>).source;
    const result = normalizeTasks([task], DEFAULT_PROJECT_ID, NOW);
    expect(result.changed).toBe(true);
    expect(result.data[0].source).toBe('manual');
  });

  it('缺失 outputs 时补全为空数组', () => {
    const task = makeValidTask();
    delete (task as Partial<Task>).outputs;
    const result = normalizeTasks([task], DEFAULT_PROJECT_ID, NOW);
    expect(result.changed).toBe(true);
    expect(result.data[0].outputs).toEqual([]);
  });

  // ---- 测试 3: TaskErrorInfo.code 未知字符串保留 ----
  it('TaskErrorInfo.code 为未知字符串时保留不抛错', () => {
    const task = makeValidTask();
    task.status = 'fail';
    task.errorInfo = {
      code: 'totally_unknown_error',
      message: '未知错误',
      recoverable: true,
      detectedAt: NOW,
    };
    const result = normalizeTasks([task], DEFAULT_PROJECT_ID, NOW);
    expect(result.data[0].errorInfo).toBeDefined();
    expect(result.data[0].errorInfo!.code).toBe('totally_unknown_error');
  });

  it('errorInfo.code 为已知错误码时正常保留', () => {
    const task = makeValidTask();
    task.status = 'fail';
    task.errorInfo = {
      code: 'timeout',
      message: '请求超时',
      recoverable: true,
      detectedAt: NOW,
    };
    const result = normalizeTasks([task], DEFAULT_PROJECT_ID, NOW);
    expect(result.data[0].errorInfo!.code).toBe('timeout');
  });

  // ---- 测试 4: 非法 status、非法日期、负数 ----
  it('非法 status 归一化为 fail 并保留原始错误信息', () => {
    const task: Record<string, unknown> = { ...makeValidTask(), status: 'invalid_status' };
    const result = normalizeTasks([task], DEFAULT_PROJECT_ID, NOW);
    expect(result.changed).toBe(true);
    expect(result.data[0].status).toBe('fail');
    expect(result.data[0].errorInfo).toBeDefined();
    expect(result.data[0].errorInfo!.message).toContain('invalid_status');
  });

  it('非法 status 但已有 errorInfo 时保留原有 errorInfo', () => {
    const task: Record<string, unknown> = {
      ...makeValidTask(),
      status: 'invalid_status',
      errorInfo: { code: 'custom_error', message: '原始错误', recoverable: false, detectedAt: NOW },
    };
    const result = normalizeTasks([task], DEFAULT_PROJECT_ID, NOW);
    expect(result.data[0].status).toBe('fail');
    expect(result.data[0].errorInfo!.code).toBe('custom_error');
    expect(result.data[0].errorInfo!.message).toBe('原始错误');
  });

  it('非法 createdAt 归一化为 now', () => {
    const task: Record<string, unknown> = { ...makeValidTask(), createdAt: 'not-a-date' };
    const result = normalizeTasks([task], DEFAULT_PROJECT_ID, NOW);
    expect(result.changed).toBe(true);
    expect(result.data[0].createdAt).toBe(NOW);
  });

  it('非法 updatedAt 归一化为 now', () => {
    const task: Record<string, unknown> = { ...makeValidTask(), updatedAt: 12345 };
    const result = normalizeTasks([task], DEFAULT_PROJECT_ID, NOW);
    expect(result.changed).toBe(true);
    expect(result.data[0].updatedAt).toBe(NOW);
  });

  it('非法 mode 归一化为 chat', () => {
    const task: Record<string, unknown> = { ...makeValidTask(), mode: 'unknown_mode' };
    const result = normalizeTasks([task], DEFAULT_PROJECT_ID, NOW);
    expect(result.changed).toBe(true);
    expect(result.data[0].mode).toBe('chat');
  });

  // ---- 测试 5: 顶层不是数组、数组项不是对象 ----
  it('顶层不是数组时安全回退为空数组', () => {
    const result = normalizeTasks({ error: true }, DEFAULT_PROJECT_ID, NOW);
    expect(result.data).toEqual([]);
    expect(result.changed).toBe(false);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('任务数组项不是对象时安全跳过', () => {
    const result = normalizeTasks([42, 'string', null, makeValidTask()], DEFAULT_PROJECT_ID, NOW);
    expect(result.data).toHaveLength(1);
    expect(result.data[0].id).toBe('task-1');
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  // ---- 测试 6: 历史任务缺少字段可恢复 ----
  it('缺失 projectId 时补全为默认项目 ID', () => {
    const task = makeValidTask();
    delete (task as Partial<Task>).projectId;
    const result = normalizeTasks([task], DEFAULT_PROJECT_ID, NOW);
    expect(result.changed).toBe(true);
    expect(result.data[0].projectId).toBe(DEFAULT_PROJECT_ID);
  });

  it('缺失 artifacts 时补全为空数组', () => {
    const task = makeValidTask();
    delete (task as Partial<Task>).artifacts;
    const result = normalizeTasks([task], DEFAULT_PROJECT_ID, NOW);
    expect(result.changed).toBe(true);
    expect(result.data[0].artifacts).toEqual([]);
  });

  it('缺失 runHistory 时补全为空数组', () => {
    const task = makeValidTask();
    delete (task as Partial<Task>).runHistory;
    const result = normalizeTasks([task], DEFAULT_PROJECT_ID, NOW);
    expect(result.changed).toBe(true);
    expect(result.data[0].runHistory).toEqual([]);
  });

  it('缺失 dependsOnTaskIds 时补全为空数组', () => {
    const task = makeValidTask();
    delete (task as Partial<Task>).dependsOnTaskIds;
    const result = normalizeTasks([task], DEFAULT_PROJECT_ID, NOW);
    expect(result.changed).toBe(true);
    expect(result.data[0].dependsOnTaskIds).toEqual([]);
  });

  it('极简任务（只有 id 和 prompt）可恢复读取', () => {
    const result = normalizeTasks([{ id: 'min-task', prompt: 'hello' }], DEFAULT_PROJECT_ID, NOW);
    expect(result.data).toHaveLength(1);
    const task = result.data[0];
    expect(task.id).toBe('min-task');
    expect(task.prompt).toBe('hello');
    // 缺失 status 时归一化为 fail（安全回退），但保留 id 和提示词
    expect(task.status).toBe('fail');
    expect(task.errorInfo).toBeDefined();
    expect(task.mode).toBe('chat');
    expect(task.outputs).toEqual([]);
    expect(task.artifacts).toEqual([]);
    expect(task.runHistory).toEqual([]);
    expect(task.dependsOnTaskIds).toEqual([]);
    expect(task.projectId).toBe(DEFAULT_PROJECT_ID);
  });

  // ---- 测试 7: 重复任务 ID 去重 ----
  it('重复任务 ID 只保留第一个且记录警告', () => {
    const t1 = makeValidTask(); t1.id = 'dup-task'; t1.prompt = '任务1';
    const t2 = makeValidTask(); t2.id = 'dup-task'; t2.prompt = '任务2';
    const result = normalizeTasks([t1, t2], DEFAULT_PROJECT_ID, NOW);
    expect(result.data).toHaveLength(1);
    expect(result.data[0].prompt).toBe('任务1');
    expect(result.warnings.some((w) => w.includes('dup-task'))).toBe(true);
  });

  // ---- 测试 8: 归一化后对象满足所需字段 ----
  it('归一化后任务满足 Task 接口所有必填字段', () => {
    const result = normalizeTasks([{ id: 'min', prompt: 'p' }], DEFAULT_PROJECT_ID, NOW);
    const task = result.data[0];
    expect(typeof task.id).toBe('string');
    expect(typeof task.prompt).toBe('string');
    expect(task.assignedAccountId).toBeNull();
    expect(typeof task.status).toBe('string');
    expect(typeof task.mode).toBe('string');
    expect(task.result).toBeNull();
    expect(Array.isArray(task.outputs)).toBe(true);
    expect(Array.isArray(task.artifacts)).toBe(true);
    expect(Array.isArray(task.runHistory)).toBe(true);
    expect(Array.isArray(task.dependsOnTaskIds)).toBe(true);
    expect(typeof task.projectId).toBe('string');
    expect(typeof task.createdAt).toBe('string');
    expect(typeof task.updatedAt).toBe('string');
  });

  // ---- 测试 9: 不改变合法附件、提示词、产物 URL ----
  it('不改变合法提示词', () => {
    const task = makeValidTask();
    task.prompt = '这是一条很长的提示词，用于测试归一化不修改原始内容。';
    const result = normalizeTasks([task], DEFAULT_PROJECT_ID, NOW);
    expect(result.data[0].prompt).toBe('这是一条很长的提示词，用于测试归一化不修改原始内容。');
  });

  it('不改变合法附件路径', () => {
    const task = makeValidTask();
    task.attachments = ['/path/to/image1.png', '/path/to/image2.jpg'];
    const result = normalizeTasks([task], DEFAULT_PROJECT_ID, NOW);
    expect(result.data[0].attachments).toEqual(['/path/to/image1.png', '/path/to/image2.jpg']);
  });

  it('不改变合法产物 URL', () => {
    const task = makeValidTask();
    task.outputs = ['https://example.com/output1.mp4', 'https://example.com/output2.mp4'];
    const result = normalizeTasks([task], DEFAULT_PROJECT_ID, NOW);
    expect(result.data[0].outputs).toEqual(['https://example.com/output1.mp4', 'https://example.com/output2.mp4']);
  });

  it('不改变合法 artifacts URL', () => {
    const task = makeValidTask();
    task.artifacts = [{
      id: 'art-1',
      url: 'https://example.com/video.mp4',
      kind: 'video',
      source: 'network',
      runId: 'run-1',
      discoveredAt: NOW,
    }];
    const result = normalizeTasks([task], DEFAULT_PROJECT_ID, NOW);
    expect(result.data[0].artifacts).toHaveLength(1);
    expect(result.data[0].artifacts![0].url).toBe('https://example.com/video.mp4');
  });

  // ---- 测试 10: 无变化不写盘、有变化才写盘 ----
  it('完整正常任务 changed=false', () => {
    const result = normalizeTasks([makeValidTask()], DEFAULT_PROJECT_ID, NOW);
    expect(result.changed).toBe(false);
  });

  it('缺失字段时 changed=true', () => {
    const task = makeValidTask();
    delete (task as Partial<Task>).projectId;
    const result = normalizeTasks([task], DEFAULT_PROJECT_ID, NOW);
    expect(result.changed).toBe(true);
  });

  // ---- 附件列表安全回退 ----
  it('损坏的附件列表（非数组）归一化为空数组', () => {
    const task: Record<string, unknown> = { ...makeValidTask(), attachments: 'not-an-array' };
    const result = normalizeTasks([task], DEFAULT_PROJECT_ID, NOW);
    expect(result.data[0].attachments).toBeUndefined();
  });

  it('附件数组含非字符串项时过滤', () => {
    const task: Record<string, unknown> = { ...makeValidTask(), attachments: ['valid.png', 42, null, 'valid2.jpg'] };
    const result = normalizeTasks([task], DEFAULT_PROJECT_ID, NOW);
    expect(result.data[0].attachments).toEqual(['valid.png', 'valid2.jpg']);
  });

  // ---- artifacts 去重 ----
  it('重复 URL 的 artifacts 去重', () => {
    const task = makeValidTask();
    task.artifacts = [
      { id: 'a1', url: 'https://example.com/dup.mp4', kind: 'video', source: 'network', discoveredAt: NOW },
      { id: 'a2', url: 'https://example.com/dup.mp4', kind: 'video', source: 'page', discoveredAt: NOW },
    ];
    const result = normalizeTasks([task], DEFAULT_PROJECT_ID, NOW);
    expect(result.data[0].artifacts).toHaveLength(1);
    expect(result.data[0].artifacts![0].id).toBe('a1');
  });

  // ---- runtime 归一化 ----
  it('runtime 缺失时设为 undefined', () => {
    const task = makeValidTask();
    const result = normalizeTasks([task], DEFAULT_PROJECT_ID, NOW);
    expect(result.data[0].runtime).toBeUndefined();
  });

  it('runtime 含合法字段时保留', () => {
    const task = makeValidTask();
    task.runtime = {
      runId: 'run-1',
      attempt: 1,
      stage: 'generating',
      message: '生成中',
      startedAt: NOW,
      stageStartedAt: NOW,
      lastHeartbeatAt: NOW,
      input: { prompt: '测试', mode: 'chat', attachments: [] },
    };
    const result = normalizeTasks([task], DEFAULT_PROJECT_ID, NOW);
    expect(result.data[0].runtime).toBeDefined();
    expect(result.data[0].runtime!.runId).toBe('run-1');
    expect(result.data[0].runtime!.stage).toBe('generating');
  });

  // ---- lock 归一化 ----
  it('lock 缺少必要字段时丢弃', () => {
    const task: Record<string, unknown> = { ...makeValidTask(), lock: { ownerId: 'owner1' } };
    const result = normalizeTasks([task], DEFAULT_PROJECT_ID, NOW);
    expect(result.data[0].lock).toBeUndefined();
  });

  it('lock 字段完整时保留', () => {
    const task = makeValidTask();
    task.lock = { ownerId: 'owner1', acquiredAt: NOW, expiresAt: FUTURE_ISO };
    const result = normalizeTasks([task], DEFAULT_PROJECT_ID, NOW);
    expect(result.data[0].lock).toBeDefined();
    expect(result.data[0].lock!.ownerId).toBe('owner1');
  });

  // ---- videoConfig 归一化 ----
  it('非法 videoConfig model 归一化为默认值', () => {
    const task: Record<string, unknown> = {
      ...makeValidTask(),
      mode: 'video',
      videoConfig: { model: 'unknown-model', duration: '10s', aspectRatio: '16:9' },
    };
    const result = normalizeTasks([task], DEFAULT_PROJECT_ID, NOW);
    expect(result.changed).toBe(true);
    expect(result.data[0].videoConfig!.model).toBe('seedance-2.0');
  });
});

// ==================== normalizeDownloadJobs ====================

describe('normalizeDownloadJobs', () => {
  // ---- 测试 1: 完整正常数据不产生变更 ----
  it('完整正常数据不产生变更', () => {
    const job = makeValidDownloadJob();
    const result = normalizeDownloadJobs([job], NOW);
    expect(result.changed).toBe(false);
    expect(result.warnings).toHaveLength(0);
  });

  it('归一化幂等性', () => {
    const job = makeValidDownloadJob();
    const first = normalizeDownloadJobs([job], NOW);
    const second = normalizeDownloadJobs(first.data, NOW);
    expect(second.changed).toBe(false);
  });

  // ---- 测试 2: 缺失字段补全 ----
  it('缺失 attempts 时补全为 0', () => {
    const job = makeValidDownloadJob();
    delete (job as Partial<DownloadJob>).attempts;
    const result = normalizeDownloadJobs([job], NOW);
    expect(result.changed).toBe(true);
    expect(result.data[0].attempts).toBe(0);
  });

  it('缺失 status 时补全为 failed', () => {
    const job = makeValidDownloadJob();
    delete (job as Partial<DownloadJob>).status;
    const result = normalizeDownloadJobs([job], NOW);
    expect(result.changed).toBe(true);
    expect(result.data[0].status).toBe('failed');
  });

  // ---- 测试 4: 非法值归一化 ----
  it('非法 status 归一化为 failed', () => {
    const job: Record<string, unknown> = { ...makeValidDownloadJob(), status: 'invalid' };
    const result = normalizeDownloadJobs([job], NOW);
    expect(result.changed).toBe(true);
    expect(result.data[0].status).toBe('failed');
  });

  it('负数 attempts 归一化为 0', () => {
    const job = makeValidDownloadJob();
    job.attempts = -5;
    const result = normalizeDownloadJobs([job], NOW);
    expect(result.changed).toBe(true);
    expect(result.data[0].attempts).toBe(0);
  });

  it('非法 createdAt 归一化为 now', () => {
    const job: Record<string, unknown> = { ...makeValidDownloadJob(), createdAt: 'not-a-date' };
    const result = normalizeDownloadJobs([job], NOW);
    expect(result.changed).toBe(true);
    expect(result.data[0].createdAt).toBe(NOW);
  });

  // ---- 测试 5: 顶层结构错误 ----
  it('顶层不是数组时安全回退', () => {
    const result = normalizeDownloadJobs({ error: true }, NOW);
    expect(result.data).toEqual([]);
    expect(result.changed).toBe(false);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('下载数组项不是对象时安全跳过', () => {
    const result = normalizeDownloadJobs([42, null, makeValidDownloadJob()], NOW);
    expect(result.data).toHaveLength(1);
    expect(result.data[0].id).toBe('dl-1');
  });

  // ---- 测试 7: 重复 ID 去重 ----
  it('重复下载 ID 只保留第一个', () => {
    const j1 = makeValidDownloadJob(); j1.id = 'dup-dl'; j1.url = 'https://a.com/1.mp4';
    const j2 = makeValidDownloadJob(); j2.id = 'dup-dl'; j2.url = 'https://a.com/2.mp4';
    const result = normalizeDownloadJobs([j1, j2], NOW);
    expect(result.data).toHaveLength(1);
    expect(result.data[0].url).toBe('https://a.com/1.mp4');
  });

  // ---- 测试 8: 归一化后满足字段 ----
  it('归一化后下载记录满足 DownloadJob 必填字段', () => {
    const result = normalizeDownloadJobs([{ id: 'min-dl' }], NOW);
    const job = result.data[0];
    expect(typeof job.id).toBe('string');
    expect(typeof job.taskId).toBe('string');
    expect(job.accountId).toBeNull();
    expect(typeof job.mode).toBe('string');
    expect(typeof job.url).toBe('string');
    expect(typeof job.status).toBe('string');
    expect(typeof job.attempts).toBe('number');
    expect(typeof job.saveDir).toBe('string');
    expect(typeof job.createdAt).toBe('string');
    expect(typeof job.updatedAt).toBe('string');
  });

  // ---- 测试 9: 不改变合法数据 ----
  it('不改变合法 URL、saveDir、filePath', () => {
    const job = makeValidDownloadJob();
    job.url = 'https://example.com/output.mp4';
    job.saveDir = '/my/downloads';
    job.filePath = '/my/downloads/output.mp4';
    job.bytes = 999999;
    const result = normalizeDownloadJobs([job], NOW);
    expect(result.data[0].url).toBe('https://example.com/output.mp4');
    expect(result.data[0].saveDir).toBe('/my/downloads');
    expect(result.data[0].filePath).toBe('/my/downloads/output.mp4');
    expect(result.data[0].bytes).toBe(999999);
  });

  // ---- 测试 10: 无变化不写盘 ----
  it('完整正常数据 changed=false', () => {
    const result = normalizeDownloadJobs([makeValidDownloadJob()], NOW);
    expect(result.changed).toBe(false);
  });

  it('缺失字段时 changed=true', () => {
    const job = makeValidDownloadJob();
    delete (job as Partial<DownloadJob>).status;
    const result = normalizeDownloadJobs([job], NOW);
    expect(result.changed).toBe(true);
  });
});
