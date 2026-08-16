/**
 * DOUBAO-MCP-CLIENT-01：MCP stdio 客户端进程适配层（唯一 spawn 位置；核心协议在 mcpClientCore）。
 *
 * 纪律：spawn 注入便于测试；stderr 仅作诊断累积，不进入协议帧。
 */
import { spawn } from 'node:child_process';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import { McpClientCore } from './mcpClientCore';
import type { McpCallResult, McpToolInfo } from './mcpClientCore';

export interface McpConnectionConfig {
  name: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  cwd?: string;
  timeoutMs?: number;
}

export interface McpClientHandle {
  core: McpClientCore;
  /** 诊断输出（stderr 累积，脱敏由调用方负责）。 */
  diagnostics(): string[];
  /** 断开连接并回收子进程。 */
  disconnect(): void;
}

export type SpawnImpl = (
  command: string,
  args: string[],
  options: { env: NodeJS.ProcessEnv; cwd?: string },
) => ChildProcessWithoutNullStreams;

/**
 * 建立 stdio MCP 客户端连接（spawn + readline 双工 + 核心协议）。
 * @param config 连接配置（env 由配置层脱敏后传入）
 * @param spawnImpl 默认 child_process.spawn（测试注入）
 */
export function createMcpClient(config: McpConnectionConfig, spawnImpl: SpawnImpl = spawn): McpClientHandle {
  const child = spawnImpl(config.command, config.args, {
    env: { ...process.env, ...config.env },
    cwd: config.cwd,
  });

  const rl = createInterface({ input: child.stdout, terminal: false });
  const diag: string[] = [];
  child.stderr.on('data', (chunk: Buffer) => {
    const line = String(chunk);
    if (diag.length < 50) diag.push(line.trimEnd());
  });

  const core = new McpClientCore(
    {
      writeLine: (line) => child.stdin.write(line + '\n'),
      onLine: (cb) => rl.on('line', cb),
      onClose: (cb) => child.on('close', cb),
      close: () => {
        try {
          rl.close();
          child.kill();
        } catch {
          /* 已退出 */
        }
      },
    },
    { timeoutMs: config.timeoutMs },
  );

  return {
    core,
    diagnostics: () => [...diag],
    disconnect: () => {
      core.disconnect();
      rl.close();
      try {
        child.kill();
      } catch {
        /* 已退出 */
      }
    },
  };
}

export type { McpCallResult, McpToolInfo };
