import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import type { Project, Task } from '@doubao-studio/contracts';
import { createProjectRecord, DEFAULT_PROJECT_ID } from '../utils/projectManagement';

export const FROZEN_MIGRATION = {
  sourceProjectId: 'MY-CATSCRATCHER-VIDEO-20260824-01',
  targetProjectId: '30c20259-58bd-4f01-8a70-f6c8d0a0732d',
  expectedCount: 12,
} as const;

function error(code: string): never {
  throw new Error(code);
}

function parseArrayFile<T>(filePath: string, missingCode: string, invalidCode: string): { raw: string; items: T[] } {
  if (!existsSync(filePath)) error(missingCode);
  const raw = readFileSync(filePath, 'utf8');
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) error(invalidCode);
    return { raw, items: parsed as T[] };
  } catch (caught) {
    if (caught instanceof Error && caught.message === invalidCode) throw caught;
    error(invalidCode);
  }
}

function atomicReplace(filePath: string, baseline: string, data: unknown, suffix: string): void {
  if (readFileSync(filePath, 'utf8') !== baseline) error(`${suffix}_FILE_CHANGED`);
  const temp = `${filePath}.${process.pid}.${suffix.toLowerCase()}.tmp`;
  try {
    writeFileSync(temp, JSON.stringify(data, null, 2), 'utf8');
    renameSync(temp, filePath);
  } finally {
    if (existsSync(temp)) unlinkSync(temp);
  }
}

export function readProjectsFile(filePath: string): { raw: string; projects: Project[] } {
  const result = parseArrayFile<Project>(filePath, 'PROJECTS_FILE_NOT_FOUND', 'PROJECTS_FILE_INVALID');
  return { raw: result.raw, projects: result.items };
}

export function requireProject(filePath: string, projectId: string): Project {
  const { projects } = readProjectsFile(filePath);
  const project = projects.find((item) => item.id === projectId);
  if (!project) error('PROJECT_NOT_FOUND');
  return project;
}

export function createProjectInFile(filePath: string, name: string): Project {
  const { raw, projects } = readProjectsFile(filePath);
  const project = createProjectRecord(randomUUID(), name);
  if (!project) error('INVALID_PROJECT_NAME');
  atomicReplace(filePath, raw, [...projects, project], 'PROJECTS');
  return project;
}

function stableFingerprint(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export interface MigrationSummary {
  dryRun: boolean;
  affected: number;
  sourceProjectId: string;
  targetProjectId: string;
  sourceQueuedVideoAfter: number;
  targetQueuedVideoAfter: number;
  defaultDoneAfter: number;
}

export function migrateProjectTasks(params: {
  tasksFile: string;
  projectsFile: string;
  sourceProjectId: string;
  targetProjectId: string;
  confirm?: number;
  beforeWrite?: () => void;
}): MigrationSummary {
  const frozen = FROZEN_MIGRATION;
  if (params.sourceProjectId !== frozen.sourceProjectId || params.targetProjectId !== frozen.targetProjectId) {
    error('MIGRATION_SCOPE_NOT_ALLOWED');
  }
  requireProject(params.projectsFile, params.targetProjectId);
  const { raw, items: tasks } = parseArrayFile<Task>(params.tasksFile, 'TASKS_FILE_NOT_FOUND', 'TASKS_FILE_INVALID');
  const source = tasks.filter((task) => task.projectId === params.sourceProjectId);
  const target = tasks.filter((task) => task.projectId === params.targetProjectId);
  const defaultDone = tasks.filter((task) => (task.projectId || DEFAULT_PROJECT_ID) === DEFAULT_PROJECT_ID && task.status === 'done');
  if (source.length !== frozen.expectedCount || source.some((task) => task.status !== 'queued' || task.mode !== 'video')) {
    error('MIGRATION_SOURCE_MISMATCH');
  }
  if (target.length !== 0) error('MIGRATION_TARGET_NOT_EMPTY');
  if (defaultDone.length !== 4) error('MIGRATION_DEFAULT_INVARIANT_MISMATCH');
  const defaultFingerprint = stableFingerprint(defaultDone);
  const summary: MigrationSummary = {
    dryRun: params.confirm !== frozen.expectedCount,
    affected: source.length,
    sourceProjectId: params.sourceProjectId,
    targetProjectId: params.targetProjectId,
    sourceQueuedVideoAfter: 0,
    targetQueuedVideoAfter: frozen.expectedCount,
    defaultDoneAfter: defaultDone.length,
  };
  if (summary.dryRun) return summary;

  const sourceIds = new Set(source.map((task) => task.id));
  const next = tasks.map((task) => sourceIds.has(task.id) ? { ...task, projectId: params.targetProjectId } : task);
  params.beforeWrite?.();
  atomicReplace(params.tasksFile, raw, next, 'TASKS');
  const reread = parseArrayFile<Task>(params.tasksFile, 'TASKS_FILE_NOT_FOUND', 'TASKS_FILE_INVALID').items;
  const sourceAfter = reread.filter((task) => task.projectId === params.sourceProjectId);
  const targetAfter = reread.filter((task) => task.projectId === params.targetProjectId && task.status === 'queued' && task.mode === 'video');
  const defaultDoneAfter = reread.filter((task) => (task.projectId || DEFAULT_PROJECT_ID) === DEFAULT_PROJECT_ID && task.status === 'done');
  if (sourceAfter.length !== 0 || targetAfter.length !== frozen.expectedCount || stableFingerprint(defaultDoneAfter) !== defaultFingerprint) {
    error('MIGRATION_VERIFY_FAILED');
  }
  return { ...summary, dryRun: false, sourceQueuedVideoAfter: sourceAfter.length, targetQueuedVideoAfter: targetAfter.length, defaultDoneAfter: defaultDoneAfter.length };
}
