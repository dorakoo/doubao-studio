export type MaterialAuthorizationState = 'absent' | 'present' | 'blocked';

export interface MaterialAuthorizationSnapshot {
  title: string;
  body: string;
  actions: readonly string[];
}

export const MATERIAL_AUTHORIZATION_FINGERPRINT = 'doubao-material-authorization-v1' as const;

const FORBIDDEN_CONFIRMATION_TEXT = /视频生成参数确认|确认后.{0,24}(?:开始|进行|为你)?生成视频|验证码|人机验证|登录|支付|购买|订阅|额度|开通会员/;

/** 严格识别平台素材授权承诺；结构不完整时 fail-closed。 */
export function classifyMaterialAuthorizationSnapshot(
  snapshot: MaterialAuthorizationSnapshot,
): MaterialAuthorizationState {
  const title = snapshot.title.replace(/\s+/g, ' ').trim();
  const body = snapshot.body.replace(/\s+/g, ' ').trim();
  const actions = new Set(snapshot.actions.map((action) => action.replace(/\s+/g, ' ').trim()));
  // 页面其它业务弹窗也可能有“确认/拒绝”按钮，动作文字本身不能成为素材授权信号。
  const hasAnySignal = title.includes('安全确认') || body.includes('上传、使用的素材');
  if (!hasAnySignal) return 'absent';
  const complete = !FORBIDDEN_CONFIRMATION_TEXT.test(`${title} ${body}`) &&
    title.includes('安全确认') && body.includes('上传、使用的素材') &&
    body.includes('充分授权') && actions.has('确认') && actions.has('拒绝');
  return complete ? 'present' : 'blocked';
}

export interface MaterialAuthorizationAutoConfirmInput {
  enabled: boolean;
  state: MaterialAuthorizationState;
  currentUrl: string;
  expectedConversationUrl: string;
  assetsValidated: boolean;
  confirmPosition?: string;
}

export type MaterialAuthorizationAutoConfirmDecision =
  | { allowed: true; fingerprint: typeof MATERIAL_AUTHORIZATION_FINGERPRINT }
  | { allowed: false; reason: 'disabled' | 'not_whitelisted' | 'conversation_mismatch' | 'assets_unverified' | 'target_missing' };

/** 自动确认前的纯判定：任何不完整证据均 fail-closed。 */
export function decideMaterialAuthorizationAutoConfirm(
  input: MaterialAuthorizationAutoConfirmInput,
): MaterialAuthorizationAutoConfirmDecision {
  if (!input.enabled) return { allowed: false, reason: 'disabled' };
  if (input.state !== 'present') return { allowed: false, reason: 'not_whitelisted' };
  if (!input.expectedConversationUrl || input.currentUrl !== input.expectedConversationUrl) {
    return { allowed: false, reason: 'conversation_mismatch' };
  }
  if (!input.assetsValidated) return { allowed: false, reason: 'assets_unverified' };
  if (!/^\d+(?:\.\d+)?,\d+(?:\.\d+)?$/.test(input.confirmPosition || '')) {
    return { allowed: false, reason: 'target_missing' };
  }
  return { allowed: true, fingerprint: MATERIAL_AUTHORIZATION_FINGERPRINT };
}

export type MaterialAuthorizationProgress = 'waiting' | 'confirmed' | 'uncertain' | 'timeout';

export function decideMaterialAuthorizationProgress(input: {
  dialogState: MaterialAuthorizationState;
  submissionConfirmed: boolean;
  elapsedMs: number;
  timeoutMs: number;
}): MaterialAuthorizationProgress {
  if (input.submissionConfirmed) return 'confirmed';
  if (input.elapsedMs >= input.timeoutMs) return 'timeout';
  if (input.dialogState === 'present') return 'waiting';
  return 'uncertain';
}
