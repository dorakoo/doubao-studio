import { ipcMain } from 'electron';
import { v4 as uuidv4 } from 'uuid';
import { readJSON, writeJSON } from '../utils/store';
import type { Project, ProjectAddParams, ProjectUpdateParams, ProjectIdParams } from '@doubao-studio/contracts';
import { replaceIpcHandlers } from './lifecycle';
import { createProjectRecord, DEFAULT_PROJECT_ID, deleteProjectRecord, updateProjectRecord } from '../utils/projectManagement';

// 领域模型接口和 IPC DTO 已迁移至 @doubao-studio/contracts。
// 此处通过 import type 引用，不产生运行时依赖。

export type { Project };

const STORE_FILE = 'projects.json';
export function loadProjects(): Project[] {
  const projects = readJSON<Project[]>(STORE_FILE, []);
  if (!projects.some((project) => project.id === DEFAULT_PROJECT_ID)) {
    const now = new Date().toISOString();
    projects.unshift({ id: DEFAULT_PROJECT_ID, name: '默认项目', description: '由旧版本任务自动迁移', color: '#6d5dfc', archived: false, createdAt: now, updatedAt: now });
    if (!writeJSON(STORE_FILE, projects)) throw new Error('PROJECTS_WRITE_FAILED');
  }
  return projects;
}

export function getDefaultProjectId(): string {
  loadProjects();
  return DEFAULT_PROJECT_ID;
}

const PROJECT_IPC_CHANNELS = ['projects:list', 'projects:add', 'projects:update', 'projects:delete'] as const;

export function registerProjectIPC(): () => void {
  const dispose = replaceIpcHandlers(ipcMain, PROJECT_IPC_CHANNELS);
  loadProjects();
  ipcMain.handle('projects:list', async () => loadProjects());
  ipcMain.handle('projects:add', async (_event, params: ProjectAddParams) => {
    if (!params.name?.trim()) return { success: false, error: '项目名称不能为空' };
    const projects = loadProjects();
    const now = new Date().toISOString();
    const project = createProjectRecord(uuidv4(), params.name, params.description, params.color, now);
    if (!project) return { success: false, error: '项目名称不能为空' };
    projects.push(project);
    if (!writeJSON(STORE_FILE, projects)) return { success: false, error: '项目写入失败' };
    return { success: true, project };
  });
  ipcMain.handle('projects:update', async (_event, params: ProjectUpdateParams) => {
    const projects = loadProjects();
    const updated = updateProjectRecord(projects, params.id, params.updates);
    if (!updated.success) return updated;
    if (!writeJSON(STORE_FILE, updated.projects)) return { success: false, error: '项目写入失败' };
    return { success: true, project: updated.project };
  });
  ipcMain.handle('projects:delete', async (_event, params: ProjectIdParams) => {
    const projects = loadProjects();
    const tasks = readJSON<Array<{ projectId?: string }>>('tasks.json', []);
    const deleted = deleteProjectRecord(projects, tasks, params.id);
    if (!deleted.success) return deleted;
    if (!writeJSON(STORE_FILE, deleted.projects)) return { success: false, error: '项目写入失败', taskCount: 0 };
    return { success: true, taskCount: 0 };
  });
  console.log('[IPC] 项目管理模块已注册');
  return dispose;
}
