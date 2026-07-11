/**
 * scripts/fixtures/top-level.ts
 *
 * Fixture: 顶层注册
 * 预期：E005 错误 — ipcMain.handle 在模块顶层调用，不在函数体内。
 *       E006 错误 — app.getPath 在模块顶层调用。
 */

import { ipcMain, app } from 'electron';
import * as path from 'path';

// E005: 模块顶层注册 IPC handler
ipcMain.handle('fixture:toplevel:handle', async () => {
  return 'top-level handle';
});

// E005: 模块顶层注册 IPC listener
ipcMain.on('fixture:toplevel:on', () => {
  console.log('top-level on');
});

// E006: 模块顶层调用 app.getPath()
const badPath = path.join(app.getPath('userData'), 'bad.json');

export { badPath };
