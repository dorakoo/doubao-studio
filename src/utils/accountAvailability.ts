import type {
  AccountAvailability,
  AccountAvailabilitySource,
  AccountPlatform,
} from '../types';

export interface AccountAvailabilityEvidence {
  platform: AccountPlatform;
  url: string;
  bodyText?: string;
  visibleLayerText?: string;
  iframeSources?: string[];
  hasUsableEditor?: boolean;
  hasLoginControl?: boolean;
  hasAuthenticatedControl?: boolean;
  documentReady?: boolean;
  loadError?: boolean;
}

interface AvailabilityWebview {
  getURL: () => string;
  executeJavaScript: (code: string) => Promise<unknown>;
}

const VERIFICATION_PHRASES = [
  '请完成验证', '安全验证', '机器人验证', '拖动滑块', '点击进行验证',
  '验证后继续', '人机验证', 'verify to continue', 'security verification',
];

const LOGIN_PHRASES = [
  '请先登录', '登录后继续', '登录即可使用', '扫码登录', '手机号登录',
  '验证码登录', 'log in to continue', 'sign in to continue',
];

const PAGE_ERROR_PHRASES = [
  '页面走丢了', '页面不存在', '服务暂不可用', '网络异常', '网络连接失败',
  '页面加载失败', '访问过于频繁', '操作过于频繁', '账号异常', '账号已冻结',
  '当前功能受限', 'something went wrong', 'service unavailable',
];

function includesAny(text: string, phrases: readonly string[]): boolean {
  const normalized = text.toLowerCase();
  return phrases.some((phrase) => normalized.includes(phrase.toLowerCase()));
}

function result(
  state: AccountAvailability['state'],
  reason: string,
  message: string,
  checkedAt: string,
  source: AccountAvailabilitySource,
): AccountAvailability {
  return { state, reason, message, checkedAt, source };
}

/**
 * 将页面可见证据归类为账号可用性。未知状态不会被伪装成可用；调用方可
 * 在受控导航后再次探测，以免把普通落地页误判成登录失效。
 */
export function classifyAccountAvailability(
  evidence: AccountAvailabilityEvidence,
  source: AccountAvailabilitySource,
  checkedAt: string = new Date().toISOString(),
): AccountAvailability {
  if (evidence.loadError) {
    return result('unavailable', 'network_error', '页面加载失败，请检查网络后重新检测', checkedAt, source);
  }

  const url = evidence.url.trim();
  if (!url || url === 'about:blank') {
    return result('unknown', 'page_loading', '页面仍在加载，稍后会自动复检', checkedAt, source);
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return result('unavailable', 'invalid_page_url', '当前页面地址异常，请刷新后重新检测', checkedAt, source);
  }

  const expectedHost = evidence.platform === 'dola' ? 'dola.com' : 'doubao.com';
  if (parsed.hostname !== expectedHost && !parsed.hostname.endsWith(`.${expectedHost}`)) {
    return result('unavailable', 'platform_mismatch', '当前页面不属于该账号平台，自动化已停用', checkedAt, source);
  }

  const allText = `${evidence.visibleLayerText || ''}\n${evidence.bodyText || ''}`;
  const path = `${parsed.pathname}${parsed.search}`.toLowerCase();
  const iframeSources = (evidence.iframeSources || []).join('\n').toLowerCase();

  if (
    path.includes('region-restricted') || path.includes('region_restricted') ||
    includesAny(allText, ['当前地区不可用', '所在地区暂不可用', 'not available in your region'])
  ) {
    return result('unavailable', 'region_restricted', '平台限制当前地区访问，无法自动化生产', checkedAt, source);
  }

  if (
    includesAny(iframeSources, ['captcha', 'verify', 'challenge', 'secsdk']) ||
    includesAny(evidence.visibleLayerText || '', VERIFICATION_PHRASES)
  ) {
    return result('action_required', 'human_verification', '需要在右侧页面完成人机验证，然后重新检测', checkedAt, source);
  }

  // 异常页/风控层要先于公共页的“登录”入口判定，否则会把平台故障误报为仅需登录。
  if (
    includesAny(evidence.visibleLayerText || '', PAGE_ERROR_PHRASES) ||
    (!evidence.hasUsableEditor && includesAny(evidence.bodyText || '', PAGE_ERROR_PHRASES))
  ) {
    return result('unavailable', 'page_error', '平台页面异常或账号受限，请在右侧页面核对后重新检测', checkedAt, source);
  }

  const loginPath = /\/(login|signin|passport|auth)(\/|$)/i.test(parsed.pathname);
  if (loginPath || evidence.hasLoginControl || (!evidence.hasUsableEditor && includesAny(allText, LOGIN_PHRASES))) {
    return result('login_required', 'login_required', '账号需要重新登录，登录完成后请重新检测', checkedAt, source);
  }

  if (evidence.hasUsableEditor) {
    // 豆包匿名页也提供输入框，“登录”按钮却可能在 SPA 启动后数秒才出现。
    // Doubao 必须同时看到已登录导航证据，否则保持 unknown 等待稳定化复检。
    if (evidence.platform === 'doubao' && !evidence.hasAuthenticatedControl) {
      return result('unknown', 'authentication_unconfirmed', '已看到输入区，但尚未确认登录身份，正在自动复检', checkedAt, source);
    }
    return result('ready', 'ready', '账号页面正常，可执行自动化', checkedAt, source);
  }

  return result(
    'unknown',
    evidence.documentReady ? 'page_unrecognized' : 'page_loading',
    evidence.documentReady ? '未识别到可用输入区域，请打开对话页后重新检测' : '页面仍在加载，稍后会自动复检',
    checkedAt,
    source,
  );
}

const PAGE_EVIDENCE_SCRIPT = `
  (function() {
    function visible(node) {
      if (!node) return false;
      var rect = node.getBoundingClientRect();
      var style = window.getComputedStyle(node);
      return rect.width > 2 && rect.height > 2 && style.visibility !== 'hidden' && style.display !== 'none';
    }
    var editor = null;
    var candidates = document.querySelectorAll('textarea:not([disabled]), [contenteditable="true"], [contenteditable=""]');
    for (var i = 0; i < candidates.length; i++) {
      if (visible(candidates[i])) { editor = candidates[i]; break; }
    }
    var layerTexts = [];
    var layers = document.querySelectorAll('[role="dialog"], [role="alert"], [class*="captcha"], [class*="verify"], [class*="Verify"], [class*="login"], [class*="Login"], [class*="toast"], [class*="Toast"], [class*="modal"], [class*="Modal"], [class*="error"], [class*="Error"]');
    for (var j = 0; j < layers.length && j < 30; j++) {
      if (visible(layers[j])) layerTexts.push(String(layers[j].innerText || '').slice(0, 1000));
    }
    var frameSources = [];
    var frames = document.querySelectorAll('iframe');
    for (var k = 0; k < frames.length && k < 20; k++) {
      if (visible(frames[k])) frameSources.push(String(frames[k].src || '').slice(0, 1000));
    }
    var hasLoginControl = false;
    var hasAuthenticatedControl = false;
    // 新版匿名页把“登录”渲染成普通 div/span，而非 button。必须扫描精确
    // 叶子文本；已登录证据仍只接受受限的导航动作，不能用任意页面文字猜测。
    var controls = document.querySelectorAll('button, a, [role="button"], div, span');
    for (var c = 0; c < controls.length && c < 800; c++) {
      if (!visible(controls[c])) continue;
      var controlText = String(controls[c].innerText || controls[c].textContent || '').replace(/\\s+/g, ' ').trim().toLowerCase();
      var childHasSameText = Array.from(controls[c].children || []).some(function (child) {
        return String(child.innerText || child.textContent || '').replace(/\\s+/g, ' ').trim().toLowerCase() === controlText;
      });
      if (!childHasSameText && (controlText === '登录' || controlText === '立即登录' || controlText === 'log in' || controlText === 'sign in')) {
        hasLoginControl = true;
      }
      if (controlText === '定时任务' || controlText === '云盘' || controlText === '退出登录' || controlText === 'log out' || controlText === 'sign out') {
        hasAuthenticatedControl = true;
      }
    }
    return {
      bodyText: String(document.body ? document.body.innerText || '' : '').slice(0, 6000),
      visibleLayerText: layerTexts.join('\\n'),
      iframeSources: frameSources,
      hasUsableEditor: !!editor,
      hasLoginControl: hasLoginControl,
      hasAuthenticatedControl: hasAuthenticatedControl,
      documentReady: document.readyState === 'interactive' || document.readyState === 'complete'
    };
  })();
`;

/** 读取当前 webview 的脱敏可见证据并给出确定性可用性结果。 */
export async function probeAccountAvailability(
  webview: AvailabilityWebview,
  platform: AccountPlatform,
  source: AccountAvailabilitySource,
  timeoutMs: number = 6000,
): Promise<AccountAvailability> {
  const checkedAt = new Date().toISOString();
  let url = '';
  try {
    url = webview.getURL() || '';
    const page = await Promise.race([
      webview.executeJavaScript(PAGE_EVIDENCE_SCRIPT),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('availability_probe_timeout')), timeoutMs)),
    ]) as Omit<AccountAvailabilityEvidence, 'platform' | 'url'>;
    return classifyAccountAvailability({ ...page, platform, url }, source, checkedAt);
  } catch {
    return classifyAccountAvailability({ platform, url, loadError: true }, source, checkedAt);
  }
}

export function availabilityBlocksAutomation(availability: AccountAvailability | undefined): boolean {
  return !!availability && availability.state !== 'ready';
}

/**
 * 持久化的 ready 只能证明上一次运行时可用。每次打开软件必须先改为待复检，
 * 避免在 webview 尚未稳定时把旧结果用于自动指派。已明确的阻断状态保留，直到新探测推翻。
 */
export function requireStartupAvailabilityRecheck(
  availability: AccountAvailability | undefined,
  checkedAt: string = new Date().toISOString(),
): AccountAvailability {
  if (availability && availability.state !== 'ready' && availability.state !== 'unknown') return availability;
  return result(
    'unknown',
    'startup_recheck_required',
    '正在重新核对登录与验证状态，检测完成前不会自动执行',
    checkedAt,
    'startup',
  );
}

const AVAILABILITY_BLOCK_LABELS: Record<AccountAvailability['state'], string | null> = {
  unknown: '自动化可用性尚未确认',
  ready: null,
  action_required: '等待人工验证',
  login_required: '登录已失效',
  unavailable: '平台页面不可用',
};

/** 供调度器消费的统一阻断说明，避免调度与 UI 各自解释状态。 */
export function getAvailabilityBlockReason(availability: AccountAvailability | undefined): string | null {
  if (!availability) return null;
  if (availability.state === 'unavailable') return availability.message || AVAILABILITY_BLOCK_LABELS.unavailable;
  return AVAILABILITY_BLOCK_LABELS[availability.state];
}
