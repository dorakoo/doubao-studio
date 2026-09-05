import { createHash, timingSafeEqual } from 'crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http';
import type { AddressInfo } from 'net';
import type { Project, Task } from '@doubao-studio/contracts';
import type { ControlCommandResult, ControlTaskAction } from './controlTypes';

const API_VERSION = 'v1';
const UNBATCHED = '_unbatched';
const MAX_BODY_BYTES = 16 * 1024;
const SAFE_ID = /^[A-Za-z0-9._:-]{1,160}$/;

export interface LocalControlDependencies {
  token: string;
  expiresAtMs: number;
  listProjects: () => Project[];
  listTasks: () => Task[];
  isRendererReady: () => boolean;
  dispatch: (command: {
    requestId: string;
    action: ControlTaskAction;
    projectId: string;
    batchId: string;
    taskId: string;
  }) => Promise<ControlCommandResult>;
  now?: () => string;
  nowMs?: () => number;
}

interface CachedResponse {
  fingerprint: string;
  status: number;
  body: Record<string, unknown>;
}

function send(res: ServerResponse, status: number, body: Record<string, unknown>): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  res.end(payload);
}

function authorized(header: string | undefined, token: string): boolean {
  if (!header?.startsWith('Bearer ')) return false;
  const supplied = Buffer.from(header.slice(7), 'utf8');
  const expected = Buffer.from(token, 'utf8');
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

function isAllowedHost(host: string | undefined, port: number): boolean {
  return host === `127.0.0.1:${port}` || host === `localhost:${port}`;
}

function isAllowedOrigin(origin: string | undefined, port: number): boolean {
  if (!origin) return true;
  return origin === `http://127.0.0.1:${port}` || origin === `http://localhost:${port}`;
}

function sanitizeProject(project: Project, tasks: Task[]): Record<string, unknown> {
  return {
    id: project.id,
    name: project.name,
    archived: project.archived,
    taskCount: tasks.filter((task) => (task.projectId || 'default-project') === project.id).length,
  };
}

function sanitizeTask(task: Task): Record<string, unknown> {
  return {
    id: task.id,
    projectId: task.projectId || 'default-project',
    batchId: task.batchId || UNBATCHED,
    status: task.status,
    mode: task.mode,
    assignedAccountId: task.assignedAccountId,
    stage: task.runtime?.stage,
    attempt: task.runtime?.attempt,
    errorCode: task.errorInfo?.code,
    outputCount: task.outputs.length,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  };
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) throw new Error('BODY_TOO_LARGE');
    chunks.push(buffer);
  }
  if (chunks.length === 0) return {};
  const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('INVALID_JSON');
  return parsed as Record<string, unknown>;
}

export class LocalControlServer {
  private server: Server | null = null;
  private port = 0;
  private readonly replay = new Map<string, CachedResponse>();
  private readonly inFlight = new Map<string, { fingerprint: string; response: Promise<CachedResponse> }>();
  private readonly now: () => string;
  private readonly nowMs: () => number;

  constructor(private readonly deps: LocalControlDependencies) {
    this.now = deps.now || (() => new Date().toISOString());
    this.nowMs = deps.nowMs || (() => Date.now());
  }

  async start(requestedPort = 0): Promise<number> {
    if (this.server) throw new Error('CONTROL_SERVER_ALREADY_STARTED');
    if (!Number.isInteger(requestedPort) || requestedPort < 0 || requestedPort > 65535) {
      throw new Error('INVALID_CONTROL_PORT');
    }
    const server = createServer((req, res) => void this.handle(req, res));
    server.on('clientError', (_error, socket) => socket.end('HTTP/1.1 400 Bad Request\r\n\r\n'));
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(requestedPort, '127.0.0.1', () => {
        server.off('error', reject);
        resolve();
      });
    });
    this.server = server;
    this.port = (server.address() as AddressInfo).port;
    return this.port;
  }

  async stop(): Promise<void> {
    const server = this.server;
    this.server = null;
    this.port = 0;
    this.replay.clear();
    this.inFlight.clear();
    if (!server) return;
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }

  // 单一封闭路由表刻意集中安全门禁，便于审计每条路径均经过 Host/Origin/Auth 校验。
  // eslint-disable-next-line complexity
  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const port = this.port || (this.server?.address() as AddressInfo | null)?.port || 0;
    if (!isAllowedHost(req.headers.host, port) || !isAllowedOrigin(req.headers.origin, port)) {
      send(res, 403, { ok: false, code: 'LOCAL_ORIGIN_REQUIRED' });
      return;
    }
    if (!authorized(req.headers.authorization, this.deps.token)) {
      send(res, 401, { ok: false, code: 'UNAUTHORIZED' });
      return;
    }
    if (this.nowMs() >= this.deps.expiresAtMs) {
      send(res, 401, { ok: false, code: 'TOKEN_EXPIRED' });
      return;
    }

    try {
      const url = new URL(req.url || '/', `http://127.0.0.1:${port}`);
      const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
      if (parts[0] !== API_VERSION) {
        send(res, 404, { ok: false, code: 'NOT_FOUND' });
        return;
      }
      if (req.method === 'GET' && parts[1] === 'health' && parts.length === 2) {
        const rendererReady = this.deps.isRendererReady();
        send(res, 200, { ok: true, ready: rendererReady, rendererReady, protocolVersion: API_VERSION, pid: process.pid, time: this.now() });
        return;
      }
      const projects = this.deps.listProjects();
      const tasks = this.deps.listTasks();
      if (req.method === 'GET' && parts[1] === 'projects' && parts.length === 2) {
        send(res, 200, { ok: true, projects: projects.map((project) => sanitizeProject(project, tasks)) });
        return;
      }
      const projectId = parts[2];
      if (parts[1] !== 'projects' || !SAFE_ID.test(projectId || '')) {
        send(res, 404, { ok: false, code: 'NOT_FOUND' });
        return;
      }
      const project = projects.find((item) => item.id === projectId);
      if (!project) {
        send(res, 404, { ok: false, code: 'PROJECT_NOT_FOUND' });
        return;
      }
      const projectTasks = tasks.filter((task) => (task.projectId || 'default-project') === projectId);
      if (req.method === 'GET' && parts.length === 3) {
        send(res, 200, { ok: true, project: sanitizeProject(project, tasks) });
        return;
      }
      if (parts[3] !== 'batches') {
        send(res, 404, { ok: false, code: 'NOT_FOUND' });
        return;
      }
      if (req.method === 'GET' && parts.length === 4) {
        const batches = [...new Set(projectTasks.map((task) => task.batchId || UNBATCHED))];
        send(res, 200, { ok: true, batches: batches.map((batchId) => ({
          id: batchId,
          taskCount: projectTasks.filter((task) => (task.batchId || UNBATCHED) === batchId).length,
        })) });
        return;
      }
      const batchId = parts[4];
      if (!SAFE_ID.test(batchId || '') || parts[5] !== 'tasks') {
        send(res, 404, { ok: false, code: 'NOT_FOUND' });
        return;
      }
      const batchTasks = projectTasks.filter((task) => (task.batchId || UNBATCHED) === batchId);
      if (req.method === 'GET' && parts.length === 6) {
        send(res, 200, { ok: true, tasks: batchTasks.map(sanitizeTask) });
        return;
      }
      const taskId = parts[6];
      if (!SAFE_ID.test(taskId || '')) {
        send(res, 404, { ok: false, code: 'NOT_FOUND' });
        return;
      }
      const task = batchTasks.find((item) => item.id === taskId);
      if (!task) {
        const sameProject = projectTasks.some((item) => item.id === taskId);
        send(res, 404, { ok: false, code: sameProject ? 'BATCH_TASK_MISMATCH' : 'TASK_NOT_FOUND' });
        return;
      }
      if (req.method === 'GET' && parts.length === 7) {
        send(res, 200, { ok: true, task: sanitizeTask(task) });
        return;
      }
      const action = parts[7] as ControlTaskAction;
      if (req.method !== 'POST' || parts.length !== 8 || !['start', 'pause', 'cancel', 'retry'].includes(action)) {
        send(res, 404, { ok: false, code: 'NOT_FOUND' });
        return;
      }
      const body = await readJson(req);
      const requestId = typeof body.requestId === 'string' ? body.requestId : '';
      if (!SAFE_ID.test(requestId) || requestId.length < 8) {
        send(res, 400, { ok: false, code: 'INVALID_REQUEST_ID' });
        return;
      }
      const fingerprint = createHash('sha256').update(`${action}\n${projectId}\n${batchId}\n${taskId}`).digest('hex');
      const prior = this.replay.get(requestId);
      if (prior) {
        if (prior.fingerprint !== fingerprint) send(res, 409, { ok: false, code: 'REQUEST_ID_CONFLICT' });
        else send(res, prior.status, prior.body);
        return;
      }
      const pending = this.inFlight.get(requestId);
      if (pending) {
        if (pending.fingerprint !== fingerprint) {
          send(res, 409, { ok: false, code: 'REQUEST_ID_CONFLICT' });
          return;
        }
        const replayed = await pending.response;
        send(res, replayed.status, replayed.body);
        return;
      }
      const responsePromise = this.deps.dispatch({ requestId, action, projectId, batchId, taskId }).then((result) => {
        const unavailable = result.code === 'RENDERER_UNAVAILABLE' || result.code === 'RENDERER_NOT_READY';
        const status = result.ok ? 202 : unavailable ? 503 : 409;
        return {
          fingerprint,
          status,
          body: { ok: result.ok, code: result.code, accepted: result.accepted === true, requestId },
        };
      });
      this.inFlight.set(requestId, { fingerprint, response: responsePromise });
      const completed = await responsePromise.finally(() => this.inFlight.delete(requestId));
      this.replay.set(requestId, completed);
      if (this.replay.size > 1000) {
        const oldest = this.replay.keys().next().value;
        if (oldest) this.replay.delete(oldest);
      }
      send(res, completed.status, completed.body);
    } catch (error) {
      const code = error instanceof Error && error.message === 'BODY_TOO_LARGE'
        ? 'BODY_TOO_LARGE'
        : 'INVALID_REQUEST';
      send(res, code === 'BODY_TOO_LARGE' ? 413 : 400, { ok: false, code });
    }
  }
}

export const LOCAL_CONTROL_UNBATCHED = UNBATCHED;
