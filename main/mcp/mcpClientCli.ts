/**
 * DOUBAO-MCP-CLIENT-01：MCP 客户端 CLI 入口（零 Electron；spawn 注入便于测试）。
 *
 * 运行：node dist/main/mcp/mcpClientCli.js <command> [options]
 *   commands: tools | call | audit | help
 *   options : --connections-file <json>（默认 data/mcp-connections.json）
 *             --connection <name>（tools/call 指定连接）
 *             --args <json>（call 参数）
 *             --audit-file <jsonl>（默认 data/mcp-audit.jsonl）
 *
 * 纪律：
 *  - 只连接用户显式配置的连接；不自动连接任何服务。
 *  - call 是用户显式触发的唯一调用路径；每次调用追加一条脱敏审计记录。
 *  - 输出一律脱敏（env 值不打码不输出）。
 */
import { readFileSync, existsSync, appendFileSync } from 'node:fs';
import { createMcpClient } from './mcpClient';
import type { SpawnImpl } from './mcpClient';
import { parseConnectionsFile, buildAuditEntry } from './mcpClientConfig';
import type { ConnectionConfig, McpCallAuditEntry } from './mcpClientConfig';

export interface McpCliRunResult {
  exitCode: number;
  output: string;
}

export interface McpCliDeps {
  write?: (s: string) => void;
  spawnImpl?: SpawnImpl;
  connectionsFile?: string;
  auditFile?: string;
}

export async function runMcpCli(args: string[], deps: McpCliDeps = {}): Promise<McpCliRunResult> {
  const write = deps.write ?? ((s: string) => process.stdout.write(s + '\n'));

  const positional: string[] = [];
  const options: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split('=');
      options[k] = v ?? args[++i] ?? 'true';
    } else {
      positional.push(a);
    }
  }
  const connectionsFile = deps.connectionsFile ?? options['connections-file'] ?? 'data/mcp-connections.json';
  const auditFile = deps.auditFile ?? options['audit-file'] ?? 'data/mcp-audit.jsonl';
  const command = positional[0] ?? 'help';

  const emit = (payload: unknown): McpCliRunResult => {
    const text = JSON.stringify(payload);
    write(text);
    return { exitCode: 0, output: text };
  };
  const fail = (payload: unknown): McpCliRunResult => {
    const text = JSON.stringify(payload);
    write(text);
    return { exitCode: 1, output: text };
  };

  if (command === 'help') {
    return emit({ usage: 'doubao-mcp-client <tools|call <tool> [--args <json>]|audit> [--connection <name>] [--connections-file <json>]' });
  }

  if (command === 'audit') {
    const entries: McpCallAuditEntry[] = [];
    if (existsSync(auditFile)) {
      for (const line of readFileSync(auditFile, 'utf8').split('\n')) {
        if (!line.trim()) continue;
        try {
          entries.push(JSON.parse(line) as McpCallAuditEntry);
        } catch {
          /* 损坏行跳过 */
        }
      }
    }
    return emit({ audit: entries });
  }

  const configs: ConnectionConfig[] = parseConnectionsFile(
    existsSync(connectionsFile) ? readFileSync(connectionsFile, 'utf8') : '[]',
  );
  if (configs.length === 0) {
    return fail({ ok: false, error: 'NO_CONNECTIONS：连接文件为空或格式非法' });
  }
  const wanted = options.connection;
  const targets = wanted ? configs.filter((c) => c.name === wanted) : configs;
  if (wanted && targets.length === 0) {
    return fail({ ok: false, error: `CONNECTION_NOT_FOUND: ${wanted}` });
  }

  if (command === 'tools') {
    const out: unknown[] = [];
    for (const config of targets) {
      const handle = createMcpClient(config, deps.spawnImpl);
      try {
        await handle.core.connect();
        const tools = await handle.core.listTools();
        out.push({ connection: config.name, state: handle.core.state, tools });
      } catch (e) {
        out.push({
          connection: config.name,
          state: handle.core.state,
          error: e instanceof Error ? e.message : String(e),
          tools: [],
        });
      } finally {
        handle.disconnect();
      }
    }
    return emit({ ok: true, connections: out });
  }

  if (command === 'call') {
    const tool = positional[1] ?? '';
    const target = targets[0];
    if (!tool) {
      return fail({ ok: false, error: '缺少工具名' });
    }
    let callArgs: Record<string, unknown> = {};
    if (options.args) {
      try {
        callArgs = JSON.parse(options.args) as Record<string, unknown>;
      } catch {
        return fail({ ok: false, error: 'ARGS_NOT_JSON' });
      }
    }
    const handle = createMcpClient(target, deps.spawnImpl);
    try {
      await handle.core.connect();
      const result = await handle.core.callTool(tool, callArgs);
      const ok = !result.isError;
      appendFileSync(auditFile, JSON.stringify(buildAuditEntry(target.name, tool, ok)) + '\n');
      return emit({ ok, connection: target.name, tool, result });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      appendFileSync(auditFile, JSON.stringify(buildAuditEntry(target.name, tool, false, message)) + '\n');
      return fail({ ok: false, connection: target.name, tool, error: message });
    } finally {
      handle.disconnect();
    }
  }

  return fail({ ok: false, error: 'UNKNOWN_COMMAND' });
}

// 仅直接执行时运行 CLI 主体
const isDirect = typeof require !== 'undefined' && require.main === module;
if (isDirect) {
  void runMcpCli(process.argv.slice(2)).then((r) => process.exit(r.exitCode));
}
