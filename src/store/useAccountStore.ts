/**
 * src/store/useAccountStore.ts
 * 账号管理状态（Zustand）
 *
 * 管理账号列表的 CRUD、当前选中账号、加载状态
 */

import { create } from 'zustand';
import type { Account, AccountAvailability, AccountPlatform, AccountStatus } from '../types';
import { requireStartupAvailabilityRecheck } from '../utils/accountAvailability';

function prepareAccountForRuntime(account: Account, checkedAt: string): Account {
  return {
    ...account,
    pinned: account.pinned ?? false,
    health: {
      ...(account.health || {
        loginState: 'unknown', verificationRequired: false, consecutiveFailures: 0,
        successCount: 0, failureCount: 0,
      }),
      availability: requireStartupAvailabilityRecheck(account.health?.availability, checkedAt),
    },
  };
}

// ==================== 类型 ====================

interface AccountState {
  /** 所有账号列表 */
  accounts: Account[];
  /** 当前选中的账号 ID */
  selectedAccountId: string | null;
  /** 数据是否正在加载 */
  loading: boolean;
  /** 错误信息 */
  error: string | null;
  availabilityChecking: Record<string, boolean>;
  availabilityCheckRequests: Record<string, number>;

  // Actions
  /** 从主进程加载账号列表 */
  loadAccounts: () => Promise<void>;
  /** 添加新账号 */
  addAccount: (name: string, platform?: AccountPlatform) => Promise<boolean>;
  /** 编辑账号名称 */
  updateAccount: (id: string, name: string) => Promise<boolean>;
  /** 删除账号 */
  deleteAccount: (id: string) => Promise<boolean>;
  /** 刷新账号 Session */
  refreshAccount: (id: string) => Promise<boolean>;
  /** 选中账号 */
  selectAccount: (id: string | null) => void;
  /** 更新账号状态 */
  updateAccountStatus: (id: string, status: AccountStatus) => Promise<void>;
  /** 切换置顶状态 */
  togglePinned: (id: string) => Promise<void>;
  recordSeedanceUsage: (id: string, units: number) => Promise<void>;
  markSeedanceExhausted: (id: string) => Promise<void>;
  recordAccountOutcome: (id: string, action: 'success' | 'failure' | 'verification' | 'login_expired' | 'clear', errorCode?: string) => Promise<void>;
  setAccountAvailability: (id: string, availability: AccountAvailability) => Promise<boolean>;
  setAvailabilityChecking: (id: string, checking: boolean) => void;
  requestAvailabilityCheck: (id: string) => void;
  updateScheduling: (id: string, updates: Partial<NonNullable<Account['scheduling']>>) => Promise<void>;
  /** 清除错误 */
  clearError: () => void;
}

// ==================== Store ====================

export const useAccountStore = create<AccountState>((set, get) => ({
  accounts: [],
  selectedAccountId: null,
  loading: false,
  error: null,
  availabilityChecking: {},
  availabilityCheckRequests: {},

  // 加载账号列表
  loadAccounts: async () => {
    set({ loading: true, error: null });
    try {
      const accounts = await window.electronAPI.accounts.list();
      // 打开软件后不信任上次运行的 ready；必须等当前隔离页面完成探测。
      const checkedAt = new Date().toISOString();
      const normalized = accounts.map((account) => prepareAccountForRuntime(account, checkedAt));
      set({ accounts: normalized, loading: false });
    } catch (err: any) {
      set({ error: err.message, loading: false });
    }
  },

  // 添加账号
  addAccount: async (name: string, platform: AccountPlatform = 'doubao') => {
    set({ error: null });
    try {
      const result = await window.electronAPI.accounts.add(name, platform);
      if (result.success && result.account) {
        const accounts = [...get().accounts, prepareAccountForRuntime(result.account, new Date().toISOString())];
        set({ accounts });
        return true;
      } else {
        set({ error: result.error || '添加失败' });
        return false;
      }
    } catch (err: any) {
      set({ error: err.message });
      return false;
    }
  },

  // 编辑账号
  updateAccount: async (id: string, name: string) => {
    set({ error: null });
    try {
      const result = await window.electronAPI.accounts.update(id, name);
      if (result.success) {
        const accounts = get().accounts.map((a) =>
          a.id === id ? { ...a, name: name.trim(), updatedAt: new Date().toISOString() } : a
        );
        set({ accounts });
        return true;
      } else {
        set({ error: result.error || '编辑失败' });
        return false;
      }
    } catch (err: any) {
      set({ error: err.message });
      return false;
    }
  },

  // 删除账号
  deleteAccount: async (id: string) => {
    set({ error: null });
    try {
      const result = await window.electronAPI.accounts.delete(id);
      if (result.success) {
        const accounts = get().accounts.filter((a) => a.id !== id);
        let newSelectedId = get().selectedAccountId;
        // 如果删除的是当前选中的账号，自动切换到第一个可用账号
        if (newSelectedId === id) {
          const pinned = accounts.find(a => a.pinned);
          newSelectedId = pinned ? pinned.id : (accounts.length > 0 ? accounts[0].id : null);
        }
        set({ accounts, selectedAccountId: newSelectedId });
        return true;
      } else {
        set({ error: result.error || '删除失败' });
        return false;
      }
    } catch (err: any) {
      set({ error: err.message });
      return false;
    }
  },

  // 刷新账号
  refreshAccount: async (id: string) => {
    try {
      const result = await window.electronAPI.accounts.refresh(id);
      if (result.success) {
        const accounts = get().accounts.map((a) =>
          a.id === id ? { ...a, status: 'idle' as AccountStatus, updatedAt: new Date().toISOString() } : a
        );
        set({ accounts });
        return true;
      }
      return false;
    } catch {
      return false;
    }
  },

  // 选中账号
  selectAccount: (id: string | null) => {
    set({ selectedAccountId: id });
  },

  // 更新账号状态
  updateAccountStatus: async (id: string, status: AccountStatus) => {
    const result = await window.electronAPI.accounts.setStatus(id, status);
    if (!result.success) {
      set({ error: '账号状态保存失败' });
      return;
    }
    const accounts = get().accounts.map((a) =>
      a.id === id ? { ...a, status } : a
    );
    set({ accounts });
  },

  // 切换置顶状态
  togglePinned: async (id: string) => {
    const account = get().accounts.find(a => a.id === id);
    if (!account) return;
    const newPinned = !account.pinned;
    const result = await window.electronAPI.accounts.setPinned(id, newPinned);
    if (!result.success) {
      set({ error: '账号置顶状态保存失败' });
      return;
    }
    const accounts = get().accounts.map((a) =>
      a.id === id ? { ...a, pinned: newPinned, updatedAt: new Date().toISOString() } : a
    );
    set({ accounts });
  },

  recordSeedanceUsage: async (id: string, units: number) => {
    const result = await window.electronAPI.accounts.updateSeedanceQuota(id, 'consume', units);
    if (result.success && result.account) {
      set({ accounts: get().accounts.map((account) => account.id === id ? result.account! : account) });
    }
  },

  markSeedanceExhausted: async (id: string) => {
    const result = await window.electronAPI.accounts.updateSeedanceQuota(id, 'exhausted');
    if (result.success && result.account) {
      set({ accounts: get().accounts.map((account) => account.id === id ? result.account! : account) });
    }
  },

  recordAccountOutcome: async (id, action, errorCode) => {
    const result = await window.electronAPI.accounts.updateHealth(id, action, errorCode);
    if (result.success && result.account) {
      set({ accounts: get().accounts.map((account) => account.id === id ? result.account! : account) });
    }
  },

  setAccountAvailability: async (id, availability) => {
    const result = await window.electronAPI.accounts.setAvailability(id, availability);
    if (!result.success || !result.account) {
      set({ error: result.error || '账号可用性状态保存失败' });
      return false;
    }
    set({ accounts: get().accounts.map((account) => account.id === id ? result.account! : account) });
    return true;
  },

  setAvailabilityChecking: (id, checking) => set({
    availabilityChecking: { ...get().availabilityChecking, [id]: checking },
  }),

  requestAvailabilityCheck: (id) => set({
    availabilityCheckRequests: {
      ...get().availabilityCheckRequests,
      [id]: (get().availabilityCheckRequests[id] || 0) + 1,
    },
  }),

  updateScheduling: async (id, updates) => {
    const result = await window.electronAPI.accounts.updateScheduling(id, updates);
    if (result.success && result.account) set({ accounts: get().accounts.map((account) => account.id === id ? result.account! : account) });
  },

  // 清除错误
  clearError: () => set({ error: null }),
}));

// getAccountSchedulingScore 已抽取到 src/utils/schedulingScore.ts
export { getAccountSchedulingScore } from '../utils/schedulingScore';
