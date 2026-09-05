import { describe, expect, it, vi } from 'vitest';
import type { WebContents } from 'electron';
import { ControlCommandBroker } from '../../main/control/ControlCommandBroker';

const command = {
  requestId: 'request-1234', action: 'start' as const,
  projectId: 'project-1', batchId: 'batch-1', taskId: 'task-1',
};

describe('ControlCommandBroker', () => {
  it('只接受当前主 Renderer 返回的命令结果', async () => {
    let sent: { commandId: string } | undefined;
    const renderer = { id: 7, isDestroyed: () => false, send: vi.fn((_channel, payload) => { sent = payload; }) } as unknown as WebContents;
    const broker = new ControlCommandBroker(() => renderer, 1000);
    expect(broker.markReady(renderer)).toBe(true);
    const pending = broker.dispatch(command);
    expect(sent).toBeDefined();
    const commandId = sent?.commandId || '';
    expect(broker.complete({ id: 8 } as WebContents, { commandId, ok: true, code: 'FORGED' })).toBe(false);
    expect(broker.complete(renderer, { commandId, ok: true, code: 'START_ACCEPTED', accepted: true })).toBe(true);
    await expect(pending).resolves.toMatchObject({ ok: true, code: 'START_ACCEPTED' });
  });

  it('Renderer 不存在时 fail-closed', async () => {
    const broker = new ControlCommandBroker(() => null);
    await expect(broker.dispatch(command)).resolves.toMatchObject({ ok: false, code: 'RENDERER_UNAVAILABLE' });
  });

  it('Renderer 尚未声明就绪时拒绝下发，伪造就绪信号无效', async () => {
    const renderer = { id: 7, isDestroyed: () => false, send: vi.fn() } as unknown as WebContents;
    const broker = new ControlCommandBroker(() => renderer);
    expect(broker.markReady({ id: 8 } as WebContents)).toBe(false);
    await expect(broker.dispatch(command)).resolves.toMatchObject({ ok: false, code: 'RENDERER_NOT_READY' });
    expect(renderer.send).not.toHaveBeenCalled();
  });

  it('关闭时拒绝所有未完成命令', async () => {
    const renderer = { id: 7, isDestroyed: () => false, send: vi.fn() } as unknown as WebContents;
    const broker = new ControlCommandBroker(() => renderer, 1000);
    broker.markReady(renderer);
    const pending = broker.dispatch(command);
    broker.close();
    await expect(pending).resolves.toMatchObject({ ok: false, code: 'CONTROL_SERVER_STOPPED' });
  });
});
