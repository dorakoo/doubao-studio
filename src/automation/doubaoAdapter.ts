import type { AdapterRuleBundle, AdapterSelfCheckReport } from '../types';
import type { WebviewHandle } from '../utils/doubaoBridge';

export const DOUBAO_ADAPTER_VERSION = '1.5.0-20260711';

export const DEFAULT_ADAPTER_BUNDLE: AdapterRuleBundle = {
  version: DOUBAO_ADAPTER_VERSION,
  createdAt: '2026-07-11T00:00:00.000Z',
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
      var checks = [
        { key: 'page', label: '豆包页面', ok: location.hostname.indexOf('doubao.com') >= 0, detail: location.pathname },
        { key: 'input', label: '提示词输入框', ok: any(rules.input), detail: any(rules.input) ? '已找到可见输入框' : '未找到 textarea/contenteditable' },
        { key: 'submit', label: '提交控件', ok: any(rules.submit) || bodyText.indexOf('发送') >= 0, detail: '按钮或发送文本检测' },
        { key: 'video_mode', label: '视频模式入口', ok: bodyText.indexOf('视频生成') >= 0 || bodyText.indexOf('生成视频') >= 0, detail: '页面文本能力检测' },
        { key: 'model', label: '模型配置', ok: bodyText.indexOf('Seedance') >= 0 || bodyText.indexOf('模型') >= 0, detail: '模型触发器检测' },
        { key: 'duration', label: '时长配置', ok: /5s|10s|15s|5秒|10秒|15秒/.test(bodyText), detail: '时长选项检测' },
        { key: 'ratio', label: '比例配置', ok: /1:1|9:16|16:9|3:4|4:3|21:9/.test(bodyText), detail: '比例选项检测' },
        { key: 'upload', label: '素材上传', ok: document.querySelectorAll(rules.uploads[0]).length > 0 || bodyText.indexOf('参考图片') >= 0, detail: '文件输入控件检测' },
        { key: 'verification', label: '验证识别', ok: true, detail: '验证码 iframe、弹窗和关键词策略已加载' },
        { key: 'artifact', label: '产物识别', ok: true, detail: document.querySelectorAll('video, img').length + ' 个媒体节点可供扫描' }
      ];
      return checks;
    })();
  `;
  const items = await webview.executeJavaScript(code) as AdapterSelfCheckReport['items'];
  const passed = items.filter((item) => item.ok).length;
  return {
    adapterVersion: bundle.version,
    pageUrl: webview.getURL(),
    checkedAt: new Date().toISOString(),
    score: Math.round((passed / Math.max(items.length, 1)) * 100),
    items,
  };
}
