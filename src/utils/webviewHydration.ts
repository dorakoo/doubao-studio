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

interface WebviewActivationStyle {
  opacity: string;
  pointerEvents: string;
  transform: string;
  zIndex: string;
  visibility: string;
}

/**
 * Electron 的 guest view 从 visibility:hidden 恢复时可能不触发合成器重绘。
 * webview 始终保留在可合成树中。Electron guest surface 不可靠遵守普通 DOM
 * z-index，因此后台页必须移出可视区域，不能与当前账号不透明叠放。
 */
export function applyWebviewActivationStyle(
  style: WebviewActivationStyle,
  active: boolean,
): void {
  style.visibility = 'visible';
  style.opacity = '1';
  style.pointerEvents = active ? 'auto' : 'none';
  style.transform = active ? 'translate3d(0, 0, 0)' : 'translate3d(-200vw, 0, 0)';
  style.zIndex = active ? '1' : '-1';
}

/** 快速切换时回收仍在加载且没有执行任务的旧前台页，避免网络加载风暴。 */
export function getSupersededLoadingAccountIds(
  registeredAccountIds: readonly string[],
  loadingAccountIds: ReadonlySet<string>,
  activeAccountId: string | null,
  executingTasks: Readonly<Record<string, string>>,
): string[] {
  return registeredAccountIds.filter((accountId) =>
    accountId !== activeAccountId &&
    loadingAccountIds.has(accountId) &&
    !executingTasks[accountId],
  );
}

interface WebviewRepaintTarget {
  readonly offsetWidth: number;
  style: { width: string };
}

/**
 * Electron guest surface 偶发已加载但未提交首帧；一次 1px 布局变化可触发与用户
 * 调整窗口相同的合成器重绘。恢复在下一帧完成，不改变最终布局。
 */
export function forceWebviewLayoutRepaint(
  target: WebviewRepaintTarget,
  scheduleFrame: (callback: () => void) => void = (callback) => requestAnimationFrame(callback),
): Promise<void> {
  const originalWidth = target.style.width || '100%';
  target.style.width = 'calc(100% - 1px)';
  void target.offsetWidth;
  return new Promise((resolve) => {
    scheduleFrame(() => {
      target.style.width = originalWidth;
      void target.offsetWidth;
      resolve();
    });
  });
}

/**
 * Electron guest 的 DOM 脚本接口偶尔晚于页面本身可用。页面已经提交真实标题且
 * URL 属于预期平台时，可作为不读取账号数据的就绪证据，避免加载层永久遮挡。
 */
export function isWebviewDocumentReady(
  url: string,
  title: string,
  expectedHost: string,
): boolean {
  if (!title.trim() || !url.trim()) return false;
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    const host = expectedHost.toLowerCase();
    return hostname === host || hostname.endsWith(`.${host}`);
  } catch {
    return false;
  }
}
