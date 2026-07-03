/**
 * src/store/useAccountStore.ts
 * 账号管理状态（Zustand）
 *
 * 管理账号列表的 CRUD、当前选中账号、加载状态
 */

import { create } from 'zustand';
import type { Account, AccountStatus } from '../types';

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

  // Actions
  /** 从主进程加载账号列表 */
  loadAccounts: () => Promise<void>;
  /** 添加新账号 */
  addAccount: (name: string) => Promise<boolean>;
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
  /** 清除错误 */
  clearError: () => void;
}

// ==================== Store ====================

export const useAccountStore = create<AccountState>((set, get) => ({
  accounts: [],
  selectedAccountId: null,
  loading: false,
  error: null,

  // 加载账号列表
  loadAccounts: async () => {
    set({ loading: true, error: null });
    try {
      const accounts = await window.electronAPI.accounts.list();
      // 兼容旧数据：如果没有 pinned 字段，默认为 false
      const normalized = accounts.map(a => ({ ...a, pinned: a.pinned ?? false }));
      set({ accounts: normalized, loading: false });
    } catch (err: any) {
      set({ error: err.message, loading: false });
    }
  },

  // 添加账号
  addAccount: async (name: string) => {
    set({ error: null });
    try {
      const result = await window.electronAPI.accounts.add(name);
      if (result.success && result.account) {
        const accounts = [...get().accounts, result.account];
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
          a.id === id ? { ...a, name, updatedAt: new Date().toISOString() } : a
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
    await window.electronAPI.accounts.setStatus(id, status);
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
    await window.electronAPI.accounts.setPinned(id, newPinned);
    const accounts = get().accounts.map((a) =>
      a.id === id ? { ...a, pinned: newPinned, updatedAt: new Date().toISOString() } : a
    );
    set({ accounts });
  },

  // 清除错误
  clearError: () => set({ error: null }),
}));
