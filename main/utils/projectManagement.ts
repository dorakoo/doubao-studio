import type { Project } from '@doubao-studio/contracts';

export const DEFAULT_PROJECT_ID = 'default-project';

export interface ProjectTaskCount {
  projectId?: string;
}

export function createProjectRecord(
  id: string,
  name: string,
  description = '',
  color = '#6d5dfc',
  now = new Date().toISOString(),
): Project | null {
  const normalizedName = name.trim();
  if (!normalizedName) return null;
  return {
    id,
    name: normalizedName,
    description: description.trim(),
    color,
    archived: false,
    createdAt: now,
    updatedAt: now,
  };
}

export function updateProjectRecord(
  projects: readonly Project[],
  id: string,
  updates: Partial<Pick<Project, 'name' | 'description' | 'color' | 'archived'>>,
  now = new Date().toISOString(),
): { success: true; projects: Project[]; project: Project } | { success: false; error: string } {
  const current = projects.find((project) => project.id === id);
  if (!current) return { success: false, error: '项目不存在' };
  if (updates.name !== undefined && !updates.name.trim()) return { success: false, error: '项目名称不能为空' };
  if (id === DEFAULT_PROJECT_ID && updates.archived === true) return { success: false, error: '默认项目不能归档' };
  const project: Project = {
    ...current,
    ...(updates.name === undefined ? {} : { name: updates.name.trim() }),
    ...(updates.description === undefined ? {} : { description: updates.description.trim() }),
    ...(updates.color === undefined ? {} : { color: updates.color }),
    ...(updates.archived === undefined ? {} : { archived: updates.archived }),
    updatedAt: now,
  };
  return {
    success: true,
    projects: projects.map((item) => item.id === id ? project : item),
    project,
  };
}

export function deleteProjectRecord(
  projects: readonly Project[],
  tasks: readonly ProjectTaskCount[],
  id: string,
): { success: true; projects: Project[]; taskCount: 0 } | { success: false; error: string; taskCount?: number } {
  if (id === DEFAULT_PROJECT_ID) return { success: false, error: '默认项目不能删除' };
  if (!projects.some((project) => project.id === id)) return { success: false, error: '项目不存在' };
  const taskCount = tasks.filter((task) => (task.projectId || DEFAULT_PROJECT_ID) === id).length;
  if (taskCount > 0) return { success: false, error: `项目仍包含 ${taskCount} 个任务，请先迁移任务`, taskCount };
  return { success: true, projects: projects.filter((project) => project.id !== id), taskCount: 0 };
}
