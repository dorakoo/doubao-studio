/**
 * src/components/BrowserPanel.tsx
 * 内嵌浏览器面板 — V2 自动化执行（多 webview 常驻版）
 *
 * 核心改进：
 * - 为每个账号维护独立的 webview，切换账号不销毁
 * - 用 CSS 控制显隐，后台 webview 继续运行
 * - 任务可以在非当前显示的账号上执行
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
  /** 所有账号列表 */
  accounts: Account[];
  /** 当前活跃账号 */
  activeAccount: Account | null;
  /** 浏览器刷新触发器 */
  refreshKey: number;
  /** 当前自动化任务 */
  activeTask: Task | null;
}

// ==================== 组件 ====================

const BrowserPanel: React.FC<BrowserPanelProps> = ({
  accounts,
  activeAccount,
  refreshKey,
  activeTask,
}) => {
  /** webview 总容器 DOM ref */
  const poolRef = useRef<HTMLDivElement>(null);
  /** webview 注册表：accountId -> webview 元素 */
  const registryRef = useRef<Map<string, HTMLWebViewElement>>(new Map());
  /** 每个账号的加载状态 */
  const loadingMapRef = useRef<Map<string, boolean>>(new Map());

  /** 当前活跃账号的加载状态（用于 UI 显示） */
  const [activeLoading, setActiveLoading] = useState(true);
  const [loadText, setLoadText] = useState('加载豆包中...');
  /** 自动化阶段 UI 状态 */
  const autoStage = useTaskStore((s) => s.automationState);
  const [autoMessage, setAutoMessage] = useState('');

  const updateAccountStatus = useAccountStore((s) => s.updateAccountStatus);

  // ---- webview 池：为所有账号创建并常驻 webview ----

  useEffect(() => {
    if (!poolRef.current || accounts.length === 0) return;

    const container = poolRef.current;

    accounts.forEach(async (account) => {
      // 已有 webview 则跳过（不销毁重建）
      if (registryRef.current.has(account.id)) return;

      loadingMapRef.current.set(account.id, true);
      if (account.id === activeAccount?.id) {
        setActiveLoading(true);
        setLoadText('加载豆包中...');
      }

      // 确保主进程 session 已初始化
      await window.electronAPI.accounts.getPartition(account.id);

      // 创建 webview
      const webview = document.createElement('webview') as HTMLWebViewElement;
      webview.setAttribute('src', 'https://www.doubao.com/chat/');
      webview.setAttribute('partition', `persist:doubao_${account.partition}`);
      webview.setAttribute('allowpopups', 'true');
      webview.setAttribute('useragent',
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      );
      webview.style.width = '100%';
      webview.style.height = '100%';
      webview.style.border = 'none';
      webview.style.outline = 'none';
      webview.style.position = 'absolute';
      webview.style.top = '0';
      webview.style.left = '0';
      // 默认隐藏，下面会设置活跃的为可见
      webview.style.visibility = 'hidden';
      webview.style.pointerEvents = 'none';

      // 事件监听
      webview.addEventListener('did-start-loading', () => {
        loadingMapRef.current.set(account.id, true);
        if (account.id === activeAccount?.id) {
          setActiveLoading(true);
          setLoadText('页面加载中...');
        }
      });

      webview.addEventListener('did-stop-loading', () => {
        loadingMapRef.current.set(account.id, false);
        if (account.id === activeAccount?.id) {
          setActiveLoading(false);
        }
      });

      webview.addEventListener('did-finish-load', () => {
        loadingMapRef.current.set(account.id, false);
        if (account.id === activeAccount?.id) {
          setActiveLoading(false);
          setLoadText('豆包已就绪');
          setTimeout(() => setLoadText(''), 1500);
        }
      });

      webview.addEventListener('did-fail-load', () => {
        loadingMapRef.current.set(account.id, false);
        if (account.id === activeAccount?.id) {
          setActiveLoading(false);
          setLoadText('加载失败，请检查网络');
        }
      });

      container.appendChild(webview);
      registryRef.current.set(account.id, webview);
    });
  }, [accounts.map(a => a.id).join(','), refreshKey]);

  // ---- 切换活跃账号时，切换 webview 可见性 ----

  useEffect(() => {
    registryRef.current.forEach((webview, accountId) => {
      if (accountId === activeAccount?.id) {
        webview.style.visibility = 'visible';
        webview.style.pointerEvents = 'auto';
        // 同步加载状态
        const isLoading = loadingMapRef.current.get(accountId);
        setActiveLoading(!!isLoading);
        if (!isLoading) {
          setLoadText('');
        }
      } else {
        webview.style.visibility = 'hidden';
        webview.style.pointerEvents = 'none';
      }
    });
  }, [activeAccount?.id]);

  // ---- V2 自动化执行（后台运行，不依赖当前显示的账号） ----

  useEffect(() => {
    if (!activeTask || !activeTask.assignedAccountId) return;

    const targetWebview = registryRef.current.get(activeTask.assignedAccountId);
    if (!targetWebview) {
      console.warn('[BrowserPanel] 目标账号的 webview 尚未创建:', activeTask.assignedAccountId);
      return;
    }

    const webview = targetWebview;

    (async () => {
      try {
        useTaskStore.getState().setAutomationState('idle'); // 强制重置状态

        // 1. 等待 webview 加载完成
        console.log('[BrowserPanel] waitForWebviewReady 开始 (账号:', activeTask.assignedAccountId, ')');
        useTaskStore.getState().setAutomationState('injecting');
        setAutoMessage('等待页面就绪...');
        await waitForWebviewReady(webview, 15000);
        console.log('[BrowserPanel] waitForWebviewReady 完成');

        // 2. 导航到豆包聊天页
        console.log('[BrowserPanel] navigateToChat 开始');
        await navigateToChat(webview);
        await waitForWebviewReady(webview, 15000);
        console.log('[BrowserPanel] navigateToChat + waitForWebviewReady 完成');

        // 3. 注入提示词
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

        // 4. 提交
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
        await sleep(3000);

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
          if (!generating) break;
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
  }, [activeTask?.id]);

  // ---- 导航方法（仅操作当前活跃账号的 webview） ----

  const getActiveWebview = useCallback(() => {
    if (!activeAccount) return null;
    return registryRef.current.get(activeAccount.id) || null;
  }, [activeAccount]);

  const handleRefresh = useCallback(() => {
    getActiveWebview()?.reload();
  }, [getActiveWebview]);

  const handleGoBack = useCallback(() => {
    const wv = getActiveWebview();
    if (wv?.canGoBack()) wv.goBack();
  }, [getActiveWebview]);

  const handleGoForward = useCallback(() => {
    const wv = getActiveWebview();
    if (wv?.canGoForward()) wv.goForward();
  }, [getActiveWebview]);

  const handleGoHome = useCallback(() => {
    getActiveWebview()?.loadURL('https://www.doubao.com/chat/');
  }, [getActiveWebview]);

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

      {/* webview 池 + 覆盖层 */}
      <div className="browser-viewport">
        {activeLoading && (
          <div className="browser-loading-overlay">
            <div className="browser-loading-spinner" />
            <span>{loadText}</span>
          </div>
        )}

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

        {/* webview 池容器：所有账号的 webview 都在这里，用 CSS 控制显隐 */}
        <div
          ref={poolRef}
          style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }}
        />
      </div>
    </div>
  );
};

// ==================== 工具函数 ====================

function waitForWebviewReady(webview: HTMLWebViewElement, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    const poll = async () => {
      if (Date.now() - startTime >= timeoutMs) {
        reject(new Error('页面就绪检测超时（' + timeoutMs + 'ms）'));
        return;
      }
      try {
        const ready = await waitForChatReady(webview, 3000);
        if (ready) {
          console.log('[BrowserPanel] 页面已就绪');
          resolve();
        } else {
          setTimeout(poll, 1000);
        }
      } catch (err) {
        setTimeout(poll, 1000);
      }
    };
    poll();
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export default BrowserPanel;
