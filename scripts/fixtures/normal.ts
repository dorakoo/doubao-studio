/**
 * scripts/fixtures/normal.ts
 *
 * Fixture: 正常用法
 * 预期：扫描后 2 个 handle、1 个 on、2 个 invoke、1 个 send，无错误。
 */

import { ipcMain } from 'electron';

export function registerNormalIPC(): void {
  ipcMain.handle('fixture:normal:hello', async () => {
    return 'hello';
  });

  ipcMain.handle('fixture:normal:echo', async (_event, msg: string) => {
    return msg;
  });

  ipcMain.on('fixture:normal:ping', () => {
    console.log('pong');
  });
}
