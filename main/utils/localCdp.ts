export interface LocalCdpConfig {
  enabled: boolean;
  address: '127.0.0.1';
  port: number;
}

const DEFAULT_LOCAL_CDP_PORT = 9333;

/**
 * 裸 CDP 只用于用户显式开启的本机验收。它默认关闭，且地址不可由命令行覆盖，
 * 避免误监听局域网或公网。
 */
export function resolveLocalCdpConfig(argv: readonly string[]): LocalCdpConfig {
  const portArg = argv.find((arg) => arg.startsWith('--local-cdp-port='));
  const enabled = argv.includes('--local-cdp') || portArg !== undefined;
  if (!enabled) {
    return { enabled: false, address: '127.0.0.1', port: DEFAULT_LOCAL_CDP_PORT };
  }

  if (!portArg) {
    return { enabled: true, address: '127.0.0.1', port: DEFAULT_LOCAL_CDP_PORT };
  }

  const port = Number(portArg.slice('--local-cdp-port='.length));
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error('本机 CDP 端口必须是 1024 到 65535 之间的整数');
  }
  return { enabled: true, address: '127.0.0.1', port };
}
