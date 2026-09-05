import { describe, expect, it } from 'vitest';
import { getWebviewHydrationAccountIds } from '../../src/utils/webviewHydration';

const accounts = [{ id: 'account-a' }, { id: 'account-b' }, { id: 'account-c' }];

describe('webview 按需挂载策略', () => {
  it('启动时只挂载当前账号，避免全部账号并发加载', () => {
    expect(getWebviewHydrationAccountIds(accounts, 'account-a', {})).toEqual(['account-a']);
  });

  it('切换账号时返回新的当前账号', () => {
    expect(getWebviewHydrationAccountIds(accounts, 'account-b', {})).toEqual(['account-b']);
  });

  it('并行任务账号即使在后台也会被挂载', () => {
    expect(getWebviewHydrationAccountIds(accounts, 'account-a', {
      'account-b': 'task-b',
      'account-c': 'task-c',
    })).toEqual(['account-a', 'account-b', 'account-c']);
  });

  it('忽略已删除账号与空执行记录', () => {
    expect(getWebviewHydrationAccountIds(accounts, null, {
      'account-a': '',
      missing: 'task-x',
    })).toEqual([]);
  });
});
