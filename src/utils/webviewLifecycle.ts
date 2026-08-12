export interface WebviewEventTarget {
  addEventListener(type: string, listener: EventListenerOrEventListenerObject): void;
  removeEventListener(type: string, listener: EventListenerOrEventListenerObject): void;
}

type TimerHandle = number | ReturnType<typeof setTimeout> | ReturnType<typeof setInterval>;

export interface WebviewResourceScope {
  readonly active: boolean;
  listen(target: WebviewEventTarget, type: string, listener: EventListenerOrEventListenerObject): void;
  trackTimer(timer: TimerHandle): void;
  clearTimer(timer: TimerHandle | undefined): void;
  clearTimers(): void;
  dispose(): void;
}

/** 将单个 webview 的监听器和定时器绑定为一个可幂等释放的资源作用域。 */
export function createWebviewResourceScope(): WebviewResourceScope {
  const listeners: Array<{
    target: WebviewEventTarget;
    type: string;
    listener: EventListenerOrEventListenerObject;
  }> = [];
  const timers = new Set<TimerHandle>();
  let active = true;

  const clearTimer = (timer: TimerHandle | undefined): void => {
    if (timer === undefined) return;
    clearInterval(timer);
    clearTimeout(timer);
    timers.delete(timer);
  };

  const clearTimers = (): void => {
    for (const timer of [...timers]) clearTimer(timer);
  };

  return {
    get active() {
      return active;
    },
    listen(target, type, listener) {
      if (!active) throw new Error('webview 资源作用域已释放');
      target.addEventListener(type, listener);
      listeners.push({ target, type, listener });
    },
    trackTimer(timer) {
      if (!active) {
        clearTimer(timer);
        return;
      }
      timers.add(timer);
    },
    clearTimer,
    clearTimers,
    dispose() {
      if (!active) return;
      active = false;
      clearTimers();
      for (const { target, type, listener } of listeners.splice(0)) {
        target.removeEventListener(type, listener);
      }
    },
  };
}
