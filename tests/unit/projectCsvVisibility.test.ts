import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Project, Task } from '@doubao-studio/contracts';
import { runCli } from '../../main/cli/doubaoCliEntry';
import { createProjectInFile, FROZEN_MIGRATION, migrateProjectTasks } from '../../main/cli/projectTaskMigration';
import { deleteProjectRecord, updateProjectRecord } from '../../main/utils/projectManagement';

let dir: string;
let tasksFile: string;
let projectsFile: string;
let csvFile: string;

function project(id: string, name = id): Project {
  return { id, name, description: '', color: '#fff', archived: false, createdAt: '2026-08-27T00:00:00.000Z', updatedAt: '2026-08-27T00:00:00.000Z' };
}

function task(id: string, projectId: string, status: Task['status'] = 'queued', mode: Task['mode'] = 'video'): Task {
  return {
    id, prompt: `prompt-${id}`, assignedAccountId: null, status, mode, result: null, outputs: [], artifacts: [], runHistory: [],
    source: 'csv', dependsOnTaskIds: [], projectId, createdAt: '2026-08-27T00:00:00.000Z', updatedAt: '2026-08-27T00:00:00.000Z',
  } as Task;
}

function writeProjects(extra: Project[] = []): void {
  writeFileSync(projectsFile, JSON.stringify([project('default-project', '默认项目'), ...extra], null, 2), 'utf8');
}

function migrationTasks(): Task[] {
  return [
    ...Array.from({ length: 12 }, (_, index) => task(`source-${index}`, FROZEN_MIGRATION.sourceProjectId)),
    ...Array.from({ length: 4 }, (_, index) => task(`c03-${index}`, 'default-project', 'done')),
  ];
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'doubao-project-visibility-'));
  tasksFile = join(dir, 'tasks.json');
  projectsFile = join(dir, 'projects.json');
  csvFile = join(dir, 'batch.csv');
  writeFileSync(tasksFile, '[]', 'utf8');
  writeProjects([project(FROZEN_MIGRATION.targetProjectId, '猫抓板')]);
  writeFileSync(csvFile, 'prompt,mode,attachments\n"secret prompt",video,"D:\\\\secret\\\\asset.png"', 'utf8');
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('CLI CSV 项目完整性', () => {
  it('未知 projectId 返回 PROJECT_NOT_FOUND 且台账原文不变', () => {
    const before = readFileSync(tasksFile, 'utf8');
    const result = runCli(['import-csv', '--csv', csvFile, '--tasks-file', tasksFile, '--projects-file', projectsFile, '--project-id', 'missing'], () => {});
    expect(JSON.parse(result.output)).toEqual({ ok: false, error: 'PROJECT_NOT_FOUND' });
    expect(readFileSync(tasksFile, 'utf8')).toBe(before);
  });

  it('已存在项目导入成功，机器输出不含任务、提示词或素材路径', () => {
    const output: string[] = [];
    const result = runCli(['import-csv', '--csv', csvFile, '--tasks-file', tasksFile, '--projects-file', projectsFile, '--project-id', FROZEN_MIGRATION.targetProjectId], (line) => output.push(line));
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(output[0]);
    expect(parsed.data).toMatchObject({ imported: 1, skipped: 0, projectId: FROZEN_MIGRATION.targetProjectId });
    expect(parsed.data).not.toHaveProperty('tasks');
    expect(output[0]).not.toContain('secret prompt');
    expect(output[0]).not.toContain('asset.png');
    expect((JSON.parse(readFileSync(tasksFile, 'utf8')) as Task[])[0].projectId).toBe(FROZEN_MIGRATION.targetProjectId);
  });

  it('--project-name 每次创建真实 UUID，同名不复用', () => {
    const first = createProjectInFile(projectsFile, '同名项目');
    const second = createProjectInFile(projectsFile, '同名项目');
    expect(first.id).not.toBe(second.id);
    expect(first.name).toBe(second.name);
  });

  it('--project-name 创建项目后导入并返回真实项目 ID', () => {
    const result = runCli(['import-csv', '--csv', csvFile, '--tasks-file', tasksFile, '--projects-file', projectsFile, '--project-name', '新项目'], () => {});
    const parsed = JSON.parse(result.output);
    expect(parsed.ok).toBe(true);
    expect(parsed.data.projectId).toMatch(/^[0-9a-f-]{36}$/);
    expect((JSON.parse(readFileSync(tasksFile, 'utf8')) as Task[])[0].projectId).toBe(parsed.data.projectId);
  });

  it('project-id 与 project-name 同时出现时 fail-closed', () => {
    const before = readFileSync(tasksFile, 'utf8');
    const result = runCli(['import-csv', '--csv', csvFile, '--tasks-file', tasksFile, '--projects-file', projectsFile, '--project-id', 'default-project', '--project-name', '冲突'], () => {});
    expect(JSON.parse(result.output).error).toBe('INVALID_ARGUMENTS');
    expect(readFileSync(tasksFile, 'utf8')).toBe(before);
  });
});

describe('一次性孤儿任务迁移', () => {
  beforeEach(() => writeFileSync(tasksFile, JSON.stringify(migrationTasks(), null, 2), 'utf8'));

  const params = () => ({
    tasksFile, projectsFile,
    sourceProjectId: FROZEN_MIGRATION.sourceProjectId,
    targetProjectId: FROZEN_MIGRATION.targetProjectId,
  });

  it('默认 dry-run 只报告12项且不写入', () => {
    const before = readFileSync(tasksFile, 'utf8');
    expect(migrateProjectTasks(params())).toMatchObject({ dryRun: true, affected: 12, targetQueuedVideoAfter: 12 });
    expect(readFileSync(tasksFile, 'utf8')).toBe(before);
  });

  it('非冻结来源或目标被拒绝', () => {
    expect(() => migrateProjectTasks({ ...params(), sourceProjectId: 'other' })).toThrow('MIGRATION_SCOPE_NOT_ALLOWED');
  });

  it('明确确认后迁移，source=0、target=12、默认4项完整不变', () => {
    const beforeDefault = migrationTasks().filter((item) => item.projectId === 'default-project');
    expect(migrateProjectTasks({ ...params(), confirm: 12 })).toMatchObject({ dryRun: false, sourceQueuedVideoAfter: 0, targetQueuedVideoAfter: 12, defaultDoneAfter: 4 });
    const after = JSON.parse(readFileSync(tasksFile, 'utf8')) as Task[];
    expect(after.filter((item) => item.projectId === FROZEN_MIGRATION.sourceProjectId)).toHaveLength(0);
    expect(after.filter((item) => item.projectId === FROZEN_MIGRATION.targetProjectId)).toHaveLength(12);
    expect(after.filter((item) => item.projectId === 'default-project')).toEqual(beforeDefault);
  });

  it('tasks.json 在读后漂移时拒绝覆盖', () => {
    expect(() => migrateProjectTasks({
      ...params(), confirm: 12,
      beforeWrite: () => writeFileSync(tasksFile, JSON.stringify([...migrationTasks(), task('external', 'default-project')]), 'utf8'),
    })).toThrow('TASKS_FILE_CHANGED');
    expect((JSON.parse(readFileSync(tasksFile, 'utf8')) as Task[]).some((item) => item.id === 'external')).toBe(true);
  });

  it.each([
    ['source count', () => migrationTasks().slice(1)],
    ['source status', () => migrationTasks().map((item, index) => index === 0 ? { ...item, status: 'fail' as const } : item)],
    ['target nonempty', () => [...migrationTasks(), task('target-existing', FROZEN_MIGRATION.targetProjectId)]],
  ])('%s 不变量不符时拒绝写入', (_label, factory) => {
    const value = factory();
    writeFileSync(tasksFile, JSON.stringify(value), 'utf8');
    expect(() => migrateProjectTasks({ ...params(), confirm: 12 })).toThrow();
    expect(JSON.parse(readFileSync(tasksFile, 'utf8'))).toEqual(value);
  });
});

describe('安全项目管理规则', () => {
  const projects = [project('default-project'), project('active')];

  it('默认项目不能删除或归档', () => {
    expect(deleteProjectRecord(projects, [], 'default-project').success).toBe(false);
    expect(updateProjectRecord(projects, 'default-project', { archived: true }).success).toBe(false);
  });

  it('含任务项目返回 taskCount 并拒绝删除', () => {
    expect(deleteProjectRecord(projects, [task('1', 'active'), task('2', 'active')], 'active')).toMatchObject({ success: false, taskCount: 2 });
  });

  it('空项目可删除且不触碰任务', () => {
    const result = deleteProjectRecord(projects, [task('1', 'default-project')], 'active');
    expect(result).toMatchObject({ success: true, taskCount: 0 });
    if (result.success) expect(result.projects.map((item) => item.id)).toEqual(['default-project']);
  });

  it('编辑只接受安全字段并拒绝空名称', () => {
    expect(updateProjectRecord(projects, 'active', { name: '  新名称  ', description: '  说明  ' })).toMatchObject({ success: true, project: { name: '新名称', description: '说明' } });
    expect(updateProjectRecord(projects, 'active', { name: '   ' }).success).toBe(false);
  });
});

describe('项目管理界面源码契约', () => {
  it('暴露管理入口、二次确认与始终可见的项目统计', () => {
    const switcher = readFileSync(join(process.cwd(), 'src/components/ProjectSwitcher.tsx'), 'utf8');
    const modal = readFileSync(join(process.cwd(), 'src/components/ProjectManagementModal.tsx'), 'utf8');
    const consoleSource = readFileSync(join(process.cwd(), 'src/components/TaskConsole.tsx'), 'utf8');
    expect(switcher).toContain('管理项目');
    expect(modal).toContain('Popconfirm');
    expect(modal).toContain('不能删除');
    expect(consoleSource).toContain('排队 {queuedCount}');
    expect(consoleSource).toContain('运行 {runningCount}');
    expect(consoleSource).toContain('完成 {doneCount}');
  });
});
