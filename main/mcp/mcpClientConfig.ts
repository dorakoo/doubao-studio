/**
 * DOUBAO-MCP-CLIENT-01：连接配置 schema 校验与 secret 脱敏（纯函数，零 IO）。
 *
 * 纪律：
 *  - 配置仅来自用户显式提供的文件；不存在内置默认连接、不自动连接任何服务。
 *  - secret 键（显式声明或按 TOKEN/KEY/SECRET/PASSWORD 命名规则）在展示/审计/日志中一律打码。
 *  - 命令执行无 shell（直接 spawn argv），避免注入。
 */

export interface ConnectionConfig {
  name: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  cwd?: string;
  timeoutMs?: number;
  /** 显式声明的 secret 环境变量键（脱敏时全量打码）。 */
  secretKeys: string[];
}

export const SECRET_KEY_HINTS = ['TOKEN', 'KEY', 'SECRET', 'PASSWORD', 'CREDENTIAL'];

export function isSecretKey(key: string, explicit: string[] = []): boolean {
  const upper = key.toUpperCase();
  if (explicit.some((k) => k.toUpperCase() === upper)) return true;
  return SECRET_KEY_HINTS.some((hint) => upper.includes(hint));
}

export type ValidateResult =
  | { ok: true; config: ConnectionConfig }
  | { ok: false; error: string };

/** 校验连接配置对象（容错解析用户输入）。 */
export function validateConnection(input: unknown): ValidateResult {
  if (typeof input !== 'object' || input === null) {
    return { ok: false, error: '连接配置必须是对象' };
  }
  const raw = input as Record<string, unknown>;
  const name = typeof raw.name === 'string' ? raw.name.trim() : '';
  const command = typeof raw.command === 'string' ? raw.command.trim() : '';
  if (!name) return { ok: false, error: '缺少连接名称 name' };
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(name)) return { ok: false, error: '连接名称仅允许字母/数字/._-' };
  if (!command) return { ok: false, error: '缺少 command' };

  const args: string[] = [];
  if (raw.args !== undefined) {
    if (!Array.isArray(raw.args) || raw.args.some((a) => typeof a !== 'string')) {
      return { ok: false, error: 'args 必须是字符串数组' };
    }
    args.push(...(raw.args as string[]));
  }

  const env: Record<string, string> = {};
  if (raw.env !== undefined) {
    if (typeof raw.env !== 'object' || raw.env === null || Array.isArray(raw.env)) {
      return { ok: false, error: 'env 必须是键值对象' };
    }
    for (const [k, v] of Object.entries(raw.env as Record<string, unknown>)) {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(k)) return { ok: false, error: `非法环境变量名: ${k}` };
      if (typeof v !== 'string') return { ok: false, error: `环境变量 ${k} 必须是字符串` };
      env[k] = v;
    }
  }

  const secretKeys: string[] = [];
  if (raw.secretKeys !== undefined) {
    if (!Array.isArray(raw.secretKeys) || raw.secretKeys.some((k) => typeof k !== 'string')) {
      return { ok: false, error: 'secretKeys 必须是字符串数组' };
    }
    secretKeys.push(...(raw.secretKeys as string[]));
  }

  let timeoutMs: number | undefined;
  if (raw.timeoutMs !== undefined) {
    if (typeof raw.timeoutMs !== 'number' || !Number.isFinite(raw.timeoutMs) || raw.timeoutMs < 1000 || raw.timeoutMs > 300000) {
      return { ok: false, error: 'timeoutMs 必须在 1000-300000 毫秒' };
    }
    timeoutMs = raw.timeoutMs;
  }

  const cwd = typeof raw.cwd === 'string' && raw.cwd.trim() !== '' ? raw.cwd.trim() : undefined;

  return {
    ok: true,
    config: { name, command, args, env, cwd, timeoutMs, secretKeys },
  };
}

/** 展示用脱敏：secret 键的值全部替换为 ***；其余键保留。 */
export function redactConnection(config: ConnectionConfig): ConnectionConfig {
  return {
    ...config,
    env: Object.fromEntries(
      Object.entries(config.env).map(([k, v]) => [k, isSecretKey(k, config.secretKeys) ? '***' : v]),
    ),
  };
}

/** 解析连接配置文件文本：JSON 数组或单对象；非法输入返回空（fail-closed）。 */
export function parseConnectionsFile(text: string): ConnectionConfig[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  const items = Array.isArray(parsed) ? parsed : [parsed];
  const configs: ConnectionConfig[] = [];
  for (const item of items) {
    const result = validateConnection(item);
    if (result.ok) configs.push(result.config);
  }
  return configs;
}

/** 调用审计记录（脱敏：不记录 env、不记录调用参数值）。 */
export interface McpCallAuditEntry {
  at: string;
  connection: string;
  tool: string;
  ok: boolean;
  error?: string;
}

export function buildAuditEntry(
  connection: string,
  tool: string,
  ok: boolean,
  error?: string,
): McpCallAuditEntry {
  return { at: new Date().toISOString(), connection, tool, ok, ...(error ? { error } : {}) };
}
