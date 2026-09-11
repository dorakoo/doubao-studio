import { describe, expect, it, vi } from 'vitest';
import type { Task } from '../../src/types';
import {
  isSameDoubaoConversation,
  normalizeDoubaoConversationUrl,
  openTaskConversation,
  resolveTaskConversationTarget,
  supportsDoubaoConversationLocator,
  waitForConcreteConversationUrl,
  waitForConversationNavigator,
} from '../../src/utils/taskConversationLocator';

const task = (runtimeUrl?: string, artifacts: Task['artifacts'] = [], bindingUrl?: string): Pick<Task, 'runtime' | 'artifacts'> => ({
  runtime: {
    runId: 'run-1', conversationUrl: runtimeUrl,
    acceptanceObservation: bindingUrl ? {
      schemaVersion: 1, accountId: 'account-1', runId: 'run-1', conversationUrl: bindingUrl,
      acceptedAt: '2026-09-10T00:00:00.000Z', evidence: { kind: 'generation_started' },
      cursor: { messageCount: 1, pollCount: 0 }, expectedArtifact: { kind: 'video', runId: 'run-1' },
      lease: { ownerId: 'owner', acquiredAt: '2026-09-10T00:00:00.000Z', expiresAt: '2026-09-10T00:01:00.000Z', lastHeartbeatAt: '2026-09-10T00:00:00.000Z' },
      outcome: 'observing',
    } : undefined,
  } as Task['runtime'],
  artifacts,
});

describe('任务原会话定位', () => {
  it.each([
    undefined,
    'https://www.doubao.com/chat/',
    'https://www.doubao.com/chat',
    'https://evil.example/chat/123',
    'http://www.doubao.com/chat/123',
    'https://www.doubao.com:443/chat/123',
    'https://user:pass@www.doubao.com/chat/123',
  ])('拒绝非规范具体豆包会话 %s', (url) => {
    expect(normalizeDoubaoConversationUrl(url)).toBeNull();
  });

  it('规范化具体会话并剥离 query 和 hash', () => {
    expect(normalizeDoubaoConversationUrl('https://www.doubao.com/chat/38440700528737026?from=list#bottom'))
      .toBe('https://www.doubao.com/chat/38440700528737026');
    expect(isSameDoubaoConversation(
      'https://www.doubao.com/chat/38440700528737026?from=list',
      'https://www.doubao.com/chat/38440700528737026#bottom',
    )).toBe(true);
  });

  it('定位器只允许豆包账号，Dola 保持 fail-closed', () => {
    expect(supportsDoubaoConversationLocator('doubao')).toBe(true);
    expect(supportsDoubaoConversationLocator(undefined)).toBe(true);
    expect(supportsDoubaoConversationLocator('dola')).toBe(false);
  });

  it('优先使用 runtime 的具体会话', () => {
    expect(resolveTaskConversationTarget(task('https://www.doubao.com/chat/runtime-1')))
      .toMatchObject({ ok: true, source: 'runtime', conversationId: 'runtime-1' });
  });

  it('acceptance binding 与 runtime 同 run 同会话时可恢复', () => {
    expect(resolveTaskConversationTarget(task(
      'https://www.doubao.com/chat/current?from=runtime', [], 'https://www.doubao.com/chat/current#accepted',
    ))).toMatchObject({ ok: true, conversationId: 'current' });
  });

  it('acceptance binding URL 或 run 与 runtime 冲突时 fail-closed', () => {
    expect(resolveTaskConversationTarget(task(
      'https://www.doubao.com/chat/current', [], 'https://www.doubao.com/chat/other',
    ))).toEqual({ ok: false, reason: 'CONVERSATION_BINDING_CONFLICT' });
    const mismatched = task('https://www.doubao.com/chat/current', [], 'https://www.doubao.com/chat/current');
    mismatched.runtime!.acceptanceObservation!.runId = 'run-old';
    expect(resolveTaskConversationTarget(mismatched)).toEqual({ ok: false, reason: 'CONVERSATION_BINDING_CONFLICT' });
  });

  it('runtime 是根页时仅回退到当前 run 的唯一 artifact 会话', () => {
    expect(resolveTaskConversationTarget(task('https://www.doubao.com/chat/', [{
      id: 'a1', kind: 'video', source: 'network', url: 'https://media.example/a.mp4', runId: 'run-1',
      conversationUrl: 'https://www.doubao.com/chat/artifact-1', discoveredAt: '2026-09-01T00:00:00Z',
    }]))).toMatchObject({ ok: true, source: 'artifact', conversationId: 'artifact-1' });
  });

  it('当前 run 多个会话歧义或只有跨 run 候选时拒绝', () => {
    const artifacts = ['one', 'two'].map((id) => ({
      id, kind: 'video' as const, source: 'network' as const, url: `https://media.example/${id}.mp4`, runId: 'run-1',
      conversationUrl: `https://www.doubao.com/chat/${id}`, discoveredAt: '2026-09-01T00:00:00Z',
    }));
    expect(resolveTaskConversationTarget(task(undefined, artifacts)))
      .toEqual({ ok: false, reason: 'CONVERSATION_URL_AMBIGUOUS' });
    expect(resolveTaskConversationTarget(task(undefined, [{ ...artifacts[0], runId: 'run-old' }])))
      .toEqual({ ok: false, reason: 'CONVERSATION_URL_MISSING' });
  });

  it('缺少当前 run 时不从 artifact 猜测', () => {
    const value = task(undefined, [{
      id: 'a1', kind: 'video', source: 'network', url: 'https://media.example/a.mp4',
      conversationUrl: 'https://www.doubao.com/chat/artifact-1', discoveredAt: '2026-09-01T00:00:00Z',
    }]);
    value.runtime = undefined;
    expect(resolveTaskConversationTarget(value)).toEqual({ ok: false, reason: 'CONVERSATION_URL_MISSING' });
  });

  it('平台受理后有界等待根页变为具体会话', async () => {
    let now = 0;
    const urls = ['https://www.doubao.com/chat/', 'https://www.doubao.com/chat/', 'https://www.doubao.com/chat/target'];
    let index = 0;
    await expect(waitForConcreteConversationUrl(
      { getURL: () => urls[Math.min(index++, urls.length - 1)] },
      { timeoutMs: 1000, intervalMs: 100, now: () => now, wait: async (ms) => { now += ms; } },
    )).resolves.toBe('https://www.doubao.com/chat/target');
  });

  it('切换账号后等待对应 WebView 注册并就绪', async () => {
    let now = 0;
    let attempt = 0;
    const navigator = { getURL: () => '', loadURL: vi.fn(), reload: vi.fn() };
    const result = await waitForConversationNavigator(
      () => { attempt += 1; return attempt >= 2 ? navigator : undefined; },
      { timeoutMs: 1000, intervalMs: 100, now: () => now, wait: async (ms) => { now += ms; }, isReady: () => attempt >= 4 },
    );
    expect(result).toBe(navigator);
    expect(attempt).toBe(4);
  });

  it('WebView 未挂载时在边界时间失败', async () => {
    let now = 0;
    await expect(waitForConversationNavigator(
      () => undefined,
      { timeoutMs: 300, intervalMs: 100, now: () => now, wait: async (ms) => { now += ms; } },
    )).resolves.toBeNull();
    expect(now).toBe(300);
  });

  it('不在目标会话时只导航，不刷新也不具备发送能力', async () => {
    let now = 0;
    let current = 'https://www.doubao.com/chat/other';
    const loadURL = vi.fn((url: string) => { current = url; });
    const reload = vi.fn();
    const result = await openTaskConversation(
      { getURL: () => current, loadURL, reload }, 'https://www.doubao.com/chat/target',
      { timeoutMs: 1000, intervalMs: 100, now: () => now, wait: async (ms) => { now += ms; } },
    );
    expect(result.ok).toBe(true);
    expect(loadURL).toHaveBeenCalledOnce();
    expect(loadURL).toHaveBeenCalledWith('https://www.doubao.com/chat/target');
    expect(reload).not.toHaveBeenCalled();
  });

  it('已在目标会话时核对只刷新，不导航', async () => {
    let now = 0;
    const loadURL = vi.fn();
    const reload = vi.fn();
    const result = await openTaskConversation(
      { getURL: () => 'https://www.doubao.com/chat/target?from=task', loadURL, reload },
      'https://www.doubao.com/chat/target',
      { refreshIfAlreadyOpen: true, timeoutMs: 1000, intervalMs: 100, now: () => now, wait: async (ms) => { now += ms; } },
    );
    expect(result.ok).toBe(true);
    expect(reload).toHaveBeenCalledOnce();
    expect(loadURL).not.toHaveBeenCalled();
  });

  it('非法目标和导航异常都 fail-closed', async () => {
    const loadURL = vi.fn(() => { throw new Error('guest gone'); });
    const reload = vi.fn();
    await expect(openTaskConversation(
      { getURL: () => 'https://www.doubao.com/chat/current', loadURL, reload }, 'https://www.doubao.com/chat/',
    )).resolves.toEqual({ ok: false, reason: 'INVALID_TARGET' });
    await expect(openTaskConversation(
      { getURL: () => 'https://www.doubao.com/chat/current', loadURL, reload }, 'https://www.doubao.com/chat/target',
    )).resolves.toEqual({ ok: false, reason: 'NAVIGATION_TIMEOUT' });
    expect(reload).not.toHaveBeenCalled();
  });
});
