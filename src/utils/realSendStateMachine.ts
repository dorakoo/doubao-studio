/**
 * DOUBAO-TASK-REAL-SEND-RECOVERY-01：真实发送/回复终态判定纯逻辑（可测试，零 DOM）。
 *
 * P0-2/P0-3 纪律：
 *  - “输入框清空”不是成功证据；提交确认至少需要 promptPublished（提示词脱离输入框进入会话区）。
 *  - 助手回复证据 = 提交确认后基线文本（已含用户消息）之后的净增长；
 *    历史消息、欢迎语、推荐内容都落在基线内，不计为回复。
 *  - 终态完成必须同时满足：用户消息已进入会话区 + 基线后有新内容 + 稳定终态
 *    （网络明确结束且内容非空，或连续多次采样无变化）。
 */

export interface SubmissionReadback {
  generationStarted: boolean;
  inputCleared: boolean;
  messageCount: number;
  promptPublished: boolean;
}

/**
 * 每个运行只允许一次真实提交。
 *
 * expectedRunId 是执行器取得控制权时的运行标识；runtimeRunId/submittedAt 必须在
 * 真正发送前从持久化任务快照重新读取。运行已被替换、快照缺失或本运行已经留下
 * 提交意图时一律 fail-closed，避免重挂载/恢复/并发回调再次点击发送。
 */
export function canAttemptSubmission(
  expectedRunId: string | undefined,
  runtimeRunId: string | undefined,
  submittedAt: string | undefined,
): boolean {
  return Boolean(expectedRunId && runtimeRunId && expectedRunId === runtimeRunId && !submittedAt);
}

export interface SubmissionRecoveryTask {
  status?: string;
  runtime?: { submittedAt?: string };
  errorInfo?: { code?: string; message?: string };
  result?: string | null;
}

const LEGACY_UNCERTAIN_SUBMISSION = /发送按钮不可用|点击结果不确定|发送动作结果不确定|发送状态不确定|人工核对豆包会话/;

/**
 * 已留下提交意图且结果不确定的任务只能回读平台，绝不能重新进入发送流程。
 * 兼容修复前被错误记录为 cancelled 的任务，确保现场中的 C01-A 也被保护。
 */
export function requiresSubmissionReconciliation(task: SubmissionRecoveryTask | undefined): boolean {
  if (task?.status === 'waiting_generation_confirmation' || task?.status === 'manual_submission_observing') return true;
  if (!task?.runtime?.submittedAt) return false;
  if (!['paused', 'waiting_verification', 'waiting_generation_confirmation', 'manual_submission_observing', 'fail', 'cancelled'].includes(task.status || '')) return false;
  if (task.errorInfo?.code === 'submission_uncertain' || task.errorInfo?.code === 'generation_confirmation_required') return true;
  return LEGACY_UNCERTAIN_SUBMISSION.test(`${task.errorInfo?.message || ''} ${task.result || ''}`);
}

function canonicalizeSubmissionText(value: string): string {
  return (value || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
}

/** 豆包会把长视频提示词折叠成“生成视频：<稳定前缀>”，因此核对使用规范化前缀。 */
export function matchesSubmissionConversation(prompt: string, conversationText: string): boolean {
  const promptKey = canonicalizeSubmissionText(prompt).slice(0, 36);
  if (promptKey.length < 16) return false;
  const conversationKey = canonicalizeSubmissionText(conversationText);
  const hasPlatformReceipt = /视频生成已提交|你的视频生成好了|视频生成参数确认|确认后.{0,16}(?:开始|进行|为你)?生成视频/.test(conversationText);
  return hasPlatformReceipt && conversationKey.includes(promptKey);
}

/** 提交回读分类：confirmed = 已观察到页面回执（生成信号或提示词已发布）且输入框已清空。 */
export function classifySubmissionReadback(r: SubmissionReadback): 'confirmed' | 'not-confirmed' {
  const published = r.generationStarted || r.promptPublished;
  return published && r.inputCleared ? 'confirmed' : 'not-confirmed';
}

/** 会话文本相对基线的净增长（字符数；不含输入框内容由调用方保证）。 */
export function computeTextGrowth(baselineText: string, currentText: string): number {
  const base = baselineText || '';
  const cur = currentText || '';
  if (!base) return cur.length > 0 ? cur.length : 0;
  if (cur.startsWith(base)) return cur.length - base.length;
  // 基线被改写（页面局部重渲染）：以共同前缀之后的差值保守估计。
  let common = 0;
  const limit = Math.min(base.length, cur.length);
  while (common < limit && base[common] === cur[common]) common++;
  return cur.length - common;
}

export type TerminalDecision = 'completed' | 'waiting';

export interface TerminalSample {
  /** 提交确认后的会话文本基线（含用户消息） */
  baselineText: string;
  /** 当前会话文本（不含输入框） */
  currentText: string;
  /** 网络监听明确结束（endTime>0）且 sseDataCount>0 */
  networkFinished: boolean;
  /** data-message-id 增量（补充证据，不作为主证据） */
  messageCountDelta: number;
  /** 已连续多少次采样文本无变化 */
  stableStreak: number;
}

export const TERMINAL_STABLE_THRESHOLD = 2;

/**
 * P0-3 终态判定。
 * completed 必须同时满足：
 *  1. 基线后有净增长（新内容 = 助手回复候选；基线已排除欢迎语/推荐/历史）；
 *  2. 稳定终态：网络明确结束且内容非空，或 stableStreak >= 阈值（多次采样无变化）。
 * 其余一律 waiting（fail-closed：证据不足不得完成）。
 */
export function evaluateTerminal(sample: TerminalSample): TerminalDecision {
  const growth = computeTextGrowth(sample.baselineText, sample.currentText);
  const hasNewContent = growth >= 1;
  if (!hasNewContent) return 'waiting';
  const networkStable = sample.networkFinished;
  const textStable = sample.stableStreak >= TERMINAL_STABLE_THRESHOLD;
  if (networkStable || textStable) return 'completed';
  return 'waiting';
}

/** 更新连续稳定计数：文本未变化则递增，变化则归零。 */
export function updateStableStreak(prevText: string, currentText: string, prevStreak: number): number {
  if (prevText === currentText) return prevStreak + 1;
  return 0;
}
