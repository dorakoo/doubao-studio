import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Account, Task } from '../../src/types';
import { decideCsvDrop } from '../../src/utils/csvDrop';
import { isUploadSnapshotReady, nextStableUploadCount } from '../../src/utils/uploadReadiness';
import { selectQuotaFallbackAccount } from '../../src/utils/quotaRecovery';
import { applyVideoQuotaAction, localDateKey } from '../../main/utils/videoQuota';
import { createWritableFileTaskStore, runCli } from '../../main/cli/doubaoCliEntry';
import { millisecondsUntilNextLocalMidnight } from '../../src/utils/dailyReset';
import { chooseDesktopDownloadPromotionAction, isDesktopDownloadPromotionText } from '../../src/utils/promotionalPopup';
import { dismissKnownDesktopDownloadPromotion } from '../../src/utils/doubaoBridge';

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'doubao-csv-experience-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe('CSV 拖放与显式 CLI 导入', () => {
  it.each([
    { names: ['batch.csv'], ok: true },
    { names: ['batch.txt'], ok: false },
    { names: ['a.csv', 'b.csv'], ok: false },
  ])('拖放文件 $names → $ok', ({ names, ok }) => {
    const files = names.map((name) => ({ name } as File));
    expect(decideCsvDrop(files).ok).toBe(ok);
  });

  it('import-csv 复用 TaskService 写入任务，并保持完整提示词', () => {
    const tasksFile = join(dir, 'tasks.json');
    const csvFile = join(dir, 'batch.csv');
    writeFileSync(tasksFile, '[]', 'utf8');
    writeFileSync(csvFile, 'prompt,mode\n"Line 1, spoken: ""Hello""",video', 'utf8');
    const output: string[] = [];
    const result = runCli(['import-csv', '--csv', csvFile, '--tasks-file', tasksFile], (line) => output.push(line));
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(output[0]).ok).toBe(true);
    const tasks = JSON.parse(readFileSync(tasksFile, 'utf8')) as Task[];
    expect(tasks).toHaveLength(1);
    expect(tasks[0].prompt).toBe('Line 1, spoken: "Hello"');
  });

  it.each([
    ['import-csv', '--csv', 'a.csv'],
    ['import-csv', '--foo', 'x', '--tasks-file', 'tasks.json', '--csv', 'a.csv'],
    ['import-csv', '--csv', 'a.csv', '--csv', 'b.csv', '--tasks-file', 'tasks.json'],
  ])('缺少、未知或重复参数一律 fail-closed', (...args) => {
    expect(runCli(args, () => {}).exitCode).toBe(1);
  });

  it('任务文件在读取后漂移时拒绝覆盖', () => {
    const tasksFile = join(dir, 'tasks.json');
    writeFileSync(tasksFile, '[]', 'utf8');
    const store = createWritableFileTaskStore(tasksFile);
    const snapshot = store.read();
    writeFileSync(tasksFile, '[{"external":true}]', 'utf8');
    expect(() => store.replace(snapshot)).toThrow('TASKS_FILE_CHANGED');
  });
});

describe('上传稳定门禁', () => {
  it('数量不足或仍有上传进度时不放行', () => {
    expect(isUploadSnapshotReady({ inputFileCount: 1, visibleAttachmentCount: 1, matchingFileNameCount: 1, pending: false }, 2, 0)).toBe(false);
    expect(isUploadSnapshotReady({ inputFileCount: 2, visibleAttachmentCount: 2, matchingFileNameCount: 2, pending: true }, 2, 0)).toBe(false);
  });

  it('数量完整且无进度需连续三次稳定', () => {
    const snapshot = { inputFileCount: 0, visibleAttachmentCount: 5, matchingFileNameCount: 2, pending: false };
    let stable = 0;
    stable = nextStableUploadCount(stable, snapshot, 2, 3);
    stable = nextStableUploadCount(stable, snapshot, 2, 3);
    stable = nextStableUploadCount(stable, snapshot, 2, 3);
    expect(stable).toBe(3);
  });
});

describe('下载电脑版推广弹窗白名单清障', () => {
  it.each([
    ['下载电脑版 使用完整功能', true],
    ['素材授权确认 使用完整功能', false],
    ['下载电脑版', false],
    ['人机验证', false],
  ])('弹窗文本「%s」识别为 %s', (text, expected) => {
    expect(isDesktopDownloadPromotionText(text)).toBe(expected);
  });

  it('优先选择下次提醒，绝不把业务确认按钮当关闭动作', () => {
    expect(chooseDesktopDownloadPromotionAction(['下载电脑版', '关闭', '下次提醒我'])).toBe('snooze');
    expect(chooseDesktopDownloadPromotionAction(['确认授权', '拒绝'])).toBeNull();
  });

  it('白名单弹窗使用原生单次点击并回读确认消失', async () => {
    const snapshots = [
      { present: true, position: '100,200', method: 'snooze' },
      { present: false },
    ];
    const events: unknown[] = [];
    const webview = {
      executeJavaScript: async () => snapshots.shift() || { present: false },
      loadURL: () => {},
      getURL: () => 'https://www.doubao.com/chat/',
      sendInputEvent: (event: unknown) => { events.push(event); },
    } as Parameters<typeof dismissKnownDesktopDownloadPromotion>[0];
    expect(await dismissKnownDesktopDownloadPromotion(webview)).toBe('dismissed');
    expect(events).toHaveLength(3);
  });

  it('页面没有白名单弹窗时零点击', async () => {
    const events: unknown[] = [];
    const webview = {
      executeJavaScript: async () => ({ present: false }),
      loadURL: () => {},
      getURL: () => 'https://www.doubao.com/chat/',
      sendInputEvent: (event: unknown) => { events.push(event); },
    } as Parameters<typeof dismissKnownDesktopDownloadPromotion>[0];
    expect(await dismissKnownDesktopDownloadPromotion(webview)).toBe('none');
    expect(events).toHaveLength(0);
  });
});

function account(id: string, usedUnits: number, exhausted = false): Account {
  return {
    id, name: id, platform: 'doubao', partition: id, status: 'idle', pinned: false,
    createdAt: '2026-08-27T00:00:00.000Z', updatedAt: '2026-08-27T00:00:00.000Z',
    seedanceQuota: { date: '2026-08-27', usedUnits, estimatedTotalUnits: 6, exhausted, updatedAt: '2026-08-27T00:00:00.000Z' },
    health: { loginState: 'ok', verificationRequired: false, consecutiveFailures: 0, successCount: 0, failureCount: 0,
      availability: { state: 'ready', reason: 'ready', message: 'ready', checkedAt: '2026-08-27T00:00:00.000Z', source: 'manual' } },
    scheduling: { enabled: true, weight: 1, preferredModes: ['video'] },
  } as Account;
}

function videoTask(): Task {
  return {
    id: 'task-1', prompt: 'video', assignedAccountId: 'exhausted', status: 'fail', mode: 'video',
    videoConfig: { model: 'seedance-2.0-fast', duration: '5s', aspectRatio: '9:16' },
    result: null, outputs: [], artifacts: [], runHistory: [], source: 'csv', dependsOnTaskIds: [],
    projectId: 'default-project', createdAt: '2026-08-27T00:00:00.000Z', updatedAt: '2026-08-27T00:00:00.000Z',
  };
}

describe('额度耗尽恢复与每日零点刷新', () => {
  it('耗尽动作立即把预计剩余额度归零', () => {
    const quota = applyVideoQuotaAction(account('a', 1).seedanceQuota!, 'exhausted', undefined, '2026-08-27T01:00:00.000Z');
    expect(quota.usedUnits).toBe(6);
    expect(quota.estimatedTotalUnits - quota.usedUnits).toBe(0);
    expect(quota.exhausted).toBe(true);
  });

  it('重新调度排除耗尽账号并选择有额度账号；无替代时返回 null', () => {
    const task = videoTask();
    expect(selectQuotaFallbackAccount(task, [task], [account('exhausted', 6, true), account('ready', 0)], 'exhausted')).toBe('ready');
    expect(selectQuotaFallbackAccount(task, [task], [account('exhausted', 6, true)], 'exhausted')).toBeNull();
  });

  it('本机自然日从 23:59 到 00:00 日期键变化', () => {
    expect(localDateKey(new Date(2026, 7, 27, 23, 59, 59))).toBe('2026-08-27');
    expect(localDateKey(new Date(2026, 7, 28, 0, 0, 0))).toBe('2026-08-28');
  });

  it('打开软件后会准确调度到下一个本地 00:00', () => {
    expect(millisecondsUntilNextLocalMidnight(new Date(2026, 7, 27, 23, 59, 59, 500))).toBe(500);
    expect(millisecondsUntilNextLocalMidnight(new Date(2026, 7, 28, 0, 0, 0))).toBe(24 * 60 * 60 * 1000);
  });
});
