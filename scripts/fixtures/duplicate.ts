/**
 * scripts/fixtures/duplicate.ts
 *
 * Fixture: 重复注册
 * 预期：E001 错误 — 同一 channel 注册了两次。
 */

import { ipcMain } from 'electron';

export function registerDuplicateIPC(): void {
  ipcMain.handle('fixture:dup:channel', async () => {
    return 'first';
  });

  ipcMain.handle('fixture:dup:channel', async () => {
    return 'second';
  });
}
