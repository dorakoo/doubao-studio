import { app, dialog, ipcMain } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { getDataDir, readJSON, writeJSON } from '../utils/store';
import type { LogEntry, LogAppendParams } from '@doubao-studio/contracts';

// 领域模型接口和 IPC DTO 已迁移至 @doubao-studio/contracts。
// 此处通过 import type 引用，不产生运行时依赖。

const DATA_FILES = ['schema.json', 'projects.json', 'accounts.json', 'tasks.json', 'downloads.json', 'adapter-diagnostics.json'];
const ARRAY_DATA_FILES = new Set(['projects.json', 'accounts.json', 'tasks.json', 'downloads.json', 'adapter-diagnostics.json', 'logs.json']);

import { compareVersions } from '../utils/version';

export function registerSystemIPC(): void {
  ipcMain.handle('logs:list', async () => readJSON<LogEntry[]>('logs.json', []));
  ipcMain.handle('logs:append', async (_event, entry: LogAppendParams) => {
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
    const accounts = readJSON<any[]>('accounts.json', []);
    const projectIds = new Set(projects.map((item) => item.id));
    const accountIds = new Set(accounts.map((item) => item.id));
    const taskIds = new Set<string>();
    for (const task of tasks) {
      if (!task.id) issues.push('存在缺少 ID 的任务');
      else if (taskIds.has(task.id)) issues.push(`任务 ID 重复：${task.id}`);
      else taskIds.add(task.id);
      if (task.projectId && !projectIds.has(task.projectId)) issues.push(`任务 ${task.id} 引用了不存在的项目`);
      if (task.assignedAccountId && !accountIds.has(task.assignedAccountId)) issues.push(`任务 ${task.id} 引用了不存在的账号`);
    }
    for (const task of tasks) {
      for (const dependencyId of task.dependsOnTaskIds || []) {
        if (!taskIds.has(dependencyId)) issues.push(`任务 ${task.id} 引用了不存在的依赖任务 ${dependencyId}`);
        if (dependencyId === task.id) issues.push(`任务 ${task.id} 不能依赖自身`);
      }
    }
    const dependenciesByTask = new Map(tasks.map((task) => [task.id, task.dependsOnTaskIds || []]));
    const visiting = new Set<string>();
    const visited = new Set<string>();
    const hasCycle = (taskId: string): boolean => {
      if (visiting.has(taskId)) return true;
      if (visited.has(taskId)) return false;
      visiting.add(taskId);
      const cyclic = (dependenciesByTask.get(taskId) || []).some((dependencyId: string) => hasCycle(dependencyId));
      visiting.delete(taskId);
      visited.add(taskId);
      return cyclic;
    };
    if (tasks.some((task) => task.id && hasCycle(task.id))) issues.push('任务依赖关系中存在循环，相关工作流无法执行');
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
      const filesToRestore = [...DATA_FILES, 'logs.json'].filter((file) => backup.data[file] !== undefined);
      for (const file of filesToRestore) {
        if (ARRAY_DATA_FILES.has(file) && !Array.isArray(backup.data[file])) {
          return { success: false, error: `备份中的 ${file} 数据格式无效` };
        }
      }
      const originals = new Map(filesToRestore.map((file) => [file, readJSON(file, undefined)]));
      const settingsPath = path.join(app.getPath('userData'), 'settings.json');
      const originalSettings = fs.existsSync(settingsPath) ? fs.readFileSync(settingsPath, 'utf-8') : undefined;
      try {
        for (const file of filesToRestore) {
          if (!writeJSON(file, backup.data[file])) throw new Error(`写入 ${file} 失败`);
        }
        if (backup.data['settings.json'] !== undefined) {
          const temporaryPath = `${settingsPath}.restore.tmp`;
          fs.writeFileSync(temporaryPath, JSON.stringify(backup.data['settings.json'], null, 2), 'utf-8');
          fs.renameSync(temporaryPath, settingsPath);
        }
      } catch (restoreError) {
        for (const [file, data] of originals) {
          if (data !== undefined) writeJSON(file, data);
          else {
            const restoredPath = path.join(getDataDir(), file);
            if (fs.existsSync(restoredPath)) fs.unlinkSync(restoredPath);
          }
        }
        if (originalSettings !== undefined) fs.writeFileSync(settingsPath, originalSettings, 'utf-8');
        else if (fs.existsSync(settingsPath)) fs.unlinkSync(settingsPath);
        throw restoreError;
      }
      return { success: true, requiresRestart: true };
    } catch (error: any) { return { success: false, error: error.message }; }
  });

  ipcMain.handle('system:exportProject', async (_event, projectId: string) => {
    const projects = readJSON<any[]>('projects.json', []);
    const project = projects.find((item) => item.id === projectId);
    if (!project) return { success: false, error: '项目不存在' };
    const tasks = readJSON<any[]>('tasks.json', []).filter((task) => task.projectId === projectId).map((task) => ({
      ...task,
      result: task.result ? '[未导出任务结果]' : task.result,
      outputs: [],
      runtime: task.runtime ? { ...task.runtime, conversationUrl: undefined } : undefined,
      artifacts: (task.artifacts || []).map((artifact: any) => ({ ...artifact, url: '[未导出远程地址]', conversationUrl: undefined })),
    }));
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
