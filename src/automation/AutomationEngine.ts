interface Reservation {
  taskId: string;
  accountId: string;
  ownerId: string;
  controller?: AbortController;
}

class AutomationEngine {
  private reservations = new Map<string, Reservation>();
  private accountTasks = new Map<string, string>();

  async reserve(taskId: string, accountId: string, ownerId: string): Promise<{ ok: boolean; error?: string }> {
    const accountTask = this.accountTasks.get(accountId);
    if (accountTask && accountTask !== taskId) return { ok: false, error: '该账号已有执行中的任务' };
    const existing = this.reservations.get(taskId);
    if (existing) return existing.ownerId === ownerId ? { ok: true } : { ok: false, error: '任务已在运行' };

    this.reservations.set(taskId, { taskId, accountId, ownerId });
    this.accountTasks.set(accountId, taskId);
    const result = await window.electronAPI.tasks.acquireLock(taskId, ownerId);
    if (!result.success) {
      this.reservations.delete(taskId);
      if (this.accountTasks.get(accountId) === taskId) this.accountTasks.delete(accountId);
      return { ok: false, error: result.error || '任务锁定失败' };
    }
    return { ok: true };
  }

  createController(taskId: string, accountId: string): AbortController {
    const reservation = this.reservations.get(taskId);
    if (!reservation || reservation.accountId !== accountId) {
      throw new Error('任务尚未获得执行锁');
    }
    reservation.controller?.abort();
    reservation.controller = new AbortController();
    return reservation.controller;
  }

  abort(taskId: string): boolean {
    const reservation = this.reservations.get(taskId);
    if (!reservation?.controller) return false;
    reservation.controller.abort();
    return true;
  }

  isReserved(taskId: string): boolean {
    return this.reservations.has(taskId);
  }

  async release(taskId: string): Promise<void> {
    const reservation = this.reservations.get(taskId);
    if (!reservation) {
      await window.electronAPI.tasks.releaseLock(taskId);
      return;
    }
    this.reservations.delete(taskId);
    if (this.accountTasks.get(reservation.accountId) === taskId) this.accountTasks.delete(reservation.accountId);
    await window.electronAPI.tasks.releaseLock(taskId, reservation.ownerId);
  }
}

export const automationEngine = new AutomationEngine();
