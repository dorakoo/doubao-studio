import { afterEach, describe, expect, it, vi } from 'vitest';
import { request } from 'http';
import type { Project, Task } from '@doubao-studio/contracts';
import { LocalControlServer } from '../../main/control/LocalControlServer';
import type { ControlCommandResult } from '../../main/control/controlTypes';

const token = 'test-token-with-enough-entropy-for-comparison';
const project: Project = {
  id: 'project-1', name: '受控项目', description: 'private description', color: '#fff', archived: false,
  createdAt: '2026-09-05T00:00:00.000Z', updatedAt: '2026-09-05T00:00:00.000Z',
};
const task: Task = {
  id: 'task-1', projectId: project.id, batchId: 'batch-1', prompt: '绝不能由控制面返回的完整提示词',
  assignedAccountId: 'account-1', status: 'queued', mode: 'video',
  attachments: ['D:\\secret\\reference.png'], audioAttachment: 'D:\\secret\\voice.mp3',
  result: null, outputs: ['https://private.example/video.mp4'], artifacts: [],
  createdAt: '2026-09-05T00:00:00.000Z', updatedAt: '2026-09-05T00:00:00.000Z',
};

describe('LocalControlServer', () => {
  let server: LocalControlServer | undefined;
  afterEach(async () => server?.stop());

  async function start(overrides: Partial<ConstructorParameters<typeof LocalControlServer>[0]> = {}) {
    const dispatch = vi.fn(async (command) => ({ commandId: 'command-1', ok: true, code: `${command.action.toUpperCase()}_ACCEPTED`, accepted: true }));
    server = new LocalControlServer({
      token, expiresAtMs: Date.now() + 60_000,
      listProjects: () => [project], listTasks: () => [task], isRendererReady: () => true, dispatch, ...overrides,
    });
    const port = await server.start(0);
    return { port, dispatch, base: `http://127.0.0.1:${port}/v1` };
  }

  const auth = { authorization: `Bearer ${token}` };

  it('默认仅绑定 IPv4 loopback 且健康响应不泄露认证数据', async () => {
    const { base } = await start();
    const response = await fetch(`${base}/health`, { headers: auth });
    const text = await response.text();
    expect(response.status).toBe(200);
    expect(text).toContain('"protocolVersion":"v1"');
    expect(text).toContain('"rendererReady":true');
    expect(text).not.toContain(token);
  });

  it('健康检查区分 HTTP 存活与 Renderer 调度桥就绪', async () => {
    const { base } = await start({ isRendererReady: () => false });
    const response = await fetch(`${base}/health`, { headers: auth });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, ready: false, rendererReady: false });
  });

  it('拒绝缺失或错误令牌', async () => {
    const { base } = await start();
    expect((await fetch(`${base}/health`)).status).toBe(401);
    expect((await fetch(`${base}/health`, { headers: { authorization: 'Bearer wrong' } })).status).toBe(401);
  });

  it('短期令牌到期后即使内容正确也拒绝访问', async () => {
    const { base } = await start({ expiresAtMs: 100, nowMs: () => 100 });
    const response = await fetch(`${base}/health`, { headers: auth });
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ code: 'TOKEN_EXPIRED' });
  });

  it('拒绝非本机 Host 与网页 Origin', async () => {
    const { base, port } = await start();
    const hostStatus = await new Promise<number>((resolve, reject) => {
      const req = request(`${base}/health`, {
        headers: { ...auth, host: `192.168.1.10:${port}` },
      }, (response) => {
        response.resume();
        response.on('end', () => resolve(response.statusCode || 0));
      });
      req.on('error', reject);
      req.end();
    });
    expect(hostStatus).toBe(403);
    expect((await fetch(`${base}/health`, { headers: { ...auth, origin: 'https://evil.example' } })).status).toBe(403);
  });

  it('按项目、批次、任务稳定定位并严格脱敏', async () => {
    const { base } = await start();
    const response = await fetch(`${base}/projects/project-1/batches/batch-1/tasks/task-1`, { headers: auth });
    const text = await response.text();
    expect(response.status).toBe(200);
    expect(text).toContain('"id":"task-1"');
    expect(text).not.toContain(task.prompt);
    expect(text).not.toContain('reference.png');
    expect(text).not.toContain('video.mp4');
    expect(text).not.toContain('private description');
  });

  it('项目或批次归属不一致时 fail-closed 且不下发命令', async () => {
    const { base, dispatch } = await start();
    const wrongBatch = await fetch(`${base}/projects/project-1/batches/batch-x/tasks/task-1/start`, {
      method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify({ requestId: 'request-0001' }),
    });
    expect(wrongBatch.status).toBe(404);
    expect(await wrongBatch.json()).toMatchObject({ code: 'BATCH_TASK_MISMATCH' });
    expect(dispatch).not.toHaveBeenCalled();
  });

  it.each(['start', 'pause', 'cancel', 'retry'] as const)('下发 %s 时携带三重 ID', async (action) => {
    const { base, dispatch } = await start();
    const response = await fetch(`${base}/projects/project-1/batches/batch-1/tasks/task-1/${action}`, {
      method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify({ requestId: `request-${action}` }),
    });
    expect(response.status).toBe(202);
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ action, projectId: 'project-1', batchId: 'batch-1', taskId: 'task-1' }));
  });

  it('相同 requestId 同命令返回缓存结果，不重复执行；跨命令复用则冲突', async () => {
    const { base, dispatch } = await start();
    const call = (action: string) => fetch(`${base}/projects/project-1/batches/batch-1/tasks/task-1/${action}`, {
      method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify({ requestId: 'request-replay' }),
    });
    expect((await call('start')).status).toBe(202);
    expect((await call('start')).status).toBe(202);
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect((await call('pause')).status).toBe(409);
    expect(dispatch).toHaveBeenCalledTimes(1);
  });

  it('并发相同 requestId 只下发一次，两个调用获得相同结果', async () => {
    let release!: (value: ControlCommandResult) => void;
    const dispatch = vi.fn(() => new Promise<ControlCommandResult>((resolve) => { release = resolve; }));
    const { base } = await start({ dispatch });
    const url = `${base}/projects/project-1/batches/batch-1/tasks/task-1/start`;
    const init = { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify({ requestId: 'request-concurrent' }) };
    const first = fetch(url, init);
    const second = fetch(url, init);
    await vi.waitFor(() => expect(dispatch).toHaveBeenCalledTimes(1));
    release({ commandId: 'command-1', ok: true, code: 'START_ACCEPTED', accepted: true });
    expect((await first).status).toBe(202);
    expect((await second).status).toBe(202);
    expect(dispatch).toHaveBeenCalledTimes(1);
  });

  it('畸形 URL 编码返回受控错误，不产生未处理拒绝', async () => {
    const { port } = await start();
    const status = await new Promise<number>((resolve, reject) => {
      const req = request({ hostname: '127.0.0.1', port, path: '/v1/projects/%E0%A4%A', headers: auth }, (response) => {
        response.resume();
        response.on('end', () => resolve(response.statusCode || 0));
      });
      req.on('error', reject);
      req.end();
    });
    expect(status).toBe(400);
  });

  it('限制请求体并拒绝无效 requestId', async () => {
    const { base, dispatch } = await start();
    const url = `${base}/projects/project-1/batches/batch-1/tasks/task-1/start`;
    expect((await fetch(url, { method: 'POST', headers: auth, body: '{}' })).status).toBe(400);
    expect((await fetch(url, { method: 'POST', headers: auth, body: JSON.stringify({ requestId: 'x'.repeat(20_000) }) })).status).toBe(413);
    expect(dispatch).not.toHaveBeenCalled();
  });
});
