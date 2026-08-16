/**
 * DOUBAO-CLI-WIRING-01：CLI 可执行入口（接线 A-3 只读边界；零 Electron）。
 *
 * 运行：node dist/main/cli/doubaoCliEntry.js <command> [options]
 *   commands: list | task <id> | outputs | diagnostics
 *   options : --tasks-file <json>（默认 data/tasks.json）--status --keyword --limit
 */
import { readFileSync, existsSync } from 'node:fs';
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

export interface CliRunResult {
  exitCode: number;
  output: string;
}

/** 纯逻辑执行体（stdout 注入便于测试）。 */
export function runCli(args: string[], write: (s: string) => void = console.log): CliRunResult {
  let tasksFile = 'data/tasks.json';
  const positional: string[] = [];
  const options: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--tasks-file' && args[i + 1]) {
      tasksFile = args[++i];
    } else if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split('=');
      options[k] = v ?? args[++i] ?? 'true';
    } else {
      positional.push(a);
    }
  }

  const service = new TaskService({ store: createFileTaskStore(tasksFile), defaultProjectId: () => 'default' });
  const cli = buildCliActions(service);
  const command = positional[0] ?? 'list';

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
      write('doubao-cli <list|task <id>|outputs|diagnostics> [--tasks-file <json>] [--status <s>] [--keyword <k>] [--limit <n>]');
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
