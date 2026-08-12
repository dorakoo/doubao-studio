import { afterEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { DownloadJob } from '@doubao-studio/contracts';
import { recoverInterruptedDownloads, removeExactDownloadPart } from '../../main/utils/downloadRecovery';

const dirs: string[] = [];
const makeDir = (): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'doubao-download-recovery-'));
  dirs.push(dir);
  return dir;
};
const job = (saveDir: string, id = 'job-1', status: DownloadJob['status'] = 'downloading'): DownloadJob => ({
  id, taskId: 'task-1', accountId: null, mode: 'video', url: 'https://example.test/video',
  status, attempts: 1, saveDir, createdAt: '2026-08-13T00:00:00.000Z', updatedAt: '2026-08-13T00:00:00.000Z',
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('下载中断恢复', () => {
  it('只删除 downloading job 精确拥有的 part，未知文件全部保留', () => {
    const dir = makeDir();
    const owned = path.join(dir, 'video.mp4.job-1.part');
    const unknown = path.join(dir, 'video.mp4.other.part');
    const normal = path.join(dir, 'video.mp4');
    for (const file of [owned, unknown, normal]) fs.writeFileSync(file, 'x');
    const jobs = [job(dir), job(dir, 'done-job', 'done')];

    const result = recoverInterruptedDownloads(fs, path, jobs, '2026-08-13T01:00:00.000Z');

    expect(result.recovered).toBe(1);
    expect(result.removedParts).toEqual([owned]);
    expect(fs.existsSync(owned)).toBe(false);
    expect(fs.existsSync(unknown)).toBe(true);
    expect(fs.existsSync(normal)).toBe(true);
    expect(jobs[0].status).toBe('failed');
    expect(jobs[1].status).toBe('done');
  });

  it('目录不存在时仍恢复状态且不删除其他位置文件', () => {
    const jobs = [job(path.join(makeDir(), 'missing'))];
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(recoverInterruptedDownloads(fs, path, jobs, '2026-08-13T01:00:00.000Z').recovered).toBe(1);
    expect(jobs[0].status).toBe('failed');
    expect(warn).toHaveBeenCalledOnce();
  });

  it('不安全 job ID 只恢复状态，不匹配或删除文件', () => {
    const dir = makeDir();
    const unknown = path.join(dir, 'video.mp4.job.part');
    fs.writeFileSync(unknown, 'x');
    const jobs = [job(dir, '../job')];
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const result = recoverInterruptedDownloads(fs, path, jobs, '2026-08-13T01:00:00.000Z');
    expect(result).toEqual({ recovered: 1, removedParts: [] });
    expect(fs.existsSync(unknown)).toBe(true);
    expect(jobs[0].status).toBe('failed');
    expect(warn).toHaveBeenCalledOnce();
  });

  it('当前失败只删除精确临时路径，越界和错误后缀均拒绝', () => {
    const dir = makeDir();
    const exact = path.join(dir, 'video.mp4.job-1.part');
    const wrong = path.join(dir, 'video.mp4.other.part');
    fs.writeFileSync(exact, 'x');
    fs.writeFileSync(wrong, 'x');
    expect(removeExactDownloadPart(fs, path, dir, wrong, 'job-1')).toBe(false);
    expect(fs.existsSync(wrong)).toBe(true);
    expect(removeExactDownloadPart(fs, path, dir, exact, 'job-1')).toBe(true);
    expect(fs.existsSync(exact)).toBe(false);
  });
});
