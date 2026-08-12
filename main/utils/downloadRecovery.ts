import type * as Fs from 'fs';
import type * as Path from 'path';
import type { DownloadJob } from '@doubao-studio/contracts';

export interface DownloadRecoveryResult {
  recovered: number;
  removedParts: string[];
}

/** 仅清理由已登记 downloading job 精确拥有、且位于 saveDir 顶层的临时文件。 */
export function recoverInterruptedDownloads(
  fs: typeof Fs,
  path: typeof Path,
  jobs: DownloadJob[],
  now: string,
): DownloadRecoveryResult {
  const removedParts: string[] = [];
  let recovered = 0;

  for (const job of jobs) {
    if (job.status !== 'downloading') continue;
    recovered++;
    const resolvedDir = path.resolve(job.saveDir);
    const safeJobId = /^[A-Za-z0-9._-]+$/.test(job.id) ? job.id : null;
    const suffix = safeJobId ? `.${safeJobId}.part` : null;
    try {
      if (!suffix) throw new Error('下载记录 ID 不是安全文件标识');
      for (const entry of fs.readdirSync(resolvedDir, { withFileTypes: true })) {
        if (!entry.isFile() || !entry.name.endsWith(suffix)) continue;
        const candidate = path.resolve(resolvedDir, entry.name);
        if (path.dirname(candidate) !== resolvedDir || !path.basename(candidate).endsWith(suffix)) continue;
        fs.unlinkSync(candidate);
        removedParts.push(candidate);
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[Downloads] 中断临时文件清理失败 (${job.id}): ${message}`);
    }
    job.status = 'failed';
    job.error = '程序退出导致下载中断，可重新下载';
    job.updatedAt = now;
  }

  return { recovered, removedParts };
}

/** 当前下载失败时只删除调用方持有的精确临时路径。 */
export function removeExactDownloadPart(
  fs: typeof Fs,
  path: typeof Path,
  saveDir: string,
  temporaryPath: string | undefined,
  jobId: string,
): boolean {
  if (!temporaryPath) return false;
  if (!/^[A-Za-z0-9._-]+$/.test(jobId)) return false;
  const resolvedDir = path.resolve(saveDir);
  const resolvedPart = path.resolve(temporaryPath);
  if (path.dirname(resolvedPart) !== resolvedDir || !path.basename(resolvedPart).endsWith(`.${jobId}.part`)) {
    return false;
  }
  if (!fs.existsSync(resolvedPart)) return false;
  fs.unlinkSync(resolvedPart);
  return true;
}
