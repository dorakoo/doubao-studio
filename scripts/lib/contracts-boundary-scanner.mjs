/**
 * scripts/lib/contracts-boundary-scanner.mjs
 *
 * 使用 TypeScript Compiler API 解析 AST，检查 @doubao-studio/contracts
 * 的 import/export 是否为声明级 type-only。
 *
 * 导出：
 *   - scanContractsImports(filePaths, rootDir) → BoundaryError[]
 */

import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

// ==================== 类型定义 ====================

/**
 * @typedef {Object} BoundaryError
 * @property {string} rule    — 规则编号 (C003)
 * @property {string} file    — 相对于 rootDir 的文件路径
 * @property {number} line    — 1-based 行号
 * @property {string} message — 错误描述
 */

const CONTRACTS_MODULE = '@doubao-studio/contracts';

// ==================== 工具函数 ====================

/** 将绝对路径转为相对于 root 的正斜杠路径 */
function relPath(filePath, root) {
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

// ==================== AST 扫描 ====================

/**
 * 扫描给定文件列表中所有 @doubao-studio/contracts 的 import/export，
 * 返回非声明级 type-only 的违规列表。
 *
 * TypeScript AST 中的 type-only 标记：
 *   - ImportDeclaration.importClause.isTypeOnly  →  `import type { ... } from '...'`
 *   - ExportDeclaration.isTypeOnly               →  `export type { ... } from '...'`
 *
 * 以下形式会被拒绝：
 *   - import { X } from '@doubao-studio/contracts'
 *   - import { type X } from '@doubao-studio/contracts'
 *   - import X from '@doubao-studio/contracts'
 *   - import * as C from '@doubao-studio/contracts'
 *   - export { X } from '@doubao-studio/contracts'
 *   - export * from '@doubao-studio/contracts'
 *
 * 拒绝 `import { type X }`（成员级 type-only）的理由：
 *   TypeScript 默认擦除行为下纯成员级 type 导入通常也会被移除，
 *   但项目统一强制声明级 `import type` 风格，便于静态审计和
 *   防止未来新增运行时导出时意外引入实际模块加载。
 *
 * @param {string[]} filePaths
 * @param {string} rootDir
 * @returns {BoundaryError[]}
 */
export function scanContractsImports(filePaths, rootDir) {
  /** @type {BoundaryError[]} */
  const errors = [];

  for (const filePath of filePaths) {
    if (!fs.existsSync(filePath)) continue;
    const relativeFile = relPath(filePath, rootDir);
    const content = fs.readFileSync(filePath, 'utf-8');
    const sourceFile = ts.createSourceFile(
      relativeFile,
      content,
      ts.ScriptTarget.Latest,
      true,
      filePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );

    function visit(node) {
      // ---- ImportDeclaration ----
      if (ts.isImportDeclaration(node)) {
        const specifier = getModuleSpecifier(node);
        if (specifier === CONTRACTS_MODULE) {
          const isTypeOnly = node.importClause?.isTypeOnly === true;
          if (!isTypeOnly) {
            errors.push({
              rule: 'C003',
              file: relativeFile,
              line: getLine(node, sourceFile),
              message: '禁止使用普通 import 导入 @doubao-studio/contracts，必须使用 import type',
            });
          }
        }
      }

      // ---- ExportDeclaration（含 re-export） ----
      if (ts.isExportDeclaration(node)) {
        const specifier = getModuleSpecifier(node);
        if (specifier === CONTRACTS_MODULE) {
          const isTypeOnly = node.isTypeOnly === true;
          if (!isTypeOnly) {
            errors.push({
              rule: 'C003',
              file: relativeFile,
              line: getLine(node, sourceFile),
              message: '禁止使用普通 export (re-export) 导入 @doubao-studio/contracts，必须使用 export type',
            });
          }
        }
      }

      ts.forEachChild(node, visit);
    }

    visit(sourceFile);
  }

  return errors;
}
