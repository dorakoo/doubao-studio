import { describe, expect, it, vi } from 'vitest';
import { createWebviewResourceScope } from '../../src/utils/webviewLifecycle';

describe('webview 资源作用域', () => {
  it('dispose 注销全部监听器、清理定时器且可重复调用', () => {
    vi.useFakeTimers();
    const target = {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };
    const listener = vi.fn();
    const scope = createWebviewResourceScope();
    scope.listen(target, 'dom-ready', listener);
    scope.trackTimer(setInterval(listener, 1_000));
    scope.trackTimer(setTimeout(listener, 2_000));

    scope.dispose();
    scope.dispose();
    vi.advanceTimersByTime(3_000);

    expect(scope.active).toBe(false);
    expect(target.removeEventListener).toHaveBeenCalledOnce();
    expect(target.removeEventListener).toHaveBeenCalledWith('dom-ready', listener);
    expect(listener).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('clearTimer 只停止指定 timer，clearTimers 停止其余 timer', () => {
    vi.useFakeTimers();
    const first = vi.fn();
    const second = vi.fn();
    const scope = createWebviewResourceScope();
    const firstTimer = setTimeout(first, 1_000);
    const secondTimer = setTimeout(second, 1_000);
    scope.trackTimer(firstTimer);
    scope.trackTimer(secondTimer);

    scope.clearTimer(firstTimer);
    vi.advanceTimersByTime(1_000);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledOnce();
    scope.clearTimers();
    scope.dispose();
    vi.useRealTimers();
  });

  it('释放后拒绝注册新监听器，并立即清除新 timer', () => {
    vi.useFakeTimers();
    const listener = vi.fn();
    const target = { addEventListener: vi.fn(), removeEventListener: vi.fn() };
    const scope = createWebviewResourceScope();
    scope.dispose();

    expect(() => scope.listen(target, 'load', listener)).toThrow('webview 资源作用域已释放');
    scope.trackTimer(setTimeout(listener, 1_000));
    vi.advanceTimersByTime(1_000);
    expect(listener).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});
