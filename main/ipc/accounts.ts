/**
 * main/ipc/accounts.ts
 * 账号管理 IPC 处理器
 * 负责：账号 CRUD、Session 分区管理、Cookie/Storage 隔离
 */

import { ipcMain, session } from 'electron';
import { readJSON, writeJSON } from '../utils/store';
import { v4 as uuidv4 } from 'uuid';

// ==================== 类型定义 ====================

/** 账号状态 */
export type AccountStatus = 'idle' | 'busy' | 'error';

/** 账号数据结构 */
export interface Account {
  id: string;
  name: string;
  /** 头像 URL（豆包默认头像） */
  avatar: string;
  /** Session 分区名（每个账号独立） */
  partition: string;
  status: AccountStatus;
  createdAt: string;
  updatedAt: string;
}

// ==================== 数据持久化 ====================

const STORE_FILE = 'accounts.json';

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
    return loadAccounts();
  });

  // ---- 添加账号 ----
  ipcMain.handle(
    'accounts:add',
    async (_event, params: { name: string }): Promise<{ success: boolean; account?: Account; error?: string }> => {
      try {
        const accounts = loadAccounts();

        // 检查同名账号
        if (accounts.some((a) => a.name === params.name.trim())) {
          return { success: false, error: `账号「${params.name}」已存在` };
        }

        const newAccount: Account = {
          id: uuidv4(),
          name: params.name.trim(),
          avatar: '', // 后续从豆包页面抓取
          partition: `account_${uuidv4().slice(0, 8)}`,
          status: 'idle',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };

        // 预创建独立 Session
        getSessionForAccount(newAccount.id, newAccount.partition);

        accounts.push(newAccount);
        saveAccounts(accounts);

        return { success: true, account: newAccount };
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    }
  );

  // ---- 编辑账号名称 ----
  ipcMain.handle(
    'accounts:update',
    async (_event, params: { id: string; name: string }): Promise<{ success: boolean; error?: string }> => {
      const accounts = loadAccounts();
      const account = accounts.find((a) => a.id === params.id);
      if (!account) {
        return { success: false, error: '账号不存在' };
      }

      account.name = params.name.trim();
      account.updatedAt = new Date().toISOString();
      saveAccounts(accounts);

      return { success: true };
    }
  );

  // ---- 删除账号 ----
  ipcMain.handle(
    'accounts:delete',
    async (_event, params: { id: string }): Promise<{ success: boolean; error?: string }> => {
      const accounts = loadAccounts();
      const idx = accounts.findIndex((a) => a.id === params.id);
      if (idx === -1) {
        return { success: false, error: '账号不存在' };
      }

      const removed = accounts.splice(idx, 1)[0];

      // 清除该账号的 Session 数据
      await clearAccountSession(removed.partition);

      saveAccounts(accounts);
      return { success: true };
    }
  );

  // ---- 刷新账号（清除 Session 后重新加载） ----
  ipcMain.handle(
    'accounts:refresh',
    async (_event, params: { id: string }): Promise<{ success: boolean; error?: string }> => {
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
      saveAccounts(accounts);

      return { success: true };
    }
  );

  // ---- 更新账号状态 ----
  ipcMain.handle(
    'accounts:setStatus',
    async (_event, params: { id: string; status: AccountStatus }): Promise<{ success: boolean }> => {
      const accounts = loadAccounts();
      const account = accounts.find((a) => a.id === params.id);
      if (account) {
        account.status = params.status;
        account.updatedAt = new Date().toISOString();
        saveAccounts(accounts);
      }
      return { success: true };
    }
  );

  // ---- 获取账号 Session 信息 ----
  ipcMain.handle(
    'accounts:getPartition',
    async (_event, params: { id: string }): Promise<string | null> => {
      const accounts = loadAccounts();
      const account = accounts.find((a) => a.id === params.id);
      return account ? account.partition : null;
    }
  );

  console.log('[IPC] 账号管理模块已注册');
}
