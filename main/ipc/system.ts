import { app, dialog, ipcMain } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { getDataDir, readJSON, writeJSON } from '../utils/store';

interface LogEntry { id: string; level: 'info' | 'warn' | 'error'; scope: string; message: string; taskId?: string; accountId?: string; createdAt: string; }

const DATA_FILES = ['schema.json', 'projects.json', 'accounts.json', 'tasks.json', 'downloads.json', 'adapter-diagnostics.json'];

function compareVersions(left: string, right: string): number {
  const a = left.split('.').map((part) => Number(part) || 0);
  const b = right.split('.').map((part) => Number(part) || 0);
  for (let index = 0; index < Math.max(a.length, b.length); index++) {
    if ((a[index] || 0) !== (b[index] || 0)) return (a[index] || 0) - (b[index] || 0);
  }
  return 0;
}

export function registerSystemIPC(): void {
  ipcMain.handle('logs:list', async () => readJSON<LogEntry[]>('logs.json', []));
  ipcMain.handle('logs:append', async (_event, entry: Omit<LogEntry, 'id' | 'createdAt'>) => {
    const logs = readJSON<LogEntry[]>('logs.json', []);
    logs.push({ ...entry, id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, createdAt: new Date().toISOString() });
    writeJSON('logs.json', logs.slice(-5000));
    return { success: true };
  });
  ipcMain.handle('logs:clear', async () => ({ success: writeJSON('logs.json', []) }));

  ipcMain.handle('system:checkIntegrity', async () => {
    const issues: string[] = [];
    for (const file of DATA_FILES) {
      const filePath = path.join(getDataDir(), file);
      if (!fs.existsSync(filePath)) continue;
      try { JSON.parse(fs.readFileSync(filePath, 'utf-8')); } catch { issues.push(`${file} 无法解析`); }
    }
    const tasks = readJSON<any[]>('tasks.json', []);
    const projects = readJSON<any[]>('projects.json', []);
    const projectIds = new Set(projects.map((item) => item.id));
    for (const task of tasks) if (task.projectId && !projectIds.has(task.projectId)) issues.push(`任务 ${task.id} 引用了不存在的项目`);
    return { success: issues.length === 0, issues, checkedAt: new Date().toISOString() };
  });

  ipcMain.handle('system:exportBackup', async () => {
    const selected = await dialog.showSaveDialog({ title: '导出完整备份', defaultPath: `doubao-studio-backup-${new Date().toISOString().slice(0, 10)}.json`, filters: [{ name: 'JSON', extensions: ['json'] }] });
    if (selected.canceled || !selected.filePath) return { success: false };
    const data: Record<string, any> = {};
    for (const file of [...DATA_FILES, 'logs.json']) data[file] = readJSON(file, null);
    const settingsPath = path.join(app.getPath('userData'), 'settings.json');
    if (fs.existsSync(settingsPath)) data['settings.json'] = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    fs.writeFileSync(selected.filePath, JSON.stringify({ format: 'doubao-studio-backup', version: 2, appVersion: app.getVersion(), exportedAt: new Date().toISOString(), data }, null, 2), 'utf-8');
    return { success: true, filePath: selected.filePath };
  });

  ipcMain.handle('system:restoreBackup', async () => {
    const selected = await dialog.showOpenDialog({ title: '恢复完整备份', properties: ['openFile'], filters: [{ name: 'JSON', extensions: ['json'] }] });
    if (selected.canceled || !selected.filePaths[0]) return { success: false };
    try {
      const backup = JSON.parse(fs.readFileSync(selected.filePaths[0], 'utf-8'));
      if (backup.format !== 'doubao-studio-backup' || !backup.data) return { success: false, error: '不是有效的豆包工作室备份' };
      for (const file of [...DATA_FILES, 'logs.json']) if (backup.data[file] !== undefined) writeJSON(file, backup.data[file]);
      if (backup.data['settings.json']) fs.writeFileSync(path.join(app.getPath('userData'), 'settings.json'), JSON.stringify(backup.data['settings.json'], null, 2), 'utf-8');
      return { success: true, requiresRestart: true };
    } catch (error: any) { return { success: false, error: error.message }; }
  });

  ipcMain.handle('system:exportProject', async (_event, projectId: string) => {
    const projects = readJSON<any[]>('projects.json', []);
    const project = projects.find((item) => item.id === projectId);
    if (!project) return { success: false, error: '项目不存在' };
    const tasks = readJSON<any[]>('tasks.json', []).filter((task) => task.projectId === projectId).map((task) => ({ ...task, outputs: [], artifacts: (task.artifacts || []).map((artifact: any) => ({ ...artifact, url: '[未导出远程地址]' })) }));
    const selected = await dialog.showSaveDialog({ title: '导出项目包', defaultPath: `${project.name}.doubao-project.json`, filters: [{ name: '豆包项目包', extensions: ['json'] }] });
    if (selected.canceled || !selected.filePath) return { success: false };
    fs.writeFileSync(selected.filePath, JSON.stringify({ format: 'doubao-studio-project', version: 1, project, tasks, exportedAt: new Date().toISOString() }, null, 2), 'utf-8');
    return { success: true, filePath: selected.filePath };
  });

  ipcMain.handle('system:checkUpdate', async () => {
    try {
      const response = await fetch('https://api.github.com/repos/dorakoo/doubao-studio/releases/latest', { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Doubao-Studio' } });
      if (!response.ok) throw new Error(`GitHub HTTP ${response.status}`);
      const release = await response.json() as any;
      const latestVersion = String(release.tag_name || '').replace(/^v/, '');
      const currentVersion = app.getVersion();
      return { success: true, currentVersion, latestVersion, hasUpdate: compareVersions(latestVersion, currentVersion) > 0, url: release.html_url, name: release.name };
    } catch (error: any) { return { success: false, error: error.message }; }
  });
}
