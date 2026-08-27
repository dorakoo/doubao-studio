import { describe, expect, it, vi } from 'vitest';
import { resolveRendererStartupTarget } from '../../main/utils/rendererStartup';
import { useAccountStore } from '../../src/store/useAccountStore';
import { resolveStartupAccountId } from '../../src/utils/accountStartupSelection';
import '../../src/types/electron.d.ts';

describe('豆包工作室启动恢复', () => {
  it('冷启动优先选择首个置顶账号，使右侧 webview 无需人工点击即可显示', () => {
    expect(resolveStartupAccountId([
      { id: 'first', pinned: false },
      { id: 'pinned', pinned: true },
      { id: 'other', pinned: true },
    ], null)).toBe('pinned');
  });

  it('账号 IPC 恢复完成后由 Store 自动建立当前选择', async () => {
    vi.stubGlobal('window', {
      electronAPI: {
        accounts: {
          list: vi.fn().mockResolvedValue([
            {
              id: 'first', name: '普通账号', avatar: '', partition: 'persist:first',
              status: 'active', pinned: false, createdAt: '2026-08-27T00:00:00.000Z',
              updatedAt: '2026-08-27T00:00:00.000Z',
            },
            {
              id: 'pinned', name: '置顶账号', avatar: '', partition: 'persist:pinned',
              status: 'active', pinned: true, createdAt: '2026-08-27T00:00:00.000Z',
              updatedAt: '2026-08-27T00:00:00.000Z',
            },
          ]),
        },
      },
    });
    useAccountStore.setState({ accounts: [], selectedAccountId: null, loading: false, error: null });

    await useAccountStore.getState().loadAccounts();

    expect(useAccountStore.getState().selectedAccountId).toBe('pinned');
    expect(useAccountStore.getState().accounts).toHaveLength(2);
    vi.unstubAllGlobals();
  });

  it('热恢复保留仍存在的当前账号；失效选择回退首个账号', () => {
    const accounts = [{ id: 'first', pinned: false }, { id: 'second', pinned: false }];
    expect(resolveStartupAccountId(accounts, 'second')).toBe('second');
    expect(resolveStartupAccountId(accounts, 'missing')).toBe('first');
    expect(resolveStartupAccountId([], 'missing')).toBeNull();
  });

  it('标准开发启动只接受注入地址，直接 electron 启动返回可见诊断页', () => {
    expect(resolveRendererStartupTarget(false, 'http://127.0.0.1:5173', 'D:/app/dist/main'))
      .toEqual({ kind: 'url', value: 'http://127.0.0.1:5173' });
    const missing = resolveRendererStartupTarget(false, undefined, 'D:/app/dist/main');
    expect(missing.kind).toBe('diagnostic');
    expect(missing.value).toContain('data:text/html');
    expect(decodeURIComponent(missing.value)).toContain('pnpm run dev');
  });

  it('打包版始终使用 renderer 文件，不依赖开发服务器', () => {
    const target = resolveRendererStartupTarget(true, undefined, 'D:/app/dist/main');
    expect(target.kind).toBe('file');
    expect(target.value.replace(/\\/g, '/')).toBe('D:/app/dist/renderer/index.html');
  });
});
