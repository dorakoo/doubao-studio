/**
 * src/components/BrowserPanel.tsx
 * V3.3 修复 poolRef 为空 — 依赖数组加入 activeAccount
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

interface BrowserPanelProps {
  accounts: Account[];
  activeAccount: Account | null;
  refreshKey: number;
}

const BrowserPanel: React.FC<BrowserPanelProps> = ({
  accounts,
  activeAccount,
  refreshKey,
}) => {
  const poolRef = useRef<HTMLDivElement>(null);
  const registryRef = useRef<Map<string, HTMLWebViewElement>>(new Map());
  const loadingMapRef = useRef<Map<string, boolean>>(new Map());
  const runningRef = useRef<Set<string>>(new Set());

  const [activeLoading, setActiveLoading] = useState(true);
  const [loadText, setLoadText] = useState('加载豆包中...');

  const accountBusy = useTaskStore((s) => s.accountBusy);
  const accountAutoState = useTaskStore((s) => s.accountAutomationState);
  const accountAutoMsg = useTaskStore((s) => s.accountAutoMessage);
  const executingTasks = useTaskStore((s) => s.executingTasks);
  const tasks = useTaskStore((s) => s.tasks);

  const activeAutoState: AutomationState | undefined = activeAccount
    ? accountAutoState[activeAccount.id]
    : undefined;
  const activeAutoMsg = activeAccount ? (accountAutoMsg[activeAccount.id] || '') : '';

  // ---- webview 池初始化 ----
  useEffect(() => {
    const container = poolRef.current;
    if (!container) {
      console.log('[BrowserPanel] poolRef 为空，等待容器挂载');
      return;
    }
    if (accounts.length === 0) {
      console.log('[BrowserPanel] accounts 为空');
      return;
    }

    console.log('[BrowserPanel] ✅ 开始创建 webview 池, accounts:', accounts.length);

    accounts.forEach((account) => {
      if (registryRef.current.has(account.id)) {
        console.log(`[BrowserPanel] webview ${account.id} 已存在，跳过`);
        return;
      }

      console.log(`[BrowserPanel] 创建 webview: ${account.id}`);
      loadingMapRef.current.set(account.id, true);

      const webview = document.createElement('webview') as HTMLWebViewElement;
      webview.setAttribute('src', 'https://www.doubao.com/chat/');
      webview.setAttribute('partition', `persist:doubao_${account.partition}`);
      webview.setAttribute('allowpopups', 'true');
      webview.style.cssText = 'width:100%;height:100%;border:none;position:absolute;top:0;left:0;';
      webview.style.visibility = 'hidden';
      webview.style.pointerEvents = 'none';

      const accId = account.id;

      const markLoaded = (evt: string) => {
        loadingMapRef.current.set(accId, false);
        console.log(`[BrowserPanel] [${accId}] 加载完成 (${evt})`);
        const cur = useAccountStore.getState().selectedAccountId;
        if (accId === cur) {
          setActiveLoading(false);
          setLoadText('');
        }
      };

      webview.addEventListener('did-start-loading', () => {
        loadingMapRef.current.set(accId, true);
        const cur = useAccountStore.getState().selectedAccountId;
        if (accId === cur) {
          setActiveLoading(true);
          setLoadText('页面加载中...');
        }
      });

      webview.addEventListener('did-finish-load', () => markLoaded('did-finish-load'));
      webview.addEventListener('did-stop-loading', () => markLoaded('did-stop-loading'));
      webview.addEventListener('did-navigate', () => markLoaded('did-navigate'));
      webview.addEventListener('did-navigate-in-page', () => markLoaded('did-navigate-in-page'));
      webview.addEventListener('dom-ready', () => markLoaded('dom-ready'));

      webview.addEventListener('did-fail-load', () => {
        loadingMapRef.current.set(accId, false);
        const cur = useAccountStore.getState().selectedAccountId;
        if (accId === cur) {
          setActiveLoading(false);
          setLoadText('加载失败');
        }
      });

      container.appendChild(webview);
      registryRef.current.set(accId, webview);
      console.log(`[BrowserPanel] ✅ webview ${accId} 已添加到 DOM`);

      // 20s 超时兜底
      setTimeout(() => {
        if (loadingMapRef.current.get(accId)) {
          console.warn(`[BrowserPanel] ⚠️ ${accId} 20s 超时`);
          markLoaded('timeout');
        }
      }, 20000);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accounts.map((a) => a.id).join(','), activeAccount?.id, refreshKey]);

  // ---- 切换可见性 ----
  useEffect(() => {
    if (!activeAccount) return;
    registryRef.current.forEach((webview, accountId) => {
      if (accountId === activeAccount.id) {
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

  // ---- V3 自动化 ----
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
      await navigateToChat(webview);
      await waitForWebviewReady(webview, 15000);
      setAccountAutomationState(accountId, 'injecting', '正在注入提示词...');
      const injected = await Promise.race([
        injectPrompt(webview, prompt),
        new Promise<boolean>((_, rej) => setTimeout(() => rej(new Error('注入超时')), 10000)),
      ]);
      if (!injected) throw new Error('注入失败');
      await sleep(800);
      setAccountAutomationState(accountId, 'submitting', '正在发送...');
      const submitted = await Promise.race([
        submitPrompt(webview),
        new Promise<boolean>((_, rej) => setTimeout(() => rej(new Error('提交超时')), 10000)),
      ]);
      if (!submitted) throw new Error('提交失败');
      setAccountAutomationState(accountId, 'generating', '等待豆包生成回复...');
      await sleep(3000);
      let generating = true;
      for (let i = 0; i < 100; i++) {
        await sleep(3000);
        try {
          generating = await Promise.race([
            checkGenerating(webview),
            new Promise<boolean>((_, rej) => setTimeout(() => rej(new Error('检测超时')), 10000)),
          ]);
        } catch { generating = true; }
        if (!generating) break;
        setAccountAutomationState(accountId, 'generating', `等待回复... (${(i + 1) * 3}s)`);
      }
      if (generating) throw new Error('生成超时');
      const resultUrl = await getResultUrl(webview);
      await completeAutomation(taskId, accountId, resultUrl);
    } catch (err: any) {
      console.error(`[Automation:${accountId}] 失败:`, err.message);
      setAccountAutomationState(accountId, 'failed', err.message);
      await failAutomation(taskId, accountId, err.message);
    } finally {
      runningRef.current.delete(accountId);
    }
  };

  // ---- 导航 ----
  const getActiveWebview = useCallback(() => {
    if (!activeAccount) return null;
    return registryRef.current.get(activeAccount.id) || null;
  }, [activeAccount]);

  const handleRefresh = useCallback(() => { getActiveWebview()?.reload(); }, [getActiveWebview]);
  const handleGoBack = useCallback(() => { const w = getActiveWebview(); if (w?.canGoBack()) w.goBack(); }, [getActiveWebview]);
  const handleGoForward = useCallback(() => { const w = getActiveWebview(); if (w?.canGoForward()) w.goForward(); }, [getActiveWebview]);
  const handleGoHome = useCallback(() => { getActiveWebview()?.loadURL('https://www.doubao.com/chat/'); }, [getActiveWebview]);

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

        <div
          ref={poolRef}
          style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }}
        />
      </div>
    </div>
  );
};

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
        if (ready) resolve();
        else setTimeout(poll, 1000);
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
