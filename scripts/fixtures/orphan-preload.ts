import { ipcRenderer } from 'electron';

export const orphanAPI = {
  invoke: () => ipcRenderer.invoke('fixture:orphan:invoke'),
  send: () => ipcRenderer.send('fixture:orphan:send'),
};
