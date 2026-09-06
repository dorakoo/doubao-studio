import { describe, expect, it } from 'vitest';
import { resolveLoopbackProxy } from '../../main/utils/localProxy';

describe('local proxy resolution', () => {
  it('prefers an HTTPS loopback proxy', () => {
    expect(resolveLoopbackProxy({
      HTTPS_PROXY: 'http://127.0.0.1:7897',
      ALL_PROXY: 'http://localhost:1080',
    })).toBe('http://127.0.0.1:7897');
  });

  it.each([
    'http://192.168.1.2:7897',
    'http://proxy.example.com:7897',
    'http://user:secret@127.0.0.1:7897',
    'file://127.0.0.1:7897',
    'not-a-url',
  ])('rejects unsafe proxy %s', (proxy) => {
    expect(resolveLoopbackProxy({ HTTPS_PROXY: proxy })).toBeNull();
  });

  it('falls back to a later safe candidate', () => {
    expect(resolveLoopbackProxy({
      HTTPS_PROXY: 'http://proxy.example.com:7897',
      ALL_PROXY: 'socks5://localhost:1080',
    })).toBe('socks5://localhost:1080');
  });
});
