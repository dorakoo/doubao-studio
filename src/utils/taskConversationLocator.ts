import type { Account, Task } from '../types';

const DOUBAO_ORIGIN = 'https://www.doubao.com';
const CONVERSATION_URL = /^https:\/\/www\.doubao\.com\/chat\/([A-Za-z0-9_-]{1,128})\/?(?:[?#].*)?$/i;

export type TaskConversationTarget =
  | { ok: true; url: string; conversationId: string; source: 'runtime' | 'artifact' }
  | {
      ok: false;
      reason: 'CONVERSATION_URL_MISSING' | 'CONVERSATION_URL_AMBIGUOUS' | 'CONVERSATION_BINDING_CONFLICT';
    };

export interface ConversationNavigator {
  getURL(): string;
  loadURL(url: string): void;
  reload(): void;
}

export interface ConversationNavigationResult {
  ok: boolean;
  reason?: 'INVALID_TARGET' | 'NAVIGATION_TIMEOUT';
  url?: string;
}

/** 只接受豆包的具体会话地址；根页、端口、凭据、错误协议与错误域名全部拒绝。 */
export function normalizeDoubaoConversationUrl(raw: string | undefined): string | null {
  if (!raw) return null;
  const match = raw.trim().match(CONVERSATION_URL);
  if (!match) return null;
  try {
    const parsed = new URL(raw.trim());
    if (parsed.origin !== DOUBAO_ORIGIN || parsed.username || parsed.password || parsed.port) return null;
    return `${DOUBAO_ORIGIN}/chat/${match[1]}`;
  } catch {
    return null;
  }
}

export function getDoubaoConversationId(raw: string | undefined): string | null {
  const normalized = normalizeDoubaoConversationUrl(raw);
  return normalized?.slice(`${DOUBAO_ORIGIN}/chat/`.length) || null;
}

export function isSameDoubaoConversation(left: string | undefined, right: string | undefined): boolean {
  const leftId = getDoubaoConversationId(left);
  return !!leftId && leftId === getDoubaoConversationId(right);
}

/** Dola 尚未完成端到端验收，不能把豆包会话定位器用于其它平台分区。 */
export function supportsDoubaoConversationLocator(platform: Account['platform'] | undefined): boolean {
  return (platform || 'doubao') === 'doubao';
}

/**
 * runtime 是权威定位；存在 acceptance binding 时，两处 URL 与 run 必须完全同步。
 * 旧任务只能回退到当前 run 的唯一 artifact，绝不跨 run 猜测。
 */
export function resolveTaskConversationTarget(
  task: Pick<Task, 'runtime' | 'artifacts'> | null | undefined,
): TaskConversationTarget {
  const runtime = task?.runtime;
  const runtimeUrl = normalizeDoubaoConversationUrl(runtime?.conversationUrl);
  const binding = runtime?.acceptanceObservation;
  if (binding) {
    const bindingUrl = normalizeDoubaoConversationUrl(binding.conversationUrl);
    if (!runtimeUrl || !bindingUrl || binding.runId !== runtime?.runId || !isSameDoubaoConversation(runtimeUrl, bindingUrl)) {
      return { ok: false, reason: 'CONVERSATION_BINDING_CONFLICT' };
    }
  }
  if (runtimeUrl) {
    const conversationId = getDoubaoConversationId(runtimeUrl);
    if (conversationId) return { ok: true, url: runtimeUrl, conversationId, source: 'runtime' };
  }

  const currentRunId = runtime?.runId;
  if (!currentRunId) return { ok: false, reason: 'CONVERSATION_URL_MISSING' };
  const urls = [...new Set((task?.artifacts || [])
    .filter((artifact) => artifact.runId === currentRunId)
    .map((artifact) => normalizeDoubaoConversationUrl(artifact.conversationUrl))
    .filter((url): url is string => !!url))];
  if (urls.length === 0) return { ok: false, reason: 'CONVERSATION_URL_MISSING' };
  if (urls.length > 1) return { ok: false, reason: 'CONVERSATION_URL_AMBIGUOUS' };
  const conversationId = getDoubaoConversationId(urls[0]);
  return conversationId
    ? { ok: true, url: urls[0], conversationId, source: 'artifact' }
    : { ok: false, reason: 'CONVERSATION_URL_MISSING' };
}

/** 切换账号后有界等待该账号的常驻 WebView 完成注册和就绪。 */
export async function waitForConversationNavigator<T extends ConversationNavigator>(
  getNavigator: () => T | null | undefined,
  options: {
    timeoutMs?: number;
    intervalMs?: number;
    now?: () => number;
    wait?: (ms: number) => Promise<void>;
    isReady?: (navigator: T) => boolean;
  } = {},
): Promise<T | null> {
  const timeoutMs = options.timeoutMs ?? 20_000;
  const intervalMs = options.intervalMs ?? 250;
  const now = options.now ?? Date.now;
  const wait = options.wait ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const deadline = now() + timeoutMs;
  do {
    const navigator = getNavigator();
    if (navigator && (!options.isReady || options.isReady(navigator))) return navigator;
    if (now() >= deadline) break;
    await wait(Math.min(intervalMs, Math.max(0, deadline - now())));
  } while (now() <= deadline);
  return null;
}

/** 平台受理后有界等待根页被替换为具体会话地址。 */
export async function waitForConcreteConversationUrl(
  navigator: Pick<ConversationNavigator, 'getURL'>,
  options: { timeoutMs?: number; intervalMs?: number; now?: () => number; wait?: (ms: number) => Promise<void> } = {},
): Promise<string | null> {
  const timeoutMs = options.timeoutMs ?? 15_000;
  const intervalMs = options.intervalMs ?? 250;
  const now = options.now ?? Date.now;
  const wait = options.wait ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const deadline = now() + timeoutMs;
  do {
    const normalized = normalizeDoubaoConversationUrl(navigator.getURL());
    if (normalized) return normalized;
    if (now() >= deadline) break;
    await wait(Math.min(intervalMs, Math.max(0, deadline - now())));
  } while (now() <= deadline);
  return null;
}

/** 只导航或刷新已验证的具体会话，并在动作后重新核对会话身份。 */
export async function openTaskConversation(
  navigator: ConversationNavigator,
  targetUrl: string,
  options: {
    refreshIfAlreadyOpen?: boolean;
    timeoutMs?: number;
    intervalMs?: number;
    now?: () => number;
    wait?: (ms: number) => Promise<void>;
  } = {},
): Promise<ConversationNavigationResult> {
  const normalizedTarget = normalizeDoubaoConversationUrl(targetUrl);
  if (!normalizedTarget) return { ok: false, reason: 'INVALID_TARGET' };
  try {
    if (isSameDoubaoConversation(navigator.getURL(), normalizedTarget)) {
      if (!options.refreshIfAlreadyOpen) return { ok: true, url: normalizedTarget };
      navigator.reload();
    } else {
      navigator.loadURL(normalizedTarget);
    }
  } catch {
    return { ok: false, reason: 'NAVIGATION_TIMEOUT' };
  }

  const timeoutMs = options.timeoutMs ?? 20_000;
  const intervalMs = options.intervalMs ?? 250;
  const now = options.now ?? Date.now;
  const wait = options.wait ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const deadline = now() + timeoutMs;
  await wait(Math.min(intervalMs, timeoutMs));
  while (now() <= deadline) {
    if (isSameDoubaoConversation(navigator.getURL(), normalizedTarget)) return { ok: true, url: normalizedTarget };
    if (now() >= deadline) break;
    await wait(Math.min(intervalMs, Math.max(0, deadline - now())));
  }
  return { ok: false, reason: 'NAVIGATION_TIMEOUT' };
}
