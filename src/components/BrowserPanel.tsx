/**
 * src/components/BrowserPanel.tsx
 * 内嵌浏览器面板 — V4 正式版
 *
 * 架构：
 * - 每个账号独立 webview，CSS 显隐控制，切换不销毁
 * - 支持多账号并行自动化 + 同账号任务队列
 * - per-account 执行状态监听，自动路由任务到对应 webview
 */

import React, { useRef, useEffect, useCallback, useState } from 'react';
import type { Account, Task } from '../types';
import { useAccountStore } from '../store/useAccountStore';
import { useTaskStore } from '../store/useTaskStore';
import type { AutomationState } from '../store/useTaskStore';
import {
  injectPrompt,
  submitPrompt,
  checkGenerating,
  getResultUrl,
  navigateToChat,
  switchMode,
  waitForModeReady,
  waitForChatReady,
  clickAITab,
  configureVideoOptions,
  uploadReferenceImages,
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

  // ---- webview 池动态管理（账号增删同步） ----
  const accountsKey = accounts.map(a => a.id).join(',');
  useEffect(() => {
    const container = poolRef.current;
    if (!container) return;

    const accountIds = new Set(accounts.map(a => a.id));

    // 清理已删除账号的 webview
    registryRef.current.forEach((webview, accountId) => {
      if (!accountIds.has(accountId)) {
        container.removeChild(webview);
        registryRef.current.delete(accountId);
        loadingMapRef.current.delete(accountId);
        console.log(`[BrowserPanel] 已移除账号 ${accountId} 的 webview`);
      }
    });

    // 为新增账号创建 webview
    accounts.forEach((account) => {
      createWebview(account, container);
    });

    // 确保当前活跃账号的加载状态同步
    if (activeAccount) {
      const isLoading = loadingMapRef.current.get(activeAccount.id);
      setActiveLoading(!!isLoading);
      if (!isLoading) setLoadText('');
      console.log(`[BrowserPanel] webview 池同步完成 (当前 ${registryRef.current.size} 个), activeAccount=${activeAccount.id}, isLoading=${isLoading}`);
    } else {
      console.log(`[BrowserPanel] webview 池同步完成 (当前 ${registryRef.current.size} 个), 无活跃账号`);
    }
  }, [accountsKey, refreshKey]);

  // ---- 创建单个 webview ----
  const createWebview = (account: Account, container: HTMLDivElement) => {
    if (registryRef.current.has(account.id)) return;

    const accId = account.id;
    loadingMapRef.current.set(accId, true);

    const webview = document.createElement('webview') as HTMLWebViewElement;
    webview.setAttribute('src', 'https://www.doubao.com/chat/');
    webview.setAttribute('partition', `persist:doubao_${account.partition}`);
    webview.setAttribute('allowpopups', 'true');
    webview.style.cssText = 'width:100%;height:100%;border:none;position:absolute;top:0;left:0;';
    webview.style.visibility = 'hidden';
    webview.style.pointerEvents = 'none';

    // 统一加载完成处理
    const markLoaded = (evt: string) => {
      loadingMapRef.current.set(accId, false);
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
    console.log(`[BrowserPanel] webview 已创建: ${accId}, src=${webview.getAttribute('src')}, partition=${webview.getAttribute('partition')}, inDOM=${container.contains(webview)}, childCount=${container.children.length}`);

    // 5s 后检查 webview 是否真的在加载
    setTimeout(() => {
      const wv = registryRef.current.get(accId);
      if (wv) {
        const url = wv.getURL?.() || '(getURL failed)';
        const stillLoading = loadingMapRef.current.get(accId);
        console.log(`[BrowserPanel] 5s检查: ${accId}, url=${url}, inDOM=${container.contains(wv)}, visibility=${wv.style.visibility}, stillLoading=${stillLoading}`);
        // 如果 5s 后还没开始加载，强制 reload
        if (stillLoading && !url.startsWith('http')) {
          console.warn(`[BrowserPanel] webview 5s 未开始加载，尝试 reload: ${accId}`);
          wv.reload();
        }
      }
    }, 5000);

    // 20s 超时兜底
    setTimeout(() => {
      if (loadingMapRef.current.get(accId)) {
        console.warn(`[BrowserPanel] 20s 超时: ${accId}`);
        markLoaded('timeout');
      }
    }, 20000);
  };

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
      console.log(`[BrowserPanel] 路由任务 ${taskId} → ${accountId}`);
      runningRef.current.add(accountId);
      executeAutomation(accountId, taskId, task.prompt, task.mode || "chat", webview, task.videoConfig, task.attachments);
    });
  }, [accountBusy, executingTasks]);

  // ---- 自动化执行 ----
  const executeAutomation = async (
    accountId: string,
    taskId: string,
    prompt: string,
    mode: string,
    webview: HTMLWebViewElement,
    videoConfig?: Task['videoConfig'],
    attachments?: string[]
  ) => {
    const { setAccountAutomationState, completeAutomation, failAutomation } =
      useTaskStore.getState();
    try {
      console.log(`[Automation:${accountId}] 开始`);
      setAccountAutomationState(accountId, 'injecting', '等待页面就绪...');
      await waitForWebviewReady(webview, 15000);
      // 根据任务模式切换到对应页面
      if (mode && mode !== 'chat') {
        const modeLabel = mode === 'image' ? '图片' : mode === 'video' ? '视频' : mode === 'music' ? '音乐' : mode;
        setAccountAutomationState(accountId, 'injecting', '切换到' + modeLabel + '模式...');
        switchMode(webview, mode);
        await waitForWebviewReady(webview, 20000);

        // image/video 模式：在 AI 创作页面点击 Tab 切换
        if (mode === 'image' || mode === 'video') {
          setAccountAutomationState(accountId, 'injecting', '点击' + modeLabel + 'Tab...');
          await clickAITab(webview, mode);
          await sleep(1500); // 等待 Tab 切换动画
        }

        // 视频模式：配置模型、时长、比例
        if (mode === 'video' && videoConfig) {
          setAccountAutomationState(accountId, 'injecting', '配置视频参数...');
          await configureVideoOptions(webview, videoConfig);
          await sleep(500);
        }

        // 有参考图片时上传
        if (attachments && attachments.length > 0) {
          setAccountAutomationState(accountId, 'injecting', '上传参考图片...');
          // 读取文件为 base64
          const fileDataList: Array<{ name: string; base64: string; mime: string }> = [];
          for (const filePath of attachments) {
            try {
              const result = await window.electronAPI.tasks.readFileAsBase64(filePath);
              if (result.success && result.data) {
                const fileName = filePath.split(/[/\\]/).pop() || 'image.jpg';
                const mimeMatch = result.data.match(/^data:(image\/\w+);base64,/);
                const mime = mimeMatch ? mimeMatch[1] : 'image/jpeg';
                const base64 = result.data.replace(/^data:image\/\w+;base64,/, '');
                fileDataList.push({ name: fileName, base64, mime });
              }
            } catch (e: any) {
              console.warn(`[BrowserPanel] 读取文件失败 ${filePath}:`, e.message);
            }
          }
          if (fileDataList.length > 0) {
            await uploadReferenceImages(webview, fileDataList);
          }
          await sleep(1000);
        }
      } else {
        await navigateToChat(webview);
        await waitForWebviewReady(webview, 15000);
      }

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

      const rawResult = await getResultUrl(webview);
      // 解析 JSON 数组字符串为图片 URL 列表
      let imageUrls: string[] = [];
      try {
        imageUrls = JSON.parse(rawResult);
      } catch {
        imageUrls = rawResult ? [rawResult] : [];
      }
      console.log(`[Automation:${accountId}] 完成, 产物:`, imageUrls);
      // 传入第一个 URL 作为 result（向后兼容），outputs 传完整数组
      await completeAutomation(taskId, accountId, imageUrls[0] || '', imageUrls);
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
