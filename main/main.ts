/**
 * main/main.ts
 * Electron 主进程入口
 *
 * 职责：
 * 1. 创建应用窗口
 * 2. 注册 IPC 通信模块
 * 3. 管理 webview 标签（多账号隔离浏览器）
 * 4. 窗口生命周期管理
 */

import { app, BrowserWindow, ipcMain, session, shell } from 'electron';
import * as path from 'path';
import { registerAccountIPC } from './ipc/accounts';
import { registerTaskIPC } from './ipc/tasks';
import { registerProjectIPC } from './ipc/projects';
import { registerSystemIPC } from './ipc/system';
import { writeCrashLog } from './utils/logger';

// ==================== 常量 ====================

const isDev = !app.isPackaged;
const PRELOAD_PATH = path.join(__dirname, 'preload.js');

/** 豆包网页地址 */
const DOUBAO_URL = 'https://www.doubao.com';

// ==================== 全局状态 ====================

let mainWindow: BrowserWindow | null = null;
/** 应用是否正在退出，防止退出过程中创建新窗口或重新调度任务 */
let isQuitting = false;

// ==================== 窗口创建 ====================

function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 680,
    title: '豆包工作室 Doubao Studio',
    backgroundColor: '#0f0f14',
    show: false, // 等待 ready-to-show 后再显示，避免白屏闪烁
    frame: false, // 无边框窗口（自定义标题栏）
    titleBarStyle: 'hidden', // macOS 隐藏原生标题栏
    webPreferences: {
      preload: PRELOAD_PATH,
      // 开启 webview 标签支持
      webviewTag: true,
      // 安全策略
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false, // 需要 preload 访问 Node API
    },
  });

  // 窗口准备好后显示
  win.once('ready-to-show', () => {
    win.show();
    if (isDev) {
      win.webContents.openDevTools({ mode: 'detach' });
    }
  });

  // 加载前端页面
  if (isDev) {
    // 开发模式：加载 Vite 开发服务器
    win.loadURL(process.env.VITE_DEV_SERVER_URL || 'http://127.0.0.1:5173');
  } else {
    // 生产模式：加载打包后的文件
    win.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  // 在默认浏览器中打开外部链接
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  return win;
}

// ==================== IPC 注册 ====================

function registerIPC(): void {
  // 注册业务模块 IPC
  registerAccountIPC();
  registerProjectIPC();
  registerTaskIPC();
  registerSystemIPC();

  // ---- 系统级 IPC ----

  // 获取应用版本
  ipcMain.handle('system:getVersion', () => {
    return app.getVersion();
  });

  // 窗口控制
  ipcMain.on('window:minimize', () => {
    mainWindow?.minimize();
  });

  ipcMain.on('window:toggleMaximize', () => {
    if (mainWindow?.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow?.maximize();
    }
  });

  ipcMain.on('window:close', () => {
    mainWindow?.close();
  });

  console.log('[Main] IPC 模块全部注册完成');
}

// ==================== 单实例锁 ====================

/**
 * 防止两个实例同时写数据。
 * requestSingleInstanceLock 返回 false 时说明已有实例在运行，当前进程应立即退出。
 */
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  // 已有实例运行，直接退出当前进程
  app.quit();
} else {
  // 第二实例启动时，聚焦并恢复已有主窗口
  app.on('second-instance', () => {
    if (isQuitting) return;
    if (mainWindow) {
      // 窗口最小化时恢复
      if (mainWindow.isMinimized()) {
        mainWindow.restore();
      }
      if (!mainWindow.isVisible()) {
        mainWindow.show();
      }
      mainWindow.focus();
    }
  });

  // ==================== 全局异常兜底 ====================

  /**
   * 未捕获的同步异常。
   * 记录日志后退出，避免进程处于不确定状态。
   * 不吞掉致命错误——记录后以非零码退出。
   */
  process.on('uncaughtException', (err: Error) => {
    writeCrashLog('uncaughtException', err.message, err.stack);
    // 给日志写入一点时间后退出
    setImmediate(() => {
      process.exit(1);
    });
  });

  /**
   * 未处理的 Promise 拒绝。
   * 记录日志但不自动退出，因为某些拒绝可能是非致命的（如网络超时）。
   * 开发者可通过日志定位并决定是否需要修复。
   */
  process.on('unhandledRejection', (reason: unknown) => {
    const message = reason instanceof Error ? reason.message : String(reason);
    const stack = reason instanceof Error ? reason.stack : undefined;
    writeCrashLog('unhandledRejection', message, stack);
  });

  // ==================== 应用生命周期 ====================

  app.whenReady().then(() => {
    // 注册 IPC
    registerIPC();

    // 创建主窗口
    mainWindow = createMainWindow();

    // macOS: 点击 Dock 图标时重新创建窗口
    // 退出过程中不创建新窗口
    app.on('activate', () => {
      if (isQuitting) return;
      if (BrowserWindow.getAllWindows().length === 0) {
        mainWindow = createMainWindow();
      }
    });
  });

  // 所有窗口关闭时退出应用（macOS 除外）
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });

  // 应用退出前清理：标记退出状态，防止退出过程中创建新窗口
  app.on('before-quit', () => {
    isQuitting = true;
    mainWindow = null;
  });
}
