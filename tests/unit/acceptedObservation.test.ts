import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Task } from '../../src/types';
import {
  completeAcceptedObservation,
  createAcceptedObservationBinding,
  hasPlatformAcceptance,
  renewObservationLease,
  shouldResumeAcceptedObservation,
} from '../../src/utils/acceptedObservation';

const acceptedAt = '2026-09-10T08:00:00.000Z';

function binding() {
  return createAcceptedObservationBinding({
    accountId: 'account-1', runId: 'run-1', conversationUrl: 'https://www.doubao.com/chat/one',
    acceptedAt, ownerId: 'observer-run-1', mode: 'video', generationStartedAt: 123,
    evidence: { generationStarted: true, inputCleared: true, messageCount: 7, promptPublished: true },
  });
}

function task(status: Task['status'], acceptanceObservation = binding()): Task {
  return {
    id: 'task-1', prompt: 'secret prompt', assignedAccountId: 'account-1', status, mode: 'video',
    result: null, outputs: [], createdAt: acceptedAt, updatedAt: acceptedAt,
    runtime: {
      runId: 'run-1', attempt: 1, stage: 'generating', message: 'observing', startedAt: acceptedAt,
      stageStartedAt: acceptedAt, lastHeartbeatAt: acceptedAt,
      conversationUrl: acceptanceObservation?.conversationUrl, acceptanceObservation,
      input: { prompt: 'secret prompt', mode: 'video', attachments: ['D:/secret/image.png'] },
    },
  };
}

describe('accepted observation', () => {
  it('只保留受理观察所需的脱敏字段', () => {
    const value = binding();
    expect(value).toMatchObject({
      schemaVersion: 1, accountId: 'account-1', runId: 'run-1', outcome: 'observing',
      evidence: { kind: 'generation_started', messageCount: 7, generationStartedAt: 123 },
      cursor: { messageCount: 7, generationStartedAt: 123, pollCount: 0 },
      expectedArtifact: { kind: 'video', runId: 'run-1' },
    });
    expect(JSON.stringify(value)).not.toContain('secret prompt');
    expect(JSON.stringify(value)).not.toContain('secret/image');
  });

  it.each([
    ['material authorization', true, 'material_authorization_confirmed'],
    ['prompt published', false, 'prompt_published'],
  ] as const)('%s 生成正确证据类型', (_label, materialAuthorizationConfirmed, kind) => {
    const value = createAcceptedObservationBinding({
      accountId: 'a', runId: 'r', conversationUrl: 'https://www.doubao.com/chat/r', acceptedAt,
      ownerId: 'o', mode: 'chat', materialAuthorizationConfirmed,
      evidence: { generationStarted: false, inputCleared: true, messageCount: 1, promptPublished: true },
    });
    expect(value.evidence.kind).toBe(kind);
    expect(value.expectedArtifact.kind).toBe('file');
  });

  it('只有同一 run 的 observing 绑定或历史 done 满足平台受理', () => {
    expect(hasPlatformAcceptance(task('generating'))).toBe(true);
    expect(hasPlatformAcceptance(task('done', undefined as never))).toBe(true);
    const mismatch = binding(); mismatch.runId = 'old-run';
    expect(hasPlatformAcceptance(task('generating', mismatch))).toBe(false);
    const completed = binding(); completed.outcome = 'completed';
    expect(hasPlatformAcceptance(task('generating', completed))).toBe(false);
  });

  it('acceptance binding 必须使用具体会话且与 runtime 会话同步', () => {
    const value = task('generating');
    value.runtime!.conversationUrl = 'https://www.doubao.com/chat/other';
    expect(hasPlatformAcceptance(value)).toBe(false);
    value.runtime!.conversationUrl = 'https://www.doubao.com/chat/one';
    value.runtime!.acceptanceObservation!.conversationUrl = 'https://www.doubao.com/chat/';
    expect(hasPlatformAcceptance(value)).toBe(false);
    expect(() => createAcceptedObservationBinding({
      accountId: 'a', runId: 'r', conversationUrl: 'https://www.doubao.com/chat/', acceptedAt,
      ownerId: 'o', mode: 'video', evidence: { generationStarted: true, inputCleared: true, messageCount: 1, promptPublished: true },
    })).toThrow('具体的豆包会话 URL');
  });

  it('仅 generating + 有效受理绑定需要在重启后恢复观察', () => {
    expect(shouldResumeAcceptedObservation(task('generating'))).toBe(true);
    expect(shouldResumeAcceptedObservation(task('manual_submission_observing'))).toBe(false);
  });

  it('续租递增游标且完成时绑定稳定 artifact ID', () => {
    const renewed = renewObservationLease(binding(), '2026-09-10T08:00:15.000Z', 30_000);
    expect(renewed.cursor.pollCount).toBe(1);
    expect(renewed.lease.expiresAt).toBe('2026-09-10T08:00:45.000Z');
    const completed = completeAcceptedObservation(renewed, 'artifact-1', '2026-09-10T08:01:00.000Z');
    expect(completed).toMatchObject({ outcome: 'completed', completedAt: '2026-09-10T08:01:00.000Z', expectedArtifact: { artifactId: 'artifact-1' } });
  });
});

describe('accepted observation pipeline 接线契约', () => {
  const panel = readFileSync(resolve(__dirname, '../../src/components/BrowserPanel.tsx'), 'utf8');
  const store = readFileSync(resolve(__dirname, '../../src/store/useTaskStore.ts'), 'utf8');

  it('明确受理后先原子持久化并回读观察绑定，再触发 generating 队列', () => {
    const start = panel.indexOf('const acceptedAt = new Date().toISOString()');
    const end = panel.indexOf('let generating = true', start);
    const body = panel.slice(start, end);
    expect(start).toBeGreaterThan(0);
    expect(body.indexOf('createAcceptedObservationBinding')).toBeLessThan(body.indexOf('await updateTaskRuntime'));
    expect(body.indexOf('await updateTaskRuntime')).toBeLessThan(body.indexOf('persistedObservation'));
    expect(body.indexOf('persistedObservation')).toBeLessThan(body.indexOf("setAccountAutomationState(accountId, 'generating'"));
    expect(body).toContain('throw new SubmissionSafetyPauseError');
  });

  it('观察恢复只派发既有只读 reconcile，不调用第二套发送链路', () => {
    const start = panel.indexOf('应用重启或页面重新挂载后，只沿已持久化的原会话恢复观察');
    const end = panel.indexOf('// ---- 自动化执行 ----', start);
    const body = panel.slice(start, end);
    expect(body).toContain("new CustomEvent('reconcile-task-submission'");
    expect(body).not.toContain('submitPromptWithNativeClick');
    expect(body).not.toContain('injectPrompt');
  });

  it('同账号 observing 时主动跳过，Renderer reload 仅恢复观察', () => {
    expect(store).toContain('const accountHasObservation = state.tasks.some');
    expect(store).toContain('if (accountHasObservation) continue;');
    expect(store).toContain('const resumableObservations = tasks.filter(shouldResumeAcceptedObservation)');
    expect(store).toContain('!shouldResumeAcceptedObservation(task)');
    expect(panel).toMatch(/acceptedObservationActive\s*\? \{ status: 'manual_submission_observing'/);
  });
});
