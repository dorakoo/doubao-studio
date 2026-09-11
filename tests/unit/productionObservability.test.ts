import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  classifyMaterialAuthorizationSnapshot,
  decideMaterialAuthorizationAutoConfirm,
} from '../../src/utils/materialAuthorization';
import { InitializationGate } from '../../src/utils/initializationGate';
import {
  classifyUploadReadinessFailure,
  isUploadSnapshotReady,
} from '../../src/utils/uploadReadiness';
import { confirmMaterialAuthorizationIfAllowed } from '../../src/utils/doubaoBridge';
import { normalizeDoubaoConversationUrl } from '../../src/utils/taskConversationLocator';

describe('P0-1 素材授权精确白名单', () => {
  it.each([
    ['精确素材授权', { title: '安全确认', body: '上传、使用的素材均已充分授权', actions: ['拒绝', '确认'] }, 'present'],
    ['视频生成确认', { title: '安全确认', body: '视频生成参数确认，确认后开始生成视频', actions: ['拒绝', '确认'] }, 'blocked'],
    ['登录确认', { title: '安全确认', body: '请登录并确认上传、使用的素材均已充分授权', actions: ['拒绝', '确认'] }, 'blocked'],
    ['支付确认', { title: '安全确认', body: '确认支付额度，上传、使用的素材均已充分授权', actions: ['拒绝', '确认'] }, 'blocked'],
    ['按钮不全', { title: '安全确认', body: '上传、使用的素材均已充分授权', actions: ['确认'] }, 'blocked'],
  ] as const)('$0 → $2', (_name, snapshot, expected) => {
    expect(classifyMaterialAuthorizationSnapshot(snapshot)).toBe(expected);
  });

  it.each([
    [{ enabled: false }, 'disabled'],
    [{ state: 'blocked' as const }, 'not_whitelisted'],
    [{ currentUrl: 'https://www.doubao.com/chat/other' }, 'conversation_mismatch'],
    [{ assetsValidated: false }, 'assets_unverified'],
    [{ confirmPosition: undefined }, 'target_missing'],
  ])('任一门禁缺失均拒绝自动确认 %#', (override, reason) => {
    expect(decideMaterialAuthorizationAutoConfirm({
      enabled: true,
      state: 'present',
      currentUrl: 'https://www.doubao.com/chat/a',
      expectedConversationUrl: 'https://www.doubao.com/chat/a',
      assetsValidated: true,
      confirmPosition: '100,200',
      ...override,
    })).toEqual({ allowed: false, reason });
  });

  it('精确匹配时只执行一次原生点击并回读弹窗消失', async () => {
    const sendInputEvent = vi.fn();
    const snapshots = [
      { title: '安全确认', body: '上传、使用的素材均已充分授权', actions: ['拒绝', '确认'], confirmPosition: '100,200', visibleAttachmentCount: 1, pending: false },
      { title: '', body: '', actions: [], visibleAttachmentCount: 1, pending: false },
    ];
    const webview = {
      executeJavaScript: vi.fn(async () => snapshots.shift() || snapshots[1]),
      loadURL: vi.fn(),
      getURL: () => 'https://www.doubao.com/chat/a',
      sendInputEvent,
    };
    const result = await confirmMaterialAuthorizationIfAllowed(webview, {
      enabled: true, expectedConversationUrl: 'https://www.doubao.com/chat/a', assetsValidated: true,
    });
    expect(result.status).toBe('confirmed');
    expect(sendInputEvent).toHaveBeenCalledTimes(3);
  });
});

describe('P0-2 初始化闸门与慢上传', () => {
  it('初始化并发 1 时第二任务等待，首任务释放后获得租约', async () => {
    const gate = new InitializationGate();
    const first = await gate.acquire('a', { limit: 1 });
    let secondAcquired = false;
    const secondPromise = gate.acquire('b', { limit: 1 }).then((lease) => { secondAcquired = true; return lease; });
    await Promise.resolve();
    expect(secondAcquired).toBe(false);
    first.release();
    const second = await secondPromise;
    expect(secondAcquired).toBe(true);
    second.release();
  });

  it('上传中、数量不足和额外素材分别给出机器码，只有精确数量放行', () => {
    expect(classifyUploadReadinessFailure({ inputFileCount: 1, visibleAttachmentCount: 1, matchingFileNameCount: 1, pending: true }, 1, 0)).toBe('pending');
    expect(classifyUploadReadinessFailure({ inputFileCount: 0, visibleAttachmentCount: 1, matchingFileNameCount: 0, pending: false }, 2, 0)).toBe('count_incomplete');
    expect(classifyUploadReadinessFailure({ inputFileCount: 3, visibleAttachmentCount: 3, matchingFileNameCount: 3, pending: false }, 2, 0)).toBe('count_mismatch');
    expect(isUploadSnapshotReady({ inputFileCount: 2, visibleAttachmentCount: 2, matchingFileNameCount: 2, pending: false }, 2, 0)).toBe(true);
  });
});

describe('P0-3 人工提交只读观察边界', () => {
  const panel = readFileSync(resolve(__dirname, '../../src/components/BrowserPanel.tsx'), 'utf8');

  it('人工声明入口只接受具体豆包会话并进入独立状态', () => {
    expect(panel).toContain("status: 'manual_submission_observing'");
    expect(panel).toContain("stage: 'manual_submission_observing'");
    expect(panel).toContain('userConfirmedCurrentUrl');
    expect(normalizeDoubaoConversationUrl('https://www.doubao.com/chat/verified?from=manual'))
      .toBe('https://www.doubao.com/chat/verified');
    expect(normalizeDoubaoConversationUrl('https://www.doubao.com/chat/')).toBeNull();
  });

  it('只读核对函数不包含注入、发送或新建对话调用', () => {
    const start = panel.indexOf('const handleSubmissionReconcile');
    const end = panel.indexOf("window.addEventListener('mark-manual-submission'", start);
    const body = panel.slice(start, end);
    expect(body).not.toContain('injectPrompt(');
    expect(body).not.toContain('submitPromptWithNativeClick(');
    expect(body).not.toContain('startNewConversation(');
    expect(body).toContain('matchesSubmissionConversation');
    expect(body).toContain('resolveVideoArtifact');
  });

  it('观察超时进入 manual_review，不计入账号失败或自动冷却', () => {
    expect(panel).toContain("code: isManualObservation ? 'manual_review_required' : 'submission_uncertain'");
    const reconcileStart = panel.indexOf('const handleSubmissionReconcile');
    const reconcileEnd = panel.indexOf("window.addEventListener('mark-manual-submission'", reconcileStart);
    const reconcileBody = panel.slice(reconcileStart, reconcileEnd);
    expect(reconcileBody).not.toContain('recordAccountOutcome(accountId, \'failure\'');
    expect(reconcileBody).not.toContain('cooldownUntil');
  });
});
