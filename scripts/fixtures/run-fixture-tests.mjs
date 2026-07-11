/** Fixture 自测试：直接调用生产 AST 扫描器与交叉校验引擎。 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { crossCheck, scanSourceFiles } from '../lib/ipc-scanner.mjs';

const fixturesDir = path.dirname(fileURLToPath(import.meta.url));

const testCases = [
  { name: 'normal', files: ['normal.ts', 'normal-preload.ts'], expectedRules: [] },
  { name: 'duplicate', files: ['duplicate.ts'], expectedRules: ['E001'] },
  { name: 'missing-preload-call', files: ['missing-invoke.ts'], expectedRules: ['E002'] },
  { name: 'orphan-preload-call', files: ['orphan-preload.ts'], expectedRules: ['E003'] },
  { name: 'direction-mismatch', files: ['mismatch.ts'], expectedRules: ['E004'] },
  { name: 'top-level-registration', files: ['top-level.ts'], expectedRules: ['E005', 'E006'] },
  { name: 'dynamic-channel', files: ['dynamic.ts'], expectedRules: ['E007'] },
];

let failed = false;
for (const testCase of testCases) {
  const filePaths = testCase.files.map((file) => path.join(fixturesDir, file));
  const { mainResult, preloadResult } = scanSourceFiles(filePaths, fixturesDir);
  const actualRules = [...new Set(crossCheck(mainResult, preloadResult).map((error) => error.rule))].sort();
  const expectedRules = [...testCase.expectedRules].sort();
  const passed = actualRules.length === expectedRules.length && expectedRules.every((rule) => actualRules.includes(rule));
  console.log(`${passed ? 'PASS' : 'FAIL'} ${testCase.name}: expected=${expectedRules.join(',') || 'none'} actual=${actualRules.join(',') || 'none'}`);
  if (!passed) failed = true;
}

if (failed) process.exit(1);
console.log(`Fixture 自测试通过：${testCases.length}/${testCases.length}`);
