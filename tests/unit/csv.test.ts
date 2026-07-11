/**
 * tests/unit/csv.test.ts
 * CSV 解析与字段标准化回归测试
 */

import { describe, it, expect } from 'vitest';
import { parseCsv, normalizeCsvMode } from '../../main/utils/csv';

describe('parseCsv', () => {
  it('解析简单的 CSV', () => {
    const result = parseCsv('a,b,c\n1,2,3');
    expect(result).toEqual([['a', 'b', 'c'], ['1', '2', '3']]);
  });

  it('处理引号包裹的字段', () => {
    const result = parseCsv('"hello,world",b');
    expect(result).toEqual([['hello,world', 'b']]);
  });

  it('处理转义引号 (""转义为")', () => {
    const result = parseCsv('"say ""hi""",b');
    expect(result).toEqual([['say "hi"', 'b']]);
  });

  it('处理 CRLF 换行', () => {
    const result = parseCsv('a,b\r\n1,2');
    expect(result).toEqual([['a', 'b'], ['1', '2']]);
  });

  it('处理 LF 换行', () => {
    const result = parseCsv('a,b\n1,2');
    expect(result).toEqual([['a', 'b'], ['1', '2']]);
  });

  it('跳过空行', () => {
    const result = parseCsv('a,b\n\n1,2');
    expect(result).toEqual([['a', 'b'], ['1', '2']]);
  });

  it('字段两侧空格被 trim', () => {
    const result = parseCsv('  hello  ,  world  ');
    expect(result).toEqual([['hello', 'world']]);
  });

  it('单行输入返回一行', () => {
    const result = parseCsv('a,b,c');
    expect(result).toEqual([['a', 'b', 'c']]);
  });

  it('空字符串返回空数组', () => {
    expect(parseCsv('')).toEqual([]);
  });

  it('仅含空白的行被跳过', () => {
    const result = parseCsv('a,b\n   \n1,2');
    expect(result).toEqual([['a', 'b'], ['1', '2']]);
  });

  it('引号内包含换行符', () => {
    const result = parseCsv('"line1\nline2",b');
    expect(result).toEqual([['line1\nline2', 'b']]);
  });

  it('最后一个字段不需要换行符', () => {
    const result = parseCsv('a,b\nc,d');
    expect(result).toHaveLength(2);
    expect(result[1]).toEqual(['c', 'd']);
  });
});

describe('normalizeCsvMode', () => {
  it('英文模式名', () => {
    expect(normalizeCsvMode('image')).toBe('image');
    expect(normalizeCsvMode('video')).toBe('video');
    expect(normalizeCsvMode('music')).toBe('music');
    expect(normalizeCsvMode('chat')).toBe('chat');
  });

  it('中文模式名', () => {
    expect(normalizeCsvMode('图片')).toBe('image');
    expect(normalizeCsvMode('视频')).toBe('video');
    expect(normalizeCsvMode('音乐')).toBe('music');
  });

  it('大小写不敏感', () => {
    expect(normalizeCsvMode('IMAGE')).toBe('image');
    expect(normalizeCsvMode('Video')).toBe('video');
  });

  it('带空白的输入被 trim', () => {
    expect(normalizeCsvMode('  image  ')).toBe('image');
    expect(normalizeCsvMode('  视频  ')).toBe('video');
  });

  it('未知值回退为 chat', () => {
    expect(normalizeCsvMode('unknown')).toBe('chat');
    expect(normalizeCsvMode('')).toBe('chat');
    expect(normalizeCsvMode('xyz')).toBe('chat');
  });
});
