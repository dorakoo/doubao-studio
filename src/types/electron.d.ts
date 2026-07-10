/**
 * src/types/electron.d.ts
 * Electron API 全局类型声明
 */

import type { Account, CsvImportResult, DownloadJob, Task, TaskErrorInfo, TaskRunSnapshot, TaskStatus } from './index';

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
    updateSeedanceQuota: (id: string, action: 'consume' | 'exhausted', units?: number) => Promise<{ success: boolean; account?: Account }>;
    updateHealth: (
      id: string,
      action: 'success' | 'failure' | 'verification' | 'login_expired' | 'clear',
      errorCode?: string
    ) => Promise<{ success: boolean; account?: Account }>;
    getPartition: (id: string) => Promise<string | null>;
  };
  tasks: {
    list: () => Promise<Task[]>;
    add: (prompts: string[], mode?: string, videoConfig?: any, attachments?: string[], audioAttachment?: string) => Promise<{ success: boolean; tasks?: Task[]; error?: string }>;
    assign: (taskId: string, accountId: string) => Promise<{ success: boolean; error?: string }>;
    updateStatus: (
      taskId: string,
      status: string,
      result?: string,
      outputs?: string[]
    ) => Promise<{ success: boolean; error?: string }>;
    updateRuntime: (taskId: string, patch: {
      status?: TaskStatus;
      runtime?: Partial<TaskRunSnapshot>;
      errorInfo?: TaskErrorInfo | null;
      result?: string;
    }) => Promise<{ success: boolean; task?: Task; error?: string }>;
    acquireLock: (taskId: string, ownerId: string) => Promise<{ success: boolean; task?: Task; error?: string }>;
    releaseLock: (taskId: string, ownerId?: string) => Promise<{ success: boolean }>;
    importCsv: () => Promise<CsvImportResult>;
    update: (taskId: string, updates: {
      prompt: string;
      videoConfig?: Task['videoConfig'];
      attachments?: string[];
      audioAttachment?: string;
    }) => Promise<{ success: boolean; task?: Task; error?: string }>;
    delete: (taskId: string) => Promise<{ success: boolean; error?: string }>;
    retry: (taskId: string) => Promise<{ success: boolean; task?: Task; error?: string }>;
    batchPause: () => Promise<{ success: boolean }>;
    getCompletedOutputs: () => Promise<Array<{ taskId: string; prompt: string; outputs: string[]; accountId: string | null; mode: Task['mode'] }>>;
    selectImages: () => Promise<{ success: boolean; filePaths?: string[]; error?: string }>;
    selectAudio: () => Promise<{ success: boolean; filePath?: string; error?: string }>;
    readFileAsBase64: (filePath: string) => Promise<{ success: boolean; data?: string; error?: string }>;
    downloadOutputs: (
      outputs: Array<{ taskId: string; prompt: string; outputs: string[]; accountId: string | null; mode: Task['mode'] }>,
      saveDir?: string
    ) => Promise<{ success: boolean; count: number; failed: number; saveDir?: string; error?: string; jobIds?: string[] }>;
    listDownloads: () => Promise<DownloadJob[]>;
    exportDiagnostics: () => Promise<{ success: boolean; filePath?: string; error?: string }>;
    validateArtifact: (taskId: string, artifactId: string) => Promise<{ success: boolean; artifact?: import('./index').TaskArtifact; error?: string }>;
    saveAdapterReport: (accountId: string, report: import('./index').AdapterSelfCheckReport) => Promise<{ success: boolean }>;
    selectAdapterRules: () => Promise<{ success: boolean; bundle?: import('./index').AdapterRuleBundle; error?: string }>;
    selectSaveDir: () => Promise<{ success: boolean; dirPath?: string; error?: string }>;
  };
  settings: {
    get: () => Promise<Record<string, any>>;
    save: (settings: Record<string, any>) => Promise<{ success: boolean; error?: string }>;
  };
  system: {
    getVersion: () => Promise<string>;
    minimize: () => void;
    toggleMaximize: () => void;
    close: () => void;
  };
}
