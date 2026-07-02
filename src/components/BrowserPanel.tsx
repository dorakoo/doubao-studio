/**
 * src/components/BrowserPanel.tsx
 * 内嵌浏览器面板
 *
 * 功能：
 * - 使用 Electron webview 标签加载豆包网页
 * - 每个账号的浏览器会话完全隔离（通过 partition 属性）
 * - 支持刷新、前进、后退导航
 * - 显示当前加载状态
 */

import React, { useRef, useEffect, useState, useCallback } from 'react';
import {
  ReloadOutlined,
  ArrowLeftOutlined,
  ArrowRightOutlined,
  HomeOutlined,
  GlobalOutlined,
  LoadingOutlined,
} from '@ant-design/icons';
import { Tooltip, Empty, Spin } from 'antd';
import { useAccountStore } from '../store/useAccountStore';

/** webview 标签的类型（Electron 渲染进程中可用） */
interface WebviewElement extends HTMLElement {
  getURL(): string;
  loadURL(url: string): void;
  reload(): void;
  goBack(): void;
  goForward(): void;
  canGoBack(): boolean;
  canGoForward(): boolean;
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions
  ): void;
  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | EventListenerOptions
  ): void;
  setAttribute(name: string, value: string): void;
}

/** 豆包首页 URL */
const DOUBAO_URL = 'https://www.doubao.com';

export const BrowserPanel: React.FC = () => {
  const { accounts, selectedAccountId } = useAccountStore();
  const webviewRef = useRef<HTMLDivElement>(null);
  const webviewTagRef = useRef<WebviewElement | null>(null);

  const [currentUrl, setCurrentUrl] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);
  const [webviewReady, setWebviewReady] = useState(false);

  // 选中的账号
  const selectedAccount = accounts.find((a) => a.id === selectedAccountId);

  // ---- 当选中账号变化时，切换 webview ----
  useEffect(() => {
    if (!webviewRef.current || !selectedAccount) {
      // 没有选中账号时清理
      if (webviewTagRef.current) {
        webviewTagRef.current.remove();
        webviewTagRef.current = null;
      }
      setWebviewReady(false);
      setCurrentUrl('');
      return;
    }

    // 清除旧 webview
    if (webviewTagRef.current) {
      webviewTagRef.current.remove();
      webviewTagRef.current = null;
    }

    setWebviewReady(false);
    setCurrentUrl('');
    setIsLoading(true);

    // 创建新 webview 元素（使用独立的 session partition 实现隔离）
    const webview = document.createElement('webview') as unknown as WebviewElement;
    webview.setAttribute('src', DOUBAO_URL);
    webview.setAttribute('partition', `persist:doubao_${selectedAccount.partition}`);
    webview.setAttribute('allowpopups', 'false');
    webview.setAttribute('useragent',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    );
    webview.style.cssText = `
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      border: none;
      border-radius: 0;
    `;

    // ---- webview 事件监听 ----
    webview.addEventListener('dom-ready', () => {
      setWebviewReady(true);
      setIsLoading(false);
      setCurrentUrl(webview.getURL());
    });

    webview.addEventListener('did-start-loading', () => {
      setIsLoading(true);
    });

    webview.addEventListener('did-stop-loading', () => {
      setIsLoading(false);
      setCurrentUrl(webview.getURL());
    });

    webview.addEventListener('did-navigate', (e: any) => {
      setCurrentUrl(e.url);
    });

    webview.addEventListener('did-navigate-in-page', (e: any) => {
      if (e.isMainFrame) {
        setCurrentUrl(e.url);
      }
    });

    // 更新导航状态
    const updateNavState = () => {
      try {
        setCanGoBack(webview.canGoBack());
        setCanGoForward(webview.canGoForward());
      } catch {
        // webview 可能尚未就绪
      }
    };

    webview.addEventListener('did-navigate', updateNavState);
    webview.addEventListener('did-navigate-in-page', updateNavState);
    webview.addEventListener('did-stop-loading', updateNavState);

    // 错误处理
    webview.addEventListener('did-fail-load', (e: any) => {
      if (e.errorCode !== -3) {
        // -3 是用户取消导航，忽略
        console.error('[WebView] 加载失败:', e.errorDescription);
        setIsLoading(false);
      }
    });

    webviewRef.current.appendChild(webview);
    webviewTagRef.current = webview;
  }, [selectedAccountId, selectedAccount?.partition]);

  // ---- 导航操作 ----
  const handleGoBack = useCallback(() => {
    if (webviewTagRef.current && webviewTagRef.current.canGoBack()) {
      webviewTagRef.current.goBack();
    }
  }, []);

  const handleGoForward = useCallback(() => {
    if (webviewTagRef.current && webviewTagRef.current.canGoForward()) {
      webviewTagRef.current.goForward();
    }
  }, []);

  const handleReload = useCallback(() => {
    if (webviewTagRef.current) {
      webviewTagRef.current.reload();
    }
  }, []);

  const handleGoHome = useCallback(() => {
    if (webviewTagRef.current) {
      webviewTagRef.current.loadURL(DOUBAO_URL);
    }
  }, []);

  // ---- 空状态：未选中账号 ----
  if (!selectedAccount) {
    return (
      <div className="flex flex-col h-full bg-db-bg">
        {/* 导航栏（禁用状态） */}
        <div className="flex items-center gap-1 px-3 py-2 bg-db-bg-secondary border-b border-db-border">
          <Tooltip title="后退">
            <button className="btn-ghost opacity-30 cursor-not-allowed">
              <ArrowLeftOutlined />
            </button>
          </Tooltip>
          <Tooltip title="前进">
            <button className="btn-ghost opacity-30 cursor-not-allowed">
              <ArrowRightOutlined />
            </button>
          </Tooltip>
          <Tooltip title="刷新">
            <button className="btn-ghost opacity-30 cursor-not-allowed">
              <ReloadOutlined />
            </button>
          </Tooltip>
          <Tooltip title="主页">
            <button className="btn-ghost opacity-30 cursor-not-allowed">
              <HomeOutlined />
            </button>
          </Tooltip>

          {/* URL 栏 */}
          <div className="flex-1 mx-3 px-3 py-1.5 rounded-db bg-db-bg border border-db-border text-xs text-db-text-muted">
            请在左侧选择一个账号以加载浏览器
          </div>
        </div>

        {/* 空状态 */}
        <div className="flex-1 flex items-center justify-center bg-db-bg">
          <Empty
            image={
              <GlobalOutlined
                style={{ fontSize: 64, color: '#38385a' }}
              />
            }
            description={
              <div className="text-db-text-muted">
                <p className="text-sm mb-1">未选择账号</p>
                <p className="text-xs">点击左侧账号列表中的一个账号</p>
                <p className="text-xs">即可在此处打开隔离的豆包浏览器</p>
              </div>
            }
          />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-db-bg">
      {/* 导航栏 */}
      <div className="flex items-center gap-1 px-3 py-2 bg-db-bg-secondary border-b border-db-border">
        {/* 导航按钮 */}
        <Tooltip title="后退">
          <button
            className={`btn-ghost ${!canGoBack ? 'opacity-30 cursor-not-allowed' : ''}`}
            onClick={handleGoBack}
            disabled={!canGoBack}
          >
            <ArrowLeftOutlined />
          </button>
        </Tooltip>
        <Tooltip title="前进">
          <button
            className={`btn-ghost ${!canGoForward ? 'opacity-30 cursor-not-allowed' : ''}`}
            onClick={handleGoForward}
            disabled={!canGoForward}
          >
            <ArrowRightOutlined />
          </button>
        </Tooltip>
        <Tooltip title="刷新">
          <button className="btn-ghost" onClick={handleReload}>
            <ReloadOutlined className={isLoading ? 'animate-spin' : ''} />
          </button>
        </Tooltip>
        <Tooltip title="主页">
          <button className="btn-ghost" onClick={handleGoHome}>
            <HomeOutlined />
          </button>
        </Tooltip>

        {/* URL 栏 */}
        <div className="flex-1 mx-3 px-3 py-1.5 rounded-db bg-db-bg border border-db-border flex items-center gap-2">
          {isLoading ? (
            <LoadingOutlined className="text-db-accent text-xs flex-shrink-0" />
          ) : (
            <GlobalOutlined className="text-db-text-muted text-xs flex-shrink-0" />
          )}
          <span className="text-xs text-db-text-secondary truncate flex-1">
            {currentUrl || '加载中...'}
          </span>
        </div>

        {/* 当前账号指示 */}
        <Tooltip title={`当前账号：${selectedAccount.name}`}>
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-db bg-db-accent/10 border border-db-accent/30 text-xs text-db-accent-light">
            <span className="status-dot idle" />
            {selectedAccount.name}
          </div>
        </Tooltip>
      </div>

      {/* webview 容器 */}
      <div className="flex-1 relative bg-db-bg">
        {/* 加载覆盖层 */}
        {isLoading && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-db-bg/60 backdrop-blur-sm">
            <div className="flex flex-col items-center gap-3">
              <Spin size="large" />
              <span className="text-sm text-db-text-secondary">正在加载豆包页面...</span>
            </div>
          </div>
        )}

        {/* webview 挂载点 */}
        <div ref={webviewRef} className="webview-container" />
      </div>
    </div>
  );
};
