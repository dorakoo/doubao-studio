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
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    console.log(`[doubaoBridge] injectPrompt 第 ${attempt}/${maxRetries} 次尝试`);

    const result = await tryInjectOnce(webview, prompt);
    if (result.ok) {
      console.log(`[doubaoBridge] injectPrompt 成功 method=${result.method} tag=${result.tag} actualLen=${result.actualLen} expectedLen=${prompt.length} preview="${result.preview || ''}"`);
      return true;
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

        // 策略1：聚焦 + execCommand insertText（最兼容富文本编辑器）
        try {
          input.focus();
          document.execCommand('selectAll', false, null);
          var ok1 = document.execCommand('insertText', false, promptText);
          if (ok1) {
            input.dispatchEvent(new Event('input', { bubbles: true }));
            var v1 = verifyValue();
            if (v1.pass) {
              console.log('[doubaoBridge] execCommand 注入成功, len=' + v1.actualLen);
              setTimeout(function() { input.dispatchEvent(new Event('input', { bubbles: true })); }, 100);
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

        // 策略4：直接设置 textContent（contenteditable 兜底）
        if (best.type === 'contenteditable') {
          input.innerHTML = '';
          input.textContent = promptText;
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
          input.focus();
          var v4 = verifyValue();
          if (v4.pass) {
            return { ok: true, tag: input.tagName, method: 'textContent', actualLen: v4.actualLen, preview: v4.preview };
          }
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
        var targetBtn = null;
        var candidates = [];

        // 找所有可点击元素中包含"生成视频"文字的
        var clickables = document.querySelectorAll('button, [role="button"], div[class*="btn"], div[class*="button"], span[class*="btn"]');
        for (var i = 0; i < clickables.length; i++) {
          var el = clickables[i];
          var text = (el.textContent || '').trim();
          if (text.indexOf('生成视频') < 0) continue;
          if (el.disabled) continue;
          var rect = el.getBoundingClientRect();
          if (rect.width < 20 || rect.height < 20) continue;
          if (rect.top < 0 || rect.top > viewportH) continue;
          
          // 排除顶部 Tab 区域（top < 150 的大概率是Tab）
          if (rect.top < 150) continue;
          
          // 排除非常小的文字标签（不是按钮）
          if (rect.width < 50 && rect.height < 30) continue;
          
          var score = 0;
          // 位置在页面中部（素材图区域）的优先
          if (rect.top > viewportH * 0.2 && rect.top < viewportH * 0.8) score += 100;
          // 越靠下越可能是生成按钮（在素材图下方）
          if (rect.top > viewportH * 0.4) score += 50;
          // 按钮有一定宽度
          if (rect.width > 80) score += 30;
          // 是 button 元素加分
          if (el.tagName === 'BUTTON') score += 20;
          
          candidates.push({ el: el, score: score, text: text, top: rect.top, w: rect.width, h: rect.height });
        }

        if (candidates.length === 0) {
          // 兜底：再找一遍，放宽条件（只要有"生成"且在素材图区域）
          var allClickables = document.querySelectorAll('button, [role="button"], div[onclick], span[onclick]');
          for (var j = 0; j < allClickables.length; j++) {
            var el2 = allClickables[j];
            var text2 = (el2.textContent || '').trim();
            if (text2 !== '生成视频' && text2 !== '生成') continue;
            if (el2.disabled) continue;
            var rect2 = el2.getBoundingClientRect();
            if (rect2.width < 30 || rect2.height < 20) continue;
            if (rect2.top < viewportH * 0.3 || rect2.top > viewportH * 0.9) continue;
            targetBtn = el2;
            break;
          }
        } else {
          // 按分数排序，取最高的
          candidates.sort(function(a, b) { return b.score - a.score; });
          targetBtn = candidates[0].el;
          console.log('[doubaoBridge] 视频生成按钮候选: ' + candidates.slice(0, 3).map(function(c) { return c.text + '(top=' + Math.round(c.top) + ',w=' + Math.round(c.w) + ',score=' + c.score + ')'; }).join('; '));
        }

        if (targetBtn) {
          targetBtn.click();
          return { ok: true, method: 'click-video-generate', text: (targetBtn.textContent || '').trim() };
        }
        
        return { ok: false, error: '未找到视频生成按钮，候选数=' + candidates.length };
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
            // 跳过太小的图（可能是图标缩略图）
            var w = imgs[i].naturalWidth || imgs[i].width || 0;
            var h = imgs[i].naturalHeight || imgs[i].height || 0;
            if (w > 0 && h > 0 && w < 50 && h < 50) continue;
            if (result.indexOf(src) === -1) {
              result.push(src);
            }
          }
          // 提取视频 poster
          var videos = container.querySelectorAll('video');
          for (var j = 0; j < videos.length; j++) {
            var poster = videos[j].poster || '';
            if (poster && result.indexOf(poster) === -1) {
              result.push(poster);
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

        // ========== 方法2：如果方法1没找到，用"左侧消息+有图片"判断 AI 消息 ==========
        if (aiContainers.length === 0 && bestMsgs.length > 0) {
          for (var k = 0; k < bestMsgs.length; k++) {
            var msg2 = bestMsgs[k];
            var imgs2 = msg2.querySelectorAll('img');
            if (imgs2.length > 0 && isLeftSide(msg2)) {
              // 左侧消息且有图片 → 认为是AI产物消息
              var hasContentImg = false;
              for (var p = 0; p < imgs2.length; p++) {
                var s = imgs2[p].src || '';
                if (s.indexOf('http') >= 0 && s.indexOf('icon') < 0 && s.indexOf('avatar') < 0 && s.indexOf('emoji') < 0) {
                  hasContentImg = true;
                  break;
                }
              }
              if (hasContentImg) {
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

        // ========== 兜底：如果以上方法都没找到，用旧方法全页面扫描（兼容特殊页面） ==========
        if (urls.length === 0) {
          var allImgs = document.querySelectorAll('img');
          for (var q = 0; q < allImgs.length; q++) {
            var src3 = allImgs[q].src || '';
            if (!src3 || src3.indexOf('data:') === 0) continue;
            if (src3.indexOf('icon') >= 0 || src3.indexOf('avatar') >= 0 ||
                src3.indexOf('emoji') >= 0 || src3.indexOf('logo') >= 0 ||
                src3.indexOf('badge') >= 0 || src3.indexOf('status') >= 0) continue;
            if (src3.indexOf('http') < 0) continue;
            var isContent = src3.indexOf('image') >= 0 || src3.indexOf('img') >= 0 ||
                            src3.indexOf('cdn') >= 0 || src3.indexOf('.png') >= 0 ||
                            src3.indexOf('.jpg') >= 0 || src3.indexOf('.webp') >= 0 ||
                            src3.indexOf('tos-') >= 0 || src3.indexOf('bytecdn') >= 0 ||
                            src3.indexOf('byteimg') >= 0 || src3.indexOf('doubao') >= 0;
            if (!isContent) continue;
            if (urls.indexOf(src3) === -1) {
              urls.push(src3);
            }
          }
          // 视频兜底
          var allVideos = document.querySelectorAll('video');
          for (var v = 0; v < allVideos.length; v++) {
            var p3 = allVideos[v].poster || '';
            if (p3 && urls.indexOf(p3) === -1) {
              urls.push(p3);
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
    'seedance-2.0': ['Seedance 2.0'],
    'seedance-2.0-fast': ['Seedance 2.0 Fast', '2.0 Fast'],
    'seedance-2.0-mini': ['Seedance 2.0 Mini', '2.0 Mini', 'Mini'],
  };

  const modelTexts = modelLabels[config.model] || [config.model];

  // 通用点击函数：通过文本匹配找到并点击元素
  const clickByText = async (texts: string[], label: string): Promise<boolean> => {
    for (const text of texts) {
      const code = `
        (function() {
          try {
            var allEls = document.querySelectorAll('button, [role="tab"], [role="option"], div, span, label');
            for (var i = 0; i < allEls.length; i++) {
              var el = allEls[i];
              var innerText = (el.innerText || '').trim();
              var directText = '';
              for (var j = 0; j < el.childNodes.length; j++) {
                if (el.childNodes[j].nodeType === 3) directText += el.childNodes[j].textContent || '';
              }
              directText = directText.trim();

              if (directText === '${text}' || innerText === '${text}') {
                var rect = el.getBoundingClientRect();
                if (rect.width > 0 && rect.height > 0 && el.offsetParent !== null) {
                  el.click();
                  return { ok: true, tag: el.tagName, text: '${text}', pos: Math.round(rect.left) + ',' + Math.round(rect.top) };
                }
              }
            }
            // 尝试 includes 匹配（更宽松）
            for (var i = 0; i < allEls.length; i++) {
              var el = allEls[i];
              var innerText = (el.innerText || '').trim();
              if (innerText.indexOf('${text}') >= 0 && innerText.length < 80) {
                var rect = el.getBoundingClientRect();
                if (rect.width > 0 && rect.height > 0 && rect.width < 200 && el.offsetParent !== null) {
                  el.click();
                  return { ok: true, tag: el.tagName, text: innerText.substring(0, 30), pos: Math.round(rect.left) + ',' + Math.round(rect.top) };
                }
              }
            }
            return { ok: false };
          } catch (e) {
            return { ok: false, error: e.message };
          }
        })()
      `;
      const result = await safeExecuteJS<{ ok: boolean; tag?: string; text?: string; pos?: string; error?: string }>(
        webview, code, 3000, 'clickByText'
      );
      if (result.ok) {
        console.log(`[doubaoBridge] 已点击${label}: "${result.text}", tag: ${result.tag}, pos: ${result.pos}`);
        return true;
      }
    }
    console.warn(`[doubaoBridge] 未找到${label}元素，尝试文本:`, texts);
    return false;
  };

  // 1. 选择模型
  console.log(`[doubaoBridge] 配置视频模型: ${config.model}`);
  await clickByText(modelTexts, '视频模型');
  await sleep(500);

  // 2. 选择时长
  console.log(`[doubaoBridge] 配置视频时长: ${config.duration}`);
  const durationSec = config.duration.replace('s', '');
  const durationTexts = [
    durationSec + ' 秒',
    durationSec + '秒',
    config.duration,
  ];
  await clickByText(durationTexts, '视频时长');
  await sleep(500);

  // 3. 选择比例
  console.log(`[doubaoBridge] 配置视频比例: ${config.aspectRatio}`);
  await clickByText([config.aspectRatio], '视频比例');
  await sleep(500);
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
        if (depth > 10 || !obj) return null;
        if (Array.isArray(obj)) {
          for (var i = 0; i < obj.length; i++) {
            var f = findVid(obj[i], depth + 1);
            if (f) return f;
          }
        } else if (typeof obj === 'object') {
          var vid = obj.vid || obj.video_id;
          if (vid && typeof vid === 'string' && vid.indexOf('v0') === 0) return vid;
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

        if (isCompletion && init && init.body) {
          var patched = patchBody(init.body);
          if (patched.changed) {
            init = Object.assign({}, init, { body: patched.body });
          }
        }

        return originalFetch.apply(this, [input, init]).then(function(resp) {
          if (isCompletion && resp.body) {
            var ct = resp.headers.get('content-type') || '';
            if (ct.indexOf('text/event-stream') >= 0) {
              var teed = resp.body.tee();
              readSSEStream(teed[1].getReader());
              return new Response(teed[0], {
                status: resp.status,
                statusText: resp.statusText,
                headers: resp.headers,
              });
            }
          }
          return resp;
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
          if (xhrUrl.indexOf('chain/single') >= 0 || xhrUrl.indexOf('/chat/completion') >= 0) {
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
