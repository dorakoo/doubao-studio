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
  sendInputEvent?(event: ElectronKeyboardEvent): void;
}

/** Electron webview sendInputEvent 的键盘事件类型 */
interface ElectronKeyboardEvent {
  type: 'keyDown' | 'keyUp' | 'char';
  keyCode?: string;
  code?: string;
  key?: string;
  text?: string;
  modifiers?: string[];
}

// ==================== 工具函数 ====================

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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
  console.log(`[doubaoBridge] injectPrompt 原始提示词长度=${prompt.length}, 前30字="${prompt.substring(0, 30)}..."`);

  // 注入前先检查按钮初始状态
  const initialBtnReady = await checkSendButtonReady(webview);
  // 视频模式守护：如果当前在视频生成页面，确保不被切走
  const videoModeGuard = async () => {
    const checkCode = `
      (function() {
        try {
          // 检查 URL 或页面元素判断是否在视频模式
          var url = window.location.href;
          var inVideo = url.indexOf('video') >= 0 || url.indexOf('doubao.com/chat') >= 0;
          
          // 检查页面上是否有视频生成相关按钮/标识
          var videoBtns = document.querySelectorAll('button, [role="button"]');
          var hasVideoTab = false;
          for (var i = 0; i < videoBtns.length; i++) {
            var txt = (videoBtns[i].innerText || '').trim();
            if (txt === '视频生成' || txt.indexOf('视频生成') >= 0 && txt.length < 10) {
              hasVideoTab = true;
              break;
            }
          }
          return { inVideo: hasVideoTab };
        } catch(e) { return { inVideo: false }; }
      })()
    `;
    try {
      const r = await safeExecuteJS<{ inVideo: boolean }>(webview, checkCode, 2000, 'video_guard');
      return r.inVideo;
    } catch {
      return false;
    }
  };
  const wasVideoMode = await videoModeGuard();
  console.log(`[doubaoBridge] 注入前按钮状态: ${initialBtnReady ? '已激活' : '未激活'}`);

  // 如果按钮本来就激活（如视频模式有图就激活），按钮状态不能作为验证标准
  // 直接走逐字输入（模拟真实按键，React 100% 捕获）
  if (initialBtnReady) {
    console.log('[doubaoBridge] 按钮初始已激活，直接使用逐字输入确保 React 状态同步');
    const charResult = await injectCharByChar(webview, prompt);
    if (charResult) {
      console.log('[doubaoBridge] 逐字输入成功');
      return true;
    }
    console.warn('[doubaoBridge] 逐字输入失败，尝试常规注入 + DOM 验证');
  }

  let charByCharTried = initialBtnReady; // 如果初始按钮已激活，上面已经试过了

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    console.log(`[doubaoBridge] injectPrompt 第 ${attempt}/${maxRetries} 次尝试`);

    const result = await tryInjectOnce(webview, prompt);
    if (result.ok) {
      console.log(`[doubaoBridge] injectPrompt 成功 method=${result.method} tag=${result.tag} actualLen=${result.actualLen} expectedLen=${prompt.length} preview="${result.preview || ''}"`);

      // 关键验证：检查发送按钮是否变为可用状态（React 状态同步的金标准）
      const btnReady = await checkSendButtonReady(webview);
      if (btnReady) {
        console.log('[doubaoBridge] 发送按钮已激活，注入确认成功');
        return true;
      }

      console.warn('[doubaoBridge] DOM 有文字但发送按钮仍禁用，React 未同步');

      // 如果还没试过逐字输入，直接走逐字输入兜底（比重复 execCommand 有效得多）
      if (!charByCharTried) {
        console.log('[doubaoBridge] 切换到逐字输入兜底策略...');
        charByCharTried = true;
        const charResult = await injectCharByChar(webview, prompt);
        if (charResult) {
          console.log('[doubaoBridge] 逐字输入成功，发送按钮已激活');
          return true;
        }
        console.warn('[doubaoBridge] 逐字输入也失败，继续重试...');
      }

      // 继续下一轮
      await new Promise((r) => setTimeout(r, 1500));
      continue;
    }

    console.warn(`[doubaoBridge] injectPrompt 第 ${attempt} 次失败:`, result.error, `actualLen=${result.actualLen}`);

    if (attempt < maxRetries) {
      console.log('[doubaoBridge] 等待 2s 后重试...');
      await new Promise((r) => setTimeout(r, 2000));
    }
  }

  console.error('[doubaoBridge] injectPrompt 全部重试失败');
  return false;
}

/** 逐字输入兜底（单独函数，确保 React 状态 100% 同步） */
async function injectCharByChar(webview: WebviewHandle, promptText: string): Promise<boolean> {
  // ========== 第一步：找到输入框并 focus + 清空 ==========
  const prepareCode = `
    (function() {
      try {
        var placeholderKeywords = ['描述你想要的视频', '描述你想要的图片', '描述你想要的图像', '输入消息', '请输入', '说点什么', '发消息', '输入内容'];
        var viewportH = window.innerHeight;
        var input = null;
        var inputType = null;

        // ---- placeholder 匹配（最准） ----
        var allTextareas = document.querySelectorAll('textarea');
        for (var pi = 0; pi < allTextareas.length; pi++) {
          var pta = allTextareas[pi];
          if (pta.disabled) continue;
          var pPlaceholder = pta.placeholder || '';
          var pRect = pta.getBoundingClientRect();
          if (pRect.width < 50 || pRect.height < 20) continue;
          if (pRect.top < 0 || pRect.top > viewportH) continue;
          for (var pki = 0; pki < placeholderKeywords.length; pki++) {
            if (pPlaceholder.indexOf(placeholderKeywords[pki]) >= 0) {
              input = pta;
              inputType = 'textarea';
              break;
            }
          }
          if (input) break;
        }
        if (!input) {
          var allEditables = document.querySelectorAll('[contenteditable="true"], [contenteditable=""]');
          for (var pei = 0; pei < allEditables.length; pei++) {
            var ped = allEditables[pei];
            var pAria = ped.getAttribute ? (ped.getAttribute('aria-label') || ped.getAttribute('data-placeholder') || ped.getAttribute('placeholder') || '') : '';
            var pRect2 = ped.getBoundingClientRect();
            if (pRect2.width < 50 || pRect2.height < 20) continue;
            if (pRect2.top < 0 || pRect2.top > viewportH) continue;
            var innerText = (ped.textContent || '').trim();
            var hasPlaceholderText = false;
            for (var pki2 = 0; pki2 < placeholderKeywords.length; pki2++) {
              if (pAria.indexOf(placeholderKeywords[pki2]) >= 0 || (innerText.length < 30 && innerText.indexOf(placeholderKeywords[pki2]) >= 0)) {
                hasPlaceholderText = true;
                break;
              }
            }
            if (hasPlaceholderText) {
              input = ped;
              inputType = 'contenteditable';
              break;
            }
          }
        }

        // ---- 面积打分兜底 ----
        if (!input) {
          var candidates = [];
          for (var ti = 0; ti < allTextareas.length; ti++) {
            var ta = allTextareas[ti];
            if (ta.disabled) continue;
            var rect = ta.getBoundingClientRect();
            if (rect.width < 30 || rect.height < 20) continue;
            if (rect.top < 0 || rect.left < 0) continue;
            var area = rect.width * rect.height;
            var bottomScore = rect.top > viewportH * 0.4 ? 1 : 0;
            candidates.push({ el: ta, type: 'textarea', score: area + bottomScore * 100000 });
          }
          var editables2 = document.querySelectorAll('[contenteditable="true"], [contenteditable=""]');
          for (var ei = 0; ei < editables2.length; ei++) {
            var ed = editables2[ei];
            if (ed.offsetParent === null) continue;
            var rect2 = ed.getBoundingClientRect();
            if (rect2.width < 30 || rect2.height < 20) continue;
            if (rect2.top < 0 || rect2.left < 0 || rect2.top > viewportH) continue;
            var area2 = rect2.width * rect2.height;
            if (area2 < 2000 && rect2.height < 40) continue;
            var bottomScore2 = rect2.top > viewportH * 0.4 ? 1 : 0;
            candidates.push({ el: ed, type: 'contenteditable', score: area2 + bottomScore2 * 100000 });
          }
          if (candidates.length > 0) {
            candidates.sort(function(a, b) { return b.score - a.score; });
            input = candidates[0].el;
            inputType = candidates[0].type;
          }
        }

        if (!input) return { ok: false, error: '未找到输入框' };

        // focus + 滚动到可视区域
        input.focus();
        if (typeof input.scrollIntoView === 'function') {
          input.scrollIntoView({ block: 'center', inline: 'center' });
        }

        // 清空内容
        if (inputType === 'textarea') {
          input.value = '';
        } else {
          input.innerHTML = '<br>';
        }
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));

        return { ok: true, inputType: inputType, tag: input.tagName };
      } catch(e) {
        return { ok: false, error: e.message };
      }
    })()
  `;

  const prepareResult = await safeExecuteJS<{ ok: boolean; inputType?: string; tag?: string; error?: string }>(
    webview, prepareCode, 8000, 'prepareInputForChar'
  );

  if (!prepareResult.ok) {
    console.warn('[doubaoBridge] injectCharByChar 准备输入框失败:', prepareResult.error);
    return false;
  }
  console.log(`[doubaoBridge] 输入框已就绪: type=${prepareResult.inputType}, tag=${prepareResult.tag}`);

  // ========== 第二步：优先使用真实键盘事件（sendInputEvent）==========
  // 短文本用真实键盘更可靠，长文本直接走 JS 批量注入更快（避免数千事件卡死页面）
  const wv = webview as any;
  const useRealKeyboard = typeof wv.sendInputEvent === 'function' && promptText.length <= 500;
  if (useRealKeyboard) {
    try {
      console.log('[doubaoBridge] 使用真实键盘事件输入 (sendInputEvent)');
      const chars = promptText.split('');
      for (let i = 0; i < chars.length; i++) {
        const ch = chars[i];
        if (ch === '\n' || ch === '\r') {
          wv.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' });
          wv.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' });
        } else if (ch === '\b') {
          wv.sendInputEvent({ type: 'keyDown', keyCode: 'Backspace' });
          wv.sendInputEvent({ type: 'keyUp', keyCode: 'Backspace' });
        } else {
          wv.sendInputEvent({ type: 'keyDown', keyCode: ch, key: ch });
          wv.sendInputEvent({ type: 'char', keyCode: ch, key: ch });
          wv.sendInputEvent({ type: 'keyUp', keyCode: ch, key: ch });
        }
        // 每50个字符稍作停顿
        if (i > 0 && i % 50 === 0) {
          await sleep(15);
        }
      }
      // 等待 React 状态完全同步
      await sleep(300);

      // 验证：读取 DOM 内容长度
      const verifyCode = `
        (function() {
          try {
            var inputType = '${prepareResult.inputType}';
            var expectedLen = ${promptText.length};
            var input = null;

            var placeholderKeywords = ['描述你想要的视频', '描述你想要的图片', '描述你想要的图像', '输入消息', '请输入', '说点什么', '发消息', '输入内容'];
            var allEls = inputType === 'textarea'
              ? document.querySelectorAll('textarea')
              : document.querySelectorAll('[contenteditable="true"], [contenteditable=""]');

            for (var i = 0; i < allEls.length; i++) {
              var el = allEls[i];
              if (inputType === 'textarea' && el.disabled) continue;
              if (inputType !== 'textarea' && el.offsetParent === null) continue;
              var ph = inputType === 'textarea'
                ? el.placeholder || ''
                : (el.getAttribute('aria-label') || el.getAttribute('data-placeholder') || '');
              var rect = el.getBoundingClientRect();
              if (rect.width < 50 || rect.height < 20) continue;
              for (var k = 0; k < placeholderKeywords.length; k++) {
                if (ph.indexOf(placeholderKeywords[k]) >= 0) {
                  input = el;
                  break;
                }
              }
              if (input) break;
            }

            // 兜底：innerText 最长的那个
            if (!input) {
              var maxLen = 0;
              for (var j = 0; j < allEls.length; j++) {
                var el2 = allEls[j];
                if (inputType !== 'textarea' && el2.offsetParent === null) continue;
                var len = inputType === 'textarea' ? el2.value.length : (el2.textContent || '').length;
                if (len > maxLen) { maxLen = len; input = el2; }
              }
            }

            if (!input) return { ok: false, error: '验证时找不到输入框' };

            var actualText = inputType === 'textarea' ? input.value : (input.innerText || '');
            var actualLen = actualText.length;

            // 检查 Fiber 节点是否存在（确认 React 接管）
            var hasFiber = false;
            try {
              var targetEl = input;
              for (var d = 0; d < 15 && targetEl; d++) {
                var keys = Object.keys(targetEl);
                for (var ki = 0; ki < keys.length; ki++) {
                  if (keys[ki].startsWith('__reactFiber') || keys[ki].startsWith('__reactProps')) {
                    hasFiber = true;
                    break;
                  }
                }
                if (hasFiber) break;
                targetEl = targetEl.parentElement;
              }
            } catch(e) {}

            return {
              ok: actualLen >= expectedLen * 0.8,
              actualLen: actualLen,
              expectedLen: expectedLen,
              hasFiber: hasFiber,
              preview: actualText.substring(0, 60)
            };
          } catch(e) {
            return { ok: false, error: e.message };
          }
        })()
      `;

      const verifyResult = await safeExecuteJS<{
        ok: boolean; actualLen: number; expectedLen: number; hasFiber: boolean; preview?: string; error?: string;
      }>(webview, verifyCode, 2000, 'verifyRealKeyboardInput');

      if (verifyResult.ok) {
        console.log(`[doubaoBridge] 真实键盘输入成功, len=${verifyResult.actualLen}/${verifyResult.expectedLen}, hasFiber=${verifyResult.hasFiber}, preview="${verifyResult.preview}..."`);
        return true;
      }
      console.warn(`[doubaoBridge] 真实键盘输入验证失败: actualLen=${verifyResult.actualLen}, expected=${promptText.length}, error=${verifyResult.error || '内容长度不足'}`);
      // 失败回退到 JS 模拟模式
    } catch (e: any) {
      console.warn('[doubaoBridge] sendInputEvent 模式异常，回退到JS模拟:', e.message);
    }
  }

  // ========== 第三步：回退 - JS 模拟逐字输入 + React Fiber 强制同步 ==========
  console.log('[doubaoBridge] 使用 JS 模拟逐字输入');
  const safePrompt = JSON.stringify(promptText);
  const fallbackCode = `
    (function() {
      try {
        var targetPrompt = ${safePrompt};
        var placeholderKeywords = ['描述你想要的视频', '描述你想要的图片', '描述你想要的图像', '输入消息', '请输入', '说点什么', '发消息', '输入内容'];
        var viewportH = window.innerHeight;
        var input = null;
        var inputType = null;

        var allTextareas = document.querySelectorAll('textarea');
        // placeholder 匹配
        for (var pi = 0; pi < allTextareas.length; pi++) {
          var pta = allTextareas[pi];
          if (pta.disabled) continue;
          var pPlaceholder = pta.placeholder || '';
          var pRect = pta.getBoundingClientRect();
          if (pRect.width < 50 || pRect.height < 20) continue;
          if (pRect.top < 0 || pRect.top > viewportH) continue;
          for (var pki = 0; pki < placeholderKeywords.length; pki++) {
            if (pPlaceholder.indexOf(placeholderKeywords[pki]) >= 0) {
              input = pta;
              inputType = 'textarea';
              break;
            }
          }
          if (input) break;
        }
        if (!input) {
          var allEditables = document.querySelectorAll('[contenteditable="true"], [contenteditable=""]');
          for (var pei = 0; pei < allEditables.length; pei++) {
            var ped = allEditables[pei];
            var pAria = ped.getAttribute ? (ped.getAttribute('aria-label') || ped.getAttribute('data-placeholder') || ped.getAttribute('placeholder') || '') : '';
            var pRect2 = ped.getBoundingClientRect();
            if (pRect2.width < 50 || pRect2.height < 20) continue;
            if (pRect2.top < 0 || pRect2.top > viewportH) continue;
            var innerText = (ped.textContent || '').trim();
            for (var pki2 = 0; pki2 < placeholderKeywords.length; pki2++) {
              if (pAria.indexOf(placeholderKeywords[pki2]) >= 0 || (innerText.length < 30 && innerText.indexOf(placeholderKeywords[pki2]) >= 0)) {
                input = ped;
                inputType = 'contenteditable';
                break;
              }
            }
          }
        }

        // 面积打分兜底
        if (!input) {
          var candidates = [];
          for (var ti = 0; ti < allTextareas.length; ti++) {
            var ta = allTextareas[ti];
            if (ta.disabled) continue;
            var rect = ta.getBoundingClientRect();
            if (rect.width < 30 || rect.height < 20) continue;
            if (rect.top < 0 || rect.left < 0) continue;
            var area = rect.width * rect.height;
            var bottomScore = rect.top > viewportH * 0.4 ? 1 : 0;
            candidates.push({ el: ta, type: 'textarea', score: area + bottomScore * 100000 });
          }
          var editables2 = document.querySelectorAll('[contenteditable="true"], [contenteditable=""]');
          for (var ei = 0; ei < editables2.length; ei++) {
            var ed = editables2[ei];
            if (ed.offsetParent === null) continue;
            var rect2 = ed.getBoundingClientRect();
            if (rect2.width < 30 || rect2.height < 20) continue;
            if (rect2.top < 0 || rect2.left < 0 || rect2.top > viewportH) continue;
            var area2 = rect2.width * rect2.height;
            if (area2 < 2000 && rect2.height < 40) continue;
            var bottomScore2 = rect2.top > viewportH * 0.4 ? 1 : 0;
            candidates.push({ el: ed, type: 'contenteditable', score: area2 + bottomScore2 * 100000 });
          }
          if (candidates.length > 0) {
            candidates.sort(function(a, b) { return b.score - a.score; });
            input = candidates[0].el;
            inputType = candidates[0].type;
          }
        }

        if (!input) return { ok: false, error: '未找到输入框' };
        input.focus();

        // 清空
        if (inputType === 'textarea') {
          var ns = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
          if (ns) ns.call(input, '');
          else input.value = '';
        } else {
          input.innerHTML = '<br>';
        }
        input.dispatchEvent(new Event('input', { bubbles: true }));

        // ===== 注入辅助函数 =====
        function setInputContent(text) {
          if (inputType === 'textarea') {
            var ns2 = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
            if (ns2) ns2.call(input, text);
            else input.value = text;
          } else {
            // contenteditable: 直接用 textContent + 光标置末
            input.textContent = text;
            // 移动光标到末尾
            var range = document.createRange();
            range.selectNodeContents(input);
            range.collapse(false);
            var sel = window.getSelection();
            sel.removeAllRanges();
            sel.addRange(range);
          }
        }

        // ===== 方案A：一次性全量注入 + React 状态同步（最快，优先尝试） =====
        setInputContent(targetPrompt);

        try {
          input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: targetPrompt }));
        } catch(e) {
          input.dispatchEvent(new Event('input', { bubbles: true }));
        }

        // 多层级 ReactFiber 同步（从 input 向上找到 onInput/onChange）
        (function syncReactFiberOneShot() {
          try {
            // 方式1: __reactProps 路径
            var fiberKey = null;
            var targetEl = input;
            var depth = 0;
            while (targetEl && depth < 15) {
              var keys = Object.keys(targetEl);
              for (var ki = 0; ki < keys.length; ki++) {
                if (keys[ki].startsWith('__reactProps')) {
                  fiberKey = keys[ki];
                  break;
                }
              }
              if (fiberKey) break;
              targetEl = targetEl.parentElement;
              depth++;
            }
            if (fiberKey) {
              var rprops = targetEl[fiberKey];
              var targetVal = inputType === 'textarea' ? input.value : (input.innerText || '');
              var fakeTarget = { value: targetVal, innerText: targetVal, textContent: targetVal };
              var fakeEvent = {
                target: fakeTarget, currentTarget: fakeTarget,
                bubbles: true, cancelable: true, defaultPrevented: false,
                preventDefault: function() { this.defaultPrevented = true; },
                stopPropagation: function() {}, persist: function() {},
                isTrusted: true, type: 'input', inputType: 'insertText', data: targetVal,
                nativeEvent: { data: targetVal, inputType: 'insertText' }
              };
              if (typeof rprops.onInput === 'function') rprops.onInput(fakeEvent);
              else if (typeof rprops.onChange === 'function') rprops.onChange(fakeEvent);
            }

            // 方式2: __reactFiber 路径（向上遍历 memoizedProps）
            var fiberKey2 = null;
            var targetEl2 = input;
            var depth2 = 0;
            while (targetEl2 && depth2 < 15) {
              var keys2 = Object.keys(targetEl2);
              for (var ki2 = 0; ki2 < keys2.length; ki2++) {
                if (keys2[ki2].startsWith('__reactFiber')) {
                  fiberKey2 = keys2[ki2];
                  break;
                }
              }
              if (fiberKey2) break;
              targetEl2 = targetEl2.parentElement;
              depth2++;
            }
            if (fiberKey2) {
              var fiber = targetEl2[fiberKey2];
              var current = fiber;
              var fdepth = 0;
              var targetVal2 = inputType === 'textarea' ? input.value : (input.innerText || '');
              var fakeTarget2 = { value: targetVal2, innerText: targetVal2, textContent: targetVal2 };
              var fakeEvent2 = {
                target: fakeTarget2, currentTarget: fakeTarget2,
                bubbles: true, cancelable: true, defaultPrevented: false,
                preventDefault: function() { this.defaultPrevented = true; },
                stopPropagation: function() {}, persist: function() {},
                isTrusted: true, type: 'input', inputType: 'insertText', data: targetVal2,
                nativeEvent: { data: targetVal2, inputType: 'insertText' }
              };
              while (current && fdepth < 30) {
                var fprops = current.memoizedProps || current.pendingProps;
                if (fprops) {
                  if (typeof fprops.onInput === 'function') {
                    try { fprops.onInput(fakeEvent2); break; } catch(e) {}
                  }
                  if (typeof fprops.onChange === 'function') {
                    try { fprops.onChange(fakeEvent2); break; } catch(e) {}
                  }
                }
                current = current.return;
                fdepth++;
              }
            }
          } catch(e) {}
        })();

        // 验证一次性注入是否成功
        var actualLenA = inputType === 'textarea' ? input.value.length : (input.innerText || '').length;
        var oneShotOk = actualLenA >= targetPrompt.length * 0.8;

        // ===== 方案B：大批量注入兜底（每200字一批，约24批/4800字） =====
        if (!oneShotOk) {
          var BATCH_SIZE = 200;
          var totalLen = targetPrompt.length;
          var batches = Math.ceil(totalLen / BATCH_SIZE);

          for (var bi = 0; bi < batches; bi++) {
            var endIdx = Math.min((bi + 1) * BATCH_SIZE, totalLen);
            var batchText = targetPrompt.substring(0, endIdx);

            setInputContent(batchText);

            try {
              input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: batchText }));
            } catch(e) {
              input.dispatchEvent(new Event('input', { bubbles: true }));
            }

            // 快速同步
            try {
              var fk = null;
              var te = input;
              var d = 0;
              while (te && d < 10) {
                var ks = Object.keys(te);
                for (var k = 0; k < ks.length; k++) {
                  if (ks[k].startsWith('__reactProps')) { fk = ks[k]; break; }
                }
                if (fk) break;
                te = te.parentElement;
                d++;
              }
              if (fk) {
                var rp = te[fk];
                var tv = inputType === 'textarea' ? input.value : (input.innerText || '');
                var ft = { value: tv, innerText: tv, textContent: tv };
                var fe = {
                  target: ft, currentTarget: ft,
                  bubbles: true, cancelable: true,
                  preventDefault: function() {}, stopPropagation: function() {},
                  isTrusted: true, type: 'input', inputType: 'insertText', data: tv,
                  nativeEvent: { data: tv, inputType: 'insertText' }
                };
                if (typeof rp.onInput === 'function') rp.onInput(fe);
                else if (typeof rp.onChange === 'function') rp.onChange(fe);
              }
            } catch(e) {}
          }
        }

        input.dispatchEvent(new Event('change', { bubbles: true }));
        input.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: targetPrompt }));

        // ========== React Fiber 强制同步（增强版：向上遍历父元素）==========
        (function syncReactFiber() {
          try {
            var fiberKey = null;
            var targetEl = input;
            var searchDepth = 0;
            while (targetEl && searchDepth < 15) {
              var keys = Object.keys(targetEl);
              for (var ki = 0; ki < keys.length; ki++) {
                if (keys[ki].startsWith('__reactFiber') || keys[ki].startsWith('__reactProps')) {
                  fiberKey = keys[ki];
                  break;
                }
              }
              if (fiberKey) break;
              targetEl = targetEl.parentElement;
              searchDepth++;
            }
            if (!fiberKey) return false;

            var targetValue = inputType === 'textarea' ? input.value : (input.innerText || '');
            var fakeTarget = { value: targetValue, innerText: targetValue, textContent: targetValue };
            var fakeEvent = {
              target: fakeTarget, currentTarget: fakeTarget,
              bubbles: true, cancelable: true, defaultPrevented: false,
              preventDefault: function() { this.defaultPrevented = true; },
              stopPropagation: function() {}, persist: function() {},
              isTrusted: true, type: 'input', inputType: 'insertText', data: targetValue,
              nativeEvent: { data: targetValue, inputType: 'insertText' }
            };

            if (fiberKey.startsWith('__reactProps')) {
              var rprops = targetEl[fiberKey];
              if (rprops && typeof rprops.onInput === 'function') {
                rprops.onInput(fakeEvent);
                console.log('[reactSync] __reactProps.onInput 同步成功');
                return true;
              }
              if (rprops && typeof rprops.onChange === 'function') {
                rprops.onChange(fakeEvent);
                console.log('[reactSync] __reactProps.onChange 同步成功');
                return true;
              }
              return false;
            }

            var fiber = targetEl[fiberKey];
            var current = fiber;
            var depth = 0;
            while (current && depth < 30) {
              var fprops = current.memoizedProps || current.pendingProps;
              if (fprops) {
                if (typeof fprops.onInput === 'function') {
                  try { fprops.onInput(fakeEvent); console.log('[reactSync] fiber.onInput 同步成功 depth=' + depth); return true; } catch(e) {}
                }
                if (typeof fprops.onChange === 'function') {
                  try { fprops.onChange(fakeEvent); console.log('[reactSync] fiber.onChange 同步成功 depth=' + depth); return true; } catch(e) {}
                }
              }
              current = current.return;
              depth++;
            }
            return false;
          } catch(e) { return false; }
        })();

        var actualLen = inputType === 'textarea' ? input.value.length : input.innerText.length;
        var ok = actualLen >= targetPrompt.length * 0.8;
        return { ok: ok, actualLen: actualLen, method: 'char-by-char-js' };
      } catch(e) {
        return { ok: false, error: e.message };
      }
    })()
  `;

  try {
    const result = await safeExecuteJS<{ ok: boolean; actualLen: number; method: string }>(
      webview, fallbackCode, 15000, 'injectCharByCharFallback'
    );
    if (result.ok) {
      console.log(`[doubaoBridge] JS模拟逐字输入成功, len=${result.actualLen}, method=${result.method}`);
      return true;
    }
    console.warn('[doubaoBridge] JS模拟逐字输入失败, actualLen=' + result.actualLen);
    return false;
  } catch (e: any) {
    console.warn('[doubaoBridge] injectCharByChar 异常:', e.message);
    return false;
  }
}


async function checkSendButtonReady(webview: WebviewHandle): Promise<boolean> {
  const code = `
    (function() {
      try {
        // 找发送按钮（和 submitPrompt 相同的优先级）
        var btn = null;

        // 策略A：aria-label
        var ariaSelectors = [
          'button[aria-label*="发送"]',
          'button[aria-label*="Send"]',
          'button[aria-label*="send"]',
          'button[aria-label*="提交"]',
        ];
        for (var s = 0; s < ariaSelectors.length; s++) {
          var b = document.querySelector(ariaSelectors[s]);
          if (b && b.offsetParent !== null) { btn = b; break; }
        }

        // 策略B：textarea 附近最后一个 button
        if (!btn) {
          var textareas = document.querySelectorAll('textarea');
          var foundTa = null;
          for (var i = 0; i < textareas.length; i++) {
            if (textareas[i].offsetParent !== null) { foundTa = textareas[i]; break; }
          }
          if (foundTa) {
            var container = foundTa.parentElement;
            for (var level = 0; level < 8 && container; level++) {
              var buttons = container.querySelectorAll('button');
              for (var bi = buttons.length - 1; bi >= 0; bi--) {
                if (buttons[bi].offsetParent !== null) {
                  btn = buttons[bi];
                  break;
                }
              }
              if (btn) break;
              container = container.parentElement;
            }
          }
        }

        // 策略C：contenteditable 附近的发送按钮（视频/图片模式）
        // 增强版：收集候选+打分排序，排除语音/麦克风按钮，优先匹配箭头图标和蓝色圆形
        if (!btn) {
          var editables = document.querySelectorAll('[contenteditable="true"]');
          var targetEd = null;
          for (var ei = 0; ei < editables.length; ei++) {
            var ed = editables[ei];
            if (ed.offsetParent !== null) { targetEd = ed; break; }
          }
          if (targetEd) {
            var candidatesC = [];
            var parentC = targetEd.parentElement;
            for (var lvl = 0; lvl < 6 && parentC; lvl++) {
              var allBtnsC = parentC.querySelectorAll('button, [role="button"]');
              for (var bj = 0; bj < allBtnsC.length; bj++) {
                var elC = allBtnsC[bj];
                if (elC.offsetParent === null) continue;
                var rectC = elC.getBoundingClientRect();
                var edRectC = targetEd.getBoundingClientRect();
                // 在输入框右下角区域
                if (rectC.left > edRectC.right - 100 && rectC.top > edRectC.bottom - 60) {
                  var score = 0;
                  var htmlC = elC.outerHTML || '';
                  var svgHtml = '';
                  var svgs = elC.querySelectorAll('svg');
                  for (var si = 0; si < svgs.length; si++) {
                    svgHtml += svgs[si].outerHTML || '';
                  }
                  // 箭头/发送图标加分
                  if (svgHtml.indexOf('arrow') >= 0 || svgHtml.indexOf('Arrow') >= 0 ||
                      svgHtml.indexOf('send') >= 0 || svgHtml.indexOf('Send') >= 0 ||
                      svgHtml.indexOf('paper-plane') >= 0 || svgHtml.indexOf('up') >= 0) {
                    score += 100;
                  }
                  // 麦克风/语音减分（排除语音输入按钮）
                  if (svgHtml.indexOf('mic') >= 0 || svgHtml.indexOf('Mic') >= 0 ||
                      svgHtml.indexOf('microphone') >= 0 || svgHtml.indexOf('voice') >= 0 ||
                      svgHtml.indexOf('audio') >= 0) {
                    score -= 200;
                  }
                  // 蓝色背景加分（发送按钮通常是蓝色）
                  var styleC = window.getComputedStyle(elC);
                  var bgColor = styleC.backgroundColor || '';
                  if (bgColor.indexOf('rgb') >= 0) {
                    var rgbMatch = bgColor.match(/\d+/g);
                    if (rgbMatch && rgbMatch.length >= 3) {
                      var r = parseInt(rgbMatch[0]), g = parseInt(rgbMatch[1]), b = parseInt(rgbMatch[2]);
                      if (b > r && b > g && b > 150) score += 50; // 蓝色调
                    }
                  }
                  // 越靠右越可能是发送按钮
                  score += rectC.left * 0.01;
                  candidatesC.push({ el: elC, score: score, rect: rectC });
                }
              }
              parentC = parentC.parentElement;
            }
            if (candidatesC.length > 0) {
              candidatesC.sort(function(a, b) { return b.score - a.score; });
              btn = candidatesC[0].el;
              console.log('[checkSendBtn] 策略C选中按钮, score=' + candidatesC[0].score +
                ', tag=' + btn.tagName + ', 候选数=' + candidatesC.length);
            }
          }
        }

        if (!btn) {
          // 找不到按钮，无法验证，保守返回 true（避免误判）
          console.log('[checkSendBtn] 未找到发送按钮，跳过验证');
          return { ready: true, found: false };
        }

        // 检查按钮是否可用
        var style = window.getComputedStyle(btn);
        var isDisabled = btn.disabled || btn.getAttribute('aria-disabled') === 'true' ||
                        parseFloat(style.opacity) < 0.5 || style.pointerEvents === 'none';

        console.log('[checkSendBtn] 按钮状态: disabled=' + isDisabled +
          ', disabledAttr=' + btn.disabled +
          ', ariaDisabled=' + btn.getAttribute('aria-disabled') +
          ', opacity=' + style.opacity +
                  ', tag=' + btn.tagName);

        return { ready: !isDisabled, found: true, disabled: isDisabled, tag: btn.tagName };
      } catch(e) {
        return { ready: true, error: e.message };
      }
    })();
  `;

  try {
    const result = await safeExecuteJS<{ ready: boolean; found: boolean; disabled?: boolean }>(
      webview, code, 5000, 'checkSendButtonReady'
    );
    return result.ready;
  } catch {
    return true; // 验证失败时保守放行
  }
}

/** 单次注入尝试 */
async function tryInjectOnce(
  webview: WebviewHandle,
  prompt: string
): Promise<{ ok: boolean; error?: string; method?: string; tag?: string; actualLen?: number }> {
  // 安全的 JSON 序列化（处理特殊字符）
  const safePrompt = JSON.stringify(prompt);

  const code = `
    (function() {
      try {
        var viewportH = window.innerHeight;
        var viewportW = window.innerWidth;

        // ========== 找到最佳输入元素（placeholder匹配优先 > 发送按钮反向 > 面积打分兜底） ==========
        var candidates = [];
        var foundByButton = null;
        var foundByPlaceholder = null;

        // ---- 策略0：通过 placeholder/提示文本直接定位输入框（最准，视频页面专用） ----
        var placeholderKeywords = ['描述你想要的视频', '描述你想要的图片', '描述你想要的图像', '输入消息', '请输入', '说点什么', '发消息', '输入内容'];
        var allTextareas = document.querySelectorAll('textarea');
        for (var pi = 0; pi < allTextareas.length; pi++) {
          var pta = allTextareas[pi];
          if (pta.disabled) continue;
          var pPlaceholder = pta.getAttribute ? (pta.getAttribute('placeholder') || '') : '';
          var pRect = pta.getBoundingClientRect();
          if (pRect.width < 50 || pRect.height < 20) continue;
          if (pRect.top < 0 || pRect.top > viewportH) continue;
          for (var pki = 0; pki < placeholderKeywords.length; pki++) {
            if (pPlaceholder.indexOf(placeholderKeywords[pki]) >= 0) {
              foundByPlaceholder = { el: pta, type: 'textarea', placeholder: pPlaceholder };
              break;
            }
          }
          if (foundByPlaceholder) break;
        }
        // 也检查 contenteditable 的 placeholder（aria-label / data-placeholder）
        if (!foundByPlaceholder) {
          var allEditables = document.querySelectorAll('[contenteditable="true"], [contenteditable=""]');
          for (var pei = 0; pei < allEditables.length; pei++) {
            var ped = allEditables[pei];
            var pAria = ped.getAttribute ? (ped.getAttribute('aria-label') || ped.getAttribute('data-placeholder') || ped.getAttribute('placeholder') || '') : '';
            var pRect2 = ped.getBoundingClientRect();
            if (pRect2.width < 50 || pRect2.height < 20) continue;
            if (pRect2.top < 0 || pRect2.top > viewportH) continue;
            for (var pki2 = 0; pki2 < placeholderKeywords.length; pki2++) {
              if (pAria.indexOf(placeholderKeywords[pki2]) >= 0) {
                foundByPlaceholder = { el: ped, type: 'contenteditable', placeholder: pAria };
                break;
              }
            }
            if (foundByPlaceholder) break;
          }
        }
        // 再兜底：contenteditable 内部的空提示文本
        if (!foundByPlaceholder) {
          var allEditables2 = document.querySelectorAll('[contenteditable="true"], [contenteditable=""]');
          for (var pe2 = 0; pe2 < allEditables2.length; pe2++) {
            var ped2 = allEditables2[pe2];
            var pRect3 = ped2.getBoundingClientRect();
            if (pRect3.width < 100 || pRect3.height < 30) continue;
            if (pRect3.top < 0 || pRect3.top > viewportH) continue;
            // 检查内部是否有提示文本元素
            var innerText = (ped2.textContent || '').trim();
            if (innerText.length > 20) continue;
            for (var pki3 = 0; pki3 < placeholderKeywords.length; pki3++) {
              if (innerText.indexOf(placeholderKeywords[pki3]) >= 0) {
                foundByPlaceholder = { el: ped2, type: 'contenteditable', placeholder: innerText };
                break;
              }
            }
            if (foundByPlaceholder) break;
          }
        }

        if (foundByPlaceholder) {
          console.log('[doubaoBridge] 通过placeholder定位输入框 type=' + foundByPlaceholder.type + ' placeholder=' + foundByPlaceholder.placeholder);
          candidates.push({ el: foundByPlaceholder.el, type: foundByPlaceholder.type, score: Infinity, area: 999999 });
        }

        // ---- 策略A：通过发送/生成按钮反向查找输入框 ----
        var buttonKeywords = ['发送', 'send', 'Send', 'SEND', '发送消息', '提交'];
        var excludeTexts = ['视频生成', '图像生成', '图片生成', '模型', 'Seedance', '时长', '比例', '尺寸', '风格'];
        var allButtons = document.querySelectorAll('button, [role="button"], div[class*="btn"], div[class*="button"], span[class*="btn"]');
        var buttonCandidates = [];
        
        for (var bi = 0; bi < allButtons.length; bi++) {
          var btn = allButtons[bi];
          var btnRect = btn.getBoundingClientRect();
          // 按钮必须在视口内且有一定大小
          if (btnRect.width < 20 || btnRect.height < 20) continue;
          if (btnRect.top < 0 || btnRect.top > viewportH) continue;
          if (btn.disabled) continue;
          
          var btnText = (btn.textContent || '').trim();
          var btnAriaLabel = btn.getAttribute ? (btn.getAttribute('aria-label') || '') : '';
          var btnTitle = btn.getAttribute ? (btn.getAttribute('title') || '') : '';
          var combinedText = btnText + ' ' + btnAriaLabel + ' ' + btnTitle;
          
          // 排除明显是 Tab / 模式切换 / 选项的按钮
          var isExcluded = false;
          for (var ei = 0; ei < excludeTexts.length; ei++) {
            if (btnText.indexOf(excludeTexts[ei]) >= 0 && btnText.length < 15) {
              isExcluded = true;
              break;
            }
          }
          if (isExcluded) continue;
          
          var btnScore = 0;
          
          // 关键词匹配加分
          for (var ki = 0; ki < buttonKeywords.length; ki++) {
            if (combinedText.indexOf(buttonKeywords[ki]) >= 0) {
              btnScore += 1000;
              break;
            }
          }
          
          // 含 SVG 图标（发送按钮通常是图标按钮）
          var svgEl = btn.querySelector('svg');
          if (svgEl) {
            btnScore += 200;
            var svgHtml = svgEl.outerHTML || '';
            if (svgHtml.indexOf('arrow') >= 0 || svgHtml.indexOf('Arrow') >= 0 || 
                svgHtml.indexOf('send') >= 0 || svgHtml.indexOf('Send') >= 0 ||
                svgHtml.indexOf('paper-plane') >= 0 || svgHtml.indexOf('plane') >= 0) {
              btnScore += 500; // 箭头/飞机图标 = 发送按钮
            }
          }
          
          // 位置：越靠下越可能是发送按钮
          if (btnRect.top > viewportH * 0.6) btnScore += 300;
          if (btnRect.top > viewportH * 0.8) btnScore += 200;
          
          // 位置：越靠右越可能是发送按钮
          if (btnRect.left > viewportW * 0.6) btnScore += 200;
          if (btnRect.left > viewportW * 0.8) btnScore += 200;
          
          // 圆形按钮（宽高接近且不大）
          var ratio = btnRect.width / btnRect.height;
          if (ratio > 0.7 && ratio < 1.4 && btnRect.width < 80) {
            btnScore += 200;
          }
          
          if (btnScore > 0) {
            buttonCandidates.push({ btn: btn, score: btnScore, text: btnText || btnAriaLabel });
          }
        }

        // 按分数排序，取最高分的按钮
        buttonCandidates.sort(function(a, b) { return b.score - a.score; });
        
        if (buttonCandidates.length > 0) {
          var topBtn = buttonCandidates[0];
          // 从按钮往上找包含输入框的父容器
          var parent = topBtn.btn.parentElement;
          for (var depth = 0; depth < 10 && parent; depth++) {
            var textareasInContainer = parent.querySelectorAll('textarea');
            var editablesInContainer = parent.querySelectorAll('[contenteditable="true"], [contenteditable=""]');
            
            var foundEl = null;
            var foundType = null;
            
            // 优先找 textarea
            for (var ti = 0; ti < textareasInContainer.length; ti++) {
              var ta = textareasInContainer[ti];
              if (ta.disabled) continue;
              var taRect = ta.getBoundingClientRect();
              if (taRect.width > 100 && taRect.height > 20) {
                foundEl = ta;
                foundType = 'textarea';
                break;
              }
            }
            
            // 再找 contenteditable
            if (!foundEl) {
              for (var ei = 0; ei < editablesInContainer.length; ei++) {
                var ed = editablesInContainer[ei];
                var edRect = ed.getBoundingClientRect();
                if (edRect.width > 100 && edRect.height > 20) {
                  foundEl = ed;
                  foundType = 'contenteditable';
                  break;
                }
              }
            }
            
            if (foundEl) {
              foundByButton = { el: foundEl, type: foundType, btnText: topBtn.text, btnScore: topBtn.score };
              break;
            }
            
            parent = parent.parentElement;
          }
        }

        if (foundByButton) {
          console.log('[doubaoBridge] 通过发送按钮定位输入框 type=' + foundByButton.type + ' 按钮文本=' + foundByButton.btnText + ' 按钮分数=' + foundByButton.btnScore + ' 候选按钮数=' + buttonCandidates.length);
          candidates.push({ el: foundByButton.el, type: foundByButton.type, score: Infinity, area: 999999 });
        } else {
          // 诊断：输出前5个高分按钮
          var topBtnsDiag = buttonCandidates.slice(0, 5).map(function(b) {
            return b.text + '(' + b.score + ')';
          }).join('; ');
          console.log('[doubaoBridge] 发送按钮定位失败，候选前5: ' + topBtnsDiag + ' 总数=' + buttonCandidates.length);
        }

        // ---- 策略B：面积打分（兜底） ----
        if (candidates.length === 0) {
          // 收集所有 textarea
          var textareas = document.querySelectorAll('textarea');
          for (var i = 0; i < textareas.length; i++) {
            var ta = textareas[i];
            if (ta.disabled) continue;
            var rect = ta.getBoundingClientRect();
            if (rect.width < 30 || rect.height < 20) continue;
            if (rect.top < 0 || rect.left < 0) continue;
            var area = rect.width * rect.height;
            var bottomScore = rect.top > viewportH * 0.4 ? 1 : 0;
            var widthScore = rect.width > viewportW * 0.5 ? 1 : 0;
            var score = area + bottomScore * 100000 + widthScore * 50000;
            candidates.push({ el: ta, type: 'textarea', rect: rect, score: score, area: area });
          }

          // 收集所有 contenteditable 元素
          var editables = document.querySelectorAll('[contenteditable="true"], [contenteditable=""]');
          for (var j = 0; j < editables.length; j++) {
            var ed = editables[j];
            var rect2 = ed.getBoundingClientRect();
            if (rect2.width < 30 || rect2.height < 20) continue;
            if (rect2.top < 0 || rect2.left < 0) continue;
            if (rect2.top > viewportH) continue;
            var area2 = rect2.width * rect2.height;
            var bottomScore2 = rect2.top > viewportH * 0.4 ? 1 : 0;
            var widthScore2 = rect2.width > viewportW * 0.5 ? 1 : 0;
            if (area2 < 2000 && rect2.height < 40) continue;
            var score2 = area2 + bottomScore2 * 100000 + widthScore2 * 50000;
            candidates.push({ el: ed, type: 'contenteditable', rect: rect2, score: score2, area: area2 });
          }
        }

        if (candidates.length === 0) {
          // 诊断
          var allInputs = document.querySelectorAll('input[type="text"], input:not([type]), textarea, [contenteditable="true"]');
          var diag = [];
          for (var k = 0; k < allInputs.length; k++) {
            var el2 = allInputs[k];
            var r2 = el2.getBoundingClientRect();
            diag.push({
              tag: el2.tagName,
              w: Math.round(r2.width),
              h: Math.round(r2.height),
              top: Math.round(r2.top),
              left: Math.round(r2.left),
              visible: el2.offsetParent !== null,
              placeholder: el2.getAttribute ? (el2.getAttribute('placeholder') || '').substring(0, 30) : ''
            });
          }
          return { ok: false, error: '未找到输入框，候选诊断: ' + JSON.stringify(diag.slice(0, 8)), actualLen: 0 };
        }

        // 按分数排序，取最高的
        candidates.sort(function(a, b) { return b.score - a.score; });
        var best = candidates[0];
        var input = best.el;
        var inputRect = input.getBoundingClientRect();

        console.log('[doubaoBridge] 找到最佳输入框 type=' + best.type + ' size=' + Math.round(inputRect.width) + 'x' + Math.round(inputRect.height) + ' pos=' + Math.round(inputRect.left) + ',' + Math.round(inputRect.top) + ' 候选数=' + candidates.length);

        // ========== 注入提示词 ==========
        var promptText = ${safePrompt};

        function verifyValue() {
          var val = '';
          if (best.type === 'textarea') {
            val = input.value;
          } else {
            val = input.innerText || input.textContent || '';
          }
          var actualLen = val.trim().length;
          var expectedLen = promptText.length;
          var ratio = actualLen > 0 && expectedLen > 0 ? Math.min(actualLen, expectedLen) / Math.max(actualLen, expectedLen) : 0;
          return { pass: ratio >= 0.5, actual: val, ratio: ratio, actualLen: actualLen, preview: val.substring(0, 50) };
        }

        // 清空输入框（移除 placeholder 等 contenteditable=false 的元素）
        function clearInput() {
          if (best.type === 'textarea') {
            input.value = '';
          } else {
            // 移除所有子节点，彻底清掉 placeholder 等元素
            while (input.firstChild) {
              input.removeChild(input.firstChild);
            }
            // 确保至少有一个空行（contenteditable 常规要求）
            var emptyP = document.createElement('p');
            var emptyBr = document.createElement('br');
            emptyP.appendChild(emptyBr);
            input.appendChild(emptyP);
          }
          input.dispatchEvent(new Event('input', { bubbles: true }));
        }

        // 策略1：聚焦 + 全选 + execCommand insertText（走编辑器原生流程，React 最容易捕获）
        try {
          input.focus();
          // 全选原有内容（不清空 DOM，避免破坏 React 引用）
          var range1 = document.createRange();
          range1.selectNodeContents(input);
          var sel1 = window.getSelection();
          sel1.removeAllRanges();
          sel1.addRange(range1);

          var ok1 = document.execCommand('insertText', false, promptText);
          if (ok1) {
            // 用 InputEvent 触发（带 data/inputType，React 合成事件更易捕获）
            try {
              input.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, inputType: 'insertText', data: promptText }));
            } catch(e) {}
            try {
              input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: promptText }));
            } catch(e) {
              // 降级用普通 Event
              input.dispatchEvent(new Event('input', { bubbles: true }));
            }
            // composition 序列（模拟中文输入完成，覆盖更多 React 富文本库）
            input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
            input.dispatchEvent(new CompositionEvent('compositionupdate', { bubbles: true, data: promptText }));
            input.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: promptText }));
            setTimeout(function() {
              try {
                input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: promptText }));
              } catch(e) {
                input.dispatchEvent(new Event('input', { bubbles: true }));
              }
            }, 30);
            setTimeout(function() { input.dispatchEvent(new Event('change', { bubbles: true })); }, 80);
            var v1 = verifyValue();
            if (v1.pass) {
              console.log('[doubaoBridge] execCommand 注入成功, len=' + v1.actualLen + ', preview=' + v1.preview);
              return { ok: true, tag: input.tagName, method: 'execCommand', actualLen: v1.actualLen, preview: v1.preview };
            }
            console.log('[doubaoBridge] execCommand 验证失败, ratio=' + v1.ratio.toFixed(2));
          }
        } catch(e) {
          console.log('[doubaoBridge] execCommand 异常:', e.message);
        }

        // 策略2：Clipboard paste 模拟粘贴
        try {
          input.focus();
          document.execCommand('selectAll', false, null);
          // 创建 paste 事件
          var clipboardData = new DataTransfer();
          clipboardData.setData('text/plain', promptText);
          var pasteEvt = new ClipboardEvent('paste', {
            bubbles: true,
            cancelable: true,
            clipboardData: clipboardData
          });
          var pasteOk = input.dispatchEvent(pasteEvt);
          if (pasteOk) {
            input.dispatchEvent(new Event('input', { bubbles: true }));
            var v2 = verifyValue();
            if (v2.pass) {
              console.log('[doubaoBridge] paste 注入成功, len=' + v2.actualLen);
              return { ok: true, tag: input.tagName, method: 'paste', actualLen: v2.actualLen, preview: v2.preview };
            }
          }
        } catch(e) {
          console.log('[doubaoBridge] paste 异常:', e.message);
        }

        // 策略3：原生 setter 赋值（textarea/input）
        if (best.type === 'textarea') {
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
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
          input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
          input.dispatchEvent(new CompositionEvent('compositionupdate', { bubbles: true, data: promptText }));
          input.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: promptText }));
          setTimeout(function() {
            input.dispatchEvent(new Event('input', { bubbles: true }));
          }, 100);
          input.focus();
          var v3 = verifyValue();
          if (v3.pass) {
            return { ok: true, tag: input.tagName, method: 'native-setter', actualLen: v3.actualLen, preview: v3.preview };
          }
        }

        // 策略4：直接设置 textContent + 完整事件序列（contenteditable 兜底）
        if (best.type === 'contenteditable') {
          input.innerHTML = '';
          input.textContent = promptText;
          // 模拟完整输入事件序列
          try { input.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, inputType: 'insertText', data: promptText })); } catch(e) {}
          try { input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: promptText })); } catch(e) { input.dispatchEvent(new Event('input', { bubbles: true })); }
          input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
          input.dispatchEvent(new CompositionEvent('compositionupdate', { bubbles: true, data: promptText }));
          input.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: promptText }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
          input.focus();
          var v4 = verifyValue();
          if (v4.pass) {
            return { ok: true, tag: input.tagName, method: 'textContent', actualLen: v4.actualLen, preview: v4.preview };
          }
        }

        // 策略5：逐字符模拟真实键盘输入（最慢但最可靠，确保 React 100% 捕获）
        try {
          // 先清空
          if (best.type === 'textarea') {
            input.value = '';
          } else {
            // 全选后删除
            input.focus();
            var selRange = document.createRange();
            selRange.selectNodeContents(input);
            var curSel = window.getSelection();
            curSel.removeAllRanges();
            curSel.addRange(selRange);
            document.execCommand('delete', false, null);
          }

          var chars = promptText.split('');
          var currentVal = '';
          for (var ci = 0; ci < chars.length; ci++) {
            var ch = chars[ci];
            var keyCode = ch.charCodeAt(0);

            // keydown
            input.dispatchEvent(new KeyboardEvent('keydown', {
              key: ch, code: 'Key' + ch.toUpperCase(), keyCode: keyCode, which: keyCode,
              bubbles: true, cancelable: true
            }));

            // keypress
            input.dispatchEvent(new KeyboardEvent('keypress', {
              key: ch, code: 'Key' + ch.toUpperCase(), keyCode: keyCode, which: keyCode,
              bubbles: true, cancelable: true
            }));

            // 更新值
            currentVal += ch;
            if (best.type === 'textarea') {
              var nativeSetter5 = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
              if (nativeSetter5) {
                nativeSetter5.call(input, currentVal);
              } else {
                input.value = currentVal;
              }
            } else {
              // contenteditable: 在光标处插入字符
              document.execCommand('insertText', false, ch);
            }

            // input 事件
            try {
              input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: ch }));
            } catch(e) {
              input.dispatchEvent(new Event('input', { bubbles: true }));
            }

            // keyup
            input.dispatchEvent(new KeyboardEvent('keyup', {
              key: ch, code: 'Key' + ch.toUpperCase(), keyCode: keyCode, which: keyCode,
              bubbles: true, cancelable: true
            }));
          }

          // 输入完成后触发 change
          input.dispatchEvent(new Event('change', { bubbles: true }));
          input.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: promptText }));

          var v5 = verifyValue();
          if (v5.pass) {
            console.log('[doubaoBridge] 逐字输入成功, len=' + v5.actualLen);
            return { ok: true, tag: input.tagName, method: 'type-char-by-char', actualLen: v5.actualLen, preview: v5.preview };
          }
        } catch(e) {
          console.log('[doubaoBridge] 逐字输入异常:', e.message);
        }

        // 全部失败
        var vFinal = verifyValue();
        return { ok: false, error: '所有注入策略失败, 实际值长度=' + vFinal.actualLen + ', 期望=' + promptText.length + ', 元素类型=' + best.type, actualLen: vFinal.actualLen, method: 'none' };
      } catch (e) {
        return { ok: false, error: e.message || '未知错误', actualLen: 0 };
      }
    })();
  `;

  try {
    const result = await safeExecuteJS<{ ok: boolean; error?: string; tag?: string; method?: string; actualLen?: number }>(
      webview, code, 10000, 'injectPrompt'
    );
    return result;
  } catch (err: any) {
    return { ok: false, error: err.message, actualLen: 0 };
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

        // ========== 策略C：按 Enter 键提交（兜底，支持 textarea 和 contenteditable） ==========
        if (!sendBtn) {
          // 尝试找 textarea
          var ta = document.querySelector('textarea');
          if (ta && ta.offsetParent !== null) {
            console.log('[doubaoBridge] 未找到发送按钮，尝试按 Enter 提交(textarea)');
            ta.focus();
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
            return { ok: true, method: 'enter-textarea' };
          }

          // 尝试找 contenteditable
          var editable = null;
          var allEds = document.querySelectorAll('[contenteditable="true"], [contenteditable=""]');
          for (var e = 0; e < allEds.length; e++) {
            if (allEds[e].offsetParent !== null) {
              var eRect = allEds[e].getBoundingClientRect();
              if (eRect.width > 100 && eRect.height > 20) {
                editable = allEds[e];
                break;
              }
            }
          }
          if (editable) {
            console.log('[doubaoBridge] 未找到发送按钮，尝试按 Enter 提交(contenteditable)');
            editable.focus();
            // 将光标移到末尾
            var range = document.createRange();
            range.selectNodeContents(editable);
            range.collapse(false);
            var sel = window.getSelection();
            sel.removeAllRanges();
            sel.addRange(range);

            editable.dispatchEvent(new KeyboardEvent('keydown', {
              key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true
            }));
            editable.dispatchEvent(new KeyboardEvent('keypress', {
              key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true
            }));
            // 某些编辑器通过 beforeinput 处理 Enter
            try {
              editable.dispatchEvent(new InputEvent('beforeinput', {
                bubbles: true, cancelable: true, inputType: 'insertParagraph', data: null
              }));
            } catch(e) {}
            editable.dispatchEvent(new KeyboardEvent('keyup', {
              key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true
            }));
            return { ok: true, method: 'enter-editable' };
          }

          return { ok: false, error: '未找到发送按钮且无输入框可按 Enter' };
        }

        console.log('[doubaoBridge] 找到发送按钮 tag=' + sendBtn.tagName + ' class=' + (sendBtn.className || '').substring(0, 60));

        // 先检测按钮是否可用（disabled/aria-disabled/低透明度 都算不可用）
        var btnStyle = window.getComputedStyle(sendBtn);
        var isDisabled = sendBtn.disabled || sendBtn.getAttribute('aria-disabled') === 'true' ||
                        parseFloat(btnStyle.opacity) < 0.5 || btnStyle.pointerEvents === 'none';
        if (isDisabled) {
          console.log('[doubaoBridge] 发送按钮处于禁用状态，点击无效');
          return { ok: false, error: '发送按钮被禁用，提示词可能未被 React 捕获' };
        }

        sendBtn.click();
        return { ok: true, method: 'click' };
      } catch (e) {
        return { ok: false, error: e.message || '未知错误', actualLen: 0 };
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

/**
 * 视频模式：点击「生成视频」按钮（素材图区域的，不是顶部Tab）
 * 视频模式下必须点这个按钮才会用完整提示词生成，点普通发送按钮会走聊天流程导致提示词被曲解
 */
export async function submitVideoGeneration(webview: WebviewHandle): Promise<boolean> {
  const code = `
    (function() {
      try {
        var viewportH = window.innerHeight;
        var viewportW = window.innerWidth;
        var candidates = [];

        // 策略1：遍历所有元素，找文本精确为"生成视频"的可点击元素
        var allElements = document.querySelectorAll('div, span, button, a, p, li');
        for (var i = 0; i < allElements.length; i++) {
          var el = allElements[i];
          // 只检查直接文本（避免父元素被子元素文本污染）
          var directText = '';
          for (var n = 0; n < el.childNodes.length; n++) {
            if (el.childNodes[n].nodeType === 3) {
              directText += el.childNodes[n].textContent;
            }
          }
          directText = directText.trim();
          if (directText !== '生成视频') continue;
          
          var rect = el.getBoundingClientRect();
          if (rect.width < 20 || rect.height < 20) continue;
          if (rect.top < 0 || rect.top > viewportH) continue;
          if (rect.left < 0 || rect.left > viewportW) continue;
          
          // 排除顶部 Tab 区域（top < 200）
          if (rect.top < 200) continue;
          
          // 排除底部输入框区域的"视频生成"Tab（底部工具栏的）
          if (rect.top > viewportH * 0.85) continue;
          
          // 判断是否可点击
          var style = window.getComputedStyle(el);
          var isClickable = (el.tagName === 'BUTTON' || el.tagName === 'A' || 
                            style.cursor === 'pointer' || el.onclick ||
                            el.getAttribute('role') === 'button');
          
          // 如果本身不可点击，往上找3层看有没有可点击的父元素
          var clickTarget = el;
          if (!isClickable) {
            var parent = el.parentElement;
            for (var d = 0; d < 5 && parent; d++) {
              var pStyle = window.getComputedStyle(parent);
              if (parent.tagName === 'BUTTON' || parent.tagName === 'A' ||
                  pStyle.cursor === 'pointer' || parent.onclick ||
                  parent.getAttribute('role') === 'button') {
                clickTarget = parent;
                isClickable = true;
                // 更新 rect 为父元素的
                var pRect = parent.getBoundingClientRect();
                rect = pRect;
                break;
              }
              parent = parent.parentElement;
            }
          }
          
          if (!isClickable) continue;
          
          var score = 0;
          // 位置在页面中上部（素材图区域，通常在 30%-70% 高度之间）
          if (rect.top > viewportH * 0.25 && rect.top < viewportH * 0.7) score += 100;
          // 有一定大小的按钮加分
          if (rect.width > 60 && rect.height > 30) score += 50;
          if (rect.width > 100) score += 30;
          // 背景色不是透明的（有按钮样式）加分
          if (style.backgroundColor && style.backgroundColor !== 'transparent' && style.backgroundColor !== 'rgba(0, 0, 0, 0)') {
            score += 40;
          }
          // 有圆角（按钮样式）加分
          if (style.borderRadius && parseInt(style.borderRadius) > 0) {
            score += 20;
          }
          
          candidates.push({ 
            el: clickTarget, 
            score: score, 
            text: directText,
            top: Math.round(rect.top), 
            w: Math.round(rect.width), 
            h: Math.round(rect.height),
            tag: clickTarget.tagName
          });
        }

        // 策略2：如果没找到，用更模糊的匹配（包含"生成视频"的元素）
        if (candidates.length === 0) {
          var allDivs = document.querySelectorAll('div');
          for (var k = 0; k < allDivs.length; k++) {
            var div = allDivs[k];
            var text = (div.textContent || '').trim();
            if (text.indexOf('生成视频') < 0) continue;
            if (text.length > 20) continue; // 太长的不是按钮
            
            var rect3 = div.getBoundingClientRect();
            if (rect3.width < 40 || rect3.height < 25) continue;
            if (rect3.top < 200 || rect3.top > viewportH * 0.85) continue;
            
            var style3 = window.getComputedStyle(div);
            if (style3.cursor !== 'pointer' && div.tagName !== 'BUTTON') continue;
            
            candidates.push({
              el: div,
              score: 50,
              text: text,
              top: Math.round(rect3.top),
              w: Math.round(rect3.width),
              h: Math.round(rect3.height),
              tag: 'DIV'
            });
          }
        }

        if (candidates.length === 0) {
          return { ok: false, error: '未找到生成视频按钮（0候选）' };
        }

        // 按分数排序
        candidates.sort(function(a, b) { return b.score - a.score; });
        
        var best = candidates[0];
        console.log('[doubaoBridge] 视频生成按钮候选前3: ' + candidates.slice(0, 3).map(function(c) { 
          return c.text + '(top=' + c.top + ',size=' + c.w + 'x' + c.h + ',score=' + c.score + ',tag=' + c.tag + ')'; 
        }).join('; '));
        
        best.el.click();
        return { ok: true, method: 'click-video-generate', text: best.text, top: best.top };
      } catch (e) {
        return { ok: false, error: e.message };
      }
    })()
  `;

  try {
    const result = await safeExecuteJS<{ ok: boolean; method?: string; text?: string; error?: string }>(
      webview, code, 10000, 'submitVideoGeneration'
    );
    if (!result.ok) {
      console.warn('[doubaoBridge] submitVideoGeneration 失败:', result.error, '，回退到普通 submitPrompt');
      // 回退到普通发送
      return false;
    }
    console.log('[doubaoBridge] submitVideoGeneration 成功, 按钮文本:', result.text);
    return true;
  } catch (err: any) {
    console.error('[doubaoBridge] submitVideoGeneration 异常:', err.message);
    return false;
  }
}

// ==================== 生成状态网络监控（后台 webview 可用） ====================

/**
 * 注入生成状态监听器（基于 fetch/XHR 拦截，不依赖 DOM）
 * 监听 /chat/completion 的 SSE 流开始和结束，写入 window.__genState
 * 后台 webview DOM 被节流时，网络层仍然正常工作
 */
export async function injectGenerationMonitor(webview: WebviewHandle): Promise<boolean> {
  const injectCode = `
    (function() {
      if (window.__genMonitorInstalled) return;
      window.__genMonitorInstalled = true;
      window.__genState = { generating: false, startTime: 0, endTime: 0, lastUpdate: 0, sseDataCount: 0 };

      function markStart() {
        window.__genState.generating = true;
        window.__genState.startTime = Date.now();
        window.__genState.lastUpdate = Date.now();
        window.__genState.endTime = 0;
        window.__genState.sseDataCount = 0;
        console.log('[GenMonitor] 生成开始');
      }

      function markEnd() {
        if (window.__genState.generating) {
          window.__genState.generating = false;
          window.__genState.endTime = Date.now();
          window.__genState.lastUpdate = Date.now();
          console.log('[GenMonitor] 生成结束, 共收到 SSE 数据帧:', window.__genState.sseDataCount);
        }
      }

      function countSSEData(chunk) {
        var lines = chunk.split('\\n');
        var count = 0;
        for (var i = 0; i < lines.length; i++) {
          if (lines[i].indexOf('data:') === 0 && lines[i].length > 6) {
            count++;
          }
        }
        if (count > 0) {
          window.__genState.sseDataCount += count;
          window.__genState.lastUpdate = Date.now();
        }
      }

      // ---- 拦截 fetch ----
      var originalFetch = window.fetch;
      window.fetch = function patchedFetch(input, init) {
        var url = typeof input === 'string' ? input : (input && input.url) || '';
        var isCompletion = url.indexOf('/chat/completion') >= 0 || url.indexOf('chain/single') >= 0;

        var promise = originalFetch.apply(this, [input, init]);

        if (isCompletion) {
          markStart();
          return promise.then(function(resp) {
            var ct = resp.headers.get('content-type') || '';
            if (ct.indexOf('text/event-stream') >= 0 && resp.body) {
              var teed = resp.body.tee();
              var reader = teed[1].getReader();
              var decoder = new TextDecoder();
              var buffer = '';
              function pump() {
                return reader.read().then(function(result) {
                  if (result.done) {
                    if (buffer.length > 0) countSSEData(buffer);
                    markEnd();
                    return;
                  }
                  var text = decoder.decode(result.value, { stream: true });
                  buffer += text;
                  var idx = buffer.lastIndexOf('\\n');
                  if (idx >= 0) {
                    countSSEData(buffer.substring(0, idx + 1));
                    buffer = buffer.substring(idx + 1);
                  }
                  return pump();
                });
              }
              pump().catch(function() { markEnd(); });
              return new Response(teed[0], {
                status: resp.status,
                statusText: resp.statusText,
                headers: resp.headers,
              });
            } else {
              // 非流式响应，直接结束
              markEnd();
            }
            return resp;
          }).catch(function(e) {
            markEnd();
            throw e;
          });
        }

        return promise;
      };

      // ---- 拦截 XHR ----
      var originalXHROpen = XMLHttpRequest.prototype.open;
      var originalXHRSend = XMLHttpRequest.prototype.send;
      var xhrUrlMap = new WeakMap();

      XMLHttpRequest.prototype.open = function(method, url) {
        xhrUrlMap.set(this, url);
        return originalXHROpen.apply(this, arguments);
      };

      XMLHttpRequest.prototype.send = function(body) {
        var url = xhrUrlMap.get(this) || '';
        var isCompletion = url.indexOf('/chat/completion') >= 0 || url.indexOf('chain/single') >= 0;

        if (isCompletion) {
          markStart();
          this.addEventListener('loadend', function() {
            markEnd();
          });
        }

        return originalXHRSend.call(this, body);
      };

      console.log('[GenMonitor] 生成状态监听器已安装');
    })();
  `;

  try {
    await safeExecuteJS(webview, injectCode, 5000, 'injectGenerationMonitor');
    return true;
  } catch (err: any) {
    console.warn('[doubaoBridge] 注入生成状态监听器失败:', err.message);
    return false;
  }
}

/**
 * 检查豆包页面当前是否正在生成回复
 * 返回 generating=true 表示确定在生成，false 表示确定已完成，unknown 表示无法确定
 */
export async function checkGenerating(webview: WebviewHandle): Promise<boolean> {
  const result = await checkGeneratingDetailed(webview);
  if (result.status === 'unknown') {
    // 无法确定时保守返回 true（继续等待），避免提前结束
    return true;
  }
  return result.generating;
}

interface GeneratingResult {
  generating: boolean;
  status: 'detected' | 'unknown';
  reason?: string;
  messageCount?: number;
  lastMessageHasImage?: boolean;
}

/**
 * 详细版生成检测：多维度综合判断
 * 1. 停止按钮/loading 指示器（最可靠）
 * 2. 对话消息数量变化
 * 3. 最新消息是否包含产物图片
 */
export async function checkGeneratingDetailed(webview: WebviewHandle): Promise<GeneratingResult> {
  const code = `
    (function() {
      try {
        // ========== 维度0：网络层监控（最可靠，后台 webview 也能用） ==========
        if (window.__genState && window.__genMonitorInstalled) {
          var gs = window.__genState;
          // 正在生成中
          if (gs.generating && gs.startTime > 0) {
            return { generating: true, status: 'detected', reason: 'network-monitor', sseDataCount: gs.sseDataCount, lastUpdate: gs.lastUpdate };
          }
          // 已完成（有明确的开始和结束时间）
          if (!gs.generating && gs.endTime > 0 && gs.startTime > 0) {
            return { generating: false, status: 'detected', reason: 'network-monitor', sseDataCount: gs.sseDataCount, endTime: gs.endTime };
          }
          // 状态未初始化（还没发过请求），继续走 DOM 检测
        }

        // ========== 维度1：停止按钮 / 生成中指示器 ==========
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
              return { generating: true, status: 'detected', reason: 'stop-button' };
            }
          } catch (e) {}
        }

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
                return { generating: true, status: 'detected', reason: 'loading-indicator' };
              }
            }
          } catch (e) {}
        }

        // ========== 维度2：对话消息检测 ==========
        // 豆包聊天消息通常在特定容器中，统计消息数量
        var msgSelectors = [
          '[class*="message-item"]',
          '[class*="messageItem"]',
          '[class*="chat-message"]',
          '[class*="chatMessage"]',
          '[data-testid*="message"]',
          'article',
        ];
        var msgCount = 0;
        var lastMsgHasImage = false;
        for (var m = 0; m < msgSelectors.length; m++) {
          try {
            var msgs = document.querySelectorAll(msgSelectors[m]);
            if (msgs.length > msgCount) {
              msgCount = msgs.length;
              // 检查最后一条消息是否有图片
              if (msgs.length > 0) {
                var lastMsg = msgs[msgs.length - 1];
                var imgs = lastMsg.querySelectorAll('img');
                var videos = lastMsg.querySelectorAll('video');
                lastMsgHasImage = imgs.length > 0 || videos.length > 0;
                // 如果最后一条消息有下载按钮，也认为有产物
                var downloadBtns = lastMsg.querySelectorAll('button[aria-label*="下载"], [class*="download"]');
                if (downloadBtns.length > 0) lastMsgHasImage = true;
              }
            }
          } catch (e) {}
        }

        // 维度3：检查输入框是否可用（生成完成后输入框会恢复）
        var textarea = document.querySelector('textarea');
        var inputDisabled = textarea ? textarea.disabled : true;

        // 综合判断：没有停止按钮 + 没有loading指示器 + (有产物图片 或 输入框可用)
        if (lastMsgHasImage || !inputDisabled) {
          return { generating: false, status: 'detected', reason: lastMsgHasImage ? 'has-output' : 'input-ready', messageCount: msgCount, lastMessageHasImage: lastMsgHasImage };
        }

        // 无法确定（可能刚开始生成还没出现停止按钮，也可能页面结构变了）
        return { generating: false, status: 'unknown', reason: 'indeterminate', messageCount: msgCount, lastMessageHasImage: lastMsgHasImage };
      } catch (e) {
        return { generating: false, status: 'unknown', reason: 'error:' + e.message };
      }
    })();
  `;

  try {
    const result = await safeExecuteJS<GeneratingResult>(
      webview, code, 8000, 'checkGenerating'
    );
    return result;
  } catch {
    return { generating: false, status: 'unknown', reason: 'execute-error' };
  }
}

// ==================== 获取结果图片 URL ====================

/**
 * 从豆包生成结果页面提取图片 URL
 * 只提取 AI 生成的产物图片，排除用户上传的参考图
 * 返回 JSON 数组字符串，包含所有产物图片的直链
 */
export async function getResultUrl(webview: WebviewHandle): Promise<string> {
  try {
    const code = `
      (function() {
        var urls = [];

        // ========== 消息选择器（与 checkGenerating 保持一致） ==========
        var msgSelectors = [
          '[class*="message-item"]',
          '[class*="messageItem"]',
          '[class*="chat-message"]',
          '[class*="chatMessage"]',
          '[data-testid*="message"]',
          'article',
        ];

        // 找到最多消息的选择器
        var bestMsgs = [];
        var bestSelector = '';
        for (var m = 0; m < msgSelectors.length; m++) {
          try {
            var msgs = document.querySelectorAll(msgSelectors[m]);
            if (msgs.length > bestMsgs.length) {
              bestMsgs = msgs;
              bestSelector = msgSelectors[m];
            }
          } catch(e) {}
        }

        // ========== 辅助函数：判断元素是否在视口左侧（AI消息） ==========
        function isLeftSide(el) {
          var rect = el.getBoundingClientRect();
          return rect.left < window.innerWidth * 0.4;
        }

        // ========== 辅助函数：从元素中提取有效图片 ==========
        function extractImages(container) {
          var result = [];
          if (!container) return result;
          var imgs = container.querySelectorAll('img');
          for (var i = 0; i < imgs.length; i++) {
            var src = imgs[i].src || '';
            if (!src || src.indexOf('data:') === 0) continue;
            if (src.indexOf('icon') >= 0 || src.indexOf('avatar') >= 0 ||
                src.indexOf('emoji') >= 0 || src.indexOf('logo') >= 0 ||
                src.indexOf('badge') >= 0 || src.indexOf('status') >= 0) continue;
            if (src.indexOf('http') < 0) continue;
            // 必须是内容图（CDN域名或图片扩展名）
            var isContentImg = src.indexOf('image') >= 0 || src.indexOf('img') >= 0 ||
                               src.indexOf('cdn') >= 0 || src.indexOf('.png') >= 0 ||
                               src.indexOf('.jpg') >= 0 || src.indexOf('.webp') >= 0 ||
                               src.indexOf('tos-') >= 0 || src.indexOf('bytecdn') >= 0 ||
                               src.indexOf('byteimg') >= 0 || src.indexOf('doubao') >= 0;
            if (!isContentImg) continue;
            // 跳过太小的图（图标、缩略图等，生成产物一般 > 200px）
            var w = imgs[i].naturalWidth || imgs[i].width || 0;
            var h = imgs[i].naturalHeight || imgs[i].height || 0;
            if (w > 0 && h > 0 && (w < 100 || h < 100)) continue;
            if (result.indexOf(src) === -1) {
              result.push(src);
            }
          }
          // 提取视频 poster + src
          var videos = container.querySelectorAll('video');
          for (var j = 0; j < videos.length; j++) {
            var poster = videos[j].poster || '';
            if (poster && result.indexOf(poster) === -1) {
              result.push(poster);
            }
            var vsrc = videos[j].src || '';
            if (vsrc && vsrc.indexOf('http') === 0 && result.indexOf(vsrc) === -1) {
              // 视频地址去水印
              vsrc = vsrc.replace(/lr=[^&]+/g, 'lr=video_gen_no_watermark');
              result.push(vsrc);
            }
            // source 子元素
            var srcs = videos[j].querySelectorAll('source');
            for (var k2 = 0; k2 < srcs.length; k2++) {
              var ssrc = srcs[k2].src || '';
              if (ssrc && ssrc.indexOf('http') === 0 && result.indexOf(ssrc) === -1) {
                ssrc = ssrc.replace(/lr=[^&]+/g, 'lr=video_gen_no_watermark');
                result.push(ssrc);
              }
            }
          }
          return result;
        }

        // ========== 方法1：找到包含下载/保存按钮的消息（AI产物才有下载按钮） ==========
        var downloadBtnSelectors = [
          'button[aria-label*="下载"]',
          'button[aria-label*="保存"]',
          'button[aria-label*="download"]',
          'button[aria-label*="save"]',
          '[class*="download"]',
          '[class*="Download"]',
          '[class*="save-btn"]',
          '[title*="下载"]',
          '[title*="保存"]',
          '[data-testid*="download"]',
          '[data-testid*="save"]',
        ];

        var aiContainers = [];
        if (bestMsgs.length > 0) {
          for (var i = 0; i < bestMsgs.length; i++) {
            var msg = bestMsgs[i];
            // 检查消息里有没有下载/保存按钮
            var hasDownloadBtn = false;
            for (var d = 0; d < downloadBtnSelectors.length; d++) {
              try {
                var btns = msg.querySelectorAll(downloadBtnSelectors[d]);
                if (btns.length > 0) {
                  hasDownloadBtn = true;
                  break;
                }
              } catch(e) {}
            }
            if (hasDownloadBtn) {
              aiContainers.push(msg);
            }
          }
        }

        // ========== 方法2：如果方法1没找到，用"左侧消息+有图片/视频+非上传区"判断 AI 消息 ==========
        if (aiContainers.length === 0 && bestMsgs.length > 0) {
          var viewportH = window.innerHeight;
          for (var k = 0; k < bestMsgs.length; k++) {
            var msg2 = bestMsgs[k];
            var msgRect = msg2.getBoundingClientRect();

            // 排除底部输入区域的元素（上传的参考图、输入框预览等）
            if (msgRect.top > viewportH * 0.75) continue;
            // 排除太窄的元素（可能不是完整消息）
            if (msgRect.width < 100) continue;
            // 必须在左侧（AI 消息区）
            if (!isLeftSide(msg2)) continue;

            var imgs2 = msg2.querySelectorAll('img');
            var videos2 = msg2.querySelectorAll('video');
            if (imgs2.length === 0 && videos2.length === 0) continue;

            // 检查是否有足够大的内容图（排除头像、图标、小缩略图）
            var hasLargeContent = false;
            for (var p = 0; p < imgs2.length; p++) {
              var s = imgs2[p].src || '';
              if (s.indexOf('http') < 0) continue;
              if (s.indexOf('icon') >= 0 || s.indexOf('avatar') >= 0 || s.indexOf('emoji') >= 0 || s.indexOf('logo') >= 0) continue;
              var iw = imgs2[p].naturalWidth || imgs2[p].width || 0;
              var ih = imgs2[p].naturalHeight || imgs2[p].height || 0;
              if (iw >= 150 && ih >= 150) {
                hasLargeContent = true;
                break;
              }
            }
            // 有视频元素也算
            if (!hasLargeContent && videos2.length > 0) hasLargeContent = true;

            if (hasLargeContent) {
              // 额外检查：消息中不包含上传/输入相关元素
              var hasUploadEl = msg2.querySelector('[class*="upload"], [class*="input"], [contenteditable="true"], textarea');
              if (!hasUploadEl) {
                aiContainers.push(msg2);
              }
            }
          }
        }

        // ========== 从 AI 容器中提取图片 ==========
        for (var c = 0; c < aiContainers.length; c++) {
          var imgs = extractImages(aiContainers[c]);
          for (var u = 0; u < imgs.length; u++) {
            if (urls.indexOf(imgs[u]) === -1) {
              urls.push(imgs[u]);
            }
          }
        }

        // ========== 兜底：仅提取视频元素（图片兜底已移除，避免误把上传图当产物） ==========
        if (urls.length === 0) {
          // 只提取视频，不提取图片（图片兜底容易把用户上传的参考图当成产物）
          var allVideos = document.querySelectorAll('video');
          for (var v = 0; v < allVideos.length; v++) {
            var p3 = allVideos[v].poster || '';
            if (p3 && urls.indexOf(p3) === -1) {
              urls.push(p3);
            }
            var vSrc = allVideos[v].src || '';
            if (vSrc && vSrc.indexOf('http') === 0 && urls.indexOf(vSrc) === -1) {
              // 视频地址去水印
              vSrc = vSrc.replace(/lr=[^&]+/g, 'lr=video_gen_no_watermark');
              urls.push(vSrc);
            }
            // 检查 source 子元素
            var sources = allVideos[v].querySelectorAll('source');
            for (var s = 0; s < sources.length; s++) {
              var sSrc = sources[s].src || '';
              if (sSrc && sSrc.indexOf('http') === 0 && urls.indexOf(sSrc) === -1) {
                sSrc = sSrc.replace(/lr=[^&]+/g, 'lr=video_gen_no_watermark');
                urls.push(sSrc);
              }
            }
          }
        }

        return JSON.stringify(urls);
      })();
    `;
    const result = await webview.executeJavaScript(code);
    return result || '[]';
  } catch {
    return '[]';
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
  const tabLabel = mode === 'image' ? '图像生成' : '视频生成';
  const code = `
    (function() {
      try {
        var allEls = document.querySelectorAll('button, [role="tab"], div, span, a');

        // 先找到 textarea 输入框的位置
        var textarea = document.querySelector('textarea');
        var textareaRect = textarea ? textarea.getBoundingClientRect() : null;
        var viewportHeight = window.innerHeight;

        // 收集所有文本匹配的元素（宽松匹配：innerText 包含目标文本）
        var candidates = [];
        for (var i = 0; i < allEls.length; i++) {
          var el = allEls[i];
          var innerText = (el.innerText || '').trim();
          var directText = '';
          for (var j = 0; j < el.childNodes.length; j++) {
            if (el.childNodes[j].nodeType === 3) directText += el.childNodes[j].textContent || '';
          }
          directText = directText.trim();

          // 匹配条件：直接文本等于目标 或 innerText 等于目标 或短文本 includes 匹配
          // includes 匹配限制 innerText 长度 < 20，避免匹配到包含目标文本的大容器
          var exactMatch = directText === '${tabLabel}' || innerText === '${tabLabel}';
          var includesMatch = !exactMatch && innerText.length < 20 && innerText.indexOf('${tabLabel}') >= 0;
          if (!exactMatch && !includesMatch) continue;
          if (el.offsetParent === null) continue;

          var rect = el.getBoundingClientRect();
          if (rect.top < 0 || rect.left < 0) continue;
          if (rect.width === 0 || rect.height === 0) continue;

          candidates.push({
            el: el,
            rect: rect,
            tag: el.tagName,
            isButton: el.tagName === 'BUTTON' || el.getAttribute('role') === 'tab',
            nearTextarea: textareaRect && rect.top > textareaRect.bottom - 10 && rect.top < viewportHeight,
            inBottomHalf: rect.top > viewportHeight * 0.5,
            notInSidebar: rect.left > 200,
            isSmall: rect.width < 150 && rect.height < 60,
            directTextMatch: directText === '${tabLabel}',
          });
        }

        // 优先：button/tab role + textarea 附近 + 不在侧边栏
        for (var i = 0; i < candidates.length; i++) {
          var c = candidates[i];
          if (c.isButton && c.nearTextarea && c.notInSidebar) {
            c.el.click();
            return { ok: true, method: 'button-near-textarea', tag: c.tag, pos: Math.round(c.rect.left) + ',' + Math.round(c.rect.top) };
          }
        }

        // 次优先：button/tab role + 页面下半 + 不在侧边栏
        for (var i = 0; i < candidates.length; i++) {
          var c = candidates[i];
          if (c.isButton && c.inBottomHalf && c.notInSidebar) {
            c.el.click();
            return { ok: true, method: 'button-bottom', tag: c.tag, pos: Math.round(c.rect.left) + ',' + Math.round(c.rect.top) };
          }
        }

        // 兜底1：任何匹配 + textarea 附近 + 不在侧边栏 + 小元素
        for (var i = 0; i < candidates.length; i++) {
          var c = candidates[i];
          if (c.nearTextarea && c.notInSidebar && c.isSmall) {
            c.el.click();
            return { ok: true, method: 'near-textarea', tag: c.tag, pos: Math.round(c.rect.left) + ',' + Math.round(c.rect.top) };
          }
        }

        // 兜底2：任何匹配 + 不在侧边栏
        for (var i = 0; i < candidates.length; i++) {
          var c = candidates[i];
          if (c.notInSidebar) {
            c.el.click();
            return { ok: true, method: 'not-sidebar', tag: c.tag, pos: Math.round(c.rect.left) + ',' + Math.round(c.rect.top) };
          }
        }

        // 全部失败，输出诊断信息
        var diag = [];
        for (var i = 0; i < allEls.length; i++) {
          var el = allEls[i];
          var t = (el.innerText || '').trim();
          if (t.indexOf('${tabLabel}') >= 0 && t.length < 50) {
            var r = el.getBoundingClientRect();
            diag.push(el.tagName + '|' + t.substring(0,20) + '|' + Math.round(r.left) + ',' + Math.round(r.top) + '|' + Math.round(r.width) + 'x' + Math.round(r.height));
          }
        }
        return { ok: false, error: '未找到${tabLabel}Tab, candidates=' + candidates.length + ', diag=' + diag.join('; ') };
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

/**
 * 配置视频生成选项（模型、时长、比例）
 * 在豆包视频生成页面，通过文本匹配点击对应选项
 */
export async function configureVideoOptions(
  webview: WebviewHandle,
  config: { model: string; duration: string; aspectRatio: string }
): Promise<void> {
  // 模型名称映射（豆包页面显示的文本）
  const modelLabels: Record<string, string[]> = {
    'seedance-2.0': ['Seedance 2.0', '2.0', '2.0 标准版', '标准', 'Standard'],
    'seedance-2.0-fast': ['Seedance 2.0 Fast', '2.0 Fast', 'Fast', '2.0 极速', '极速', '极速版', '2.0 Fast 极速'],
    'seedance-2.0-mini': ['Seedance 2.0 Mini', '2.0 Mini', 'Mini', '2.0 轻量', '轻量', '轻量版'],
  };

  const modelTexts = modelLabels[config.model] || [config.model];
  const durationSec = config.duration.replace('s', '');
  const durationTexts = [durationSec + ' 秒', durationSec + '秒', config.duration];

  /**
   * 点击下拉选项：先点击触发按钮展开下拉，再选择目标选项
   * triggerTexts: 触发按钮的文本关键词（用于找到并点击展开）
   * optionTexts: 下拉选项的文本
   */
  // ========== 辅助：确保视频配置栏可见 ==========
  const ensureVideoConfigBar = async (): Promise<boolean> => {
    const code = `
      (function() {
        try {
          // 先找输入框并聚焦
          var ta = document.querySelector('textarea');
          var ce = document.querySelector('[contenteditable="true"]');
          var input = ta || ce;
          if (input) input.focus();

          // 检查是否有模型/比例/时长相关配置按钮
          var viewportH = window.innerHeight;
          var all = document.querySelectorAll('button, [role="button"], div, span');
          var hasModel = false, hasRatio = false, hasDuration = false;
          for (var i = 0; i < all.length; i++) {
            var el = all[i];
            if (el.offsetParent === null) continue;
            var rect = el.getBoundingClientRect();
            if (rect.width < 20 || rect.height < 20) continue;
            if (rect.top < viewportH * 0.5) continue;
            var text = (el.innerText || '').trim();
            if (!text || text.length > 30) continue;
            if (text.indexOf('模型') >= 0 && text.length < 20) hasModel = true;
            if (text.indexOf('比例') >= 0 && text.length < 10) hasRatio = true;
            if ((text.indexOf('秒') >= 0 || text.indexOf('s ') >= 0 || /\\d+s$/.test(text)) && text.length < 10) hasDuration = true;
          }
          return { ok: hasModel || hasRatio, hasModel: hasModel, hasRatio: hasRatio, hasDuration: hasDuration };
        } catch(e) {
          return { ok: false, error: e.message };
        }
      })()
    `;
    try {
      const r = await safeExecuteJS<{ ok: boolean; hasModel: boolean; hasRatio: boolean; hasDuration: boolean }>(
        webview, code, 3000, 'ensure_config_bar'
      );
      return r.ok;
    } catch {
      return false;
    }
  };

  // 先确保配置栏可见
  await ensureVideoConfigBar();
  await sleep(300);
  await ensureVideoConfigBar(); // 二次确认

  // ========== 下拉选择函数 ==========
  const selectDropdownOption = async (
    triggerTexts: string[],
    optionTexts: string[],
    label: string
  ): Promise<boolean> => {
    // 操作前确保配置栏可见
    await ensureVideoConfigBar();
    await sleep(200);

    // ---- 第一步：找到并点击触发按钮（点击右边缘 = 下拉箭头区域） ----
    const triggerCode = `
      (function() {
        try {
          var triggerTexts = ${JSON.stringify(triggerTexts)};
          var viewportH = window.innerHeight;
          var candidates = [];

          var allClickable = document.querySelectorAll('button, [role="button"], div, span');
          for (var i = 0; i < allClickable.length; i++) {
            var el = allClickable[i];
            if (el.offsetParent === null) continue;
            var rect = el.getBoundingClientRect();
            if (rect.width < 20 || rect.height < 20) continue;
            if (rect.top < viewportH * 0.5) continue;
            var text = (el.innerText || '').trim();
            if (!text || text.length > 30) continue;

            var matched = false;
            for (var t = 0; t < triggerTexts.length; t++) {
              if (text.indexOf(triggerTexts[t]) >= 0) { matched = true; break; }
            }
            if (!matched) continue;

            if (el.tagName === 'TEXTAREA' || el.contentEditable === 'true') continue;
            if (rect.width > 300) continue;

            var bottomScore = rect.top > viewportH * 0.7 ? 100 : 0;
            var sizeScore = rect.width * rect.height < 10000 ? 50 : 0;
            candidates.push({ el: el, text: text, score: bottomScore + sizeScore, rect: rect });
          }

          if (candidates.length === 0) return { ok: false, error: '未找到触发按钮' };

          candidates.sort(function(a, b) { return b.score - a.score; });
          var best = candidates[0];
          var r = best.rect;

          // 点击右边缘（下拉箭头通常在按钮右侧）
          var clickX = r.right - 8;
          var clickY = r.top + r.height / 2;

          // 用 MouseEvent 模拟精确位置点击
          var evt1 = new MouseEvent('mousedown', {
            bubbles: true, cancelable: true, view: window,
            clientX: clickX, clientY: clickY, button: 0
          });
          var evt2 = new MouseEvent('mouseup', {
            bubbles: true, cancelable: true, view: window,
            clientX: clickX, clientY: clickY, button: 0
          });
          var evt3 = new MouseEvent('click', {
            bubbles: true, cancelable: true, view: window,
            clientX: clickX, clientY: clickY, button: 0
          });
          best.el.dispatchEvent(evt1);
          best.el.dispatchEvent(evt2);
          best.el.dispatchEvent(evt3);

          return {
            ok: true, text: best.text,
            pos: Math.round(r.left) + ',' + Math.round(r.top),
            clickPos: Math.round(clickX) + ',' + Math.round(clickY)
          };
        } catch(e) {
          return { ok: false, error: e.message };
        }
      })()
    `;

    // 先拍点击前快照（所有包含选项关键词的可见元素）
    const snapshotBefore = await safeExecuteJS<string[]>(
      webview,
      `(function(){
        try {
          var optTexts = ${JSON.stringify(optionTexts)};
          var result = [];
          var all = document.querySelectorAll('*');
          for (var i = 0; i < all.length; i++) {
            var el = all[i];
            var r = el.getBoundingClientRect();
            if (r.width < 10 || r.height < 10) continue;
            var text = (el.innerText || '').trim();
            if (!text || text.length > 60 || text.length < 2) continue;
            for (var j = 0; j < optTexts.length; j++) {
              if (text.indexOf(optTexts[j]) >= 0 || optTexts[j].indexOf(text) >= 0) {
                result.push(text.substring(0, 40));
                break;
              }
            }
          }
          return result.slice(0, 50);
        } catch(e) { return []; }
      })()`,
      3000,
      `snapshot_before_${label}`
    ).catch(() => []);

    const triggerResult = await safeExecuteJS<{ ok: boolean; text?: string; pos?: string; clickPos?: string; error?: string }>(
      webview, triggerCode, 3000, `trigger_${label}`
    );

    if (!triggerResult.ok) {
      console.warn(`[doubaoBridge] ${label} 触发按钮未找到:`, triggerResult.error, triggerTexts);
    } else {
      console.log(`[doubaoBridge] 已点击${label}触发按钮: "${triggerResult.text}", pos: ${triggerResult.pos}, clickPos: ${triggerResult.clickPos}`);
      await sleep(1500); // 等待下拉/面板展开
    }

    // ---- 第二步：查找并点击选项 ----
    const optionCode = `
      (function() {
        try {
          var optionTexts = ${JSON.stringify(optionTexts)};
          var snapBefore = ${JSON.stringify(snapshotBefore)};
          var snapMap = {};
          for (var sb = 0; sb < snapBefore.length; sb++) {
            snapMap[snapBefore[sb]] = true;
          }

          var optLow = [];
          for (var k = 0; k < optionTexts.length; k++) {
            optLow.push(optionTexts[k].toLowerCase());
          }

          function textMatch(text) {
            var t = (text || '').trim();
            if (!t) return false;
            var tl = t.toLowerCase();
            for (var m = 0; m < optionTexts.length; m++) {
              if (t === optionTexts[m] || tl === optLow[m]) return true;
              if (t.indexOf(optionTexts[m]) >= 0 || tl.indexOf(optLow[m]) >= 0) return true;
            }
            return false;
          }

          function isVisible(el) {
            if (!el) return false;
            var r = el.getBoundingClientRect();
            if (r.width < 10 || r.height < 10) return false;
            if (r.top > window.innerHeight + 200 || r.bottom < -200) return false;
            if (r.left > window.innerWidth + 100 || r.right < -100) return false;
            return true;
          }

          function tryClick(el, text) {
            if (!el || !isVisible(el)) return false;
            var rect = el.getBoundingClientRect();
            el.click();
            return { ok: true, text: (text || el.innerText || '').trim().substring(0, 50), tag: el.tagName, pos: Math.round(rect.left) + ',' + Math.round(rect.top) };
          }

          // ---- 策略A：点击后新出现的元素（最可能是下拉选项） ----
          var newCandidates = [];
          var allElems = document.querySelectorAll('*');
          for (var i = 0; i < allElems.length; i++) {
            var el = allElems[i];
            if (!isVisible(el)) continue;
            var childCount = el.children ? el.children.length : 0;
            if (childCount > 10) continue; // 跳过容器
            var text = (el.innerText || '').trim();
            if (!text || text.length > 60 || text.length < 2) continue;
            if (!textMatch(text)) continue;
            var shortText = text.substring(0, 40);
            // 点击前不存在的元素 = 新出现的
            if (!snapMap[shortText]) {
              var r = el.getBoundingClientRect();
              newCandidates.push({ el: el, text: text, rect: r, area: r.width * r.height });
            }
          }
          if (newCandidates.length > 0) {
            // 选面积最小的（选项通常比容器小），排除按钮本身
            newCandidates.sort(function(a, b) { return a.area - b.area; });
            for (var nc = 0; nc < newCandidates.length; nc++) {
              var res = tryClick(newCandidates[nc].el, newCandidates[nc].text);
              if (res && res.ok) return res;
            }
          }

          // ---- 策略B：标准选项选择器 ----
          var sels1 = '[role="option"], [role="menuitem"], div[class*="option"], div[class*="item"], li[class*="option"], li[class*="item"], [class*="popover"] button, [class*="dropdown"] *';
          var all1 = document.querySelectorAll(sels1);
          for (var i1 = 0; i1 < all1.length; i1++) {
            var el1 = all1[i1];
            if (!isVisible(el1)) continue;
            var text1 = (el1.innerText || '').trim();
            if (!text1 || text1.length > 60) continue;
            if (textMatch(text1)) {
              var r1 = tryClick(el1, text1);
              if (r1) return r1;
            }
          }

          // ---- 策略C：TreeWalker 全文匹配 ----
          var candidates = [];
          var tw = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT, {
            acceptNode: function(node) {
              var tag = node.tagName;
              if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT') return NodeFilter.FILTER_REJECT;
              var childCount = node.children ? node.children.length : 0;
              if (childCount > 5) return NodeFilter.FILTER_SKIP;
              var txt = (node.innerText || '').trim();
              if (!txt || txt.length > 60 || txt.length < 2) return NodeFilter.FILTER_SKIP;
              if (!textMatch(txt)) return NodeFilter.FILTER_SKIP;
              if (!isVisible(node)) return NodeFilter.FILTER_SKIP;
              return NodeFilter.FILTER_ACCEPT;
            }
          });
          var node;
          while ((node = tw.nextNode())) {
            candidates.push(node);
            if (candidates.length > 30) break;
          }

          if (candidates.length > 0) {
            var viewportH = window.innerHeight;
            var scored = candidates.map(function(el) {
              var r = el.getBoundingClientRect();
              var area = r.width * r.height;
              var sizeScore = area > 200 && area < 50000 ? 100 : 0;
              var posScore = r.top > viewportH * 0.2 && r.top < viewportH * 0.95 ? 50 : 0;
              return { el: el, score: sizeScore + posScore, area: area, rect: r };
            });
            scored.sort(function(a, b) { return b.score - a.score || a.area - b.area; });
            var best = scored[0];
            return tryClick(best.el, (best.el.innerText || '').trim());
          }

          // ---- 诊断：收集视口中下部所有可见文本元素 ----
          var diag = [];
          var diagTw = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT, {
            acceptNode: function(node) {
              var tag = node.tagName;
              if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT') return NodeFilter.FILTER_REJECT;
              var childCount = node.children ? node.children.length : 0;
              if (childCount > 3) return NodeFilter.FILTER_SKIP;
              var txt = (node.innerText || '').trim();
              if (!txt || txt.length > 30 || txt.length < 1) return NodeFilter.FILTER_SKIP;
              var r = node.getBoundingClientRect();
              if (r.width < 10 || r.height < 10) return NodeFilter.FILTER_SKIP;
              if (r.top < 100 || r.top > window.innerHeight + 100) return NodeFilter.FILTER_SKIP;
              if (r.left < 50 || r.left > window.innerWidth - 50) return NodeFilter.FILTER_SKIP;
              return NodeFilter.FILTER_ACCEPT;
            }
          });
          var dnode;
          var dcount = 0;
          while ((dnode = diagTw.nextNode()) && dcount < 40) {
            var dr = dnode.getBoundingClientRect();
            diag.push(dnode.tagName + '|' + (dnode.innerText || '').trim().substring(0, 25) + '|' + Math.round(dr.left) + ',' + Math.round(dr.top));
            dcount++;
          }
          return { ok: false, diag: diag.join('; ') };
        } catch(e) {
          return { ok: false, error: e.message };
        }
      })()
    `;

    const optionResult = await safeExecuteJS<{ ok: boolean; text?: string; tag?: string; pos?: string; error?: string; diag?: string }>(
      webview, optionCode, 6000, `select_${label}`
    );

    if (optionResult.ok) {
      console.log(`[doubaoBridge] 已选择${label}: "${optionResult.text}", tag: ${optionResult.tag}, pos: ${optionResult.pos}`);
      await sleep(300);
      // 选择后重新确保配置栏可见
      await ensureVideoConfigBar();
      return true;
    }

    if (optionResult.diag) {
      console.warn(`[doubaoBridge] ${label} 下拉诊断(可见元素):`, optionResult.diag);
    }
    console.warn(`[doubaoBridge] ${label} DOM查找失败, 候选文本:`, optionTexts);
    return false;
  };

  // 1. 选择模型
  console.log(`[doubaoBridge] 配置视频模型: ${config.model}`);
  const modelTriggers = ['模型', 'Mini', 'Fast', '2.0'];
  await selectDropdownOption(modelTriggers, modelTexts, '视频模型');
  await sleep(400);

  // 2. 选择时长
  const is15sPatch = config.duration === '15s';
  if (is15sPatch) {
    console.log(`[doubaoBridge] 配置视频时长: 15s（通过请求拦截实现，UI 跳过）`);
  } else {
    console.log(`[doubaoBridge] 配置视频时长: ${config.duration}`);
    const durationTriggers = ['秒', 's', '时长'];
    await selectDropdownOption(durationTriggers, durationTexts, '视频时长');
  }
  await sleep(300);

  // 3. 选择比例
  console.log(`[doubaoBridge] 配置视频比例: ${config.aspectRatio}`);
  const ratioTriggers = ['比例', '比'];
  await selectDropdownOption(ratioTriggers, [config.aspectRatio], '视频比例');
  await sleep(400);

  // 最后确保在视频模式且配置栏正常
  await ensureVideoConfigBar();
}


/**
 * 上传参考图片
 * 通过 webview 的文件输入元素上传本地图片
 * 注意：此函数会先尝试找到文件输入元素并注入文件
 */
export async function uploadReferenceImages(
  webview: WebviewHandle,
  fileDataList: Array<{ name: string; base64: string; mime: string }>
): Promise<boolean> {
  if (!fileDataList || fileDataList.length === 0) return true;

  console.log(`[doubaoBridge] 上传参考图片: ${fileDataList.length} 张`);

  // 构造 JS 代码，通过 DataTransfer 注入文件
  const filesJson = JSON.stringify(fileDataList);
  const injectCode = `
    (function() {
      try {
        var fileDataList = ${filesJson};
        var inputs = document.querySelectorAll('input[type="file"]');
        if (inputs.length === 0) {
          return { ok: false, error: '未找到 file input 元素' };
        }
        
        var inp = inputs[0];
        var dataTransfer = new DataTransfer();
        
        for (var i = 0; i < fileDataList.length; i++) {
          var fd = fileDataList[i];
          // base64 解码为 ArrayBuffer
          var binary = atob(fd.base64);
          var bytes = new Uint8Array(binary.length);
          for (var j = 0; j < binary.length; j++) {
            bytes[j] = binary.charCodeAt(j);
          }
          var file = new File([bytes], fd.name, { type: fd.mime });
          dataTransfer.items.add(file);
        }
        
        inp.files = dataTransfer.files;
        inp.dispatchEvent(new Event('change', { bubbles: true }));
        
        return { ok: true, count: fileDataList.length };
      } catch (e) {
        return { ok: false, error: e.message };
      }
    })()
  `;

  const result = await safeExecuteJS<{ ok: boolean; count?: number; error?: string }>(
    webview,
    injectCode,
    5000,
    'injectFiles'
  );

  if (result?.ok) {
    console.log(`[doubaoBridge] 文件注入成功: ${result.count} 张，等待上传完成...`);
  } else {
    console.warn('[doubaoBridge] 文件注入失败:', result?.error);
    return false;
  }

  // 动态等待上传完成：轮询已显示的图片缩略图数量
  const expectedCount = fileDataList.length;
  const waitCode = `
    (function() {
      return new Promise(function(resolve) {
        var checked = 0;
        var maxCheck = 60; // 最多等30秒
        function check() {
          checked++;
          // 统计输入区域内已显示的图片缩略图（已上传完成的）
          var imgs = document.querySelectorAll('img');
          var uploadedCount = 0;
          for (var i = 0; i < imgs.length; i++) {
            var img = imgs[i];
            var rect = img.getBoundingClientRect();
            // 只统计输入框附近的缩略图（排除页面其他图片）
            if (rect.top > window.innerHeight * 0.4 && rect.top < window.innerHeight * 0.95 && rect.width > 30 && rect.height > 30) {
              var src = img.src || '';
              // 已上传的图片通常是 blob: 或 data: 或服务器URL，而非loading占位
              if (src.indexOf('blob:') === 0 || src.indexOf('data:image') === 0 || (src.indexOf('http') === 0 && src.indexOf('loading') < 0)) {
                uploadedCount++;
              }
            }
          }
          // 另一种方式：找上传后的图片容器/缩略图
          var containers = document.querySelectorAll('[class*="image-item"], [class*="img-item"], [class*="thumb"], [class*="preview"], [class*="upload"] img');
          var containerCount = 0;
          for (var j = 0; j < containers.length; j++) {
            var c = containers[j];
            if (c.tagName === 'IMG') {
              var cr = c.getBoundingClientRect();
              if (cr.top > window.innerHeight * 0.4 && cr.width > 20 && cr.height > 20) containerCount++;
            } else {
              var ci = c.querySelector ? c.querySelector('img') : null;
              if (ci) {
                var cr2 = ci.getBoundingClientRect();
                if (cr2.top > window.innerHeight * 0.4 && cr2.width > 20 && cr2.height > 20) containerCount++;
              }
            }
          }
          var finalCount = Math.max(uploadedCount, containerCount);
          if (finalCount >= ${expectedCount} || checked >= maxCheck) {
            resolve({ uploaded: finalCount, expected: ${expectedCount}, checked: checked });
          } else {
            setTimeout(check, 500);
          }
        }
        setTimeout(check, 500);
      });
    })()
  `;

  try {
    const waitResult = await webview.executeJavaScript(waitCode) as { uploaded: number; expected: number; checked: number };
    console.log(`[doubaoBridge] 图片上传完成检测: 已上传=${waitResult.uploaded}/${waitResult.expected}, 检测次数=${waitResult.checked}`);
    return true;
  } catch (e) {
    console.warn('[doubaoBridge] 等待图片上传超时或失败:', e);
    // 超时也返回true，不阻塞主流程
    return true;
  }
}

/**
 * 上传参考音频文件（视频生成配音用）
 * 策略：先尝试找音频专属上传入口，找不到则尝试通用文件上传
 */
export async function uploadReferenceAudio(
  webview: WebviewHandle,
  fileData: { name: string; base64: string; mime: string }
): Promise<boolean> {
  console.log(`[doubaoBridge] 上传参考音频: ${fileData.name}`);

  const fileJson = JSON.stringify(fileData);
  const injectCode = `
    (function() {
      try {
        var fd = ${fileJson};
        
        // 策略1：找 accept 包含 audio 的 file input
        var audioInputs = document.querySelectorAll('input[type="file"]');
        var targetInput = null;
        
        for (var i = 0; i < audioInputs.length; i++) {
          var inp = audioInputs[i];
          var accept = (inp.accept || '').toLowerCase();
          if (accept.indexOf('audio') >= 0 || accept.indexOf('mp3') >= 0 || accept.indexOf('wav') >= 0) {
            targetInput = inp;
            break;
          }
        }
        
        // 策略2：找"音频"/"配音"/"音乐"/"BGM"相关按钮附近的 file input
        if (!targetInput) {
          var keywords = ['音频', '配音', '音乐', 'BGM', 'bgm', '语音', 'sound', 'audio', 'voice', 'music'];
          var allButtons = document.querySelectorAll('button, [role="button"], div[class*="btn"], div[class*="button"]');
          
          for (var i = 0; i < allButtons.length; i++) {
            var btn = allButtons[i];
            var text = (btn.textContent || '').trim();
            var matched = false;
            for (var k = 0; k < keywords.length; k++) {
              if (text.indexOf(keywords[k]) >= 0 && text.length < 20) {
                matched = true;
                break;
              }
            }
            if (matched) {
              // 在按钮附近找 file input
              var parent = btn.parentElement;
              for (var d = 0; d < 5 && parent; d++) {
                var nearbyInputs = parent.querySelectorAll('input[type="file"]');
                if (nearbyInputs.length > 0) {
                  targetInput = nearbyInputs[0];
                  break;
                }
                parent = parent.parentElement;
              }
              if (targetInput) break;
            }
          }
        }
        
        // 策略3：点击"添加音频"类按钮触发后再找 input（有些是动态出现的）
        if (!targetInput) {
          var clickKeywords = ['添加音频', '上传音频', '选择音频', '添加配音', '上传配音', '选择配音', '添加音乐', '上传音乐', '选择BGM', '添加BGM'];
          var allElements = document.querySelectorAll('button, span, div, a');
          for (var i = 0; i < allElements.length; i++) {
            var el = allElements[i];
            var text = (el.textContent || '').trim();
            for (var k = 0; k < clickKeywords.length; k++) {
              if (text === clickKeywords[k] || text.indexOf(clickKeywords[k]) >= 0 && text.length < 15) {
                try {
                  el.click();
                } catch(e) {}
                // 等待一下再搜索
                break;
              }
            }
          }
          // 重新搜索 audio input
          var allInputs2 = document.querySelectorAll('input[type="file"]');
          for (var i = 0; i < allInputs2.length; i++) {
            var inp2 = allInputs2[i];
            var accept2 = (inp2.accept || '').toLowerCase();
            if (accept2.indexOf('audio') >= 0 || accept2.indexOf('mp3') >= 0) {
              targetInput = inp2;
              break;
            }
          }
        }
        
        if (!targetInput) {
          return { ok: false, error: '未找到音频上传入口' };
        }
        
        // 构造 File 并注入
        var binary = atob(fd.base64);
        var bytes = new Uint8Array(binary.length);
        for (var j = 0; j < binary.length; j++) {
          bytes[j] = binary.charCodeAt(j);
        }
        var file = new File([bytes], fd.name, { type: fd.mime });
        
        var dataTransfer = new DataTransfer();
        dataTransfer.items.add(file);
        targetInput.files = dataTransfer.files;
        targetInput.dispatchEvent(new Event('change', { bubbles: true }));
        
        return { ok: true, method: targetInput.accept || 'default' };
      } catch (e) {
        return { ok: false, error: e.message };
      }
    })()
  `;

  const result = await safeExecuteJS<{ ok: boolean; method?: string; error?: string }>(
    webview,
    injectCode,
    8000,
    'injectAudio'
  );

  if (result?.ok) {
    console.log(`[doubaoBridge] 音频上传成功, 方法: ${result.method}`);
  } else {
    console.warn('[doubaoBridge] 音频上传失败:', result?.error);
  }

  return result?.ok || false;
}

// ==================== 15秒 Seedance 2.0 视频生成注入 ====================

/**
 * 注入 15 秒 Seedance 2.0 视频生成补丁到豆包页面
 * 通过 monkey-patch fetch 和 XMLHttpRequest 拦截 /chat/completion 请求
 * 强制视频生成使用 seedance_v2.0 模型 + 15秒时长
 * 同时拦截 SSE 响应，提取 vid 和无水印视频地址存入 window.__doubaoVideoCache
 */
export async function inject15sVideoPatch(webview: WebviewHandle): Promise<boolean> {
  const injectCode = `
    (function() {
      if (window.__doubao15sPatched) return;
      window.__doubao15sPatched = true;
      window.__doubaoVideoCache = window.__doubaoVideoCache || {};

      function findVid(obj, depth) {
        if (depth === undefined) depth = 0;
        if (depth > 12 || !obj) return null;
        if (Array.isArray(obj)) {
          for (var i = 0; i < obj.length; i++) {
            var f = findVid(obj[i], depth + 1);
            if (f) return f;
          }
        } else if (typeof obj === 'object') {
          var vid = obj.vid || obj.video_id || obj.videoId || obj.key;
          if (vid && typeof vid === 'string' && vid.length >= 10) return vid;
          for (var key in obj) {
            if (obj.hasOwnProperty(key)) {
              var f = findVid(obj[key], depth + 1);
              if (f) return f;
            }
          }
        }
        return null;
      }

      function findAllPlayInfos(obj, results, depth) {
        if (depth === undefined) depth = 0;
        if (!results) results = [];
        if (depth > 10 || !obj) return results;
        if (Array.isArray(obj)) {
          for (var i = 0; i < obj.length; i++) {
            findAllPlayInfos(obj[i], results, depth + 1);
          }
        } else if (typeof obj === 'object') {
          if (obj.play_info) results.push(obj.play_info);
          for (var key in obj) {
            if (obj.hasOwnProperty(key) && key !== 'play_info') {
              findAllPlayInfos(obj[key], results, depth + 1);
            }
          }
        }
        return results;
      }

      function removeWatermark(url) {
        if (!url || typeof url !== 'string') return url;
        return url.replace(/lr=[^&]+/g, 'lr=video_gen_no_watermark');
      }

      function processVideoData(data) {
        try {
          var vid = findVid(data);
          if (vid) {
            window.__doubaoVideoCache.lastVid = vid;
            var playInfos = findAllPlayInfos(data);
            for (var i = 0; i < playInfos.length; i++) {
              var pi = playInfos[i];
              var mainUrl = pi.main || pi.main_url;
              if (mainUrl && typeof mainUrl === 'string') {
                var cleanUrl = removeWatermark(mainUrl);
                window.__doubaoVideoCache[vid] = cleanUrl;
                window.__doubaoVideoCache.lastVideoUrl = cleanUrl;
                console.log('[15sPatch] 找到视频:', vid, cleanUrl.substring(0, 80) + '...');
                break;
              }
            }
          }
        } catch(e) {}
      }

      function patchBody(rawBody) {
        try {
          var payload = JSON.parse(rawBody);
          var ability = payload.chat_ability;
          if (!ability || Number(ability.ability_type) !== 17) {
            return { changed: false, body: rawBody };
          }
          var param;
          try { param = JSON.parse(ability.ability_param); } catch(e) { param = {}; }
          param.model = 'seedance_v2.0';
          param.duration = 15;
          ability.ability_param = JSON.stringify(param);
          console.log('[15sPatch] 已注入 Seedance 2.0 + 15s 参数');
          return { changed: true, body: JSON.stringify(payload) };
        } catch(e) {
          return { changed: false, body: rawBody };
        }
      }

      function readSSEStream(reader) {
        var decoder = new TextDecoder();
        var buffer = '';
        function pump() {
          return reader.read().then(function(result) {
            if (result.done) return;
            buffer += decoder.decode(result.value, { stream: true });
            var lines = buffer.split('\\n');
            buffer = lines.pop() || '';
            for (var i = 0; i < lines.length; i++) {
              var line = lines[i];
              if (line.indexOf('data:') === 0) {
                var jsonStr = line.substring(5).trim();
                if (jsonStr) {
                  try {
                    var data = JSON.parse(jsonStr);
                    processVideoData(data);
                  } catch(e) {}
                }
              }
            }
            return pump();
          });
        }
        pump().catch(function() {});
      }

      var originalFetch = window.fetch;
      window.fetch = function patchedFetch(input, init) {
        var url = typeof input === 'string' ? input : (input && input.url) || '';
        var isCompletion = url.indexOf('/chat/completion') >= 0;
        // 仅拦截明确的视频相关 API，避免误伤其他请求导致页面异常
        var isVideoApi = isCompletion ||
                         url.indexOf('get_play_info') >= 0 ||
                         url.indexOf('play_info') >= 0 ||
                         url.indexOf('/video/') >= 0;

        if (isCompletion && init && init.body) {
          try {
            var patched = patchBody(init.body);
            if (patched.changed) {
              init = Object.assign({}, init, { body: patched.body });
            }
          } catch(e) {}
        }

        return originalFetch.apply(this, [input, init]).then(function(resp) {
          if (isVideoApi && resp.body) {
            try {
              var ct = resp.headers.get('content-type') || '';
              if (ct.indexOf('text/event-stream') >= 0) {
                var teed = resp.body.tee();
                readSSEStream(teed[1].getReader());
                return new Response(teed[0], {
                  status: resp.status,
                  statusText: resp.statusText,
                  headers: resp.headers,
                });
              } else if (ct.indexOf('application/json') >= 0) {
                // 普通 JSON 响应（如 get_play_info），克隆一份解析
                return resp.clone().json().then(function(data) {
                  processVideoData(data);
                  return resp;
                }).catch(function() { return resp; });
              }
            } catch(e) {
              // 任何异常都不影响原始响应
              return resp;
            }
          }
          return resp;
        }).catch(function(err) {
          throw err; // 透传原始错误
        });
      };

      var originalXHROpen = XMLHttpRequest.prototype.open;
      var originalXHRSend = XMLHttpRequest.prototype.send;
      var xhrUrlMap = new WeakMap();

      XMLHttpRequest.prototype.open = function(method, url) {
        xhrUrlMap.set(this, url);
        return originalXHROpen.apply(this, arguments);
      };

      XMLHttpRequest.prototype.send = function(body) {
        var url = xhrUrlMap.get(this) || '';
        var isCompletion = url.indexOf('/chat/completion') >= 0;

        if (isCompletion && body) {
          var patched = patchBody(body);
          if (patched.changed) { body = patched.body; }
        }

        this.addEventListener('load', function() {
          var xhrUrl = xhrUrlMap.get(this) || '';
          if (xhrUrl.indexOf('chain/single') >= 0 ||
              xhrUrl.indexOf('/chat/completion') >= 0 ||
              xhrUrl.indexOf('get_play_info') >= 0 ||
              xhrUrl.indexOf('play_info') >= 0 ||
              xhrUrl.indexOf('media/') >= 0) {
            try {
              var resp = JSON.parse(this.responseText);
              processVideoData(resp);
            } catch(e) {}
          }
        });

        return originalXHRSend.call(this, body);
      };

      console.log('[15sPatch] Seedance 2.0 + 15s 视频生成补丁已注入');
    })();
  `;

  try {
    await safeExecuteJS(webview, injectCode, 5000, 'inject15sPatch');
    return true;
  } catch (err: any) {
    console.warn('[doubaoBridge] 注入15s补丁失败:', err.message);
    return false;
  }
}

/**
 * 从页面全局变量获取最新的视频 URL（无水印）
 */
export async function getCachedVideoUrl(webview: WebviewHandle): Promise<{ vid: string; videoUrl: string } | null> {
  const code = `
    (function() {
      var cache = window.__doubaoVideoCache;
      if (!cache) return { found: false };
      if (cache.lastVid && cache.lastVideoUrl) {
        return { found: true, vid: cache.lastVid, videoUrl: cache.lastVideoUrl };
      }
      return { found: false };
    })();
  `;

  try {
    const result = await safeExecuteJS<{ found: boolean; vid?: string; videoUrl?: string }>(
      webview, code, 5000, 'getCachedVideoUrl'
    );
    if (result.found && result.vid && result.videoUrl) {
      return { vid: result.vid, videoUrl: result.videoUrl };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * 通过 vid 获取视频播放地址（备用方案，在 webview 页面上下文调用豆包 API）
 */
export async function getVideoPlayUrl(webview: WebviewHandle, vid: string): Promise<string | null> {
  const code = `
    (function() {
      var vid = '${vid}';
      var uuid = crypto.randomUUID ? crypto.randomUUID() : Date.now().toString();
      var params = 'version_code=20800&language=zh&device_platform=web&aid=497858&real_aid=497858&pkg_type=release_version&device_id=7622868208475047462&pc_version=3.20.2&web_id=&tea_uuid=&region=CN&sys_region=CN&samantha_web=1&web_platform=browser&use-olympus-account=1&web_tab_id=' + uuid;
      var url = '/samantha/media/get_play_info?' + params;
      return fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'agw-js-conv': 'str',
          'origin': location.origin,
          'referer': location.href,
        },
        credentials: 'include',
        body: JSON.stringify({ key: vid, type: 'video' }),
      }).then(function(r) { return r.json(); })
        .then(function(data) {
          if (data && data.code === 0 && data.data) {
            var mainUrl = '';
            if (data.data.original_media_info && data.data.original_media_info.main_url) {
              mainUrl = data.data.original_media_info.main_url;
            } else if (data.data.play_info && data.data.play_info.main) {
              mainUrl = data.data.play_info.main;
            } else if (data.data.play_infos && data.data.play_infos.length > 0) {
              mainUrl = data.data.play_infos[0].main;
            }
            if (mainUrl) {
              mainUrl = mainUrl.replace(/lr=[^&]+/g, 'lr=video_gen_no_watermark');
              return { success: true, url: mainUrl };
            }
          }
          return { success: false, error: '无播放地址' };
        })
        .catch(function(e) {
          return { success: false, error: e.message };
        });
    })();
  `;

  try {
    const result = await webview.executeJavaScript(code);
    if (result && result.success && result.url) {
      return result.url;
    }
    return null;
  } catch (err: any) {
    console.warn('[doubaoBridge] 获取视频播放地址失败:', err.message);
    return null;
  }
}
