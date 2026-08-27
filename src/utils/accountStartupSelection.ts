import type { Account } from '../types';

/**
 * 启动恢复账号列表后解析唯一活跃账号。
 * 保留仍存在的当前选择；冷启动则优先置顶账号，最后回退到列表首项。
 */
export function resolveStartupAccountId(
  accounts: ReadonlyArray<Pick<Account, 'id' | 'pinned'>>,
  currentAccountId: string | null,
): string | null {
  if (currentAccountId && accounts.some((account) => account.id === currentAccountId)) {
    return currentAccountId;
  }
  return accounts.find((account) => account.pinned)?.id ?? accounts[0]?.id ?? null;
}
