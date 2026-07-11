/**
 * vitest.config.ts
 *
 * Vitest 测试运行器配置
 * - 默认环境 Node（纯逻辑测试不需要 DOM）
 * - 当前仅运行纯逻辑测试；引入组件测试时再新增独立 DOM project
 * - 覆盖率使用 v8 provider
 */

import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  test: {
    // 默认使用 Node 环境
    environment: 'node',
    // 单次运行模式，不启用 watch
    watch: false,
    // 使用 projects 定义不同环境的测试分组
    projects: [
      // 纯逻辑测试 — Node 环境
      {
        test: {
          name: 'node',
          include: ['tests/**/*.test.{ts,tsx}'],
          exclude: ['**/*.dom.test.{ts,tsx}'],
          environment: 'node',
        },
      },
    ],
    // 覆盖率配置
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary'],
      include: ['main/**/*.ts', 'src/**/*.ts', 'src/**/*.tsx'],
      exclude: ['**/*.d.ts', '**/*.test.*', 'scripts/**'],
    },
  },
});
