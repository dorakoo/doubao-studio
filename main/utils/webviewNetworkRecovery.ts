export interface PersistedAccountPartition {
  partition?: unknown;
  platform?: unknown;
}

export interface RecoverableSession {
  clearCache(): Promise<void>;
  clearHostResolverCache(): Promise<void>;
  closeAllConnections(): Promise<void>;
}

export const WEBVIEW_NETWORK_RECOVERY_VERSION = '2.3.4-cache-v2';
const REGENERABLE_CACHE_DIRS = [
  'Cache',
  'Code Cache',
  'GPUCache',
  'DawnGraphiteCache',
  'DawnWebGPUCache',
] as const;

/** 只接受应用自身生成的账号分区名，禁止路径或任意 partition 注入。 */
export function getRecoverablePartitions(accounts: readonly PersistedAccountPartition[]): string[] {
  const partitions = new Set<string>();
  for (const account of accounts) {
    if (typeof account.partition !== 'string') continue;
    if (!/^account_[a-f0-9]{8}$/i.test(account.partition)) continue;
    const platform = account.platform === 'dola' ? 'dola' : 'doubao';
    partitions.add(`persist:${platform}_${account.partition}`);
  }
  return [...partitions];
}

/**
 * 仅清理可再生成的 HTTP/DNS 缓存和连接池；不调用 clearStorageData，
 * 因而不清 Cookie、Local Storage、IndexedDB 或账号登录 Session。
 */
export async function recoverWebviewNetworkCaches(
  partitions: readonly string[],
  getSession: (partition: string) => RecoverableSession,
): Promise<number> {
  for (const partition of partitions) {
    const target = getSession(partition);
    await target.closeAllConnections();
    await target.clearHostResolverCache();
    await target.clearCache();
  }
  return partitions.length;
}

/**
 * 在 Chromium 创建分区 Session 前归档可再生成缓存。对 junction 解析真实目标
 * 后原地归档并重建目标，保留 C 盘缓存迁移布局；目标名异常时 fail-closed。
 */
export function archiveRegenerableCacheDirectories(
  partitionDirectory: string,
  suffix: string,
): string[] {
  const archived: string[] = [];
  for (const cacheName of REGENERABLE_CACHE_DIRS) {
    const linkPath = path.join(partitionDirectory, cacheName);
    if (!fs.existsSync(linkPath)) continue;
    const targetPath = fs.realpathSync.native(linkPath);
    if (path.basename(targetPath).toLowerCase() !== cacheName.toLowerCase()) {
      throw new Error(`缓存目录目标名称异常: ${cacheName}`);
    }
    let backupPath = `${targetPath}.pre-${suffix}`;
    let counter = 1;
    while (fs.existsSync(backupPath)) {
      backupPath = `${targetPath}.pre-${suffix}-${counter}`;
      counter += 1;
    }
    fs.renameSync(targetPath, backupPath);
    try {
      fs.mkdirSync(targetPath, { recursive: true });
    } catch (error) {
      fs.renameSync(backupPath, targetPath);
      throw error;
    }
    archived.push(backupPath);
  }
  return archived;
}
import * as fs from 'fs';
import * as path from 'path';
