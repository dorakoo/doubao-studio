/**
 * tests/unit/version.test.ts
 * 版本比较纯函数回归测试
 */

import { describe, it, expect } from 'vitest';
import { compareVersions } from '../../main/utils/version';

describe('compareVersions', () => {
  it('相同版本返回 0', () => {
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0);
    expect(compareVersions('2.5.3', '2.5.3')).toBe(0);
  });

  it('left > right 返回正数', () => {
    expect(compareVersions('2.0.0', '1.0.0')).toBeGreaterThan(0);
    expect(compareVersions('1.2.0', '1.1.0')).toBeGreaterThan(0);
    expect(compareVersions('1.0.1', '1.0.0')).toBeGreaterThan(0);
  });

  it('left < right 返回负数', () => {
    expect(compareVersions('1.0.0', '2.0.0')).toBeLessThan(0);
    expect(compareVersions('1.1.0', '1.2.0')).toBeLessThan(0);
    expect(compareVersions('1.0.0', '1.0.1')).toBeLessThan(0);
  });

  it('不同段数比较 — 短版本补 0', () => {
    expect(compareVersions('1.0', '1.0.0')).toBe(0);
    expect(compareVersions('1.0.0.1', '1.0.0')).toBeGreaterThan(0);
    expect(compareVersions('1.0', '1.0.1')).toBeLessThan(0);
  });

  it('非数字段视为 0', () => {
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0);
    expect(compareVersions('1.0.x', '1.0.0')).toBe(0);
  });

  it('空字符串视为全 0', () => {
    expect(compareVersions('', '0.0.0')).toBe(0);
    expect(compareVersions('', '')).toBe(0);
  });
});
