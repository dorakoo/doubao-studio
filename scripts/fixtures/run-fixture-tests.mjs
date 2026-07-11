/**
 * scripts/fixtures/run-fixture-tests.mjs
 *
 * Fixture 自测试：验证 ipc-scanner 对 5 类场景的检测能力。
 * 不依赖 Electron 运行时，只解析 AST。
 *
 * 运行方式：node scripts/fixtures/run-fixture-tests.mjs
 * 退出码 0 = 全部通过，非零 = 有失败。
 */

import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = __dirname;

// ==================== 内联扫描器（独立于 ipc-scanner.mjs，直接扫描 fixture 文件） ====================

/**
 * 扫描指定文件列表，提取 ipcMain.handle/on 和 ipcRenderer.invoke/send 以及 app.getPath 调用。
 * @param {string[]} files — 绝对路径列表
 */
function scanFiles(files) {
  const handles = [];
  const onListeners = [];
  const invokes = [];
  const sends = [];
  const getPathCalls = [];

  for (const filePath of files) {
    if (!fs.existsSync(filePath)) continue;
    const relativeFile = path.basename(filePath);
    const content = fs.readFileSync(filePath, 'utf-8');
    const sourceFile = ts.createSourceFile(relativeFile, content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

    function isTopLevel(node) {
      let current = node.parent;
      while (current) {
        if (
          ts.isFunctionDeclaration(current) ||
          ts.isFunctionExpression(current) ||
          ts.isArrowFunction(current) ||
          ts.isMethodDeclaration(current) ||
          current.kind === ts.SyntaxKind.Constructor ||
          ts.isGetAccessor(current) ||
          ts.isSetAccessor(current)
        ) {
          return false;
        }
        current = current.parent;
      }
      return true;
    }

    function getLine(node) {
      return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
    }

    function extractChannel(arg) {
      if (!arg) return null;
      if (ts.isStringLiteral(arg)) return arg.text;
      if (ts.isNoSubstitutionTemplateLiteral(arg)) return arg.text;
      return null;
    }

    function visit(node) {
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
        const propAccess = node.expression;
        const objectExpr = propAccess.expression;
        const methodName = propAccess.name.text;

        if (ts.isIdentifier(objectExpr)) {
          // ipcMain.handle / ipcMain.on
          if (objectExpr.text === 'ipcMain' && (methodName === 'handle' || methodName === 'on')) {
            const channel = extractChannel(node.arguments[0]) ?? '<dynamic>';
            const info = { file: relativeFile, line: getLine(node), method: methodName, channel, topLevel: isTopLevel(node) };
            if (methodName === 'handle') handles.push(info);
            else onListeners.push(info);
          }

          // ipcRenderer.invoke / ipcRenderer.send
          if (objectExpr.text === 'ipcRenderer' && (methodName === 'invoke' || methodName === 'send')) {
            const channel = extractChannel(node.arguments[0]) ?? '<dynamic>';
            const info = { file: relativeFile, line: getLine(node), method: methodName, channel };
            if (methodName === 'invoke') invokes.push(info);
            else sends.push(info);
          }

          // app.getPath
          if (objectExpr.text === 'app' && methodName === 'getPath') {
            getPathCalls.push({ file: relativeFile, line: getLine(node), topLevel: isTopLevel(node) });
          }
        }

        // require('electron').app.getPath
        if (methodName === 'getPath' && ts.isPropertyAccessExpression(objectExpr) && objectExpr.name.text === 'app') {
          getPathCalls.push({ file: relativeFile, line: getLine(node), topLevel: isTopLevel(node) });
        }
      }
      ts.forEachChild(node, visit);
    }

    visit(sourceFile);
  }

  return { handles, onListeners, invokes, sends, getPathCalls };
}

/**
 * 对 fixture 扫描结果进行交叉校验，返回错误列表。
 * 与 ipc-scanner.mjs 的 crossCheck 逻辑一致，但作用于单文件。
 */
function checkFixture(scanResult) {
  const { handles, onListeners, invokes, sends, getPathCalls } = scanResult;
  const errors = [];

  // E001: 重复
  const handleChannels = handles.map((h) => h.channel);
  const dupes = handleChannels.filter((ch, i) => handleChannels.indexOf(ch) !== i);
  for (const ch of [...new Set(dupes)]) {
    errors.push({ rule: 'E001', channel: ch });
  }

  // E005: 顶层注册
  for (const h of [...handles, ...onListeners]) {
    if (h.topLevel) errors.push({ rule: 'E005', channel: h.channel });
  }

  // E006: 顶层 getPath
  for (const g of getPathCalls) {
    if (g.topLevel) errors.push({ rule: 'E006', channel: '<getPath>' });
  }

  // 交叉校验
  const handleSet = new Set(handles.filter((h) => h.channel !== '<dynamic>').map((h) => h.channel));
  const onSet = new Set(onListeners.filter((o) => o.channel !== '<dynamic>').map((o) => o.channel));
  const invokeSet = new Set(invokes.filter((i) => i.channel !== '<dynamic>').map((i) => i.channel));
  const sendSet = new Set(sends.filter((s) => s.channel !== '<dynamic>').map((s) => s.channel));

  // E002: handle 缺 invoke
  for (const ch of handleSet) {
    if (!invokeSet.has(ch)) errors.push({ rule: 'E002', channel: ch });
  }
  // E003: invoke 缺 handle
  for (const ch of invokeSet) {
    if (!handleSet.has(ch)) errors.push({ rule: 'E003', channel: ch });
  }
  // E004: 方向不匹配
  for (const ch of handleSet) {
    if (sendSet.has(ch)) errors.push({ rule: 'E004', channel: ch });
  }
  for (const ch of onSet) {
    if (invokeSet.has(ch)) errors.push({ rule: 'E004', channel: ch });
  }
  // on 缺 send
  for (const ch of onSet) {
    if (!sendSet.has(ch)) errors.push({ rule: 'E002', channel: ch });
  }
  // send 缺 on
  for (const ch of sendSet) {
    if (!onSet.has(ch)) errors.push({ rule: 'E003', channel: ch });
  }

  return errors;
}

// ==================== 测试用例 ====================

/** @typedef {{ name: string, files: string[], expectErrors: string[], expectPass: boolean }} TestCase */

const testCases = [
  {
    name: 'normal（正常用法，无错误）',
    files: ['normal.ts', 'normal-preload.ts'],
    expectErrors: [],
    expectPass: true,
  },
  {
    name: 'duplicate（重复注册，E001）',
    files: ['duplicate.ts'],
    expectErrors: ['E001'],
    expectPass: false,
  },
  {
    name: 'missing-invoke（缺失接收端，E002）',
    files: ['missing-invoke.ts'],
    expectErrors: ['E002'],
    expectPass: false,
  },
  {
    name: 'mismatch（方向不匹配，E004）',
    files: ['mismatch.ts'],
    expectErrors: ['E004'],
    expectPass: false,
  },
  {
    name: 'top-level（顶层注册，E005 + E006）',
    files: ['top-level.ts'],
    expectErrors: ['E005', 'E006'],
    expectPass: false,
  },
];

// ==================== 执行测试 ====================

let allPassed = true;

for (const tc of testCases) {
  const filePaths = tc.files.map((f) => path.join(fixturesDir, f));
  const scanResult = scanFiles(filePaths);
  const errors = checkFixture(scanResult);
  const errorRules = [...new Set(errors.map((e) => e.rule))].sort();
  const expectedRules = [...tc.expectErrors].sort();

  const passed = tc.expectPass
    ? errors.length === 0
    : expectedRules.every((r) => errorRules.includes(r));

  const status = passed ? '✅ PASS' : '❌ FAIL';
  console.log(`${status}  ${tc.name}`);
  console.log(`         预期错误: ${expectedRules.length > 0 ? expectedRules.join(', ') : '(无)'}`);
  console.log(`         实际错误: ${errorRules.length > 0 ? errorRules.join(', ') : '(无)'}`);

  if (errors.length > 0) {
    for (const e of errors) {
      console.log(`           [${e.rule}] channel='${e.channel}'`);
    }
  }
  console.log();

  if (!passed) allPassed = false;
}

if (allPassed) {
  console.log('✅ 所有 Fixture 测试通过。\n');
} else {
  console.log('❌ 部分 Fixture 测试失败。\n');
  process.exit(1);
}
