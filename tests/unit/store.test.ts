/**
 * tests/unit/store.test.ts
 * JSON 备份读取与写入失败语义回归测试
 *
 * 通过 mock electron 的 app.getPath 返回临时目录，
 * 测试 readJSON / writeJSON 的正常流程、损坏文件回退备份、写入失败语义。
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// 创建临时目录作为 userData
let tempDir: string;
let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

vi.mock('electron', () => ({
  app: {
    getPath: () => tempDir,
  },
}));

// 动态导入，确保 mock 生效
const { readJSON, writeJSON, getDataDir } = await import('../../main/utils/store');

describe('JSON 存储工具', () => {
  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'doubao-test-'));
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    consoleErrorSpy.mockRestore();
  });

  describe('readJSON', () => {
    it('文件不存在时返回 fallback', () => {
      const result = readJSON('nonexistent.json', { default: true });
      expect(result).toEqual({ default: true });
    });

    it('正常读取 JSON 文件', () => {
      const dataDir = getDataDir();
      const filePath = path.join(dataDir, 'test.json');
      fs.writeFileSync(filePath, JSON.stringify({ name: 'test', value: 42 }), 'utf-8');
      const result = readJSON('test.json', null);
      expect(result).toEqual({ name: 'test', value: 42 });
    });

    it('读取数组类型', () => {
      const dataDir = getDataDir();
      const filePath = path.join(dataDir, 'array.json');
      fs.writeFileSync(filePath, JSON.stringify([1, 2, 3]), 'utf-8');
      const result = readJSON<number[]>('array.json', []);
      expect(result).toEqual([1, 2, 3]);
    });

    it('JSON 损坏时回退到 .bak 文件', () => {
      const dataDir = getDataDir();
      const filePath = path.join(dataDir, 'corrupt.json');
      const bakPath = `${filePath}.bak`;
      fs.writeFileSync(filePath, '{ invalid json !!!', 'utf-8');
      fs.writeFileSync(bakPath, JSON.stringify({ recovered: true }), 'utf-8');
      const result = readJSON('corrupt.json', null);
      expect(result).toEqual({ recovered: true });
    });

    it('JSON 损坏且无 .bak 时返回 fallback', () => {
      const dataDir = getDataDir();
      const filePath = path.join(dataDir, 'corrupt2.json');
      fs.writeFileSync(filePath, '{ broken', 'utf-8');
      const result = readJSON('corrupt2.json', { fallback: true });
      expect(result).toEqual({ fallback: true });
    });

    it('.bak 文件也损坏时返回 fallback', () => {
      const dataDir = getDataDir();
      const filePath = path.join(dataDir, 'both-corrupt.json');
      const bakPath = `${filePath}.bak`;
      fs.writeFileSync(filePath, '{ broken', 'utf-8');
      fs.writeFileSync(bakPath, '{ also broken', 'utf-8');
      const result = readJSON('both-corrupt.json', { safe: true });
      expect(result).toEqual({ safe: true });
    });
  });

  describe('writeJSON', () => {
    it('正常写入数据', () => {
      const data = { items: [1, 2, 3], name: '测试' };
      const success = writeJSON('write-test.json', data);
      expect(success).toBe(true);
      const dataDir = getDataDir();
      const filePath = path.join(dataDir, 'write-test.json');
      const content = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      expect(content).toEqual(data);
    });

    it('写入后旧文件被备份为 .bak', () => {
      const dataDir = getDataDir();
      const filePath = path.join(dataDir, 'backup-test.json');
      const bakPath = `${filePath}.bak`;

      // 第一次写入
      const v1 = { version: 1 };
      writeJSON('backup-test.json', v1);
      expect(fs.existsSync(filePath)).toBe(true);

      // 第二次写入 — 旧文件应备份
      const v2 = { version: 2 };
      writeJSON('backup-test.json', v2);

      expect(JSON.parse(fs.readFileSync(filePath, 'utf-8'))).toEqual(v2);
      expect(fs.existsSync(bakPath)).toBe(true);
      expect(JSON.parse(fs.readFileSync(bakPath, 'utf-8'))).toEqual(v1);
    });

    it('首次写入时无旧文件，不创建 .bak', () => {
      const dataDir = getDataDir();
      const filePath = path.join(dataDir, 'first-write.json');
      const bakPath = `${filePath}.bak`;

      writeJSON('first-write.json', { data: 'hello' });
      expect(fs.existsSync(filePath)).toBe(true);
      expect(fs.existsSync(bakPath)).toBe(false);
    });

    it('连续多次写入 — .bak 始终保存上一次内容', () => {
      const dataDir = getDataDir();
      const filePath = path.join(dataDir, 'multi.json');
      const bakPath = `${filePath}.bak`;

      writeJSON('multi.json', { v: 1 });
      writeJSON('multi.json', { v: 2 });
      writeJSON('multi.json', { v: 3 });

      expect(JSON.parse(fs.readFileSync(filePath, 'utf-8'))).toEqual({ v: 3 });
      expect(JSON.parse(fs.readFileSync(bakPath, 'utf-8'))).toEqual({ v: 2 });
    });

    it('数据目录无法创建时返回 false 而不是抛异常', () => {
      fs.rmSync(tempDir, { recursive: true, force: true });
      fs.writeFileSync(tempDir, 'not-a-directory', 'utf-8');
      expect(() => writeJSON('blocked.json', { value: 1 })).not.toThrow();
      expect(writeJSON('blocked.json', { value: 1 })).toBe(false);
    });
  });

  describe('读写往返', () => {
    it('写入后读取应得到相同数据', () => {
      const data = { id: 'abc', list: [1, 2, 3], nested: { a: true } };
      writeJSON('roundtrip.json', data);
      const result = readJSON('roundtrip.json', null);
      expect(result).toEqual(data);
    });
  });
});
