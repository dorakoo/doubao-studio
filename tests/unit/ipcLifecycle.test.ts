import { describe, expect, it, vi } from 'vitest';
import { replaceIpcHandlers } from '../../main/ipc/lifecycle';

describe('IPC handler 生命周期', () => {
  it('注册前移除同名旧 handler，disposer 可重复调用', () => {
    const registry = { removeHandler: vi.fn() };
    const dispose = replaceIpcHandlers(registry, ['alpha', 'beta']);

    expect(registry.removeHandler.mock.calls).toEqual([['alpha'], ['beta']]);
    dispose();
    dispose();

    expect(registry.removeHandler.mock.calls).toEqual([
      ['alpha'], ['beta'], ['alpha'], ['beta'],
    ]);
  });

  it('旧注册批次的 disposer 不会移除后来替换的新 handler', () => {
    const registry = { removeHandler: vi.fn() };
    const disposeOld = replaceIpcHandlers(registry, ['shared']);
    const disposeNew = replaceIpcHandlers(registry, ['shared']);

    disposeOld();
    expect(registry.removeHandler).toHaveBeenCalledTimes(2);

    disposeNew();
    expect(registry.removeHandler).toHaveBeenCalledTimes(3);
  });

  it.each([
    ['重复 channel', ['same', 'same']],
    ['空 channel', ['valid', '']],
  ])('%s 时 fail-closed', (_label, channels) => {
    const registry = { removeHandler: vi.fn() };
    expect(() => replaceIpcHandlers(registry, channels)).toThrow('IPC channel 清单必须为非空且不可重复');
    expect(registry.removeHandler).not.toHaveBeenCalled();
  });
});
