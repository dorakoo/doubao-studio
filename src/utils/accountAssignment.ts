import type { Account, GenerationMode, VideoDuration } from '../types';
import { getAutomaticSchedulingBlockReason } from './schedulingScore';
import { getVideoQuotaUsageUnits } from './videoQuota';

export interface ManualAssignmentOption {
  value: string;
  label: string;
  automaticBlockReason: string | null;
}

/** 手动指派始终列出全部现存账号；自动调度阻塞只作为说明，不删除选项。 */
export function buildManualAssignmentOptions(
  accounts: readonly Account[],
  mode: GenerationMode,
  duration?: VideoDuration,
  now: number = Date.now(),
): ManualAssignmentOption[] {
  const requiredUnits = mode === 'video' ? getVideoQuotaUsageUnits(duration) : 1;
  return accounts.map((account) => {
    const automaticBlockReason = getAutomaticSchedulingBlockReason(account, mode, requiredUnits, 0, now);
    const platform = (account.platform || 'doubao') === 'dola' ? 'Dola' : '豆包';
    return {
      value: account.id,
      label: `${account.name} · ${platform}${automaticBlockReason ? ` · ${automaticBlockReason}` : ''}`,
      automaticBlockReason,
    };
  });
}
