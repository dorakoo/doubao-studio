/**
 * src/components/BrowserPanel.tsx
 * 内嵌浏览器面板 — V3.1 修复加载卡死 + 多账号并行
 *
 * 修复点：
 * - 活跃账号优先加载，其余错开创建（避免并发限速）
 * - 增加 did-navigate / did-navigate-in-page 信号（SPA 兼容）
 * - 30s 超时兜底自动关闭 loading 遮罩
 */

import React, { useRef, useEffect, useCallback, useState } from 'react';
import type { Account } from '../types';
import { useAccountStore } from '../store/useAccountStore';
import { useTaskStore } from '../store/useTaskStore';
import type { AutomationState } from '../store/useTaskStore';
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
  accounts: Account[];
  activeAccount: Account | null;
  refreshKey: number;
}

// ==================== 组件 ====================

const BrowserPanel: React.FC<BrowserPanelProps> = ({
  accounts,
  activeAccount,
  refreshKey,
}) => {
  const poolRef = useRef<HTMLDivElement>(null);
  const registryRef = useRef<Map<string, HTMLWebViewElement>>(new Map());
  const loadingMapRef = useRef<Map<string, boolean>>(new Map());
  /** 正在执行自动化的账号 Set（防止重复触发） */
  const runningRef = useRef<Set<string>>(new Set());

  const [activeLoading, setActiveLoading] = useState(true);
  const [loadText, setLoadText] = useState('加载豆包中...');

  // V3: per-account 自动化状态
  const accountBusy = useTaskStore((s) => s.accountBusy);
  const accountAutoState = useTaskStore((s) => s.accountAutomationState);
  const accountAutoMsg = useTaskStore((s) => s.accountAutoMessage);
  const executingTasks = useTaskStore((s) => s.executingTasks);
  const tasks = useTaskStore((s) => s.tasks);

  const updateAccountStatus = useAccountStore((s) => s.updateAccountStatus);

  // 当前活跃账号的自动化状态（用于 UI 覆盖层）
  const activeAutoState: AutomationState | undefined = activeAccount
    ? accountAutoState[activeAccount.id]
    : undefined;
  const activeAutoMsg = activeAccount ? (accountAutoMsg[activeAccount.id] || '') : '';

  // ---- webview 创建（单个） ----

  const createWebview = useCallback(async (account: Account, container: HTMLDivElement) => {
    if (registryRef.current.has(account.id)) return;

    console.log('[BrowserPanel] 创建 webview for account:', account.id);
    loadingMapRef.current.set(account.id, true);

    try {
      await window.electronAPI.accounts.getPartition(account.id);
    } catch (err) {
      console.warn('[BrowserPanel] getPartition 失败, 继续创建:', account.id, err);
    }

    const webview = document.createElement('webview') as HTMLWebViewElement;
    webview.setAttribute('src', 'https://www.doubao.com/chat/');
    webview.setAttribute('partition', `persist:doubao_${account.partition}`);
    webview.setAttribute('allowpopups', 'true');
    webview.setAttribute('useragent',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    );
    webview.style.cssText = 'width:100%;height:100%;border:none;outline:none;position:absolute;top:0;left:0;';
    webview.style.visibility = 'hidden';
    webview.style.pointerEvents = 'none';

    const accId = account.id;

    // 统一的"加载完成"处理 — 用 store.getState() 读最新 activeId，避免闭包过期
    const markLoaded = (event: string) => {
      loadingMapRef.current.set(accId, false);
      console.log(`[BrowserPanel] webview ${accId} 加载完成 (via ${event})`);
      const currentActiveId = useAccountStore.getState().selectedAccountId;
      if (accId === currentActiveId) {
        setActiveLoading(false);
        setLoadText('');
      }
    };

    webview.addEventListener('did-start-loading', () => {
      loadingMapRef.current.set(accId, true);
      console.log(`[BrowserPanel] webview ${accId} 开始加载`);
      const currentActiveId = useAccountStore.getState().selectedAccountId;
      if (accId === currentActiveId) {
        setActiveLoading(true);
        setLoadText('页面加载中...');
      }
    });

    // 多种加载完成信号 — SPA 兼容
    webview.addEventListener('did-finish-load', () => markLoaded('did-finish-load'));
    webview.addEventListener('did-stop-loading', () => markLoaded('did-stop-loading'));
    webview.addEventListener('did-navigate', () => markLoaded('did-navigate'));
    webview.addEventListener('did-navigate-in-page', () => markLoaded('did-navigate-in-page'));

    webview.addEventListener('did-fail-load', (e: any) => {
      console.warn(`[BrowserPanel] webview ${accId} 加载失败:`, e);
      loadingMapRef.current.set(accId, false);
      const currentActiveId = useAccountStore.getState().selectedAccountId;
      if (accId === currentActiveId) {
        setActiveLoading(false);
        setLoadText('加载失败，请检查网络');
      }
    });

    container.appendChild(webview);
    registryRef.current.set(accId, webview);
    console.log('[BrowserPanel] webview 已注册:', accId);

    // 30s 超时兜底
    setTimeout(() => {
      if (loadingMapRef.current.get(accId)) {
        console.warn(`[BrowserPanel] webview ${accId} 30s 超时，强制关闭 loading`);
        markLoaded('timeout-30s');
      }
    }, 30000);
  }, []);

  // ---- webview 池初始化（活跃账号优先 + 其余错开） ----

  useEffect(() => {
    if (!poolRef.current || accounts.length === 0) return;
    const container = poolRef.current;

    // 排序：活跃账号排第一，立即创建；其余错开 2s
    const activeId = activeAccount?.id;
    const sorted = [...accounts].sort((a, b) => {
      if (a.id === activeId) return -1;
      if (b.id === activeId) return 1;
      return 0;
    });

    sorted.forEach((account, index) => {
      if (registryRef.current.has(account.id)) return;

      if (index === 0) {
        // 活跃账号立即创建
        createWebview(account, container);
      } else {
        // 其余错开 2s 避免并发限速
        setTimeout(() => {
          createWebview(account, container);
        }, index * 2000);
      }
    });
  }, [accounts.map((a) => a.id).join(','), refreshKey]);

  // ---- 切换活跃账号时切换可见性 ----

  useEffect(() => {
    registryRef.current.forEach((webview, accountId) => {
      if (accountId === activeAccount?.id) {
        webview.style.visibility = 'visible';
        webview.style.pointerEvents = 'auto';
        const isLoading = loadingMapRef.current.get(accountId);
        setActiveLoading(!!isLoading);
        if (!isLoading) setLoadText('');
      } else {
        webview.style.visibility = 'hidden';
        webview.style.pointerEvents = 'none';
      }
    });
  }, [activeAccount?.id]);

  // ---- V3 自动化：监听 per-account 执行状态 ----

  useEffect(() => {
    accounts.forEach((account) => {
      const accountId = account.id;
      const isBusy = accountBusy[accountId];
      const taskId = executingTasks[accountId];
      const webview = registryRef.current.get(accountId);

      if (!isBusy || !taskId || !webview) return;
      if (runningRef.current.has(accountId)) return;

      const task = tasks.find((t) => t.id === taskId);
      if (!task) return;

      console.log('[BrowserPanel] 检测到账号', accountId, '需要执行任务', taskId);
      runningRef.current.add(accountId);

      executeAutomation(accountId, taskId, task.prompt, webview);
    });
  }, [accountBusy, executingTasks]);

  // ---- 自动化执行函数 ----

  const executeAutomation = async (
    accountId: string,
    taskId: string,
    prompt: string,
    webview: HTMLWebViewElement
  ) => {
    const { setAccountAutomationState, completeAutomation, failAutomation } =
      useTaskStore.getState();

    try {
      console.log(`[Automation:${accountId}] 开始执行任务 ${taskId}`);
      setAccountAutomationState(accountId, 'injecting', '等待页面就绪...');

      await waitForWebviewReady(webview, 15000);
      console.log(`[Automation:${accountId}] 页面就绪`);

      await navigateToChat(webview);
      await waitForWebviewReady(webview, 15000);
      console.log(`[Automation:${accountId}] 导航完成`);

      setAccountAutomationState(accountId, 'injecting', '正在注入提示词...');
      console.log(`[Automation:${accountId}] injectPrompt 开始`);
      const injected = await Promise.race([
        injectPrompt(webview, prompt),
        new Promise<boolean>((_, reject) =>
          setTimeout(() => reject(new Error('注入超时（10s）')), 10000)
        ),
      ]);
      console.log(`[Automation:${accountId}] injectPrompt 结果:`, injected);
      if (!injected) throw new Error('注入失败：未找到输入框');
      await sleep(800);

      setAccountAutomationState(accountId, 'submitting', '正在发送...');
      console.log(`[Automation:${accountId}] submitPrompt 开始`);
      const submitted = await Promise.race([
        submitPrompt(webview),
        new Promise<boolean>((_, reject) =>
          setTimeout(() => reject(new Error('提交超时（10s）')), 10000)
        ),
      ]);
      console.log(`[Automation:${accountId}] submitPrompt 结果:`, submitted);
      if (!submitted) throw new Error('提交失败：未找到发送按钮');

      setAccountAutomationState(accountId, 'generating', '等待豆包生成回复...');
      await sleep(3000);

      const maxAttempts = 100;
      const intervalMs = 3000;
      let generating = true;

      for (let i = 0; i < maxAttempts; i++) {
        await sleep(intervalMs);
        try {
          generating = await Promise.race([
            checkGenerating(webview),
            new Promise<boolean>((_, reject) =>
              setTimeout(() => reject(new Error('检测超时')), 10000)
            ),
          ]);
        } catch {
          generating = true;
        }
        if (!generating) break;
        setAccountAutomationState(
          accountId,
          'generating',
          `等待豆包生成回复... (${Math.round(((i + 1) * intervalMs) / 1000)}s)`
        );
      }

      if (generating) throw new Error('生成超时（超过 5 分钟）');

      const resultUrl = await getResultUrl(webview);
      console.log(`[Automation:${accountId}] 任务完成:`, resultUrl);

      await completeAutomation(taskId, accountId, resultUrl);
    } catch (err: any) {
      console.error(`[Automation:${accountId}] 执行失败:`, err.message);
      setAccountAutomationState(accountId, 'failed', err.message);
      await failAutomation(taskId, accountId, err.message);
    } finally {
      runningRef.current.delete(accountId);
      console.log(`[Automation:${accountId}] 执行结束，清理完成`);
    }
  };

  // ---- 导航方法 ----

  const getActiveWebview = useCallback(() => {
    if (!activeAccount) return null;
    return registryRef.current.get(activeAccount.id) || null;
  }, [activeAccount]);

  const handleRefresh = useCallback(() => { getActiveWebview()?.reload(); }, [getActiveWebview]);
  const handleGoBack = useCallback(() => { const w = getActiveWebview(); if (w?.canGoBack()) w.goBack(); }, [getActiveWebview]);
  const handleGoForward = useCallback(() => { const w = getActiveWebview(); if (w?.canGoForward()) w.goForward(); }, [getActiveWebview]);
  const handleGoHome = useCallback(() => { getActiveWebview()?.loadURL('https://www.doubao.com/chat/'); }, [getActiveWebview]);

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

  const showOverlay = activeAutoState && activeAutoState !== 'idle' && activeAutoState !== 'completed' && activeAutoState !== 'failed';

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

        {showOverlay && (
          <div className="automation-overlay">
            <div className="automation-indicator">
              <div className="automation-spinner" />
              <span>{activeAutoMsg}</span>
            </div>
          </div>
        )}

        {activeAutoState === 'completed' && (
          <div className="automation-toast completed">
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
              <circle cx="9" cy="9" r="8" stroke="#34d399" strokeWidth="2" />
              <path d="M5.5 9l2.5 2.5 4.5-5" stroke="#34d399" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span>{activeAutoMsg}</span>
          </div>
        )}

        {activeAutoState === 'failed' && (
          <div className="automation-toast failed">
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
              <circle cx="9" cy="9" r="8" stroke="#fb7185" strokeWidth="2" />
              <path d="M6 6l6 6M12 6l-6 6" stroke="#fb7185" strokeWidth="2" strokeLinecap="round" />
            </svg>
            <span>执行失败: {activeAutoMsg}</span>
          </div>
        )}

        {/* webview 池 */}
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
          resolve();
        } else {
          setTimeout(poll, 1000);
        }
      } catch {
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
