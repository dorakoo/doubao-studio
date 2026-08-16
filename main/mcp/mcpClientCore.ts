/**
 * DOUBAO-MCP-CLIENT-01：MCP stdio 客户端协议核心（零 Electron、零 spawn —— transport 注入）。
 *
 * 协议：JSON-RPC 2.0 over stdio（initialize / tools/list / tools/call / ping）。
 * 纪律：
 *  - 请求/响应按 id 关联；未知 id 的响应与无 id 通知忽略（协议允许）。
 *  - 每个请求独立超时（默认 30s）；超时/对端关闭时 reject 且清理 pending。
 *  - 非 JSON 行忽略不打断连接；未知方法由对端表达（isError）。
 */

export interface McpIo {
  writeLine: (line: string) => void;
  onLine: (cb: (line: string) => void) => void;
  onClose: (cb: () => void) => void;
  close: () => void;
}

export interface McpToolInfo {
  name: string;
  description?: string;
  inputSchema?: unknown;
}

export interface McpCallResult {
  content: unknown[];
  isError?: boolean;
}

export interface McpClientOptions {
  /** 单请求超时（毫秒），默认 30000。 */
  timeoutMs?: number;
}

interface Pending {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export type McpClientState = 'idle' | 'connecting' | 'connected' | 'closed' | 'error';

export class McpClientCore {
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private readonly timeoutMs: number;
  state: McpClientState = 'idle';
  lastError: string | null = null;

  constructor(
    private readonly io: McpIo,
    options: McpClientOptions = {},
  ) {
    this.timeoutMs = options.timeoutMs ?? 30000;
    this.io.onLine((line) => this.handleLine(line));
    this.io.onClose(() => this.handleClose());
  }

  private handleLine(line: string) {
    let msg: { id?: unknown; result?: unknown; error?: unknown };
    try {
      msg = JSON.parse(line);
    } catch {
      return; // 非 JSON 行忽略（不打断连接）
    }
    if (typeof msg.id !== 'number') return; // 通知/未知帧：忽略
    const pending = this.pending.get(msg.id);
    if (!pending) return; // 非本客户端发出的请求：忽略
    this.pending.delete(msg.id);
    clearTimeout(pending.timer);
    if (msg.error !== undefined) {
      pending.reject(new Error(String((msg.error as { message?: string })?.message ?? 'MCP 对端错误')));
    } else {
      pending.resolve(msg.result);
    }
  }

  private handleClose() {
    if (this.state === 'closed') return;
    this.state = 'closed';
    const err = new Error('MCP 连接已关闭');
    for (const [, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(err);
    }
    this.pending.clear();
  }

  private request<T>(method: string, params?: unknown): Promise<T> {
    if (this.state === 'closed') return Promise.reject(new Error('MCP 连接已关闭'));
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`MCP 请求超时（${this.timeoutMs}ms）：${method}`));
      }, this.timeoutMs);
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
      this.io.writeLine(JSON.stringify({ jsonrpc: '2.0', id, method, params: params ?? {} }));
    });
  }

  /** initialize 握手；成功后 state=connected。 */
  async connect(): Promise<{ protocolVersion: string; serverInfo?: unknown }> {
    this.state = 'connecting';
    try {
      const result = await this.request<{ protocolVersion: string; serverInfo?: unknown }>('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'doubao-studio-mcp-client', version: '0.1.0' },
      });
      this.state = 'connected';
      this.lastError = null;
      return { protocolVersion: result.protocolVersion, serverInfo: result.serverInfo };
    } catch (e) {
      this.state = 'error';
      this.lastError = e instanceof Error ? e.message : String(e);
      throw e;
    }
  }

  /** tools/list（需先 connect）。 */
  async listTools(): Promise<McpToolInfo[]> {
    const result = await this.request<{ tools?: McpToolInfo[] }>('tools/list');
    return Array.isArray(result?.tools) ? result.tools : [];
  }

  /** tools/call（显式调用；对端未知工具时 isError 由对端表达）。 */
  async callTool(name: string, args: Record<string, unknown>): Promise<McpCallResult> {
    const result = await this.request<McpCallResult>('tools/call', { name, arguments: args ?? {} });
    return {
      content: Array.isArray(result?.content) ? result.content : [],
      isError: result?.isError === true,
    };
  }

  /** 主动断开：拒绝全部 pending、关闭 io。 */
  disconnect(): void {
    if (this.state === 'closed') return;
    this.state = 'closed';
    const err = new Error('MCP 客户端已断开');
    for (const [, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(err);
    }
    this.pending.clear();
  }
}
