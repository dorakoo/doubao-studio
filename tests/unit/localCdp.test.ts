import { describe, expect, it } from 'vitest';
import { resolveLocalCdpConfig } from '../../main/utils/localCdp';

describe('local CDP configuration', () => {
  it('is disabled by default and remains loopback-only', () => {
    expect(resolveLocalCdpConfig([])).toEqual({
      enabled: false,
      address: '127.0.0.1',
      port: 9333,
    });
  });

  it('enables the controlled default port only when explicitly requested', () => {
    expect(resolveLocalCdpConfig(['--local-cdp'])).toEqual({
      enabled: true,
      address: '127.0.0.1',
      port: 9333,
    });
  });

  it('accepts an explicit local port without accepting an address override', () => {
    expect(resolveLocalCdpConfig([
      '--local-cdp-port=9444',
      '--remote-debugging-address=0.0.0.0',
    ])).toEqual({
      enabled: true,
      address: '127.0.0.1',
      port: 9444,
    });
  });

  it.each(['0', '1023', '65536', 'abc', '9333.5'])(
    'rejects invalid port %s',
    (port) => {
      expect(() => resolveLocalCdpConfig([`--local-cdp-port=${port}`])).toThrow(
        '本机 CDP 端口必须是 1024 到 65535 之间的整数',
      );
    },
  );
});
