export type MaterialAuthorizationState = 'absent' | 'present' | 'blocked';

export interface MaterialAuthorizationSnapshot {
  title: string;
  body: string;
  actions: readonly string[];
}

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
  const complete = title.includes('安全确认') && body.includes('上传、使用的素材') &&
    body.includes('充分授权') && actions.has('确认') && actions.has('拒绝');
  return complete ? 'present' : 'blocked';
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
