/**
 * DOUBAO-CLI-MCP-BOUNDARY-01 契约测试。
 *
 * 覆盖：
 *  - CLI/MCP 边界纯逻辑：无 electron 依赖（源码断言）。
 *  - listTasks 过滤/截断、taskDetail 稳定投影、completedOutputs、diagnostics 脱敏。
 *  - MCP 工具注册表与处理器（含缺参 fail-closed）。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { TaskService } from '../../main/core/TaskService';
import { buildCliActions } from '../../main/cli/doubaoCli';
import { buildMcpToolHandlers, DOUBAO_MCP_TOOLS } from '../../main/mcp/doubaoMcpTools';
import type { Task } from '@doubao-studio/contracts';

function makeService(tasks: Task[]): TaskService {
  const store = { read: () => structuredClone(tasks), replace: () => false };
  return new TaskService({ store, defaultProjectId: () => 'p1' });
}

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: 't1',
    prompt: '画一只猫',
    assignedAccountId: null,
    status: 'queued',
    mode: 'txt2img',
    result: null,
    outputs: [],
    artifacts: [],
    createdAt: '2026-08-16T00:00:00Z',
    updatedAt: '2026-08-16T00:00:00Z',
    ...overrides,
  } as unknown as Task;
}

describe('DOUBAO-CLI-MCP-BOUNDARY-01', () => {
  it('边界源码零 Electron 依赖（fail-closed 边界）', () => {
    for (const file of ['main/cli/doubaoCli.ts', 'main/mcp/doubaoMcpTools.ts']) {
      const source = readFileSync(resolve(__dirname, '..', '..', file), 'utf8');
      expect(source.includes("from 'electron'")).toBe(false);
      expect(source.includes("require('electron')")).toBe(false);
    }
  });

  it('listTasks：过滤 + 截断 + 稳定投影（prompt 截 120 字符）', () => {
    const cli = buildCliActions(makeService([
      task({ id: 'a', status: 'done', prompt: 'x'.repeat(200) }),
      task({ id: 'b', status: 'queued', prompt: '订单' }),
    ]));
    const all = cli.listTasks();
    expect(all.ok).toBe(true);
    expect((all.data as { id: string }[]).map((t) => t.id).sort()).toEqual(['a', 'b']);
    const done = cli.listTasks({ status: 'done' });
    expect((done.data as { id: string }[]).map((t) => t.id)).toEqual(['a']);
    expect((done.data as { prompt: string }[])[0].prompt.length).toBe(120);
    const limited = cli.listTasks({ limit: 1 });
    expect((limited.data as unknown[]).length).toBe(1);
    const keyword = cli.listTasks({ keyword: '订单' });
    expect((keyword.data as { id: string }[]).map((t) => t.id)).toEqual(['b']);
  });

  it('taskDetail：存在/不存在（TASK_NOT_FOUND）', () => {
    const cli = buildCliActions(makeService([task({ id: 'a', assignedAccountId: 'acc1' })]));
    expect(cli.taskDetail('a')).toEqual({
      ok: true,
      data: {
        id: 'a', status: 'queued', mode: 'txt2img', prompt: '画一只猫', outputCount: 0,
        assignedAccountId: 'acc1', createdAt: '2026-08-16T00:00:00Z', updatedAt: '2026-08-16T00:00:00Z',
      },
    });
    expect(cli.taskDetail('nope')).toEqual({ ok: false, error: 'TASK_NOT_FOUND' });
  });

  it('completedOutputs 仅 done 且有产物；diagnostics 全脱敏', () => {
    const doneTask = task({
      id: 'd',
      status: 'done',
      outputs: ['file://out/1.png'],
      artifacts: [{ url: 'file://secret/1.png' } as never],
      attachments: ['D:/secret/attach.png'],
    });
    const cli = buildCliActions(makeService([doneTask, task({ id: 'p' })]));
    const outputs = cli.completedOutputs();
    expect((outputs.data as { taskId: string }[]).map((o) => o.taskId)).toEqual(['d']);
    const diag = cli.diagnostics();
    const diagTask = (diag.data as Task[]).find((t) => t.id === 'd');
    expect(diagTask?.prompt).toContain('已脱敏');
    expect((diagTask?.artifacts || [])[0]?.url).toBe('[已脱敏]');
    expect((diagTask?.attachments || [])[0]).not.toContain('secret');
  });

  it('MCP：工具注册表 + 处理器（含缺参 fail-closed）', () => {
    const handlers = buildMcpToolHandlers(makeService([task({ id: 'a' })]));
    expect(DOUBAO_MCP_TOOLS.map((t) => t.name)).toEqual(['doubao.list_tasks', 'doubao.get_task']);
    const list = handlers['doubao.list_tasks']({ status: 'queued' });
    expect(list.isError).toBe(false);
    expect(JSON.parse(list.content[0].text).ok).toBe(true);
    const missing = handlers['doubao.get_task']({});
    expect(missing.isError).toBe(true);
    expect(JSON.parse(missing.content[0].text).error).toBe('MISSING_TASK_ID');
    const found = handlers['doubao.get_task']({ taskId: 'a' });
    expect(JSON.parse(found.content[0].text).data.id).toBe('a');
  });
});
