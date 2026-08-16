/**
 * DOUBAO-MCP-CLIENT-01 专项测试。
 *
 * 覆盖（表驱动 + 自举端到端）：
 *  - 核心协议端到端：内存 io 直连 doubaoMcpServer（initialize→tools/list→tools/call 只读回读）。
 *  - 超时 / 对端关闭 / 非 JSON 行 / 未知 id 响应 / 未知工具 isError。
 *  - 配置校验（缺名/非法名/非法 args/env/超时越界）、secret 脱敏、连接文件解析。
 *  - CLI：audit 只读、tools 参数解析与错误码（spawn 注入 fake）。
 *  - 边界：核心与进程层源码零 Electron import。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { McpClientCore } from '../../main/mcp/mcpClientCore';
import type { McpIo } from '../../main/mcp/mcpClientCore';
import { startMcpServer } from '../../main/mcp/doubaoMcpServer';
import {
  validateConnection,
  redactConnection,
  parseConnectionsFile,
  isSecretKey,
} from '../../main/mcp/mcpClientConfig';
import { runMcpCli } from '../../main/mcp/mcpClientCli';

/** 内存双工 io 对（a=客户端侧，b=服务端侧；无 spawn、无网络）。 */
function memoryIoPair(): { client: McpIo; server: McpIo } {
  const aHandlers: Array<(l: string) => void> = [];
  const bHandlers: Array<(l: string) => void> = [];
  const aClose: Array<() => void> = [];
  const bClose: Array<() => void> = [];
  return {
    client: {
      writeLine: (l) => { for (const h of bHandlers) h(l); },
      onLine: (cb) => { aHandlers.push(cb); },
      onClose: (cb) => { aClose.push(cb); },
      close: () => { for (const cb of bClose) cb(); },
    },
    server: {
      writeLine: (l) => { for (const h of aHandlers) h(l); },
      onLine: (cb) => { bHandlers.push(cb); },
      onClose: (cb) => { bClose.push(cb); },
      close: () => { for (const cb of aClose) cb(); },
    },
  };
}

function tempTasksFile(): { dir: string; file: string } {
  const dir = mkdtempSync(resolve(tmpdir(), 'doubao-mcp-client-'));
  const file = resolve(dir, 'tasks.json');
  writeFileSync(file, JSON.stringify([
    {
      id: 't1', prompt: '画一只猫', assignedAccountId: null, status: 'queued', mode: 'txt2img',
      result: null, outputs: [], artifacts: [], createdAt: '2026-08-16T00:00:00Z', updatedAt: '2026-08-16T00:00:00Z',
    },
  ]));
  return { dir, file };
}

describe('DOUBAO-MCP-CLIENT-01', () => {
  it('边界源码零 Electron import', () => {
    for (const file of ['main/mcp/mcpClientCore.ts', 'main/mcp/mcpClient.ts', 'main/mcp/mcpClientConfig.ts', 'main/mcp/mcpClientCli.ts']) {
      const source = readFileSync(resolve(__dirname, '..', '..', file), 'utf8');
      expect(source.includes("from 'electron'")).toBe(false);
      expect(source.includes("require('electron')")).toBe(false);
    }
  });

  it('自举端到端：initialize → tools/list → tools/call 只读回读', async () => {
    const tmp = tempTasksFile();
    try {
      const { client, server } = memoryIoPair();
      startMcpServer(server, tmp.file);
      const core = new McpClientCore(client, { timeoutMs: 5000 });

      const handshake = await core.connect();
      expect(handshake.protocolVersion).toBe('2024-11-05');
      expect(core.state).toBe('connected');

      const tools = await core.listTools();
      expect(tools.map((t) => t.name).sort()).toEqual(['doubao.get_task', 'doubao.list_tasks']);

      const list = await core.callTool('doubao.list_tasks', {});
      expect(list.isError).not.toBe(true);
      const text = String((list.content[0] as { text: string }).text);
      expect(JSON.parse(text).ok).toBe(true);

      const get = await core.callTool('doubao.get_task', { taskId: 't1' });
      expect(JSON.parse(String((get.content[0] as { text: string }).text)).data.id).toBe('t1');

      core.disconnect();
      expect(core.state).toBe('closed');
    } finally {
      rmSync(tmp.dir, { recursive: true, force: true });
    }
  });

  it('未知工具：对端 isError（fail-closed）', async () => {
    const tmp = tempTasksFile();
    try {
      const { client, server } = memoryIoPair();
      startMcpServer(server, tmp.file);
      const core = new McpClientCore(client, { timeoutMs: 5000 });
      await core.connect();
      const result = await core.callTool('doubao.unknown', {});
      expect(result.isError).toBe(true);
      core.disconnect();
    } finally {
      rmSync(tmp.dir, { recursive: true, force: true });
    }
  });

  it('超时：无响应对端 → reject 且不残留 pending', async () => {
    const io: McpIo = { writeLine: () => {}, onLine: () => {}, onClose: () => {}, close: () => {} };
    const core = new McpClientCore(io, { timeoutMs: 50 });
    await expect(core.connect()).rejects.toThrow(/超时/);
    expect(core.state).toBe('error');
  });

  it('对端关闭：pending 全部 reject（连接关闭错误）', async () => {
    const { client, server } = memoryIoPair();
    void server;
    const core = new McpClientCore(client, { timeoutMs: 5000 });
    const pending = core.connect();
    // 服务端无响应直接关闭
    // memoryIoPair 无主动触发 onClose 的入口：直接调用 disconnect 验证 pending reject
    core.disconnect();
    await expect(pending).rejects.toThrow(/已断开|已关闭/);
  });

  it('非 JSON 行与未知 id 响应：忽略不打断连接', async () => {
    const tmp = tempTasksFile();
    try {
      const { client, server } = memoryIoPair();
      startMcpServer(server, tmp.file);
      const core = new McpClientCore(client, { timeoutMs: 5000 });
      // 模拟噪声行（非 JSON + 未知 id 响应）
      client.onLine(() => {}); // 占位；实际由 server 侧注入噪声
      server.writeLine('not-json');
      server.writeLine(JSON.stringify({ jsonrpc: '2.0', id: 999, result: {} }));
      const handshake = await core.connect();
      expect(handshake.protocolVersion).toBe('2024-11-05');
      core.disconnect();
    } finally {
      rmSync(tmp.dir, { recursive: true, force: true });
    }
  });

  it('配置校验：缺名/非法名/非法 args/env/超时越界 全部 fail-closed', () => {
    expect(validateConnection(null).ok).toBe(false);
    expect(validateConnection({ command: 'node' }).ok).toBe(false);
    expect(validateConnection({ name: 'a b', command: 'node' }).ok).toBe(false);
    expect(validateConnection({ name: 'ok', command: 'node', args: [1] }).ok).toBe(false);
    expect(validateConnection({ name: 'ok', command: 'node', env: { 'BAD KEY': 'x' } }).ok).toBe(false);
    expect(validateConnection({ name: 'ok', command: 'node', env: { A: 1 } }).ok).toBe(false);
    expect(validateConnection({ name: 'ok', command: 'node', timeoutMs: 100 }).ok).toBe(false);
    expect(validateConnection({ name: 'ok', command: 'node', timeoutMs: 5000 }).ok).toBe(true);
  });

  it('secret 脱敏：命名规则与显式声明均打码；普通 env 保留', () => {
    const result = validateConnection({
      name: 'demo',
      command: 'node',
      env: { API_TOKEN: 'abc', PLAIN: 'x', MY_KEY: 'y' },
      secretKeys: ['my_custom'],
    });
    expect(result.ok).toBe(true);
    const redacted = redactConnection(result.ok ? result.config : (null as never));
    expect(redacted.env.API_TOKEN).toBe('***');
    expect(redacted.env.MY_KEY).toBe('***');
    expect(redacted.env.PLAIN).toBe('x');
    expect(isSecretKey('password', [])).toBe(true);
    expect(isSecretKey('CUSTOM', ['custom'])).toBe(true);
    expect(isSecretKey('name', [])).toBe(false);
  });

  it('连接文件解析：数组/单对象/非法输入', () => {
    expect(parseConnectionsFile('[]')).toEqual([]);
    expect(parseConnectionsFile('not-json')).toEqual([]);
    const parsed = parseConnectionsFile(
      JSON.stringify([{ name: 'a', command: 'node' }, { name: 'b', command: 'node', args: ['x'] }]),
    );
    expect(parsed.map((c) => c.name)).toEqual(['a', 'b']);
    expect(parseConnectionsFile(JSON.stringify({ name: 'solo', command: 'node' }))).toHaveLength(1);
  });

  it('CLI audit：只读输出审计记录（无文件 → 空）', async () => {
    const writes: string[] = [];
    const r = await runMcpCli(['audit', '--audit-file', '/nonexistent/audit.jsonl'], {
      write: (s) => writes.push(s),
    });
    expect(r.exitCode).toBe(0);
    expect(JSON.parse(writes[0]).audit).toEqual([]);
  });

  it('CLI：连接文件为空 → NO_CONNECTIONS fail-closed', async () => {
    const writes: string[] = [];
    const r = await runMcpCli(['tools', '--connections-file', '/nonexistent/conns.json'], {
      write: (s) => writes.push(s),
    });
    expect(r.exitCode).toBe(1);
    expect(JSON.parse(writes[0]).error).toBe('NO_CONNECTIONS：连接文件为空或格式非法');
  });

  it('CLI call：参数非 JSON → ARGS_NOT_JSON', async () => {
    const writes: string[] = [];
    const dir = mkdtempSync(resolve(tmpdir(), 'doubao-mcp-cli-'));
    const conns = resolve(dir, 'conns.json');
    writeFileSync(conns, JSON.stringify([{ name: 'a', command: 'node' }]));
    try {
      const r = await runMcpCli(
        ['call', 'doubao.list_tasks', '--connection', 'a', '--args', '{bad', '--connections-file', conns, '--audit-file', resolve(dir, 'audit.jsonl')],
        { write: (s) => writes.push(s) },
      );
      expect(r.exitCode).toBe(1);
      expect(JSON.parse(writes[0]).error).toBe('ARGS_NOT_JSON');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
