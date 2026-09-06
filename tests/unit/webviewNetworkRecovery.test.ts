import { describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  archiveRegenerableCacheDirectories,
  getRecoverablePartitions,
  recoverWebviewNetworkCaches,
  type RecoverableSession,
} from '../../main/utils/webviewNetworkRecovery';

describe('webview network recovery', () => {
  it('derives unique application-owned partitions only', () => {
    expect(getRecoverablePartitions([
      { partition: 'account_1234abcd', platform: 'doubao' },
      { partition: 'account_1234abcd', platform: 'doubao' },
      { partition: 'account_deadbeef', platform: 'dola' },
      { partition: '../escape', platform: 'doubao' },
      { partition: 'account_abcdefgh', platform: 'doubao' },
    ])).toEqual([
      'persist:doubao_account_1234abcd',
      'persist:dola_account_deadbeef',
    ]);
  });

  it('clears connections and caches without clearing storage data', async () => {
    const calls: string[] = [];
    const target: RecoverableSession = {
      closeAllConnections: vi.fn(async () => { calls.push('connections'); }),
      clearHostResolverCache: vi.fn(async () => { calls.push('dns'); }),
      clearCache: vi.fn(async () => { calls.push('http'); }),
    };
    await expect(recoverWebviewNetworkCaches(['persist:doubao_account_1234abcd'], () => target))
      .resolves.toBe(1);
    expect(calls).toEqual(['connections', 'dns', 'http']);
    expect(target).not.toHaveProperty('clearStorageData');
  });

  it('fails closed after a partial failure', async () => {
    const target: RecoverableSession = {
      closeAllConnections: vi.fn(async () => undefined),
      clearHostResolverCache: vi.fn(async () => { throw new Error('dns failure'); }),
      clearCache: vi.fn(async () => undefined),
    };
    await expect(recoverWebviewNetworkCaches(['persist:doubao_account_1234abcd'], () => target))
      .rejects.toThrow('dns failure');
    expect(target.clearCache).not.toHaveBeenCalled();
  });

  it('archives only regenerable cache directories and recreates empty targets', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'doubao-cache-recovery-'));
    const cache = path.join(root, 'Cache');
    const localStorage = path.join(root, 'Local Storage');
    fs.mkdirSync(cache);
    fs.mkdirSync(localStorage);
    fs.writeFileSync(path.join(cache, 'index'), 'cache');
    fs.writeFileSync(path.join(localStorage, 'identity'), 'preserve');
    try {
      const archived = archiveRegenerableCacheDirectories(root, 'test');
      expect(archived).toHaveLength(1);
      expect(fs.readdirSync(cache)).toEqual([]);
      expect(fs.readFileSync(path.join(archived[0], 'index'), 'utf8')).toBe('cache');
      expect(fs.readFileSync(path.join(localStorage, 'identity'), 'utf8')).toBe('preserve');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
      for (const sibling of fs.readdirSync(path.dirname(root))) {
        if (sibling.startsWith(`${path.basename(root)}.pre-`)) {
          fs.rmSync(path.join(path.dirname(root), sibling), { recursive: true, force: true });
        }
      }
    }
  });
});
