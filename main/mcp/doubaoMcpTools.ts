/**
 * DOUBAO-CLI-MCP-BOUNDARY-01：MCP 工具处理器（纯逻辑，零 Electron / 零网络）。
 *
 * 由 MCP stdio 入口（后续独立接线包）构造 TaskService 后调用；
 * 本文件只负责「工具名 → 只读动作」映射与结果 JSON 序列化。
 */
import { TaskService } from '../core/TaskService';
import { buildCliActions } from '../cli/doubaoCli';

export interface McpToolResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

/** 工具描述（MCP tools/list 注册表）。 */
export const DOUBAO_MCP_TOOLS = [
  {
    name: 'doubao.list_tasks',
    description: '只读列出豆包任务（可选 status/keyword 过滤；零写入）',
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string' },
        keyword: { type: 'string' },
        limit: { type: 'integer' },
      },
    },
  },
  {
    name: 'doubao.get_task',
    description: '只读获取单个豆包任务详情（零写入）',
    inputSchema: {
      type: 'object',
      properties: { taskId: { type: 'string' } },
      required: ['taskId'],
    },
  },
] as const;

/** 构建 MCP 工具处理器映射（纯逻辑；结果恒为 JSON 文本）。 */
export function buildMcpToolHandlers(service: TaskService) {
  const cli = buildCliActions(service);
  return {
    'doubao.list_tasks': (args: { status?: string; keyword?: string; limit?: number } = {}): McpToolResult => {
      const result = cli.listTasks(args);
      return { content: [{ type: 'text', text: JSON.stringify(result) }], isError: !result.ok };
    },
    'doubao.get_task': (args: { taskId?: string } = {}): McpToolResult => {
      if (!args.taskId) {
        return { content: [{ type: 'text', text: JSON.stringify({ ok: false, error: 'MISSING_TASK_ID' }) }], isError: true };
      }
      const result = cli.taskDetail(args.taskId);
      return { content: [{ type: 'text', text: JSON.stringify(result) }], isError: !result.ok };
    },
  };
}

export type McpToolHandlers = ReturnType<typeof buildMcpToolHandlers>;
