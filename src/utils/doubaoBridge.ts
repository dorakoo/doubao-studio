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
 */
export async function submitPrompt(webview: WebviewHandle): Promise<boolean> {
  const code = `
    (function() {
      try {
        // ========== 策略A：aria-label 匹配 ==========
        var sendBtn = null;
        var ariaSelectors = [
          'button[aria-label*="发送"]',
          'button[aria-label*="Send"]',
          'button[aria-label*="send"]',
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
            // 向上找几层，找到包含多个 button 的容器
            for (var level = 0; level < 5 && container; level++) {
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

        // ========== 策略C：按 Enter 键提交 ==========
        if (!sendBtn) {
          var ta = document.querySelector('textarea');
          if (ta) {
            console.log('[doubaoBridge] 未找到发送按钮，尝试按 Enter 提交');
            ta.focus();
            ta.dispatchEvent(new KeyboardEvent('keydown', {
              key: 'Enter',
              code: 'Enter',
              keyCode: 13,
              which: 13,
              bubbles: true,
              cancelable: true
            }));
            return { ok: true, method: 'enter' };
          }
          return { ok: false, error: '未找到发送按钮且无 textarea 可按 Enter' };
        }

        console.log('[doubaoBridge] 找到发送按钮 tag=' + sendBtn.tagName);
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
