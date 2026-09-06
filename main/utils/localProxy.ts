export interface ProxyEnvironment {
  HTTPS_PROXY?: string;
  https_proxy?: string;
  ALL_PROXY?: string;
  all_proxy?: string;
  HTTP_PROXY?: string;
  http_proxy?: string;
}

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);
const ALLOWED_PROTOCOLS = new Set(['http:', 'https:', 'socks:', 'socks5:']);

/** 只接收无凭据的本机代理，远端或带认证信息的代理一律忽略。 */
export function resolveLoopbackProxy(environment: ProxyEnvironment): string | null {
  const candidates = [
    environment.HTTPS_PROXY,
    environment.https_proxy,
    environment.ALL_PROXY,
    environment.all_proxy,
    environment.HTTP_PROXY,
    environment.http_proxy,
  ];
  for (const candidate of candidates) {
    if (!candidate?.trim()) continue;
    try {
      const parsed = new URL(candidate);
      const hostname = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();
      if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) continue;
      if (!LOOPBACK_HOSTS.has(hostname)) continue;
      if (parsed.username || parsed.password || !parsed.port) continue;
      const port = Number(parsed.port);
      if (!Number.isInteger(port) || port < 1 || port > 65535) continue;
      return `${parsed.protocol}//${parsed.host}`;
    } catch {
      // 畸形变量不阻断应用启动，继续尝试下一个候选。
    }
  }
  return null;
}
