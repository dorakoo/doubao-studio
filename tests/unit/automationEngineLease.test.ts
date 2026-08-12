import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AutomationEngine } from '../../src/automation/AutomationEngine';

const acquireLock = vi.fn();
const renewLock = vi.fn();
const releaseLock = vi.fn();

describe('AutomationEngine 租约心跳', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    acquireLock.mockReset().mockResolvedValue({ success: true });
    renewLock.mockReset().mockResolvedValue({ success: true });
    releaseLock.mockReset().mockResolvedValue({ success: true });
    vi.stubGlobal('window', {
      electronAPI: { tasks: { acquireLock, renewLock, releaseLock } },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('持锁期间每 30 秒续租，释放后停止心跳并携带 owner', async () => {
    const engine = new AutomationEngine();
    await engine.reserve('task-1', 'account-1', 'owner-1');
    await vi.advanceTimersByTimeAsync(30_000);
    expect(renewLock).toHaveBeenCalledWith('task-1', 'owner-1');

    await engine.release('task-1');
    expect(releaseLock).toHaveBeenCalledWith('task-1', 'owner-1');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(renewLock).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['返回失败', () => renewLock.mockResolvedValueOnce({ success: false, error: 'lost' })],
    ['IPC 抛错', () => renewLock.mockRejectedValueOnce(new Error('offline'))],
  ])('%s 时中止控制器并释放本地 reservation', async (_label, arrange) => {
    const engine = new AutomationEngine();
    await engine.reserve('task-2', 'account-2', 'owner-2');
    const controller = engine.createController('task-2', 'account-2');
    const abortSpy = vi.spyOn(controller, 'abort');
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    arrange();

    await vi.advanceTimersByTimeAsync(30_000);

    expect(abortSpy).toHaveBeenCalledOnce();
    expect(engine.isReserved('task-2')).toBe(false);
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('任务租约续租失败'));
    consoleSpy.mockRestore();
  });
});
