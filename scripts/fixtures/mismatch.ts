/**
 * scripts/fixtures/mismatch.ts
 *
 * Fixture: 模式不匹配
 * 预期：E004 错误 — handle 配了 send，on 配了 invoke。
 */

import { ipcMain } from 'electron';
import { ipcRenderer } from 'electron';

export function registerMismatchIPC(): void {
  // handle 应该配 invoke，但 preload 中用 send 调用
  ipcMain.handle('fixture:mismatch:handle-with-send', async () => {
    return 'wrong direction';
  });

  // on 应该配 send，但 preload 中用 invoke 调用
  ipcMain.on('fixture:mismatch:on-with-invoke', () => {
    console.log('wrong direction');
  });
}

// preload 侧的错误调用
export const mismatchAPI = {
  wrongSend: () => ipcRenderer.send('fixture:mismatch:handle-with-send'),
  wrongInvoke: () => ipcRenderer.invoke('fixture:mismatch:on-with-invoke'),
};
