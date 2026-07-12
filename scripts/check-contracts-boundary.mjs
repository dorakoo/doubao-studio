/**
 * scripts/check-contracts-boundary.mjs
 *
 * Contracts 包边界纯洁性检查。
 *
 * 检查规则：
 *   C001 — contracts 源文件禁止导入 electron、react、react-dom、zustand、fs、path、os
 *   C002 — contracts 源文件禁止引用 document、window、HTMLElement 等 DOM 全局
 *   C003 — 所有受管源文件中 @doubao-studio/contracts 的 import/export 必须是 type-only
 *          （递归扫描 main/、src/、tests/，使用 AST 精确判断）
 */

import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const root = process.cwd();
const errors = [];

// ==================== 辅助函数 ====================

/** 递归收集目录下所有 TypeScript 文件（.ts / .tsx） */
function walkTsFiles(dir) {
  const results = [];
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkTsFiles(fullPath));
    } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) {
      results.push(fullPath);
    }
  }
  return results;
}

/** 将绝对路径转为相对于 root 的正斜杠路径 */
function relPath(filePath) {
  return path.relative(root, filePath).replace(/\\/g, '/');
}

/** 获取 AST 节点的 1-based 行号 */
function getLine(node, sourceFile) {
  return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
}

/** 从 ImportDeclaration / ExportDeclaration 中提取模块说明符字符串 */
function getModuleSpecifier(node) {
  if (!node.moduleSpecifier) return null;
  if (ts.isStringLiteral(node.moduleSpecifier)) {
    return node.moduleSpecifier.text;
  }
  return null;
}

const CONTRACTS_MODULE = '@doubao-studio/contracts';

// ==================== C001: contracts 源文件禁止导入受限模块 ====================

const FORBIDDEN_MODULES = ['electron', 'react', 'react-dom', 'zustand', 'fs', 'path', 'os'];
const contractsSrcDir = path.join(root, 'packages', 'contracts', 'src');

for (const file of walkTsFiles(contractsSrcDir)) {
  const content = fs.readFileSync(file, 'utf-8');
  const rel = relPath(file);

  for (const mod of FORBIDDEN_MODULES) {
    const regex = new RegExp(`from\\s+['"]${mod}(/[^'"]*)?['"]`, 'g');
    if (regex.test(content)) {
      errors.push(`[C001] ${rel}: 禁止导入 "${mod}"`);
    }
  }
}

// ==================== C002: contracts 源文件禁止引用 DOM 全局类型 ====================

const FORBIDDEN_GLOBALS = ['document', 'window', 'HTMLElement'];

for (const file of walkTsFiles(contractsSrcDir)) {
  const content = fs.readFileSync(file, 'utf-8');
  const rel = relPath(file);

  for (const globalName of FORBIDDEN_GLOBALS) {
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();
      if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) continue;
      const regex = new RegExp(`\\b${globalName}\\b`);
      if (regex.test(line)) {
        errors.push(`[C002] ${rel}:${i + 1}: 禁止引用 DOM 全局 "${globalName}"`);
      }
    }
  }
}

// ==================== C003: 所有受管源文件中 contracts 导入/导出必须是 type-only ====================

/**
 * 递归扫描 main/、src/、tests/ 下所有 TypeScript 文件，
 * 使用 AST 精确判断每个 @doubao-studio/contracts 的 import/export 是否为 type-only。
 *
 * TypeScript AST 中的 type-only 标记：
 *   - ImportDeclaration.importClause.isTypeOnly  →  `import type { ... } from '...'`
 *   - ExportDeclaration.isTypeOnly               →  `export type { ... } from '...'`
 *
 * 以下形式均会被拒绝（因为声明级别不是 type-only，会生成运行时 require/import）：
 *   - import { X } from '@doubao-studio/contracts'
 *   - import { type X } from '@doubao-studio/contracts'   （specifier 级 type-only 仍产生运行时模块加载）
 *   - import X from '@doubao-studio/contracts'
 *   - import * as C from '@doubao-studio/contracts'
 *   - export { X } from '@doubao-studio/contracts'
 *   - export * from '@doubao-studio/contracts'
 */
const CONSUMER_DIRS = [
  path.join(root, 'main'),
  path.join(root, 'src'),
  path.join(root, 'tests'),
];

for (const dir of CONSUMER_DIRS) {
  for (const file of walkTsFiles(dir)) {
    const content = fs.readFileSync(file, 'utf-8');
    const rel = relPath(file);
    const sourceFile = ts.createSourceFile(rel, content, ts.ScriptTarget.Latest, true,
      file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);

    function visit(node) {
      // ---- ImportDeclaration ----
      if (ts.isImportDeclaration(node)) {
        const specifier = getModuleSpecifier(node);
        if (specifier === CONTRACTS_MODULE) {
          const isTypeOnly = node.importClause?.isTypeOnly === true;
          if (!isTypeOnly) {
            errors.push(
              `[C003] ${rel}:${getLine(node, sourceFile)}: ` +
              `禁止使用普通 import 导入 @doubao-studio/contracts，必须使用 import type`,
            );
          }
        }
      }

      // ---- ExportDeclaration（含 re-export） ----
      if (ts.isExportDeclaration(node)) {
        const specifier = getModuleSpecifier(node);
        if (specifier === CONTRACTS_MODULE) {
          const isTypeOnly = node.isTypeOnly === true;
          if (!isTypeOnly) {
            errors.push(
              `[C003] ${rel}:${getLine(node, sourceFile)}: ` +
              `禁止使用普通 export (re-export) 导入 @doubao-studio/contracts，必须使用 export type`,
            );
          }
        }
      }

      ts.forEachChild(node, visit);
    }

    visit(sourceFile);
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
