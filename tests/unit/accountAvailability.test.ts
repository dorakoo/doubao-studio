import { describe, expect, it, vi } from 'vitest';
import {
  availabilityBlocksAutomation,
  classifyAccountAvailability,
  getAccountWarmupSortRank,
  probeAccountAvailability,
  requireStartupAvailabilityRecheck,
} from '../../src/utils/accountAvailability';

const CHECKED_AT = '2026-08-24T10:00:00.000Z';

describe('账号自动化可用性检测', () => {
  it('账号列表按已可用、已检测需处理、尚未预热的顺序排列', () => {
    expect(getAccountWarmupSortRank({ state: 'ready' })).toBe(0);
    for (const state of ['action_required', 'login_required', 'unavailable'] as const) {
      expect(getAccountWarmupSortRank({ state })).toBe(1);
    }
    expect(getAccountWarmupSortRank({ state: 'unknown' })).toBe(2);
    expect(getAccountWarmupSortRank(undefined)).toBe(2);
  });

  it.each([
    ['doubao', 'https://www.doubao.com/chat/', true, true],
    ['dola', 'https://www.dola.com/chat', true, false],
  ] as const)('%s 页面满足对应登录证据时判定 ready', (platform, url, hasUsableEditor, hasAuthenticatedControl) => {
    const result = classifyAccountAvailability({
      platform, url, hasUsableEditor, hasAuthenticatedControl, documentReady: true,
    }, 'startup', CHECKED_AT);
    expect(result).toMatchObject({ state: 'ready', reason: 'ready', source: 'startup', checkedAt: CHECKED_AT });
  });

  it.each([
    { iframeSources: ['https://verify.example/secsdk/captcha'], visibleLayerText: '' },
    { iframeSources: [], visibleLayerText: '请完成验证，拖动滑块' },
  ])('可见验证码证据判定 action_required', (extra) => {
    const result = classifyAccountAvailability({
      platform: 'doubao', url: 'https://www.doubao.com/chat/', documentReady: true, ...extra,
    }, 'navigation', CHECKED_AT);
    expect(result).toMatchObject({ state: 'action_required', reason: 'human_verification' });
  });

  it.each([
    { url: 'https://www.doubao.com/login', bodyText: '' },
    { url: 'https://www.doubao.com/chat/', bodyText: '请先登录，手机号登录' },
  ])('登录入口或明确登录文案判定 login_required', ({ url, bodyText }) => {
    const result = classifyAccountAvailability({
      platform: 'doubao', url, bodyText, hasUsableEditor: false, documentReady: true,
    }, 'pre_task', CHECKED_AT);
    expect(result).toMatchObject({ state: 'login_required', reason: 'login_required' });
  });

  it('匿名页即使有输入框，只要存在明确登录按钮仍判定 login_required', () => {
    const result = classifyAccountAvailability({
      platform: 'doubao', url: 'https://www.doubao.com/chat/', hasUsableEditor: true,
      hasLoginControl: true, documentReady: true,
    }, 'startup', CHECKED_AT);
    expect(result).toMatchObject({ state: 'login_required', reason: 'login_required' });
  });

  it('探针源码覆盖新版普通 div/span 登录入口', async () => {
    let script = '';
    await probeAccountAvailability({
      getURL: () => 'https://www.doubao.com/chat/',
      executeJavaScript: async (code) => {
        script = code;
        return { hasUsableEditor: true, hasLoginControl: true, documentReady: true };
      },
    }, 'doubao', 'pre_task', 100);
    expect(script).toContain("button, a, [role=\"button\"], div, span");
    expect(script).toContain('childHasSameText');
  });

  it('豆包输入框先于账号壳渲染时保持 unknown，不会误判 ready', () => {
    const result = classifyAccountAvailability({
      platform: 'doubao', url: 'https://www.doubao.com/chat/', hasUsableEditor: true,
      hasLoginControl: false, hasAuthenticatedControl: false, documentReady: true,
    }, 'startup', CHECKED_AT);
    expect(result).toMatchObject({ state: 'unknown', reason: 'authentication_unconfirmed' });
  });

  it('Dola 地区限制页面 fail-closed', () => {
    const result = classifyAccountAvailability({
      platform: 'dola', url: 'https://www.dola.com/security/region-restricted', documentReady: true,
    }, 'startup', CHECKED_AT);
    expect(result).toMatchObject({ state: 'unavailable', reason: 'region_restricted' });
  });

  it('跨平台页面判定 platform_mismatch', () => {
    const result = classifyAccountAvailability({
      platform: 'dola', url: 'https://www.doubao.com/chat/', hasUsableEditor: true,
    }, 'pre_task', CHECKED_AT);
    expect(result).toMatchObject({ state: 'unavailable', reason: 'platform_mismatch' });
  });

  it('页面网络错误判定 unavailable', () => {
    const result = classifyAccountAvailability({
      platform: 'doubao', url: 'https://www.doubao.com/chat/', loadError: true,
    }, 'navigation', CHECKED_AT);
    expect(result).toMatchObject({ state: 'unavailable', reason: 'network_error' });
  });

  it('可见异常层优先于公共登录入口判定 unavailable', () => {
    const result = classifyAccountAvailability({
      platform: 'doubao', url: 'https://www.doubao.com/chat/', hasLoginControl: true,
      visibleLayerText: '当前功能受限，请稍后重试', documentReady: true,
    }, 'navigation', CHECKED_AT);
    expect(result).toMatchObject({ state: 'unavailable', reason: 'page_error' });
  });

  it('已加载但无输入区和明确阻断证据时保持 unknown', () => {
    const result = classifyAccountAvailability({
      platform: 'doubao', url: 'https://www.doubao.com/', bodyText: '豆包官网', documentReady: true,
    }, 'startup', CHECKED_AT);
    expect(result).toMatchObject({ state: 'unknown', reason: 'page_unrecognized' });
  });

  it('探针只消费脱敏页面证据并输出 ready', async () => {
    const executeJavaScript = vi.fn(async () => ({
      bodyText: '欢迎使用', visibleLayerText: '', iframeSources: [], hasUsableEditor: true,
      hasAuthenticatedControl: true, documentReady: true,
    }));
    const result = await probeAccountAvailability({
      getURL: () => 'https://www.doubao.com/chat/', executeJavaScript,
    }, 'doubao', 'manual', 100);
    expect(result).toMatchObject({ state: 'ready', source: 'manual' });
    expect(executeJavaScript).toHaveBeenCalledTimes(1);
  });

  it('脚本探针异常或超时保持 unknown，不能伪报网络失败', async () => {
    const result = await probeAccountAvailability({
      getURL: () => 'https://www.doubao.com/chat/',
      executeJavaScript: async () => new Promise(() => undefined),
    }, 'doubao', 'pre_task', 5);
    expect(result).toMatchObject({ state: 'unknown', reason: 'page_loading' });
  });

  it('只有 ready 不阻断自动化', () => {
    const base = { reason: 'x', message: 'x', checkedAt: CHECKED_AT, source: 'manual' as const };
    expect(availabilityBlocksAutomation({ ...base, state: 'ready' })).toBe(false);
    for (const state of ['unknown', 'action_required', 'login_required', 'unavailable'] as const) {
      expect(availabilityBlocksAutomation({ ...base, state })).toBe(true);
    }
  });

  it('软件重新打开时所有旧结论都必须失效，等待当前隔离页面重新探测', () => {
    const ready = requireStartupAvailabilityRecheck({
      state: 'ready', reason: 'ready', message: '可用', checkedAt: '2026-08-23T10:00:00.000Z', source: 'manual',
    }, CHECKED_AT);
    expect(ready).toMatchObject({
      state: 'unknown', reason: 'startup_recheck_required', source: 'startup', checkedAt: CHECKED_AT,
    });

    for (const state of ['login_required', 'action_required', 'unavailable', 'unknown'] as const) {
      expect(requireStartupAvailabilityRecheck({
        state, reason: 'stale', message: '旧结论', checkedAt: '2026-08-23T10:00:00.000Z', source: 'manual',
      }, CHECKED_AT)).toMatchObject({
        state: 'unknown', reason: 'startup_recheck_required', source: 'startup', checkedAt: CHECKED_AT,
      });
    }
  });
});
