/**
 * src/components/BrowserPanel.tsx
 * 内嵌浏览器面板 — V2 自动化执行
 *
 * 核心职责：
 * 1. 展示对应账号的 webview，隔离 session
 * 2. 接收自动化任务 → 注入提示词 → 提交 → 轮询结果
 * 3. 管理 webview 导航（前进/后退/刷新/首页）
 */

import React, { useRef, useEffect, useCallback, useState } from 'react';
import type { Account, Task } from '../types';
import { useAccountStore } from '../store/useAccountStore';
import { useTaskStore } from '../store/useTaskStore';
import {
  injectPrompt,
  submitPrompt,
  checkGenerating,
  getResultUrl,
  navigateToChat,
  waitForChatReady,
} from '../utils/doubaoBridge';

// ==================== 类型 ====================

interface BrowserPanelProps {
  /** 当前活跃账号 */
  activeAccount: Account | null;
  /** 浏览器刷新触发器 */
  refreshKey: number;
  /** 当前自动化任务 */
  activeTask: Task | null;
}

// ==================== 组件 ====================

const BrowserPanel: React.FC<BrowserPanelProps> = ({
  activeAccount,
  refreshKey,
  activeTask,
}) => {
  /** webview 容器 DOM ref */
  const webviewRef = useRef<HTMLDivElement>(null);
  /** webview 元素直接引用 */
  const webviewTagRef = useRef<HTMLWebViewElement | null>(null);

  /** 加载状态 */
  const [loading, setLoading] = useState(true);
  /** 加载进度文字 */
  const [loadText, setLoadText] = useState('加载豆包中...');
  /** 自动化阶段 UI 状态（从 store 读取） */
  const autoStage = useTaskStore((s) => s.automationState);
  /** 自动化消息 */
  const [autoMessage, setAutoMessage] = useState('');

  const updateAccountStatus = useAccountStore((s) => s.updateAccountStatus);

  // ---- webview 生命周期 ----

  /**
   * 当 activeAccount 或 refreshKey 变化时，销毁旧 webview 并创建新的
   */
  useEffect(() => {
    if (!webviewRef.current || !activeAccount) return;

    const container = webviewRef.current; // 提前捕获，避免 TS 窄化失效
    (async () => {
    // 清理旧 webview
    container.innerHTML = '';

    setLoading(true);
    setLoadText('加载豆包中...');
    useTaskStore.getState().setAutomationState('idle');
    setAutoMessage('');

    // 确保主进程 session 已初始化（重启后 partition 可能未被预创建）
    await window.electronAPI.accounts.getPartition(activeAccount.id);

    // 创建 webview
    const webview = document.createElement('webview') as HTMLWebViewElement;
    webviewTagRef.current = webview;

    // 基础属性
    webview.setAttribute('src', 'https://www.doubao.com/chat/');
    webview.setAttribute('partition', `persist:doubao_${activeAccount.partition}`);
    webview.setAttribute('allowpopups', 'true');
    webview.setAttribute('useragent',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    );
    webview.setAttribute('width', '100%');
    webview.setAttribute('height', '100%');
    webview.style.width = '100%';
    webview.style.height = '100%';
    webview.style.border = 'none';
    webview.style.outline = 'none';

    // 事件监听
    webview.addEventListener('did-start-loading', () => {
      setLoading(true);
      setLoadText('页面加载中...');
    });

    webview.addEventListener('did-stop-loading', () => {
      setLoading(false);
    });

    webview.addEventListener('did-finish-load', () => {
      setLoading(false);
      setLoadText('豆包已就绪');
      setTimeout(() => setLoadText(''), 1500);
    });

    webview.addEventListener('did-fail-load', () => {
      setLoading(false);
      setLoadText('加载失败，请检查网络');
    });

    container.appendChild(webview);
    })();

    return () => {
      if (webviewTagRef.current) {
        webviewTagRef.current.remove();
        webviewTagRef.current = null;
      }
    };
  }, [activeAccount?.id, refreshKey]);

  // ---- V2 自动化执行 ----

  /**
   * 监听 activeTask 变化，当有新任务到来时自动执行
   */
  useEffect(() => {
    if (!activeTask || !webviewTagRef.current) return;
    // 守卫：确保任务指派的账号匹配当前活跃账号
    if (activeTask.assignedAccountId !== activeAccount?.id) return;

    const webview = webviewTagRef.current;

    // 执行自动化流程
    (async () => {
      try {
        // 并发守卫：已有自动化在执行则跳过
        if (useTaskStore.getState().automationState !== 'idle') return;

        // 1. 等待 webview 加载完成
        console.log('[BrowserPanel] waitForWebviewReady 开始');
        useTaskStore.getState().setAutomationState('injecting');
        setAutoMessage('等待页面就绪...');
        await waitForWebviewReady(webview, 15000);
        console.log('[BrowserPanel] waitForWebviewReady 完成');

        // 2. 导航到豆包聊天页，用 waitForChatReady 等 DOM 就绪
        console.log('[BrowserPanel] navigateToChat 开始');
        await navigateToChat(webview);
        await waitForWebviewReady(webview, 15000);
        console.log('[BrowserPanel] navigateToChat + waitForWebviewReady 完成');

        // 3. 注入提示词（10s 超时保护）
        console.log('[BrowserPanel] injectPrompt 开始, prompt:', activeTask.prompt.substring(0, 50));
        useTaskStore.getState().setAutomationState('injecting');
        setAutoMessage('正在注入提示词...');
        const injected = await Promise.race([
          injectPrompt(webview, activeTask.prompt),
          new Promise<boolean>((_, reject) =>
            setTimeout(() => reject(new Error('注入提示词超时（10s）')), 10000)
          ),
        ]);
        console.log('[BrowserPanel] injectPrompt 结果:', injected);
        if (!injected) {
          throw new Error('注入提示词失败：未找到输入框');
        }
        await sleep(800);

        // 4. 提交（10s 超时保护）
        console.log('[BrowserPanel] submitPrompt 开始');
        useTaskStore.getState().setAutomationState('submitting');
        setAutoMessage('正在发送...');
        const submitted = await Promise.race([
          submitPrompt(webview),
          new Promise<boolean>((_, reject) =>
            setTimeout(() => reject(new Error('提交超时（10s）')), 10000)
          ),
        ]);
        console.log('[BrowserPanel] submitPrompt 结果:', submitted);
        if (!submitted) {
          throw new Error('提交失败：未找到发送按钮');
        }

        // 5. 轮询等待生成
        useTaskStore.getState().setAutomationState('generating');
        setAutoMessage('等待豆包生成回复...');

        // 先等一小段时间让生成开始
        await sleep(3000);

        // 开始轮询（最多 5 分钟）
        const maxAttempts = 100;
        const intervalMs = 3000;
        let generating = true;

        for (let i = 0; i < maxAttempts; i++) {
          await sleep(intervalMs);
          generating = await Promise.race([
            checkGenerating(webview),
            new Promise<boolean>((_, reject) =>
              setTimeout(() => reject(new Error('生成检测超时（10s）')), 10000)
            ),
          ]);
          if (!generating) {
            break;
          }
          setAutoMessage(`等待豆包生成回复... (${Math.round((i * intervalMs) / 1000)}s)`);
        }

        if (generating) {
          throw new Error('生成超时（超过 5 分钟）');
        }

        // 6. 获取结果 URL
        useTaskStore.getState().setAutomationState('completed');
        setAutoMessage('生成完成！');
        const resultUrl = await getResultUrl(webview);

        // 7. 通知 store 完成任务
        const { completeAutomation } = useTaskStore.getState();
        await completeAutomation(activeTask.id, resultUrl);
      } catch (err: any) {
        console.error('[BrowserPanel] 自动化执行失败:', err.message);
        useTaskStore.getState().setAutomationState('failed');
        setAutoMessage(err.message);

        if (activeTask) {
          const { failAutomation } = useTaskStore.getState();
          await failAutomation(activeTask.id, err.message);
        }
      }
    })();
  }, [activeTask?.id, activeAccount?.id]);

  // ---- 导航方法 ----

  /** 刷新 */
  const handleRefresh = useCallback(() => {
    if (webviewTagRef.current) {
      webviewTagRef.current.reload();
    }
  }, []);

  /** 后退 */
  const handleGoBack = useCallback(() => {
    if (webviewTagRef.current?.canGoBack()) {
      webviewTagRef.current.goBack();
    }
  }, []);

  /** 前进 */
  const handleGoForward = useCallback(() => {
    if (webviewTagRef.current?.canGoForward()) {
      webviewTagRef.current.goForward();
    }
  }, []);

  /** 回到首页 */
  const handleGoHome = useCallback(() => {
    if (webviewTagRef.current) {
      webviewTagRef.current.loadURL('https://www.doubao.com/chat/');
    }
  }, []);

  // ---- 渲染 ----

  if (!activeAccount) {
    return (
      <div className="browser-panel-empty">
        <div className="browser-empty-content">
          <svg width="64" height="64" viewBox="0 0 64 64" fill="none">
            <rect x="4" y="8" width="56" height="40" rx="4" stroke="#38385a" strokeWidth="2" />
            <path d="M4 16h56" stroke="#38385a" strokeWidth="2" />
            <circle cx="12" cy="12" r="2" fill="#38385a" />
            <circle cx="19" cy="12" r="2" fill="#38385a" />
            <circle cx="26" cy="12" r="2" fill="#38385a" />
          </svg>
          <p>选择一个账号以打开浏览器</p>
        </div>
      </div>
    );
  }

  return (
    <div className="browser-panel">
      {/* 导航栏 */}
      <div className="browser-toolbar">
        <div className="browser-nav-buttons">
          <button onClick={handleGoBack} title="后退">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <path d="M10.5 3L5.5 8l5 5" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <button onClick={handleGoForward} title="前进">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <path d="M5.5 3l5 5-5 5" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <button onClick={handleRefresh} title="刷新">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <path d="M13.5 8a5.5 5.5 0 00-10-2.5M2.5 8a5.5 5.5 0 0010 2.5" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" />
              <path d="M2 3v3h3M14 13v-3h-3" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <button onClick={handleGoHome} title="回到豆包首页">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <path d="M2 6l6-4.5L14 6v7.5a.5.5 0 01-.5.5h-3.5V9H6v5H2.5a.5.5 0 01-.5-.5V6z" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
        <div className="browser-url-bar">
          <span className="browser-url-text">doubao.com</span>
        </div>
      </div>

      {/* webview 容器 */}
      <div className="browser-viewport">
        {loading && (
          <div className="browser-loading-overlay">
            <div className="browser-loading-spinner" />
            <span>{loadText}</span>
          </div>
        )}

        {/* V2 自动化状态覆盖层 */}
        {autoStage !== 'idle' && autoStage !== 'completed' && (
          <div className="automation-overlay">
            <div className="automation-indicator">
              <div className="automation-spinner" />
              <span>{autoMessage}</span>
            </div>
          </div>
        )}

        {autoStage === 'completed' && (
          <div className="automation-toast completed">
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
              <circle cx="9" cy="9" r="8" stroke="#34d399" strokeWidth="2" />
              <path d="M5.5 9l2.5 2.5 4.5-5" stroke="#34d399" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span>{autoMessage}</span>
          </div>
        )}

        {autoStage === 'failed' && (
          <div className="automation-toast failed">
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
              <circle cx="9" cy="9" r="8" stroke="#fb7185" strokeWidth="2" />
              <path d="M6 6l6 6M12 6l-6 6" stroke="#fb7185" strokeWidth="2" strokeLinecap="round" />
            </svg>
            <span>执行失败: {autoMessage}</span>
          </div>
        )}

        <div
          ref={webviewRef}
          style={{ position: 'relative', width: '100%', height: '100%' }}
        />
      </div>
    </div>
  );
};

// ==================== 工具函数 ====================

/**
 * 等待 webview 页面完全就绪（DOM 已渲染 textarea）
 *
 * 策略：
 * 1. 先等 did-finish-load 事件（主框架加载完成）
 * 2. 然后用 waitForChatReady 轮询 DOM，确认 textarea 真实可见后再 resolve
 *    避免 did-finish-load 触发时 DOM 尚未完全渲染的问题
 */
function waitForWebviewReady(webview: HTMLWebViewElement, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    // 先检查是否已经加载完成（避免 did-finish-load 已错过）
    const isLoading = (webview as any).isLoading?.() ?? true;
    if (!isLoading) {
      console.log('[BrowserPanel] webview 已加载完成，直接检查 DOM 就绪');
      waitForChatReady(webview, 15000).then((ready) => {
        if (ready) resolve();
        else reject(new Error('页面 DOM 就绪检测失败：textarea 未在 15 秒内出现'));
      }).catch((err) => reject(new Error('页面就绪检测失败: ' + err.message)));
      return;
    }

    // 还没加载完，等 did-finish-load
    console.log('[BrowserPanel] webview 加载中，等待 did-finish-load...');
    const timer = setTimeout(() => {
      webview.removeEventListener('did-finish-load', onLoad);
      reject(new Error('页面就绪检测超时（' + timeoutMs + 'ms）'));
    }, timeoutMs);

    const onLoad = async () => {
      clearTimeout(timer);
      console.log('[BrowserPanel] did-finish-load 触发，开始 DOM 轮询');
      try {
        const ready = await waitForChatReady(webview, 15000);
        if (ready) {
          resolve();
        } else {
          reject(new Error('页面 DOM 就绪检测失败：textarea 未在 15 秒内出现'));
        }
      } catch (err) {
        reject(new Error('页面就绪检测失败: ' + (err as Error).message));
      }
    };

    webview.addEventListener('did-finish-load', onLoad, { once: true });
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export default BrowserPanel;
