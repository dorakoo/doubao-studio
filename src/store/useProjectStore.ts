import { create } from 'zustand';
import type { Project } from '../types';

interface ProjectState {
  projects: Project[];
  activeProjectId: string;
  loading: boolean;
  loadProjects: () => Promise<void>;
  selectProject: (id: string) => void;
  addProject: (name: string, description?: string) => Promise<boolean>;
  updateProject: (id: string, updates: Partial<Pick<Project, 'name' | 'description' | 'color' | 'archived'>>) => Promise<boolean>;
  deleteProject: (id: string) => Promise<boolean>;
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  projects: [], activeProjectId: 'default-project', loading: false,
  loadProjects: async () => {
    set({ loading: true });
    const projects = await window.electronAPI.projects.list();
    const stored = localStorage.getItem('doubao-studio-active-project');
    const activeProjectId = projects.some((project) => project.id === stored) ? stored! : (projects.find((project) => !project.archived)?.id || 'default-project');
    set({ projects, activeProjectId, loading: false });
  },
  selectProject: (id) => {
    localStorage.setItem('doubao-studio-active-project', id);
    set({ activeProjectId: id });
  },
  addProject: async (name, description) => {
    const result = await window.electronAPI.projects.add(name, description);
    if (!result.success || !result.project) return false;
    set({ projects: [...get().projects, result.project], activeProjectId: result.project.id });
    localStorage.setItem('doubao-studio-active-project', result.project.id);
    return true;
  },
  updateProject: async (id, updates) => {
    const result = await window.electronAPI.projects.update(id, updates);
    if (!result.success || !result.project) return false;
    set({ projects: get().projects.map((project) => project.id === id ? result.project! : project) });
    return true;
  },
  deleteProject: async (id) => {
    const result = await window.electronAPI.projects.delete(id);
    if (!result.success) return false;
    set({ projects: get().projects.filter((project) => project.id !== id), activeProjectId: 'default-project' });
    return true;
  },
}));
