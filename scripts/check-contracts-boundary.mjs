/**
 * scripts/check-contracts-boundary.mjs
 *
 * Contracts 包边界纯洁性检查。
 *
 * 检查规则：
 *   C001 — contracts 源文件禁止导入 electron、react、react-dom、zustand、fs、path、os
 *   C002 — contracts 源文件禁止引用 document、window、HTMLElement 等 DOM 全局
 *   C003 — 消费方文件禁止使用普通 import 导入 @doubao-studio/contracts（必须 import type）
 */

import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const errors = [];

// ==================== 辅助函数 ====================

function walkTsFiles(dir) {
  const results = [];
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkTsFiles(fullPath));
    } else if (entry.name.endsWith('.ts')) {
      results.push(fullPath);
    }
  }
  return results;
}

// ==================== C001: 禁止导入受限模块 ====================

const FORBIDDEN_MODULES = ['electron', 'react', 'react-dom', 'zustand', 'fs', 'path', 'os'];
const contractsSrcDir = path.join(root, 'packages', 'contracts', 'src');

for (const file of walkTsFiles(contractsSrcDir)) {
  const content = fs.readFileSync(file, 'utf-8');
  const relPath = path.relative(root, file);

  for (const mod of FORBIDDEN_MODULES) {
    // 匹配: from 'mod' 或 from "mod"（精确匹配模块名，不匹配子路径如 'fs/promises'）
    const regex = new RegExp(`from\\s+['"]${mod}(/[^'"]*)?['"]`, 'g');
    if (regex.test(content)) {
      errors.push(`[C001] ${relPath}: 禁止导入 "${mod}"`);
    }
  }
}

// ==================== C002: 禁止引用 DOM 全局类型 ====================

const FORBIDDEN_GLOBALS = ['document', 'window', 'HTMLElement'];

for (const file of walkTsFiles(contractsSrcDir)) {
  const content = fs.readFileSync(file, 'utf-8');
  const relPath = path.relative(root, file);

  for (const globalName of FORBIDDEN_GLOBALS) {
    // 匹配作为类型引用的 DOM 全局（排除注释中的词）
    // 简化策略：检查是否在代码中作为标识符出现（非注释行）
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // 跳过注释行
      const trimmed = line.trim();
      if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) continue;
      // 检查是否包含 DOM 全局标识符（作为单词边界）
      const regex = new RegExp(`\\b${globalName}\\b`);
      if (regex.test(line)) {
        errors.push(`[C002] ${relPath}:${i + 1}: 禁止引用 DOM 全局 "${globalName}"`);
      }
    }
  }
}

// ==================== C003: 消费方必须使用 import type ====================

const CONSUMER_FILES = [
  'main/ipc/tasks.ts',
  'main/ipc/accounts.ts',
  'main/utils/csv.ts',
  'src/types/index.ts',
];

for (const relFile of CONSUMER_FILES) {
  const file = path.join(root, relFile);
  if (!fs.existsSync(file)) continue;
  const content = fs.readFileSync(file, 'utf-8');

  // 逐行扫描，跳过注释和 type-only import/export 块
  const lines = content.split('\n');
  let inTypeOnlyBlock = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // 跳过注释行
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) continue;

    // 检测 type-only import/export 块的开始
    // 匹配: import type { ... } 或 export type { ... }
    if (/^(import|export)\s+type\s+\{/.test(trimmed)) {
      // 单行完整语句: import type { X } from '...'
      if (trimmed.includes('}')) {
        continue;
      }
      // 多行块开始
      inTypeOnlyBlock = true;
      continue;
    }

    // 在 type-only 块内，跳过直到找到闭合 }
    if (inTypeOnlyBlock) {
      if (trimmed.includes('}')) {
        inTypeOnlyBlock = false;
      }
      continue;
    }

    // 非注释、非 type-only 块的行中如果包含 @doubao-studio/contracts，则为违规
    if (line.includes('@doubao-studio/contracts')) {
      errors.push(`[C003] ${relFile}:${i + 1}: 禁止使用普通 import 导入 @doubao-studio/contracts，必须使用 import type`);
    }
  }
}

// ==================== 输出结果 ====================

if (errors.length > 0) {
  console.error('\n❌ Contracts 边界检查失败：\n');
  for (const err of errors) {
    console.error(`  ${err}`);
  }
  console.error(`\n共 ${errors.length} 个错误。\n`);
  process.exit(1);
}

console.log('Contracts 边界检查通过。');
