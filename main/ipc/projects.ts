import { ipcMain } from 'electron';
import { v4 as uuidv4 } from 'uuid';
import { readJSON, writeJSON } from '../utils/store';

export interface Project {
  id: string;
  name: string;
  description: string;
  color: string;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}

const STORE_FILE = 'projects.json';
const DEFAULT_PROJECT_ID = 'default-project';

export function loadProjects(): Project[] {
  const projects = readJSON<Project[]>(STORE_FILE, []);
  if (!projects.some((project) => project.id === DEFAULT_PROJECT_ID)) {
    const now = new Date().toISOString();
    projects.unshift({ id: DEFAULT_PROJECT_ID, name: '默认项目', description: '由旧版本任务自动迁移', color: '#6d5dfc', archived: false, createdAt: now, updatedAt: now });
    writeJSON(STORE_FILE, projects);
  }
  return projects;
}

export function getDefaultProjectId(): string {
  loadProjects();
  return DEFAULT_PROJECT_ID;
}

export function registerProjectIPC(): void {
  loadProjects();
  ipcMain.handle('projects:list', async () => loadProjects());
  ipcMain.handle('projects:add', async (_event, params: { name: string; description?: string; color?: string }) => {
    if (!params.name?.trim()) return { success: false, error: '项目名称不能为空' };
    const projects = loadProjects();
    const now = new Date().toISOString();
    const project: Project = { id: uuidv4(), name: params.name.trim(), description: params.description?.trim() || '', color: params.color || '#6d5dfc', archived: false, createdAt: now, updatedAt: now };
    projects.push(project);
    writeJSON(STORE_FILE, projects);
    return { success: true, project };
  });
  ipcMain.handle('projects:update', async (_event, params: { id: string; updates: Partial<Pick<Project, 'name' | 'description' | 'color' | 'archived'>> }) => {
    const projects = loadProjects();
    const project = projects.find((item) => item.id === params.id);
    if (!project) return { success: false, error: '项目不存在' };
    Object.assign(project, params.updates, { updatedAt: new Date().toISOString() });
    writeJSON(STORE_FILE, projects);
    return { success: true, project };
  });
  ipcMain.handle('projects:delete', async (_event, params: { id: string }) => {
    if (params.id === DEFAULT_PROJECT_ID) return { success: false, error: '默认项目不能删除' };
    const projects = loadProjects();
    const next = projects.filter((project) => project.id !== params.id);
    if (next.length === projects.length) return { success: false, error: '项目不存在' };
    const tasks = readJSON<Array<{ projectId?: string }>>('tasks.json', []);
    const taskCount = tasks.filter((task) => task.projectId === params.id).length;
    if (taskCount > 0) return { success: false, error: `项目仍包含 ${taskCount} 个任务，请先迁移或删除任务` };
    writeJSON(STORE_FILE, next);
    return { success: true };
  });
  console.log('[IPC] 项目管理模块已注册');
}
