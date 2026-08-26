import { describe, expect, it } from 'vitest';
import { buildManualAssignmentOptions } from '../../src/utils/accountAssignment';
import type { Account } from '../../src/types';

const NOW = new Date('2026-08-24T10:00:00.000Z').getTime();

function account(overrides: Partial<Account>): Account {
  return {
    id: 'account-1', name: '失败账号', avatar: '', partition: 'one', platform: 'doubao',
    status: 'idle', pinned: false, createdAt: new Date(NOW).toISOString(), updatedAt: new Date(NOW).toISOString(),
    ...overrides,
  };
}

describe('手动指派账号选项', () => {
  it('连续失败进入自动冷却后仍保留账号选项并显示原因', () => {
    const cooldownUntil = new Date(NOW + 30 * 60_000).toISOString();
    const options = buildManualAssignmentOptions([
      account({ health: { loginState: 'ok', verificationRequired: false, consecutiveFailures: 3, successCount: 0, failureCount: 3, cooldownUntil } }),
    ], 'chat', undefined, NOW);
    expect(options).toHaveLength(1);
    expect(options[0].value).toBe('account-1');
    expect(options[0].automaticBlockReason).toBe('自动冷却中');
    expect(options[0].label).toContain('失败账号');
  });

  it('Dola 账号和额度不足账号均不从手动列表消失', () => {
    const options = buildManualAssignmentOptions([
      account({ id: 'dola-1', name: 'Dola号', platform: 'dola' }),
      account({ id: 'quota-1', name: '余额号', seedanceQuota: { date: '2026-08-24', usedUnits: 5, estimatedTotalUnits: 6, exhausted: false, updatedAt: new Date(NOW).toISOString() } }),
    ], 'video', '10s', NOW);
    expect(options.map((item) => item.value)).toEqual(['dola-1', 'quota-1']);
    expect(options[0].label).toContain('Dola');
    expect(options[1].automaticBlockReason).toContain('额度不足');
  });
});
