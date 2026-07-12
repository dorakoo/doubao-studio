/**
 * scripts/fixtures/run-contracts-fixtures.mjs
 *
 * Contracts 边界检查 C003 规则的 Fixture 自测试。
 * 直接调用 scanContractsImports，验证 AST 扫描逻辑对各种
 * import/export 形式的判断正确性。
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanContractsImports } from '../lib/contracts-boundary-scanner.mjs';

const fixturesDir = path.dirname(fileURLToPath(import.meta.url));

const testCases = [
  {
    name: 'contracts-valid',
    files: ['contracts-valid.ts'],
    expectedCount: 0,
    description: '合法的 import type / export type 不应产生 C003 错误',
  },
  {
    name: 'contracts-violations',
    files: ['contracts-violations.ts'],
    expectedCount: 3,
    description: '普通 import、成员级 type import、普通 re-export 均应被拒绝',
  },
];

let failed = false;
for (const testCase of testCases) {
  const filePaths = testCase.files.map((file) => path.join(fixturesDir, file));
  const errors = scanContractsImports(filePaths, fixturesDir);
  const passed = errors.length === testCase.expectedCount;
  console.log(
    `${passed ? 'PASS' : 'FAIL'} ${testCase.name}: ` +
    `expected=${testCase.expectedCount} actual=${errors.length}  ` +
    `(${testCase.description})`,
  );
  if (!passed) {
    for (const err of errors) {
      console.log(`  → [${err.rule}] ${err.file}:${err.line} ${err.message}`);
    }
    failed = true;
  }
}

if (failed) process.exit(1);
console.log(`Contracts fixture 自测试通过：${testCases.length}/${testCases.length}`);
