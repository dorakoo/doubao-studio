/**
 * scripts/fixtures/missing-invoke.ts
 *
 * Fixture: 缺失接收端
 * 预期：E002 错误 — handle 注册了但 preload 中没有对应的 invoke。
 */

import { ipcMain } from 'electron';

export function registerMissingInvokeIPC(): void {
  // 这个 channel 在 preload 中没有对应的 invoke
  ipcMain.handle('fixture:missing:no-invoke', async () => {
    return 'orphan';
  });

  // 这个 on channel 在 preload 中没有对应的 send
  ipcMain.on('fixture:missing:no-send', () => {
    console.log('nobody sends to me');
  });
}
