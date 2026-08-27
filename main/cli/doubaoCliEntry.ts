/**
 * 查询命令保持只读；import-csv 是唯一显式写入命令（零 Electron）。
 *
 * 运行：node dist/main/cli/doubaoCliEntry.js <command> [options]
 *   commands: list | task <id> | outputs | diagnostics | import-csv
 *   options : --tasks-file <json>（默认 data/tasks.json）--status --keyword --limit
 */
import { readFileSync, writeFileSync, renameSync, unlinkSync, existsSync, statSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { TaskService } from '../core/TaskService';
import { buildCliActions } from './doubaoCli';
import type { Task } from '@doubao-studio/contracts';

/** JSON 文件任务存储（只读面；replace 恒 false —— CLI 无写路径）。 */
export function createFileTaskStore(filePath: string) {
  return {
    read(): Task[] {
      if (!existsSync(filePath)) return [];
      try {
        const parsed = JSON.parse(readFileSync(filePath, 'utf8'));
        return Array.isArray(parsed) ? (parsed as Task[]) : [];
      } catch {
        return [];
      }
    },
    replace(): boolean {
      return false;
    },
  };
}

/** 显式写入型存储：原文指纹漂移即拒绝，落盘使用同目录临时文件原子替换。 */
export function createWritableFileTaskStore(filePath: string) {
  let baseline: string | null = null;
  return {
    read(): Task[] {
      if (!existsSync(filePath)) throw new Error('TASKS_FILE_NOT_FOUND');
      const raw = readFileSync(filePath, 'utf8');
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) throw new Error('TASKS_FILE_INVALID');
      baseline = raw;
      return parsed as Task[];
    },
    replace(tasks: Task[]): boolean {
      if (baseline === null || readFileSync(filePath, 'utf8') !== baseline) {
        throw new Error('TASKS_FILE_CHANGED');
      }
      const temp = `${filePath}.${process.pid}.import.tmp`;
      try {
        writeFileSync(temp, JSON.stringify(tasks, null, 2), 'utf8');
        renameSync(temp, filePath);
        baseline = readFileSync(filePath, 'utf8');
        return true;
      } finally {
        if (existsSync(temp)) unlinkSync(temp);
      }
    },
  };
}

export interface CliRunResult {
  exitCode: number;
  output: string;
}

/** 纯逻辑执行体（stdout 注入便于测试）。 */
export function runCli(args: string[], write: (s: string) => void = console.log): CliRunResult {
  let tasksFile = 'data/tasks.json';
  const positional: string[] = [];
  const options: Record<string, string> = {};
  const seenOptions = new Set<string>();
  let invalidArguments = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split('=');
      const next = v ?? args[i + 1];
      if (seenOptions.has(k) || !next || next.startsWith('--')) {
        invalidArguments = true;
        continue;
      }
      seenOptions.add(k);
      options[k] = next;
      if (v === undefined) i += 1;
      if (k === 'tasks-file') tasksFile = next;
    } else {
      positional.push(a);
    }
  }

  const command = positional[0] ?? 'list';
  const allowedByCommand: Record<string, ReadonlySet<string>> = {
    list: new Set(['tasks-file', 'status', 'keyword', 'limit']),
    task: new Set(['tasks-file']),
    outputs: new Set(['tasks-file']),
    diagnostics: new Set(['tasks-file']),
    'import-csv': new Set(['tasks-file', 'csv', 'accounts-file', 'project-id']),
    help: new Set(),
  };
  if (invalidArguments || !allowedByCommand[command] || Object.keys(options).some((key) => !allowedByCommand[command].has(key))) {
    const output = JSON.stringify({ ok: false, error: 'INVALID_ARGUMENTS' });
    write(output);
    return { exitCode: 1, output };
  }

  if (command === 'import-csv') {
    const csvPath = options.csv ? resolve(options.csv) : '';
    const explicitTasksFile = options['tasks-file'] ? resolve(options['tasks-file']) : '';
    if (!csvPath || !explicitTasksFile || extname(csvPath).toLowerCase() !== '.csv') {
      const output = JSON.stringify({ ok: false, error: 'INVALID_ARGUMENTS' });
      write(output);
      return { exitCode: 1, output };
    }
    try {
      const csvStat = statSync(csvPath);
      if (!csvStat.isFile() || csvStat.size <= 0 || csvStat.size > 10 * 1024 * 1024) throw new Error('CSV_INVALID');
      const accountsFile = resolve(options['accounts-file'] || join(dirname(explicitTasksFile), 'accounts.json'));
      const accountsRaw = existsSync(accountsFile) ? JSON.parse(readFileSync(accountsFile, 'utf8')) as unknown : [];
      if (!Array.isArray(accountsRaw)) throw new Error('ACCOUNTS_FILE_INVALID');
      const service = new TaskService({
        store: createWritableFileTaskStore(explicitTasksFile),
        defaultProjectId: () => options['project-id'] || 'default-project',
      });
      const imported = service.importCsv({
        text: readFileSync(csvPath, 'utf8'),
        accounts: accountsRaw as Array<{ id: string; name: string; platform?: 'doubao' | 'dola' }>,
        projectId: options['project-id'],
      });
      const result = imported.success ? { ok: true, data: imported.data } : { ok: false, error: imported.error };
      const output = JSON.stringify(result);
      write(output);
      return { exitCode: result.ok ? 0 : 1, output };
    } catch {
      const output = JSON.stringify({ ok: false, error: 'CSV_IMPORT_FAILED' });
      write(output);
      return { exitCode: 1, output };
    }
  }

  const service = new TaskService({ store: createFileTaskStore(tasksFile), defaultProjectId: () => 'default' });
  const cli = buildCliActions(service);

  let result: { ok: boolean; error?: string; data?: unknown } = { ok: false, error: 'UNKNOWN_COMMAND' };
  switch (command) {
    case 'list':
      result = cli.listTasks({
        status: options.status,
        keyword: options.keyword,
        limit: options.limit ? Number(options.limit) : undefined,
      });
      break;
    case 'task':
      result = cli.taskDetail(positional[1] ?? '');
      break;
    case 'outputs':
      result = cli.completedOutputs();
      break;
    case 'diagnostics':
      result = cli.diagnostics();
      break;
    case 'help':
      write('doubao-cli <list|task <id>|outputs|diagnostics|import-csv> [--tasks-file <json>] [--csv <csv>] [--accounts-file <json>] [--project-id <id>]');
      return { exitCode: 0, output: 'help' };
    default:
      result = { ok: false, error: 'UNKNOWN_COMMAND' };
  }

  write(JSON.stringify(result));
  return { exitCode: result.ok ? 0 : 1, output: JSON.stringify(result) };
}

// 仅直接执行时运行 CLI 主体
const isDirect = typeof require !== 'undefined' && require.main === module;
if (isDirect) {
  const code = runCli(process.argv.slice(2)).exitCode;
  process.exit(code);
}
