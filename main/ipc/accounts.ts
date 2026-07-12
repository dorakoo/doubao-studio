/**
 * main/ipc/accounts.ts
 * 账号管理 IPC 处理器
 * 负责：账号 CRUD、Session 分区管理、Cookie/Storage 隔离
 */

import { ipcMain, session } from 'electron';
import { readJSON, writeJSON } from '../utils/store';
import { v4 as uuidv4 } from 'uuid';
import type {
  Account,
  AccountAddParams,
  AccountUpdateParams,
  AccountIdParams,
  AccountSetStatusParams,
  AccountSetPinnedParams,
  AccountUpdateSeedanceQuotaParams,
  AccountUpdateHealthParams,
  AccountUpdateSchedulingParams,
} from '@doubao-studio/contracts';

// ==================== 类型定义 ====================

// 枚举/联合类型、领域模型接口和 IPC DTO 已迁移至 @doubao-studio/contracts。
// 此处通过 import type 引用，不产生运行时依赖。

export type { Account };

// ==================== 数据持久化 ====================

const STORE_FILE = 'accounts.json';
const DEFAULT_SEEDANCE_DAILY_UNITS = 10;

function localDateKey(): string {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}

// GenerationMode 已迁移至 @doubao-studio/contracts

function normalizeQuota(account: Account): void {
  const today = localDateKey();
  if (!account.seedanceQuota || account.seedanceQuota.date !== today) {
    account.seedanceQuota = {
      date: today,
      usedUnits: 0,
      estimatedTotalUnits: account.seedanceQuota?.estimatedTotalUnits || DEFAULT_SEEDANCE_DAILY_UNITS,
      exhausted: false,
      updatedAt: new Date().toISOString(),
    };
  }
}

function normalizeHealth(account: Account): void {
  account.health = {
    loginState: account.health?.loginState || 'unknown',
    verificationRequired: account.health?.verificationRequired || false,
    consecutiveFailures: account.health?.consecutiveFailures || 0,
    successCount: account.health?.successCount || 0,
    failureCount: account.health?.failureCount || 0,
    lastSuccessAt: account.health?.lastSuccessAt,
    lastFailureAt: account.health?.lastFailureAt,
    lastErrorCode: account.health?.lastErrorCode,
    cooldownUntil: account.health?.cooldownUntil,
  };
  if (account.health.cooldownUntil && new Date(account.health.cooldownUntil).getTime() <= Date.now()) {
    account.health.cooldownUntil = undefined;
    account.health.verificationRequired = false;
  }
}

function normalizeScheduling(account: Account): void {
  account.scheduling = {
    enabled: account.scheduling?.enabled ?? true,
    weight: Math.max(0.1, Math.min(10, account.scheduling?.weight || 1)),
    preferredModes: account.scheduling?.preferredModes || [],
    manualCooldownUntil: account.scheduling?.manualCooldownUntil,
  };
  if (account.scheduling.manualCooldownUntil && new Date(account.scheduling.manualCooldownUntil).getTime() <= Date.now()) {
    account.scheduling.manualCooldownUntil = undefined;
  }
}

/** 读取所有账号 */
function loadAccounts(): Account[] {
  return readJSON<Account[]>(STORE_FILE, []);
}

/** 保存所有账号 */
function saveAccounts(accounts: Account[]): boolean {
  return writeJSON(STORE_FILE, accounts);
}

// ==================== Session 管理 ====================

/** 活跃的 session 分区集合（用于清理） */
const activePartitions = new Set<string>();

/**
 * 为指定账号创建独立的 Electron Session
 * 通过 partition 实现 Cookie/Storage 完全隔离
 */
function getSessionForAccount(accountId: string, partition: string): Electron.Session {
  const sess = session.fromPartition(`persist:doubao_${partition}`);
  activePartitions.add(partition);

  // 配置 User-Agent（模拟 Chrome 浏览器）
  sess.setUserAgent(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'zh-CN'
  );

  return sess;
}

/**
 * 清除指定账号的 Session 数据（Cookie/Storage）
 */
async function clearAccountSession(partition: string): Promise<void> {
  const sess = session.fromPartition(`persist:doubao_${partition}`);
  try {
    await sess.clearStorageData();
    await sess.clearCache();
    activePartitions.delete(partition);
  } catch (err) {
    console.error(`[Accounts] 清除 Session 失败 (partition=${partition}):`, err);
  }
}

// ==================== IPC 处理器注册 ====================

export function registerAccountIPC(): void {
  // ---- 获取所有账号 ----
  ipcMain.handle('accounts:list', async (): Promise<Account[]> => {
    const accounts = loadAccounts();
    // 规范化前快照，用于判断是否真正产生了字段补全或额度重置
    const before = JSON.stringify(accounts);
    accounts.forEach(normalizeQuota);
    accounts.forEach(normalizeHealth);
    accounts.forEach(normalizeScheduling);
    // 仅在规范化确实改变了数据时写盘，避免每次 list 都产生无意义磁盘 IO
    if (JSON.stringify(accounts) !== before) {
      saveAccounts(accounts);
    }
    return accounts;
  });

  // ---- 添加账号 ----
  ipcMain.handle(
    'accounts:add',
    async (_event, params: AccountAddParams): Promise<{ success: boolean; account?: Account; error?: string }> => {
      try {
        const trimmedName = params.name?.trim();
        if (!trimmedName) {
          return { success: false, error: '账号名称不能为空' };
        }

        const accounts = loadAccounts();

        // 检查同名账号
        if (accounts.some((a) => a.name === trimmedName)) {
          return { success: false, error: `账号「${trimmedName}」已存在` };
        }

        const newAccount: Account = {
          id: uuidv4(),
          name: trimmedName,
          avatar: '', // 后续从豆包页面抓取
          partition: `account_${uuidv4().slice(0, 8)}`,
          status: 'idle',
          pinned: false,
          seedanceQuota: {
            date: localDateKey(),
            usedUnits: 0,
            estimatedTotalUnits: DEFAULT_SEEDANCE_DAILY_UNITS,
            exhausted: false,
            updatedAt: new Date().toISOString(),
          },
          health: {
            loginState: 'unknown',
            verificationRequired: false,
            consecutiveFailures: 0,
            successCount: 0,
            failureCount: 0,
          },
          scheduling: { enabled: true, weight: 1, preferredModes: [] },
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };

        // 预创建独立 Session
        getSessionForAccount(newAccount.id, newAccount.partition);

        accounts.push(newAccount);
        if (!saveAccounts(accounts)) {
          return { success: false, error: '账号数据写入失败，请检查磁盘空间和数据目录权限' };
        }

        return { success: true, account: newAccount };
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    }
  );

  // ---- 编辑账号名称 ----
  ipcMain.handle(
    'accounts:update',
    async (_event, params: AccountUpdateParams): Promise<{ success: boolean; error?: string }> => {
      const trimmedName = params.name?.trim();
      if (!trimmedName) {
        return { success: false, error: '账号名称不能为空' };
      }

      const accounts = loadAccounts();
      const account = accounts.find((a) => a.id === params.id);
      if (!account) {
        return { success: false, error: '账号不存在' };
      }

      // 排除自身后查重
      if (accounts.some((a) => a.id !== params.id && a.name === trimmedName)) {
        return { success: false, error: `账号「${trimmedName}」已存在` };
      }

      account.name = trimmedName;
      account.updatedAt = new Date().toISOString();
      if (!saveAccounts(accounts)) {
        return { success: false, error: '账号数据写入失败，请检查磁盘空间和数据目录权限' };
      }

      return { success: true };
    }
  );

  // ---- 删除账号 ----
  ipcMain.handle(
    'accounts:delete',
    async (_event, params: AccountIdParams): Promise<{ success: boolean; error?: string }> => {
      const accounts = loadAccounts();
      const idx = accounts.findIndex((a) => a.id === params.id);
      if (idx === -1) {
        return { success: false, error: '账号不存在' };
      }

      // 引用完整性：存在关联任务时拒绝删除，避免产生孤儿任务引用
      const tasks = readJSON<Array<{ assignedAccountId?: string | null }>>('tasks.json', []);
      const linkedTaskCount = tasks.filter((t) => t.assignedAccountId === params.id).length;
      if (linkedTaskCount > 0) {
        return { success: false, error: `仍有 ${linkedTaskCount} 个任务指派到此账号，请先迁移或删除这些任务` };
      }

      const removed = accounts.splice(idx, 1)[0];
      if (!saveAccounts(accounts)) {
        return { success: false, error: '账号数据写入失败，请检查磁盘空间和数据目录权限' };
      }

      // 先持久化删除，再清理不可回滚的登录数据，避免写盘失败却把现有账号登出。
      await clearAccountSession(removed.partition);
      return { success: true };
    }
  );

  // ---- 刷新账号（清除 Session 后重新加载） ----
  ipcMain.handle(
    'accounts:refresh',
    async (_event, params: AccountIdParams): Promise<{ success: boolean; error?: string }> => {
      const accounts = loadAccounts();
      const account = accounts.find((a) => a.id === params.id);
      if (!account) {
        return { success: false, error: '账号不存在' };
      }

      await clearAccountSession(account.partition);
      // 重新创建 Session
      getSessionForAccount(account.id, account.partition);
      account.status = 'idle';
      account.updatedAt = new Date().toISOString();
      if (!saveAccounts(accounts)) {
        return { success: false, error: '账号数据写入失败，请检查磁盘空间和数据目录权限' };
      }

      return { success: true };
    }
  );

  // ---- 更新账号状态 ----
  ipcMain.handle(
    'accounts:setStatus',
    async (_event, params: AccountSetStatusParams): Promise<{ success: boolean }> => {
      const accounts = loadAccounts();
      const account = accounts.find((a) => a.id === params.id);
      if (!account) return { success: false };
      account.status = params.status;
      account.updatedAt = new Date().toISOString();
      if (!saveAccounts(accounts)) {
        return { success: false };
      }
      return { success: true };
    }
  );

  // ---- 切换置顶状态 ----
  ipcMain.handle(
    'accounts:setPinned',
    async (_event, params: AccountSetPinnedParams): Promise<{ success: boolean }> => {
      const accounts = loadAccounts();
      const account = accounts.find((a) => a.id === params.id);
      if (!account) return { success: false };
      account.pinned = params.pinned;
      account.updatedAt = new Date().toISOString();
      if (!saveAccounts(accounts)) {
        return { success: false };
      }
      return { success: true };
    }
  );

  ipcMain.handle('accounts:updateScheduling', async (_event, params: AccountUpdateSchedulingParams) => {
    const accounts = loadAccounts();
    const account = accounts.find((item) => item.id === params.id);
    if (!account) return { success: false };
    normalizeScheduling(account);
    account.scheduling = { ...account.scheduling!, ...params.updates };
    normalizeScheduling(account);
    account.updatedAt = new Date().toISOString();
    if (!saveAccounts(accounts)) {
      return { success: false, error: '账号数据写入失败，请检查磁盘空间和数据目录权限' };
    }
    return { success: true, account };
  });

  ipcMain.handle(
    'accounts:updateHealth',
    async (_event, params: AccountUpdateHealthParams): Promise<{ success: boolean; account?: Account; error?: string }> => {
      const accounts = loadAccounts();
      const account = accounts.find((item) => item.id === params.id);
      if (!account) return { success: false };
      normalizeHealth(account);
      const health = account.health!;
      const now = new Date();

      if (params.action === 'success') {
        health.loginState = 'ok';
        health.verificationRequired = false;
        health.consecutiveFailures = 0;
        health.successCount++;
        health.lastSuccessAt = now.toISOString();
        health.lastErrorCode = undefined;
        health.cooldownUntil = undefined;
      } else if (params.action === 'failure') {
        health.consecutiveFailures++;
        health.failureCount++;
        health.lastFailureAt = now.toISOString();
        health.lastErrorCode = params.errorCode;
        if (health.consecutiveFailures >= 3) {
          health.cooldownUntil = new Date(now.getTime() + 30 * 60 * 1000).toISOString();
        }
      } else if (params.action === 'verification') {
        health.verificationRequired = true;
        health.lastErrorCode = 'verification';
        health.cooldownUntil = new Date(now.getTime() + 10 * 60 * 1000).toISOString();
      } else if (params.action === 'login_expired') {
        health.loginState = 'expired';
        health.lastErrorCode = 'page_changed';
      } else {
        account.health = {
          loginState: 'unknown', verificationRequired: false, consecutiveFailures: 0,
          successCount: health.successCount, failureCount: health.failureCount,
        };
      }
      account.updatedAt = now.toISOString();
      if (!saveAccounts(accounts)) {
        return { success: false, error: '账号数据写入失败，请检查磁盘空间和数据目录权限' };
      }
      return { success: true, account };
    }
  );

  // ---- 更新 Seedance 每日额度预测 ----
  ipcMain.handle(
    'accounts:updateSeedanceQuota',
    async (_event, params: AccountUpdateSeedanceQuotaParams): Promise<{ success: boolean; account?: Account; error?: string }> => {
      const accounts = loadAccounts();
      const account = accounts.find((item) => item.id === params.id);
      if (!account) return { success: false };
      normalizeQuota(account);
      const quota = account.seedanceQuota!;
      if (params.action === 'consume') {
        quota.usedUnits += Math.max(1, Math.round(params.units || 1));
        quota.exhausted = false;
      } else {
        quota.exhausted = true;
        if (quota.usedUnits > 0) quota.estimatedTotalUnits = quota.usedUnits;
      }
      quota.updatedAt = new Date().toISOString();
      account.updatedAt = quota.updatedAt;
      if (!saveAccounts(accounts)) {
        return { success: false, error: '账号数据写入失败，请检查磁盘空间和数据目录权限' };
      }
      return { success: true, account };
    }
  );

  // ---- 获取账号 Session 信息 ----
  ipcMain.handle(
    'accounts:getPartition',
    async (_event, params: AccountIdParams): Promise<string | null> => {
      const accounts = loadAccounts();
      const account = accounts.find((a) => a.id === params.id);
      return account ? account.partition : null;
    }
  );

  console.log('[IPC] 账号管理模块已注册');
}
