/**
 * @doubao-studio/contracts — 项目 IPC DTO
 *
 * 项目管理 IPC 的参数和返回值类型。
 * 复用 domain 中的领域模型，不引入运行时值。
 */

import type { Project } from '../domain';

// ==================== 通用返回值 ====================

/** 项目操作简单结果（无数据返回） */
export interface ProjectOperationResult {
  success: boolean;
  error?: string;
}

/** 项目操作结果（包含项目数据） */
export interface ProjectResult {
  success: boolean;
  project?: Project;
  error?: string;
}

// ==================== IPC 参数 DTO ====================

export interface ProjectAddParams {
  name: string;
  description?: string;
  color?: string;
}

export interface ProjectUpdateParams {
  id: string;
  updates: Partial<Pick<Project, 'name' | 'description' | 'color' | 'archived'>>;
}

export interface ProjectIdParams {
  id: string;
}
