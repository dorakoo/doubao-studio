export interface InitializationLease {
  waitedMs: number;
  release: () => void;
}

interface Waiter {
  taskId: string;
  enqueuedAt: number;
  signal?: AbortSignal;
  resolve: (lease: InitializationLease) => void;
  reject: (error: Error) => void;
}

/**
 * 仅限制页面高冲突初始化区；任务进入 generating 后调用 release，生成阶段不占槽。
 */
export class InitializationGate {
  private active = new Set<string>();
  private waiters: Waiter[] = [];
  private limit = 1;

  async acquire(taskId: string, options: { limit?: number; signal?: AbortSignal } = {}): Promise<InitializationLease> {
    this.limit = Math.max(1, Math.min(3, Math.floor(options.limit || 1)));
    if (options.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    return new Promise<InitializationLease>((resolve, reject) => {
      const waiter: Waiter = { taskId, enqueuedAt: Date.now(), signal: options.signal, resolve, reject };
      const onAbort = () => {
        this.waiters = this.waiters.filter((item) => item !== waiter);
        reject(new DOMException('Aborted', 'AbortError'));
      };
      options.signal?.addEventListener('abort', onAbort, { once: true });
      const originalResolve = waiter.resolve;
      waiter.resolve = (lease) => {
        options.signal?.removeEventListener('abort', onAbort);
        originalResolve(lease);
      };
      this.waiters.push(waiter);
      this.drain();
    });
  }

  private drain(): void {
    while (this.active.size < this.limit && this.waiters.length > 0) {
      const waiter = this.waiters.shift()!;
      if (waiter.signal?.aborted) continue;
      this.active.add(waiter.taskId);
      let released = false;
      waiter.resolve({
        waitedMs: Date.now() - waiter.enqueuedAt,
        release: () => {
          if (released) return;
          released = true;
          this.active.delete(waiter.taskId);
          this.drain();
        },
      });
    }
  }
}

export const initializationGate = new InitializationGate();
