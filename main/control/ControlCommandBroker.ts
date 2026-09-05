import { randomUUID } from 'crypto';
import type { WebContents } from 'electron';
import type { ControlCommandResult, ControlTaskCommand } from './controlTypes';

type Pending = {
  resolve: (result: ControlCommandResult) => void;
  timer: NodeJS.Timeout;
};

export class ControlCommandBroker {
  private readonly pending = new Map<string, Pending>();
  private rendererReady = false;

  constructor(
    private readonly getRenderer: () => WebContents | null,
    private readonly timeoutMs = 10_000,
  ) {}

  dispatch(command: Omit<ControlTaskCommand, 'commandId'>): Promise<ControlCommandResult> {
    const renderer = this.getRenderer();
    if (!renderer || renderer.isDestroyed()) {
      return Promise.resolve({ commandId: '', ok: false, code: 'RENDERER_UNAVAILABLE' });
    }
    if (!this.rendererReady) {
      return Promise.resolve({ commandId: '', ok: false, code: 'RENDERER_NOT_READY' });
    }
    const commandId = randomUUID();
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(commandId);
        resolve({ commandId, ok: false, code: 'RENDERER_TIMEOUT' });
      }, this.timeoutMs);
      this.pending.set(commandId, { resolve, timer });
      renderer.send('control:command', { ...command, commandId });
    });
  }

  markReady(sender: WebContents): boolean {
    const renderer = this.getRenderer();
    if (!renderer || renderer.isDestroyed() || sender.id !== renderer.id) return false;
    this.rendererReady = true;
    return true;
  }

  markUnavailable(): void {
    this.rendererReady = false;
  }

  isReady(): boolean {
    const renderer = this.getRenderer();
    return this.rendererReady && !!renderer && !renderer.isDestroyed();
  }

  complete(sender: WebContents, result: ControlCommandResult): boolean {
    const renderer = this.getRenderer();
    if (!renderer || sender.id !== renderer.id || !result?.commandId) return false;
    const pending = this.pending.get(result.commandId);
    if (!pending) return false;
    clearTimeout(pending.timer);
    this.pending.delete(result.commandId);
    pending.resolve(result);
    return true;
  }

  close(): void {
    this.rendererReady = false;
    for (const [commandId, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.resolve({ commandId, ok: false, code: 'CONTROL_SERVER_STOPPED' });
    }
    this.pending.clear();
  }
}
