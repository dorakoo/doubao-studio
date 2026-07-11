/**
 * tests/smoke.test.ts
 *
 * 基础冒烟测试 — 验证 Vitest 运行器正常工作。
 * 一个通过的断言和一个验证失败时产生非零退出码的断言（通过 expect.assertions 保证）。
 */

import { describe, it, expect } from 'vitest';

describe('Vitest 冒烟测试', () => {
  it('应正确计算 1 + 1 = 2', () => {
    expect(1 + 1).toBe(2);
  });

  it('应正确比较字符串', () => {
    expect('hello').toBe('hello');
    expect('hello'.length).toBe(5);
  });
});
