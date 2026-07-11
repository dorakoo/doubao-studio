/**
 * eslint.config.mjs
 *
 * ESLint flat config — 豆包工作室 G-202 基线
 *
 * 设计原则：
 * - 首批只启用能发现真实缺陷的高价值规则（error 级别）
 * - `any`、复杂度、未使用变量和风格规则降为 warn（基线记录），不阻断构建
 * - 禁止全局 disable 掩盖问题
 * - TypeScript 类型检查由 ts-check 独立负责，ESLint 不重复执行类型分析
 *
 * 退出标准：
 * - 故意加入空分支（非 catch）、条件 Hook 调用、const 未初始化等可被 error 规则捕获
 * - 现有工程无需大范围业务改写即可通过（0 error）
 */

import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default tseslint.config(
  // ==================== 全局忽略 ====================
  {
    ignores: [
      'dist/**',
      'release/**',
      'node_modules/**',
      'data/**',
      // 根级 doubaoBridge.ts 是历史游离文件，不在任何 tsconfig include 中
      'doubaoBridge.ts',
    ],
  },

  // ==================== 基础 JS 推荐规则 ====================
  js.configs.recommended,

  // ==================== TypeScript 推荐规则（非类型检查） ====================
  ...tseslint.configs.recommended,

  // ==================== JS 配置文件（CommonJS） ====================
  {
    files: ['*.config.js', 'tailwind.config.js', 'postcss.config.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: {
        ...globals.node,
      },
    },
    rules: {
      'no-undef': 'off', // CommonJS 环境下 module/exports 已定义
    },
  },

  // ==================== 主进程 (Electron Main) ====================
  {
    files: ['main/**/*.ts'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: {
        ...globals.node,
      },
    },
    rules: {
      // ---- 高价值规则（error）----
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-constant-condition': ['error', { checkLoops: false }],
      'no-var': 'error',

      // ---- 基线记录（warn，不阻断）----
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-non-null-assertion': 'warn',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'complexity': ['warn', { max: 30 }],
      'prefer-const': 'warn',

      // ---- 关闭无关规则 ----
      'no-undef': 'off', // TypeScript 已处理
      '@typescript-eslint/no-require-imports': 'off', // Electron 主进程合法使用 require
    },
  },

  // ==================== 渲染进程 (React + TypeScript) ====================
  {
    files: ['src/**/*.ts', 'src/**/*.tsx'],
    plugins: {
      'react-hooks': reactHooks,
    },
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.es2021,
      },
    },
    rules: {
      // ---- React Hooks 高价值规则（error）----
      // rules-of-hooks 捕获条件式调用 Hook 等严重错误
      'react-hooks/rules-of-hooks': 'error',
      // exhaustive-deps 降为 warn 基线：现有代码存在依赖缺失，需逐步修复
      'react-hooks/exhaustive-deps': 'warn',

      // ---- 高价值规则（error）----
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-constant-condition': ['error', { checkLoops: false }],
      'no-var': 'error',

      // ---- 基线记录（warn，不阻断）----
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-non-null-assertion': 'warn',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'complexity': ['warn', { max: 30 }],
      'prefer-const': 'warn',
      'no-useless-escape': 'warn',

      // ---- 关闭无关规则 ----
      'no-undef': 'off', // TypeScript 已处理
    },
  },

  // ==================== Node 脚本 ====================
  {
    files: ['scripts/**/*.mjs', 'scripts/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.node,
      },
    },
    rules: {
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'prefer-const': 'warn',
      'no-var': 'error',
    },
  },

  // ==================== 类型声明文件（宽松） ====================
  {
    files: ['src/**/*.d.ts', 'src/vite-env.d.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
    },
  },
);
