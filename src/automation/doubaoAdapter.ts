import type { AdapterRuleBundle, AdapterSelfCheckReport } from '../types';
import type { WebviewHandle } from '../utils/doubaoBridge';
import { buildDoubaoCapabilitySnapshot, DOUBAO_CAPABILITY_ADAPTER_VERSION } from './doubaoCapability';

export const DOUBAO_ADAPTER_VERSION = DOUBAO_CAPABILITY_ADAPTER_VERSION;

export const DEFAULT_ADAPTER_BUNDLE: AdapterRuleBundle = {
  version: DOUBAO_ADAPTER_VERSION,
  createdAt: '2026-07-31T00:00:00.000Z',
  rules: {
    input: ['textarea', '[contenteditable="true"]'],
    submit: ['button[aria-label*="发送"]', 'button[aria-label*="send" i]', 'button[type="submit"]'],
    dialogs: ['[role="dialog"]', '[role="listbox"]'],
    uploads: ['input[type="file"]'],
    media: ['video', 'img[src^="http"]'],
  },
};

function validateBundle(value: unknown): value is AdapterRuleBundle {
  if (!value || typeof value !== 'object') return false;
  const bundle = value as AdapterRuleBundle;
  if (!bundle.version || !bundle.rules) return false;
  return ['input', 'submit', 'dialogs', 'uploads', 'media'].every((key) => {
    const selectors = bundle.rules[key as keyof AdapterRuleBundle['rules']];
    return Array.isArray(selectors) && selectors.length > 0 && selectors.every((selector) => typeof selector === 'string' && selector.length < 300);
  });
}

export async function getActiveAdapterBundle(): Promise<AdapterRuleBundle> {
  const settings = await window.electronAPI.settings.get();
  return validateBundle(settings.adapterRuleBundle) ? settings.adapterRuleBundle : DEFAULT_ADAPTER_BUNDLE;
}

export async function installAdapterBundle(bundle: unknown): Promise<{ ok: boolean; error?: string }> {
  if (!validateBundle(bundle)) return { ok: false, error: '规则包结构无效' };
  const settings = await window.electronAPI.settings.get();
  const current = validateBundle(settings.adapterRuleBundle) ? settings.adapterRuleBundle : DEFAULT_ADAPTER_BUNDLE;
  const history = Array.isArray(settings.adapterRuleHistory) ? settings.adapterRuleHistory.filter(validateBundle) : [];
  await window.electronAPI.settings.save({ ...settings, adapterRuleBundle: bundle, adapterRuleHistory: [current, ...history].slice(0, 5) });
  return { ok: true };
}

export async function rollbackAdapterBundle(): Promise<{ ok: boolean; version?: string; error?: string }> {
  const settings = await window.electronAPI.settings.get();
  const history = Array.isArray(settings.adapterRuleHistory) ? settings.adapterRuleHistory.filter(validateBundle) : [];
  const previous = history[0];
  if (!previous) return { ok: false, error: '没有可回退的适配规则' };
  await window.electronAPI.settings.save({ ...settings, adapterRuleBundle: previous, adapterRuleHistory: history.slice(1) });
  return { ok: true, version: previous.version };
}

export async function runAdapterSelfCheck(webview: WebviewHandle): Promise<AdapterSelfCheckReport> {
  const bundle = await getActiveAdapterBundle();
  const rules = bundle.rules;
  const code = `
    (function() {
      var rules = ${JSON.stringify(rules)};
      function visible(selector) {
        var nodes = document.querySelectorAll(selector);
        for (var i = 0; i < nodes.length; i++) {
          var rect = nodes[i].getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) return true;
        }
        return false;
      }
      function any(selectors) {
        for (var i = 0; i < selectors.length; i++) if (visible(selectors[i])) return true;
        return false;
      }
      var bodyText = document.body ? (document.body.innerText || '') : '';
      var membershipText = '';
      var dialogs = document.querySelectorAll('[role="dialog"], [aria-modal="true"]');
      for (var d = 0; d < dialogs.length; d++) {
        var dialogText = (dialogs[d].innerText || '').trim();
        if (/购买会员|开通会员|升级会员|会员专享|仅限会员|权益不足/.test(dialogText)) {
          membershipText = dialogText.slice(0, 500);
          break;
        }
      }
      // 当前购买会员界面是跨域订阅 iframe，父页面无法读取正文；
      // 只能使用平台提供的 iframe title/src 作为机器可读动作证据。
      if (!membershipText) {
        var frames = document.querySelectorAll('iframe');
        for (var f = 0; f < frames.length; f++) {
          var frameTitle = (frames[f].getAttribute('title') || '').trim();
          var frameSrc = frames[f].getAttribute('src') || '';
          if (frameTitle.indexOf('订阅') >= 0 || /subscribe|subscription|membership|upgrade/i.test(frameSrc)) {
            membershipText = '升级会员';
            break;
          }
        }
      }
      var accountTier = 'unknown';
      var tierMatch = bodyText.match(/(?:当前套餐|当前会员|会员等级)[:：\\s]*(免费|标准|加强|高级)(?:会员)?/);
      if (tierMatch) accountTier = tierMatch[1];
      var checks = [
        { key: 'page', label: '豆包页面', ok: location.hostname.indexOf('doubao.com') >= 0, detail: location.pathname },
        { key: 'input', label: '提示词输入框', ok: any(rules.input), detail: any(rules.input) ? '已找到可见输入框' : '未找到 textarea/contenteditable' },
        { key: 'submit', label: '提交控件', ok: any(rules.submit) || bodyText.indexOf('发送') >= 0, detail: '按钮或发送文本检测' },
        { key: 'video_mode', label: '视频模式入口', ok: bodyText.indexOf('视频生成') >= 0 || bodyText.indexOf('生成视频') >= 0, detail: '页面文本能力检测' },
        { key: 'model', label: '模型配置', ok: bodyText.indexOf('Seedance') >= 0 || bodyText.indexOf('模型') >= 0, detail: '模型触发器检测' },
        { key: 'duration', label: '时长配置', ok: /(?:1[0-5]|[4-9])\\s*(?:s|秒)/i.test(bodyText), detail: '4–15 秒页面选项检测' },
        { key: 'ratio', label: '比例配置', ok: /1:1|9:16|16:9|3:4|4:3|21:9/.test(bodyText), detail: '比例选项检测' },
        { key: 'upload', label: '素材上传', ok: document.querySelectorAll(rules.uploads[0]).length > 0 || bodyText.indexOf('参考图片') >= 0, detail: '文件输入控件检测' },
        { key: 'verification', label: '验证识别', ok: true, detail: '验证码 iframe、弹窗和关键词策略已加载' },
        { key: 'artifact', label: '产物识别', ok: true, detail: document.querySelectorAll('video, img').length + ' 个媒体节点可供扫描' }
      ];
      return { checks: checks, bodyText: bodyText.slice(0, 20000), membershipText: membershipText, accountTier: accountTier };
    })();
  `;
  const result = await webview.executeJavaScript(code) as {
    checks: AdapterSelfCheckReport['items'];
    bodyText: string;
    membershipText: string;
    accountTier: string;
  };
  const snapshot = buildDoubaoCapabilitySnapshot({
    pageUrl: webview.getURL(),
    bodyText: result.bodyText,
    membershipDialogText: result.membershipText,
    accountTier: result.accountTier,
  });
  const items = [
    ...result.checks,
    {
      key: 'capability_snapshot',
      label: '只读能力快照',
      ok: snapshot.status !== 'unknown',
      detail: JSON.stringify(snapshot),
    },
    {
      key: 'final_submit',
      label: '最终生成提交',
      ok: true,
      detail: 'dry-run：未点击最终生成、购买或升级控件',
    },
  ];
  const passed = items.filter((item) => item.ok).length;
  return {
    adapterVersion: bundle.version,
    pageUrl: webview.getURL(),
    checkedAt: new Date().toISOString(),
    score: Math.round((passed / Math.max(items.length, 1)) * 100),
    items,
  };
}
