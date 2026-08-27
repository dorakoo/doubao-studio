export type PromotionalPopupAction = 'snooze' | 'close' | null;

function normalize(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/** 只认豆包“下载电脑版 / 使用完整功能”推广，不把业务确认弹窗纳入自动关闭。 */
export function isDesktopDownloadPromotionText(value: string): boolean {
  const text = normalize(value);
  return text.includes('下载电脑版') && text.includes('使用完整功能');
}

/** 优先使用页面明确提供的“下次提醒我”，关闭按钮仅作为同一白名单弹窗的兜底。 */
export function chooseDesktopDownloadPromotionAction(labels: readonly string[]): PromotionalPopupAction {
  const normalized = labels.map(normalize);
  if (normalized.includes('下次提醒我')) return 'snooze';
  if (normalized.some((label) => label === '关闭' || label === '关闭弹窗')) return 'close';
  return null;
}
