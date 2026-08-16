/**
 * DOUBAO-CLI-WIRING-01 契约测试：CLI/MCP 可执行入口接线。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCli } from '../../main/cli/doubaoCliEntry';
import { startMcpServer, type McpIo } from '../../main/mcp/doubaoMcpServer';
import type { Task } from '@doubao-studio/contracts';

function fixtureTask(id: string, status: string): Task {
  return {
    id,
    prompt: `任务 ${id}`,
    assignedAccountId: null,
    status,
    mode: 'txt2img',
    result: null,
    outputs: status === 'done' ? ['file://out/1.png'] : [],
    artifacts: [],
    createdAt: '2026-08-16T00:00:00Z',
    updatedAt: '2026-08-16T00:00:00Z',
  } as unknown as Task;
}

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'doubao-cli-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('CLI 入口接线', () => {
  it('list：读取 JSON 任务文件并输出稳定 JSON（exit 0）', () => {
    const file = join(dir, 'tasks.json');
    writeFileSync(file, JSON.stringify([fixtureTask('a', 'queued'), fixtureTask('b', 'done')]), 'utf8');
    const out: string[] = [];
    const result = runCli(['list', '--tasks-file', file], (s) => out.push(s));
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(out[0]);
    expect(parsed.ok).toBe(true);
    expect((parsed.data as { id: string }[]).map((t) => t.id).sort()).toEqual(['a', 'b']);
  });

  it('task：不存在任务 exit 1 + TASK_NOT_FOUND', () => {
    const file = join(dir, 'tasks.json');
    writeFileSync(file, '[]', 'utf8');
    const out: string[] = [];
    const result = runCli(['task', 'nope', '--tasks-file', file], (s) => out.push(s));
    expect(result.exitCode).toBe(1);
    expect(JSON.parse(out[0]).error).toBe('TASK_NOT_FOUND');
  });

  it('outputs/diagnostics 命令可用且零写入', () => {
    const file = join(dir, 'tasks.json');
    writeFileSync(file, JSON.stringify([fixtureTask('d', 'done')]), 'utf8');
    const out1: string[] = [];
    expect(runCli(['outputs', '--tasks-file', file], (s) => out1.push(s)).exitCode).toBe(0);
    expect((JSON.parse(out1[0]).data as { taskId: string }[])[0].taskId).toBe('d');
    const out2: string[] = [];
    expect(runCli(['diagnostics', '--tasks-file', file], (s) => out2.push(s)).exitCode).toBe(0);
    expect((JSON.parse(out2[0]).data as Task[])[0].prompt).toContain('已脱敏');
    // 零写入：replace 恒 false，文件内容不变
    const after = JSON.parse(readFileSync(file, 'utf8'));
    expect(after.length).toBe(1);
  });
});

function fakeIo(): McpIo & { sent: string[]; emit: (line: string) => void } {
  const sent: string[] = [];
  const callbacks: Array<(line: string) => void> = [];
  return {
    sent,
    writeLine: (line: string) => {
      sent.push(line);
    },
    onLine: (cb) => callbacks.push(cb),
    close: () => {},
    emit: (line: string) => callbacks.forEach((cb) => cb(line)),
  };
}

describe('MCP stdio 入口接线', () => {
  it('initialize / tools/list / tools/call / ping 全协议', () => {
    const file = join(dir, 'tasks.json');
    writeFileSync(file, JSON.stringify([fixtureTask('a', 'queued')]), 'utf8');
    const io = fakeIo();
    startMcpServer(io, file);

    io.emit(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' }));
    const init = JSON.parse(io.sent[0]);
    expect(init.result.protocolVersion).toBe('2024-11-05');

    io.emit(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }));
    const tools = JSON.parse(io.sent[1]);
    expect(tools.result.tools.map((t: { name: string }) => t.name)).toEqual(['doubao.list_tasks', 'doubao.get_task']);

    io.emit(JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'doubao.get_task', arguments: { taskId: 'a' } } }));
    const call = JSON.parse(io.sent[2]);
    expect(call.result.isError).toBe(false);
    expect(JSON.parse(call.result.content[0].text).data.id).toBe('a');

    io.emit(JSON.stringify({ jsonrpc: '2.0', id: 4, method: 'ping' }));
    expect(JSON.parse(io.sent[3]).result).toEqual({});

    io.emit('not-json');
    expect(io.sent.length).toBe(4);
  });

  it('未知工具 → isError UNKNOWN_TOOL', () => {
    const file = join(dir, 'tasks.json');
    writeFileSync(file, '[]', 'utf8');
    const io = fakeIo();
    startMcpServer(io, file);
    io.emit(JSON.stringify({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'nope' } }));
    const call = JSON.parse(io.sent[0]);
    expect(call.result.isError).toBe(true);
    expect(JSON.parse(call.result.content[0].text).error).toBe('UNKNOWN_TOOL');
  });
});
