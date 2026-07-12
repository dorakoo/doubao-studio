/**
 * src/types/electron.d.ts
 * Electron API 全局类型声明
 *
 * ElectronAPI 接口已迁移至 @doubao-studio/contracts。
 * 本文件仅负责：
 * 1. 声明 window.electronAPI 全局类型
 * 2. 扩展 HTMLElement 以支持 webview 标签
 */

import type { ElectronAPI } from '@doubao-studio/contracts';

// 扩展 HTMLElement 以支持 webview 标签
declare global {
  interface HTMLElementTagNameMap {
    webview: Electron.WebviewTag;
  }

  // 运行时 webview 元素类型（用于 document.createElement('webview')）
  interface HTMLWebViewElement extends HTMLElement {
    src: string;
    reload(): void;
    goBack(): void;
    goForward(): void;
    canGoBack(): boolean;
    canGoForward(): boolean;
    loadURL(url: string): void;
    getURL(): string;
    executeJavaScript(code: string): Promise<any>;
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
    getAttribute(name: string): string | null;
  }

  namespace JSX {
    interface IntrinsicElements {
      webview: React.DetailedHTMLProps<
        React.HTMLAttributes<Electron.WebviewTag> & {
          src?: string;
          partition?: string;
          allowpopups?: string;
          useragent?: string;
          ref?: React.Ref<Electron.WebviewTag>;
        },
        Electron.WebviewTag
      >;
    }
  }

  interface Window {
    electronAPI: ElectronAPI;
  }
}
