/**
 * DOUBAO-CLI-WIRING-01：MCP stdio 服务器入口（接线 A-3 工具处理器；零 Electron / 零网络）。
 *
 * 协议：JSON-RPC 2.0 over stdio（initialize / tools/list / tools/call / ping）。
 * 运行：node dist/main/mcp/doubaoMcpServer.js --tasks-file <json>
 */
import { createInterface } from 'node:readline';
import { TaskService } from '../core/TaskService';
import { buildMcpToolHandlers, DOUBAO_MCP_TOOLS } from './doubaoMcpTools';
import { createFileTaskStore } from '../cli/doubaoCliEntry';

export interface McpIo {
  writeLine: (line: string) => void;
  onLine: (cb: (line: string) => void) => void;
  close: () => void;
}

export function createStdioIo(): McpIo {
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: false });
  return {
    writeLine: (line: string) => process.stdout.write(line + '\n'),
    onLine: (cb) => rl.on('line', cb),
    close: () => rl.close(),
  };
}

function respond(io: McpIo, id: unknown, result: unknown) {
  io.writeLine(JSON.stringify({ jsonrpc: '2.0', id, result }));
}

/** 启动 MCP 服务（io 注入便于测试）。返回 stop 句柄。 */
export function startMcpServer(io: McpIo, tasksFile: string = 'data/tasks.json') {
  const service = new TaskService({ store: createFileTaskStore(tasksFile), defaultProjectId: () => 'default' });
  const handlers = buildMcpToolHandlers(service);

  io.onLine((line) => {
    let msg: { id?: unknown; method?: string; params?: Record<string, unknown> };
    try {
      msg = JSON.parse(line);
    } catch {
      return; // 非 JSON 行忽略（不打断连接）
    }
    const { id, method, params } = msg;
    if (method === 'initialize') {
      respond(io, id, {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'doubao-mcp', version: '0.1.0' },
      });
    } else if (method === 'tools/list') {
      respond(io, id, { tools: DOUBAO_MCP_TOOLS.map((t) => ({ ...t })) });
    } else if (method === 'tools/call') {
      const toolName = params?.name as keyof ReturnType<typeof buildMcpToolHandlers>;
      const toolArgs = (params?.arguments ?? {}) as never;
      const handler = handlers[toolName];
      if (!handler) {
        respond(io, id, { content: [{ type: 'text', text: JSON.stringify({ ok: false, error: 'UNKNOWN_TOOL' }) }], isError: true });
      } else {
        respond(io, id, handler(toolArgs));
      }
    } else if (method === 'ping') {
      respond(io, id, {});
    }
    // 未知方法静默忽略（MCP 允许客户端扩展）
  });

  return { stop: () => io.close() };
}

// 仅直接执行时启动 stdio 服务
const isDirect = typeof require !== 'undefined' && require.main === module;
if (isDirect) {
  const tasksFileArg = process.argv.find((a) => a.startsWith('--tasks-file='));
  const tasksFile = tasksFileArg ? tasksFileArg.split('=')[1] : 'data/tasks.json';
  startMcpServer(createStdioIo(), tasksFile);
}
