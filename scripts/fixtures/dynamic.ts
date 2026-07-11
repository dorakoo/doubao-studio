import { ipcMain, ipcRenderer } from 'electron';

const channel = 'fixture:dynamic';

export function registerDynamicIPC(): void {
  ipcMain.handle(channel, async () => true);
}

export const dynamicAPI = {
  invoke: () => ipcRenderer.invoke(channel),
};
