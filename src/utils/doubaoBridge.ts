/**
 * src/utils/doubaoBridge.ts
 * 豆包 webview DOM 操作工具函数
 *
 * 所有函数通过 webview.executeJavaScript() 注入 JS 到豆包页面 DOM 中执行。
 * 豆包 chat 页面结构（https://www.doubao.com/chat/）：
 * - 输入框：textarea[role="textbox"] 或 [contenteditable="true"]
 * - 发送按钮：在输入框附近，有 aria-label 含"发送"或 SVG 图标
 * - 生成中指示器：Stop 按钮可见 / loading 动画存在
 * - 结果区域：对话消息列表容器
 */

// ==================== 类型 ====================

/** webview 最小接口（Electron 渲染进程 webview 元素） */
export interface WebviewHandle {
  executeJavaScript(code: string): Promise<any>;
  loadURL(url: string): void;
  getURL(): string;
}

// ==================== 注入提示词 ====================

/**
 * 注入提示词到豆包输入框
 * 策略：查找 textarea[role="textbox"] 或 contenteditable 元素，设置值并触发 React 事件
 */
export async function injectPrompt(webview: WebviewHandle, prompt: string): Promise<boolean> {
  const code = `
    (function() {
      try {
        // 查找输入框：优先 textarea[role="textbox"]，其次 [contenteditable="true"]
        let input = document.querySelector('textarea[role="textbox"]');
        if (!input) {
          input = document.querySelector('[contenteditable="true"]');
        }
        if (!input) {
          // 通用回退：查找页面中的 textarea
          const textareas = document.querySelectorAll('textarea');
          input = textareas[textareas.length - 1]; // 取最后一个 textarea
        }
        if (!input) {
          return { ok: false, error: '未找到豆包输入框' };
        }

        // 设置文本内容
        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
          window.HTMLTextAreaElement.prototype, 'value'
        )?.set;
        if (nativeInputValueSetter) {
          nativeInputValueSetter.call(input, ${JSON.stringify(prompt)});
        } else if ('value' in input) {
          input.value = ${JSON.stringify(prompt)};
        } else {
          input.textContent = ${JSON.stringify(prompt)};
        }

        // 触发 React 合成事件，让豆包前端感知输入变化
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        // 额外触发 composition 事件序列（某些框架依赖此序列）
        input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: '' }));
        input.dispatchEvent(new CompositionEvent('compositionupdate', { bubbles: true, data: ${JSON.stringify(prompt)} }));
        input.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: ${JSON.stringify(prompt)} }));

        // 注入前调试信息
        const info = document.querySelector('textarea[role="textbox"]') ||
                     document.querySelector('[contenteditable="true"]');
        console.log('[doubaoBridge] 注入前 input 存在:', !!info, 'tag:', info?.tagName);
        return { ok: true };
      } catch (e) {
        console.error('[doubaoBridge] 注入异常:', e);
        return { ok: false, error: e.message };
      }
    })();
  `;

  try {
    // 10 秒超时保护
    const result = await Promise.race([
      webview.executeJavaScript(code),
      new Promise<{ ok: boolean; error?: string }>((_, reject) =>
        setTimeout(() => reject(new Error('injectPrompt executeJavaScript 超时（10s）')), 10000)
      ),
    ]);
    if (!result.ok) {
      console.error('[doubaoBridge] injectPrompt 失败:', result.error);
      return false;
    }
    return true;
  } catch (err: any) {
    console.error('[doubaoBridge] injectPrompt 异常:', err.message);
    return false;
  }
}

// ==================== 点击发送按钮 ====================

/**
 * 点击豆包发送按钮
 * 策略：查找多种可能的发送按钮选择器
 */
export async function submitPrompt(webview: WebviewHandle): Promise<boolean> {
  const code = `
    (function() {
      try {
        // 多种发送按钮选择器（按优先级排列）
        const selectors = [
          // 有明确 aria-label 的发送按钮
          'button[aria-label*="发送"]',
          'button[aria-label*="send"]',
          'button[aria-label*="Send"]',
          // 带 SVG 图标的按钮（常见发送图标特征）
          'button svg[class*="send"]',
          // 输入框旁边的最后一个按钮
          'textarea[role="textbox"] ~ div button:last-of-type',
          // 通用：查找包含特定 class 的按钮
          'button[class*="send"]',
          'button[class*="submit"]',
        ];

        let sendBtn = null;
        for (const selector of selectors) {
          try {
            const el = document.querySelector(selector);
            if (el) {
              // 如果是 svg 选择器，取其父 button
              sendBtn = el.closest('button') || (el instanceof HTMLButtonElement ? el : null);
              if (sendBtn && !sendBtn.disabled) break;
              sendBtn = null;
            }
          } catch {
            // 选择器无效则跳过
          }
        }

        // 回退：找输入框附近最后一个可点击按钮
        if (!sendBtn) {
          const textarea = document.querySelector('textarea[role="textbox"]');
          if (textarea) {
            const container = textarea.closest('div[class*="input"]') || textarea.parentElement;
            if (container) {
              const buttons = container.querySelectorAll('button');
              for (let i = buttons.length - 1; i >= 0; i--) {
                if (!buttons[i].disabled) {
                  sendBtn = buttons[i];
                  break;
                }
              }
            }
          }
        }

        if (!sendBtn) {
          return { ok: false, error: '未找到发送按钮' };
        }

        // 模拟点击
        sendBtn.click();
        return { ok: true };
      } catch (e) {
        return { ok: false, error: e.message };
      }
    })();
  `;

  try {
    // 10 秒超时保护
    const result = await Promise.race([
      webview.executeJavaScript(code),
      new Promise<{ ok: boolean; error?: string }>((_, reject) =>
        setTimeout(() => reject(new Error('submitPrompt executeJavaScript 超时（10s）')), 10000)
      ),
    ]);
    if (!result.ok) {
      console.error('[doubaoBridge] submitPrompt 失败:', result.error);
      return false;
    }
    return true;
  } catch (err: any) {
    console.error('[doubaoBridge] submitPrompt 异常:', err.message);
    return false;
  }
}

// ==================== 检查是否正在生成 ====================

/**
 * 检查豆包页面当前是否正在生成回复
 * 判断依据：
 * 1. 存在 Stop 按钮（生成中可停止）
 * 2. 存在 loading 动画指示器
 * 3. 最后一条消息尚未完整（有 typing 动画）
 */
export async function checkGenerating(webview: WebviewHandle): Promise<boolean> {
  const code = `
    (function() {
      try {
        // 1. 检查 Stop/停止 按钮是否可见
        const stopSelectors = [
          'button[aria-label*="停止"]',
          'button[aria-label*="stop"]',
          'button[aria-label*="Stop"]',
          '[class*="stop-generat"]',
          '[class*="StopGenerat"]',
          'button svg[class*="stop"]',
        ];
        for (const sel of stopSelectors) {
          try {
            const el = document.querySelector(sel);
            if (el && el.offsetParent !== null) {
              return { generating: true };
            }
          } catch {}
        }

        // 2. 检查 loading/typing 指示器
        const loadingSelectors = [
          '[class*="loading"]',
          '[class*="Loading"]',
          '[class*="typing"]',
          '[class*="Typing"]',
          '[class*="streaming"]',
          '[class*="Streaming"]',
          '[class*="thinking"]',
          '[class*="Thinking"]',
          '.animate-pulse',
          '[role="status"]',
        ];
        for (const sel of loadingSelectors) {
          try {
            const els = document.querySelectorAll(sel);
            for (const el of els) {
              if (el.offsetParent !== null) {
                return { generating: true };
              }
            }
          } catch {}
        }

        // 3. 检查是否有闪烁光标（通常表示正在输出）
        const blinkCursor = document.querySelector('[class*="blink"], [class*="cursor"]');
        if (blinkCursor && blinkCursor.offsetParent !== null) {
          return { generating: true };
        }

        return { generating: false };
      } catch (e) {
        return { generating: false, error: e instanceof Error ? e.message : String(e) };
      }
    })();
  `;

  try {
    // 10 秒超时保护
    const result = await Promise.race([
      webview.executeJavaScript(code),
      new Promise<{ generating: boolean }>((_, reject) =>
        setTimeout(() => reject(new Error('checkGenerating executeJavaScript 超时（10s）')), 10000)
      ),
    ]);
    return result.generating === true;
  } catch {
    return false;
  }
}

// ==================== 获取结果 URL ====================

/**
 * 获取当前页面 URL 作为结果链接
 * 豆包每次对话会生成唯一的分享链接或对话 URL
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
  // 如果不在聊天页面，导航过去
  if (!currentUrl.includes('/chat')) {
    webview.loadURL('https://www.doubao.com/chat/');
  }
}

// ==================== 等待页面就绪 ====================

/**
 * 等待豆包聊天页面 DOM 完全加载（输入框可见）
 * 轮询检查直到输入框出现或超时
 */
export async function waitForChatReady(
  webview: WebviewHandle,
  timeoutMs: number = 15000
): Promise<boolean> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    const code = `
      (function() {
        const input = document.querySelector('textarea[role="textbox"]') ||
                      document.querySelector('[contenteditable="true"]');
        return input !== null && input.offsetParent !== null;
      })();
    `;

    try {
      const ready = await webview.executeJavaScript(code);
      if (ready) return true;
    } catch {
      // 页面可能还在加载，继续等待
    }

    // 等待 1 秒后重试
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  return false;
}
