/**
 * src/types/electron.d.ts
 * Electron API 全局类型声明
 */

import type { Account, Task } from './index';

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

export interface ElectronAPI {
  accounts: {
    list: () => Promise<Account[]>;
    add: (name: string) => Promise<{ success: boolean; account?: Account; error?: string }>;
    update: (id: string, name: string) => Promise<{ success: boolean; error?: string }>;
    delete: (id: string) => Promise<{ success: boolean; error?: string }>;
    refresh: (id: string) => Promise<{ success: boolean; error?: string }>;
    setStatus: (id: string, status: string) => Promise<{ success: boolean }>;
    setPinned: (id: string, pinned: boolean) => Promise<{ success: boolean }>;
    getPartition: (id: string) => Promise<string | null>;
  };
  tasks: {
    list: () => Promise<Task[]>;
    add: (prompts: string[], mode?: string) => Promise<{ success: boolean; tasks?: Task[]; error?: string }>;
    assign: (taskId: string, accountId: string) => Promise<{ success: boolean; error?: string }>;
    updateStatus: (
      taskId: string,
      status: string,
      result?: string,
      outputs?: string[]
    ) => Promise<{ success: boolean; error?: string }>;
    delete: (taskId: string) => Promise<{ success: boolean; error?: string }>;
    batchPause: () => Promise<{ success: boolean }>;
    getCompletedOutputs: () => Promise<{ taskId: string; prompt: string; outputs: string[] }[]>;
  };
  system: {
    getVersion: () => Promise<string>;
    minimize: () => void;
    toggleMaximize: () => void;
    close: () => void;
  };
}
