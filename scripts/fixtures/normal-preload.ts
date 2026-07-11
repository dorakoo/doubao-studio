/**
 * scripts/fixtures/normal-preload.ts
 *
 * Fixture: 正常用法的 preload 对应文件
 * 预期：2 个 invoke、1 个 send，与 normal.ts 一一对应。
 */

import { ipcRenderer } from 'electron';

export const normalAPI = {
  hello: () => ipcRenderer.invoke('fixture:normal:hello'),
  echo: (msg: string) => ipcRenderer.invoke('fixture:normal:echo', msg),
  ping: () => ipcRenderer.send('fixture:normal:ping'),
};
