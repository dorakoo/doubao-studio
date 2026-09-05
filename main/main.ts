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
import { randomBytes } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { registerAccountIPC } from './ipc/accounts';
import { listTasksForLocalControl, registerTaskIPC } from './ipc/tasks';
import { loadProjects, registerProjectIPC } from './ipc/projects';
import { registerSystemIPC } from './ipc/system';
import { writeCrashLog } from './utils/logger';
import { replaceIpcHandlers } from './ipc/lifecycle';
import { buildDevelopmentLaunchHelpUrl, resolveRendererStartupTarget } from './utils/rendererStartup';
import { ControlCommandBroker } from './control/ControlCommandBroker';
import { LocalControlServer } from './control/LocalControlServer';
import type { ControlCommandResult } from './control/controlTypes';

// ==================== 常量 ====================

const isDev = !app.isPackaged;
const PRELOAD_PATH = path.join(__dirname, 'preload.js');

/** 豆包网页地址 */
const DOUBAO_URL = 'https://www.doubao.com';

// ==================== 全局状态 ====================

let mainWindow: BrowserWindow | null = null;
/** 应用是否正在退出，防止退出过程中创建新窗口或重新调度任务 */
let isQuitting = false;
let unregisterIPC: (() => void) | null = null;
let localControlServer: LocalControlServer | null = null;
let controlBroker: ControlCommandBroker | null = null;
let localControlFiles: string[] = [];

function resolveLocalControlPort(argv: string[]): number | null {
  const enabled = argv.includes('--local-control') || argv.some((arg) => arg.startsWith('--local-control-port='));
  if (!enabled) return null;
  const portArg = argv.find((arg) => arg.startsWith('--local-control-port='));
  if (!portArg) return 0;
  const value = Number(portArg.slice('--local-control-port='.length));
  if (!Number.isInteger(value) || value < 0 || value > 65535) throw new Error('本机控制端口无效');
  return value;
}

function writePrivateJson(filePath: string, value: unknown): void {
  const tempPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(value, null, 2), { encoding: 'utf8', mode: 0o600 });
  fs.chmodSync(tempPath, 0o600);
  fs.renameSync(tempPath, filePath);
  fs.chmodSync(filePath, 0o600);
}

async function startLocalControl(): Promise<void> {
  const requestedPort = resolveLocalControlPort(process.argv.slice(1));
  if (requestedPort === null) return;
  const token = randomBytes(32).toString('base64url');
  const startedAtMs = Date.now();
  const expiresAtMs = startedAtMs + 8 * 60 * 60 * 1000;
  const controlDir = path.join(app.getPath('userData'), 'DoubaoStudioControl');
  fs.mkdirSync(controlDir, { recursive: true, mode: 0o700 });
  fs.chmodSync(controlDir, 0o700);
  const tokenPath = path.join(controlDir, 'control-token');
  const infoPath = path.join(controlDir, 'control-info.json');
  // 单实例锁已取得，可安全清理上次崩溃遗留的两个固定发现文件。
  for (const stalePath of [infoPath, tokenPath]) {
    try { fs.unlinkSync(stalePath); } catch {}
  }
  const broker = new ControlCommandBroker(() => mainWindow?.webContents || null);
  controlBroker = broker;
  localControlServer = new LocalControlServer({
    token,
    expiresAtMs,
    listProjects: loadProjects,
    listTasks: listTasksForLocalControl,
    isRendererReady: () => broker.isReady(),
    dispatch: (command) => broker.dispatch(command),
  });
  const port = await localControlServer.start(requestedPort);
  fs.writeFileSync(tokenPath, token, { encoding: 'utf8', mode: 0o600 });
  fs.chmodSync(tokenPath, 0o600);
  writePrivateJson(infoPath, {
    protocolVersion: 'v1',
    address: '127.0.0.1',
    port,
    pid: process.pid,
    tokenFile: 'control-token',
    startedAt: new Date(startedAtMs).toISOString(),
    expiresAt: new Date(expiresAtMs).toISOString(),
  });
  localControlFiles = [infoPath, tokenPath];
  console.log(`[Control] 本机受控接口已启动 127.0.0.1:${port}（认证令牌未写入日志）`);
}

async function stopLocalControl(): Promise<void> {
  controlBroker?.close();
  controlBroker = null;
  const server = localControlServer;
  localControlServer = null;
  if (server) await server.stop().catch(() => undefined);
  for (const filePath of localControlFiles) {
    try { fs.unlinkSync(filePath); } catch {}
  }
  localControlFiles = [];
}

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

  // 加载前端页面。源码开发版缺少 dev server 注入时显示诊断页，禁止静默黑屏。
  const rendererTarget = resolveRendererStartupTarget(app.isPackaged, process.env.VITE_DEV_SERVER_URL, __dirname);
  const rendererLoad = rendererTarget.kind === 'file'
    ? win.loadFile(rendererTarget.value)
    : win.loadURL(rendererTarget.value);
  void rendererLoad.catch((error: Error) => {
    writeCrashLog('rendererLoadFailure', error.message, error.stack);
    if (!win.isDestroyed()) void win.loadURL(buildDevelopmentLaunchHelpUrl());
  });

  // 在默认浏览器中打开外部链接
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null;
  });

  return win;
}

// ==================== IPC 注册 ====================

function registerIPC(): void {
  unregisterIPC?.();
  // 注册业务模块 IPC
  const disposers = [
    registerAccountIPC(),
    registerProjectIPC(),
    registerTaskIPC(),
    registerSystemIPC(),
  ];

  disposers.push(replaceIpcHandlers(ipcMain, ['system:getVersion']));

  // ---- 系统级 IPC ----

  // 获取应用版本
  ipcMain.handle('system:getVersion', () => {
    return app.getVersion();
  });

  // 窗口控制
  const minimizeWindow = (): void => {
    mainWindow?.minimize();
  };

  const toggleMaximizeWindow = (): void => {
    if (mainWindow?.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow?.maximize();
    }
  };

  const closeWindow = (): void => {
    mainWindow?.close();
  };

  ipcMain.on('window:minimize', minimizeWindow);
  ipcMain.on('window:toggleMaximize', toggleMaximizeWindow);
  ipcMain.on('window:close', closeWindow);

  const completeControlCommand = (event: Electron.IpcMainEvent, result: ControlCommandResult): void => {
    controlBroker?.complete(event.sender, result);
  };
  const markControlReady = (event: Electron.IpcMainEvent): void => {
    controlBroker?.markReady(event.sender);
  };
  ipcMain.on('control:result', completeControlCommand);
  ipcMain.on('control:ready', markControlReady);

  unregisterIPC = () => {
    for (const dispose of disposers.reverse()) dispose();
    ipcMain.removeListener('window:minimize', minimizeWindow);
    ipcMain.removeListener('window:toggleMaximize', toggleMaximizeWindow);
    ipcMain.removeListener('window:close', closeWindow);
    ipcMain.removeListener('control:result', completeControlCommand);
    ipcMain.removeListener('control:ready', markControlReady);
    unregisterIPC = null;
  };

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
    if (mainWindow && !mainWindow.isDestroyed()) {
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

  app.whenReady().then(async () => {
    // 注册 IPC
    registerIPC();

    // 创建主窗口
    mainWindow = createMainWindow();
    mainWindow.webContents.on('did-start-loading', () => controlBroker?.markUnavailable());
    mainWindow.webContents.on('render-process-gone', () => controlBroker?.markUnavailable());
    await startLocalControl();

    // macOS: 点击 Dock 图标时重新创建窗口
    // 退出过程中不创建新窗口
    app.on('activate', () => {
      if (isQuitting) return;
      if (BrowserWindow.getAllWindows().length === 0) {
        mainWindow = createMainWindow();
      }
    });
  }).catch((reason: unknown) => {
    const error = reason instanceof Error ? reason : new Error(String(reason));
    writeCrashLog('startupFailure', error.message, error.stack);
    app.exit(1);
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
    unregisterIPC?.();
    void stopLocalControl();
    mainWindow = null;
  });
}
