export type InteractiveAutomationState = 'idle' | 'injecting' | 'submitting' | 'generating' | 'completed' | 'failed';

/**
 * DOM 配置、上传和原生输入期间只能有一个前台账号。
 * 生成/产物轮询可在隐藏 webview 中继续，不占用前台交互租约。
 */
export function findInteractiveAccountId(
  states: Readonly<Record<string, InteractiveAutomationState | undefined>>,
): string | null {
  for (const [accountId, state] of Object.entries(states)) {
    if (state === 'injecting' || state === 'submitting') return accountId;
  }
  return null;
}

export function canSelectAccount(
  requestedAccountId: string,
  interactiveAccountId: string | null,
): boolean {
  return !interactiveAccountId || requestedAccountId === interactiveAccountId;
}

