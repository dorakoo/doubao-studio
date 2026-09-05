import type { Account } from '../types';

/**
 * 启动时只挂载当前账号；任务真正进入执行态时再补挂对应账号。
 * 已经创建的 webview 由 BrowserPanel registry 保留，不在这里回收。
 */
export function getWebviewHydrationAccountIds(
  accounts: Array<Pick<Account, 'id'>>,
  activeAccountId: string | null,
  executingTasks: Record<string, string>,
): string[] {
  const existingIds = new Set(accounts.map((account) => account.id));
  const desired = new Set<string>();

  if (activeAccountId && existingIds.has(activeAccountId)) desired.add(activeAccountId);
  for (const accountId of Object.keys(executingTasks)) {
    if (executingTasks[accountId] && existingIds.has(accountId)) desired.add(accountId);
  }

  return [...desired];
}
