/**
 * src/utils/doubaoBridge.ts
 * 豆包 webview DOM 操作工具函数
 *
 * 所有函数通过 webview.executeJavaScript() 注入 JS 到豆包页面 DOM 中执行。
 * 豆包 chat 页面结构（https://www.doubao.com/chat/）：
 * - 输入框：textarea 或 contenteditable div
 * - 发送按钮：输入框附近，aria-label 含"发送"或 SVG 图标
 * - 生成中指示器：Stop 按钮可见 / loading 动画存在
 * - 结果区域：对话消息列表容器
 *
 * 关键原则：
 * 1. 所有注入的 JS 代码必须是纯 JavaScript，不能有任何 TypeScript 语法
 * 2. 选择器尽量宽泛，兼容豆包页面 DOM 变化
 * 3. 每个 executeJavaScript 调用都有 10s 超时保护
 */

// ==================== 类型 ====================

/** webview 最小接口（Electron 渲染进程 webview 元素） */
export interface WebviewHandle {
  executeJavaScript(code: string): Promise<any>;
  loadURL(url: string): void;
  getURL(): string;
}

// ==================== 工具函数 ====================

/** 带超时的 executeJavaScript */
async function safeExecuteJS<T>(
  webview: WebviewHandle,
  code: string,
  timeoutMs: number = 10000,
  label: string = 'executeJS'
): Promise<T> {
  return Promise.race([
    webview.executeJavaScript(code),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} 超时（${timeoutMs}ms）`)), timeoutMs)
    ),
  ]);
}

// ==================== 注入提示词 ====================

/**
 * 注入提示词到豆包输入框（多策略 + 重试 + 诊断）
 *
 * 策略A：遍历所有 textarea，找第一个可见且未 disabled 的
 * 策略B：遍历所有 contenteditable 元素
 * 策略C：输出诊断信息
 *
 * 最多重试 3 次，每次间隔 2 秒
 */
export async function injectPrompt(
  webview: WebviewHandle,
  prompt: string,
  maxRetries: number = 3
): Promise<boolean> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    console.log(`[doubaoBridge] injectPrompt 第 ${attempt}/${maxRetries} 次尝试`);

    const result = await tryInjectOnce(webview, prompt);
    if (result.ok) {
      console.log('[doubaoBridge] injectPrompt 成功');
      return true;
    }

    console.warn(`[doubaoBridge] injectPrompt 第 ${attempt} 次失败:`, result.error);

    if (attempt < maxRetries) {
      console.log('[doubaoBridge] 等待 2s 后重试...');
      await new Promise((r) => setTimeout(r, 2000));
    }
  }

  console.error('[doubaoBridge] injectPrompt 全部重试失败');
  return false;
}

/** 单次注入尝试 */
async function tryInjectOnce(
  webview: WebviewHandle,
  prompt: string
): Promise<{ ok: boolean; error?: string }> {
  // 安全的 JSON 序列化（处理特殊字符）
  const safePrompt = JSON.stringify(prompt);

  const code = `
    (function() {
      try {
        // ========== 策略A：遍历所有 textarea，找可见的 ==========
        var textareas = document.querySelectorAll('textarea');
        var input = null;
        for (var i = 0; i < textareas.length; i++) {
          var ta = textareas[i];
          if (ta.offsetParent !== null && !ta.disabled) {
            input = ta;
            break;
          }
        }
        // 如果所有 textarea 都不可见，取最后一个
        if (!input && textareas.length > 0) {
          input = textareas[textareas.length - 1];
        }

        // ========== 策略B：contenteditable div ==========
        if (!input) {
          var editables = document.querySelectorAll('[contenteditable="true"]');
          for (var j = 0; j < editables.length; j++) {
            var ed = editables[j];
            if (ed.offsetParent !== null) {
              input = ed;
              break;
            }
          }
          if (!input && editables.length > 0) {
            input = editables[editables.length - 1];
          }
        }

        // ========== 策略C：诊断 ==========
        if (!input) {
          var diagnostics = [];
          var allInputs = document.querySelectorAll('input[type="text"], input:not([type]), textarea, [contenteditable="true"]');
          for (var k = 0; k < allInputs.length; k++) {
            var el = allInputs[k];
            diagnostics.push({
              tag: el.tagName,
              role: el.getAttribute('role') || '',
              placeholder: el.getAttribute('placeholder') || '',
              className: (el.className || '').toString().substring(0, 80),
              visible: el.offsetParent !== null,
              disabled: !!el.disabled,
              contenteditable: el.getAttribute('contenteditable') || ''
            });
          }
          console.log('[doubaoBridge] 诊断 - 页面上找到的输入元素:', JSON.stringify(diagnostics));
          return { ok: false, error: '未找到输入框，诊断: ' + JSON.stringify(diagnostics.slice(0, 5)) };
        }

        console.log('[doubaoBridge] 找到输入框 tag=' + input.tagName + ' visible=' + (input.offsetParent !== null));

        // ========== 设置值 ==========
        var promptText = ${safePrompt};

        if (input.tagName === 'TEXTAREA' || input.tagName === 'INPUT') {
          // textarea/input：使用原生 setter 绕过 React 控制
          var nativeSetter = Object.getOwnPropertyDescriptor(
            HTMLTextAreaElement.prototype, 'value'
          ) || Object.getOwnPropertyDescriptor(
            HTMLInputElement.prototype, 'value'
          );
          if (nativeSetter && nativeSetter.set) {
            nativeSetter.set.call(input, promptText);
          } else {
            input.value = promptText;
          }
        } else {
          // contenteditable div：先清空再设置
          input.innerHTML = '';
          input.textContent = promptText;
        }

        // ========== 触发事件 ==========
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));

        // 额外触发 composition 事件（部分框架依赖此序列）
        input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
        input.dispatchEvent(new CompositionEvent('compositionupdate', { bubbles: true, data: promptText }));
        input.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: promptText }));

        // 再触发一次 input 确保框架感知
        setTimeout(function() {
          input.dispatchEvent(new Event('input', { bubbles: true }));
        }, 100);

        // 让输入框获得焦点
        input.focus();

        return { ok: true, tag: input.tagName };
      } catch (e) {
        return { ok: false, error: e.message || '未知错误' };
      }
    })();
  `;

  try {
    const result = await safeExecuteJS<{ ok: boolean; error?: string; tag?: string }>(
      webview, code, 10000, 'injectPrompt'
    );
    return result;
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
}

// ==================== 点击发送按钮 ====================

/**
 * 点击豆包发送按钮（多策略回退）
 *
 * 策略A：找 aria-label 含"发送"/"send"的 button
 * 策略B：找 textarea 父容器中最后一个非 disabled button
 * 策略C：在 textarea 上触发 Enter 键
 * 策略D：找蓝色圆形发送按钮（AI创作页面）
 * 策略E：找包含发送图标的可点击元素
 */
export async function submitPrompt(webview: WebviewHandle): Promise<boolean> {
  const code = `
    (function() {
      try {
        var sendBtn = null;

        // ========== 策略A：aria-label 匹配 ==========
        var ariaSelectors = [
          'button[aria-label*="发送"]',
          'button[aria-label*="Send"]',
          'button[aria-label*="send"]',
          'button[aria-label*="提交"]',
        ];
        for (var s = 0; s < ariaSelectors.length; s++) {
          try {
            var btn = document.querySelector(ariaSelectors[s]);
            if (btn && !btn.disabled && btn.offsetParent !== null) {
              sendBtn = btn;
              break;
            }
          } catch (e) {}
        }

        // ========== 策略B：textarea 父容器中最后一个 button ==========
        if (!sendBtn) {
          var textareas = document.querySelectorAll('textarea');
          var foundTa = null;
          for (var i = 0; i < textareas.length; i++) {
            if (textareas[i].offsetParent !== null) { foundTa = textareas[i]; break; }
          }
          if (foundTa) {
            var container = foundTa.parentElement;
            for (var level = 0; level < 8 && container; level++) {
              var buttons = container.querySelectorAll('button');
              if (buttons.length > 0) {
                for (var b = buttons.length - 1; b >= 0; b--) {
                  if (!buttons[b].disabled && buttons[b].offsetParent !== null) {
                    sendBtn = buttons[b];
                    break;
                  }
                }
                if (sendBtn) break;
              }
              container = container.parentElement;
            }
          }
        }

        // ========== 策略D：AI创作页面的蓝色圆形发送按钮 ==========
        // 在 textarea 右下方，通常是蓝色圆形带箭头图标
        if (!sendBtn && foundTa) {
          var taRect = foundTa.getBoundingClientRect();
          var searchArea = document.elementsFromPoint(
            taRect.right - 40,
            taRect.bottom - 20
          );
          for (var i = 0; i < searchArea.length; i++) {
            var el = searchArea[i];
            if (el.tagName === 'BUTTON' || el.getAttribute('role') === 'button' ||
                (el.click && window.getComputedStyle(el).cursor === 'pointer')) {
              // 排除 tag/label 类元素（如"图像生成 x"）
              var cls = (el.className || '').toLowerCase();
              var text = (el.textContent || '').trim();
              if (text.length < 30 && !cls.includes('tag') && !text.includes('x') && !text.includes('×')) {
                sendBtn = el;
                break;
              }
            }
          }
        }

        // ========== 策略E：通过 SVG 箭头图标找发送按钮 ==========
        if (!sendBtn) {
          var allSvg = document.querySelectorAll('svg');
          for (var i = 0; i < allSvg.length; i++) {
            var svg = allSvg[i];
            // 找向上箭头 SVG（发送图标通常是 arrow-up）
            var svgHtml = svg.outerHTML || '';
            if (svgHtml.includes('arrow') || svgHtml.includes('Arrow') || svgHtml.includes('send')) {
              var parent = svg.parentElement;
              while (parent && parent !== document.body) {
                if (parent.click && parent.offsetParent !== null) {
                  var style = window.getComputedStyle(parent);
                  if (style.cursor === 'pointer' || parent.tagName === 'BUTTON' || parent.getAttribute('role') === 'button') {
                    sendBtn = parent;
                    break;
                  }
                }
                parent = parent.parentElement;
              }
              if (sendBtn) break;
            }
          }
        }

        // ========== 策略F：textarea 附近右下角的可点击元素 ==========
        if (!sendBtn && foundTa) {
          var taRect2 = foundTa.getBoundingClientRect();
          // 在 textarea 右下角区域搜索
          var nearbyEls = document.querySelectorAll('button, [role="button"], [onclick]');
          for (var i = 0; i < nearbyEls.length; i++) {
            var el = nearbyEls[i];
            var rect = el.getBoundingClientRect();
            // 在 textarea 右侧或下方 60px 范围内
            if (rect.left > taRect2.right - 80 && rect.top > taRect2.bottom - 60 &&
                rect.top < taRect2.bottom + 20 && !el.disabled) {
              var text2 = (el.textContent || '').trim();
              if (text2.length < 20) {
                sendBtn = el;
                break;
              }
            }
          }
        }

        // ========== 策略C：按 Enter 键提交 ==========
        if (!sendBtn) {
          var ta = document.querySelector('textarea');
          if (ta) {
            console.log('[doubaoBridge] 未找到发送按钮，尝试按 Enter 提交');
            ta.focus();
            // React 需要 nativeInputValueSetter
            var nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
            if (nativeSetter) {
              nativeSetter.call(ta, ta.value);
            }
            ta.dispatchEvent(new Event('input', { bubbles: true }));
            ta.dispatchEvent(new KeyboardEvent('keydown', {
              key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true
            }));
            ta.dispatchEvent(new KeyboardEvent('keypress', {
              key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true
            }));
            ta.dispatchEvent(new KeyboardEvent('keyup', {
              key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true
            }));
            return { ok: true, method: 'enter' };
          }
          return { ok: false, error: '未找到发送按钮且无 textarea 可按 Enter' };
        }

        console.log('[doubaoBridge] 找到发送按钮 tag=' + sendBtn.tagName + ' class=' + (sendBtn.className || '').substring(0, 60));
        sendBtn.click();
        return { ok: true, method: 'click' };
      } catch (e) {
        return { ok: false, error: e.message || '未知错误' };
      }
    })();
  `;

  try {
    const result = await safeExecuteJS<{ ok: boolean; error?: string; method?: string }>(
      webview, code, 10000, 'submitPrompt'
    );
    if (!result.ok) {
      console.error('[doubaoBridge] submitPrompt 失败:', result.error);
      return false;
    }
    console.log('[doubaoBridge] submitPrompt 成功, 方法:', result.method);
    return true;
  } catch (err: any) {
    console.error('[doubaoBridge] submitPrompt 异常:', err.message);
    return false;
  }
}

// ==================== 检查是否正在生成 ====================

/**
 * 检查豆包页面当前是否正在生成回复
 */
export async function checkGenerating(webview: WebviewHandle): Promise<boolean> {
  const code = `
    (function() {
      try {
        // 1. 检查 Stop/停止 按钮是否可见
        var stopSelectors = [
          'button[aria-label*="停止"]',
          'button[aria-label*="stop"]',
          'button[aria-label*="Stop"]',
          '[class*="stop-generat"]',
          '[class*="StopGenerat"]',
          'button svg[class*="stop"]',
        ];
        for (var i = 0; i < stopSelectors.length; i++) {
          try {
            var el = document.querySelector(stopSelectors[i]);
            if (el && el.offsetParent !== null) {
              return { generating: true, reason: 'stop-button' };
            }
          } catch (e) {}
        }

        // 2. 检查 loading/typing 指示器
        var loadingSelectors = [
          '[class*="loading"]',
          '[class*="typing"]',
          '[class*="streaming"]',
          '[class*="thinking"]',
          '.animate-pulse',
          '[role="status"]',
        ];
        for (var j = 0; j < loadingSelectors.length; j++) {
          try {
            var els = document.querySelectorAll(loadingSelectors[j]);
            for (var k = 0; k < els.length; k++) {
              if (els[k].offsetParent !== null) {
                return { generating: true, reason: 'loading-indicator' };
              }
            }
          } catch (e) {}
        }

        return { generating: false };
      } catch (e) {
        return { generating: false };
      }
    })();
  `;

  try {
    const result = await safeExecuteJS<{ generating: boolean; reason?: string }>(
      webview, code, 10000, 'checkGenerating'
    );
    return result.generating === true;
  } catch {
    return false;
  }
}

// ==================== 获取结果 URL ====================

/**
 * 获取当前页面 URL 作为结果链接
 */
export async function getResultUrl(webview: WebviewHandle): Promise<string> {
  try {
    return webview.getURL();
  } catch {
    return '';
  }
}

// ==================== 导航到豆包聊天页 ====================

/**
 * 确保 webview 在豆包聊天页面
 */
export function navigateToChat(webview: WebviewHandle): void {
  const currentUrl = webview.getURL();
  if (!currentUrl.includes('/chat')) {
    webview.loadURL('https://www.doubao.com/chat/');
  }
}

// ==================== 等待页面就绪 ====================

/**
 * 等待豆包聊天页面 DOM 完全加载（输入框可见）
 * 轮询检查 textarea 或 contenteditable 元素是否可见
 */
export async function waitForChatReady(
  webview: WebviewHandle,
  timeoutMs: number = 15000
): Promise<boolean> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    const code = `
      (function() {
        // 与 injectPrompt 保持一致的选择器逻辑
        var textareas = document.querySelectorAll('textarea');
        for (var i = 0; i < textareas.length; i++) {
          if (textareas[i].offsetParent !== null && !textareas[i].disabled) {
            return true;
          }
        }
        var editables = document.querySelectorAll('[contenteditable="true"]');
        for (var j = 0; j < editables.length; j++) {
          if (editables[j].offsetParent !== null) {
            return true;
          }
        }
        return false;
      })();
    `;

    try {
      const ready = await safeExecuteJS<boolean>(webview, code, 5000, 'waitForChatReady');
      if (ready) return true;
    } catch {
      // 页面可能还在加载，继续等待
    }

    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  return false;
}

// ==================== 模式切换 ====================

/** 生成模式对应的 URL 映射 */
const MODE_URLS: Record<string, string> = {
  chat: 'https://www.doubao.com/chat/',
  image: 'https://www.doubao.com/chat/',
  video: 'https://www.doubao.com/chat/',
  music: 'https://www.doubao.com/chat/create-music/',
};

/**
 * 切换豆包生成模式
 *
 * 对于 image/video 模式：导航到统一的 chat 页面，然后通过 DOM 点击底部 Tab 切换
 * 对于 chat/music 模式：直接导航到对应 URL
 */
export function switchMode(webview: WebviewHandle, mode: string): void {
  const targetUrl = MODE_URLS[mode] || MODE_URLS.chat;
  const currentUrl = webview.getURL();

  // 对于 image/video，统一导航到 /chat/ 页面（Tab 切换在 DOM 中完成）
  if (mode === 'image' || mode === 'video') {
    if (currentUrl.includes('/chat/')) {
      console.log(`[doubaoBridge] 已在 chat 页面，通过 Tab 切换到 ${mode} 模式`);
      // 不导航，由 clickAITab 处理
      return;
    }
    console.log(`[doubaoBridge] 导航到 chat 页面 → ${targetUrl}`);
    webview.loadURL(targetUrl);
    return;
  }

  // chat/music 模式：直接 URL 导航
  if (currentUrl.includes(mode === 'chat' ? '/chat/' : `/create-${mode}/`)) {
    console.log(`[doubaoBridge] 已在 ${mode} 模式，跳过切换`);
    return;
  }

  console.log(`[doubaoBridge] 切换到 ${mode} 模式 → ${targetUrl}`);
  webview.loadURL(targetUrl);
}

/**
 * 在 AI 创作页面点击 Tab 切换模式（图像/视频）
 * 豆包统一页面底部输入框下方有「图像」「视频」Tab
 * 注意：必须排除左侧边栏菜单中的同名元素
 */
export async function clickAITab(webview: WebviewHandle, mode: 'image' | 'video'): Promise<boolean> {
  const tabLabel = mode === 'image' ? '图像' : '视频';
  const code = `
    (function() {
      try {
        var allEls = document.querySelectorAll('div, span, button, a, [role="tab"]');

        // 先找到 textarea 输入框的位置
        var textarea = document.querySelector('textarea');
        var textareaRect = textarea ? textarea.getBoundingClientRect() : null;
        var viewportHeight = window.innerHeight;

        // 收集所有文本匹配的元素
        var candidates = [];
        for (var i = 0; i < allEls.length; i++) {
          var el = allEls[i];
          var text = (el.textContent || '').trim();
          if (text !== '${tabLabel}') continue;
          if (el.offsetParent === null) continue;

          var rect = el.getBoundingClientRect();
          // 必须在视口内
          if (rect.top < 0 || rect.left < 0) continue;

          candidates.push({
            el: el,
            rect: rect,
            tag: el.tagName,
            // 优先：在 textarea 下方且靠近底部（Tab 在输入框下面）
            nearTextarea: textareaRect && rect.top > textareaRect.bottom && rect.top < viewportHeight,
            // 次优先：在页面下半部分（排除顶部导航/侧边栏）
            inBottomHalf: rect.top > viewportHeight * 0.5,
            // 排除：左侧边栏区域（x < 300 通常是侧边栏）
            notInSidebar: rect.left > 280,
            // 元素大小（Tab 按钮通常较小）
            isSmall: rect.width < 120 && rect.height < 50,
          });
        }

        // 优先选择：在 textarea 下方 + 不在侧边栏 + 小元素
        for (var i = 0; i < candidates.length; i++) {
          var c = candidates[i];
          if (c.nearTextarea && c.notInSidebar && c.isSmall) {
            c.el.click();
            return { ok: true, method: 'near-textarea', tag: c.tag, pos: Math.round(c.rect.left) + ',' + Math.round(c.rect.top) };
          }
        }

        // 次优先：在页面下半部分 + 不在侧边栏
        for (var i = 0; i < candidates.length; i++) {
          var c = candidates[i];
          if (c.inBottomHalf && c.notInSidebar) {
            c.el.click();
            return { ok: true, method: 'bottom-half', tag: c.tag, pos: Math.round(c.rect.left) + ',' + Math.round(c.rect.top) };
          }
        }

        // 兜底：不在侧边栏的任何匹配元素
        for (var i = 0; i < candidates.length; i++) {
          var c = candidates[i];
          if (c.notInSidebar) {
            c.el.click();
            return { ok: true, method: 'not-sidebar', tag: c.tag, pos: Math.round(c.rect.left) + ',' + Math.round(c.rect.top) };
          }
        }

        return { ok: false, error: '未找到${tabLabel}Tab, candidates=' + candidates.length };
      } catch (e) {
        return { ok: false, error: e.message };
      }
    })();
  `;

  try {
    const result = await safeExecuteJS<{ ok: boolean; error?: string; method?: string; tag?: string; pos?: string }>(
      webview, code, 5000, 'clickAITab'
    );
    if (result.ok) {
      console.log(`[doubaoBridge] 已点击${tabLabel}Tab, 方法: ${result.method}, tag: ${result.tag}, pos: ${result.pos}`);
    } else {
      console.warn(`[doubaoBridge] 点击${tabLabel}Tab 失败:`, result.error);
    }
    return result.ok;
  } catch (err: any) {
    console.error('[doubaoBridge] clickAITab 异常:', err.message);
    return false;
  }
}

/**
 * 等待模式切换完成（页面重新加载 + DOM 就绪）
 */
export async function waitForModeReady(
  webview: WebviewHandle,
  mode: string,
  timeoutMs: number = 20000
): Promise<boolean> {
  const startTime = Date.now();

  // 对于 image/video，等待 chat 页面就绪
  const urlMatch = mode === 'chat' ? '/chat/' : mode === 'music' ? '/create-music' : '/chat/';

  while (Date.now() - startTime < timeoutMs) {
    try {
      const currentUrl = webview.getURL();
      if (currentUrl.includes(urlMatch)) {
        const ready = await waitForChatReady(webview, timeoutMs - (Date.now() - startTime));
        if (ready) {
          console.log(`[doubaoBridge] ${mode} 模式已就绪`);
          return true;
        }
      }
    } catch {
      // 页面可能还在加载
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  console.warn(`[doubaoBridge] ${mode} 模式切换超时`);
  return false;
}

/**
 * 检测当前豆包页面处于哪种模式
 */
export async function detectCurrentMode(webview: WebviewHandle): Promise<string> {
  try {
    const currentUrl = webview.getURL();
    if (currentUrl.includes('/create-image')) return 'image';
    if (currentUrl.includes('/create-video')) return 'video';
    if (currentUrl.includes('/create-music')) return 'music';
    if (currentUrl.includes('/chat/')) return 'chat';
    return 'chat';
  } catch {
    return 'chat';
  }
}
