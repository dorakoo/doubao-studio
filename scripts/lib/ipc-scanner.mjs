/**
 * scripts/lib/ipc-scanner.mjs
 *
 * 使用 TypeScript Compiler API 解析 AST，提取 IPC 通道注册和调用信息。
 * 不依赖正则，能够精确定位文件、行号，并判断调用是否在模块顶层。
 *
 * 导出：
 *   - scanMainFiles(rootDir) → MainScanResult
 *   - scanPreloadFile(rootDir) → PreloadScanResult
 *   - crossCheck(mainResult, preloadResult) → CheckError[]
 */

import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

// ==================== 类型定义 ====================

/**
 * @typedef {Object} IpcCall
 * @property {string} file       — 相对于项目根的文件路径
 * @property {number} line       — 1-based 行号
 * @property {string} method     — 'handle' | 'on'
 * @property {string} channel    — 通道名（字符串字面量），非字符串时为 '<dynamic>'
 * @property {boolean} topLevel  — 是否在模块顶层（不在任何函数体内）
 */

/**
 * @typedef {Object} InvokeCall
 * @property {string} file
 * @property {number} line
 * @property {string} method     — 'invoke' | 'send'
 * @property {string} channel    — 通道名或 '<dynamic>'
 */

/**
 * @typedef {Object} GetPathCall
 * @property {string} file
 * @property {number} line
 * @property {boolean} topLevel
 */

/**
 * @typedef {Object} MainScanResult
 * @property {IpcCall[]}     handles      — 所有 ipcMain.handle 调用
 * @property {IpcCall[]}     onListeners  — 所有 ipcMain.on 调用
 * @property {GetPathCall[]} getPathCalls — 所有 app.getPath 调用
 */

/**
 * @typedef {Object} PreloadScanResult
 * @property {InvokeCall[]} invokes — 所有 ipcRenderer.invoke 调用
 * @property {InvokeCall[]} sends   — 所有 ipcRenderer.send 调用
 */

/**
 * @typedef {Object} CheckError
 * @property {string} rule    — 规则编号 (E001~E006)
 * @property {string} file    — 文件路径
 * @property {number} line    — 行号
 * @property {string} message — 错误描述
 */

// ==================== 工具函数 ====================

/** 将绝对路径转为相对于 root 的路径 */
function relPath(filePath, root) {
  return path.relative(root, filePath).replace(/\\/g, '/');
}

/** 获取 AST 节点的 1-based 行号 */
function getLine(node, sourceFile) {
  return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
}

/**
 * 判断节点是否在模块顶层（不在任何函数体内）。
 * 通过向上遍历父节点链，如果遇到 FunctionDeclaration / FunctionExpression /
 * ArrowFunction / MethodDeclaration 则不在顶层。
 */
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

/**
 * 从 CallExpression 的第一个参数中提取字符串字面量。
 * 支持普通字符串和模板字面量（无插值时）。
 * @returns {string|null} 通道名，无法确定时返回 null
 */
function extractStringLiteral(arg) {
  if (!arg) return null;
  if (ts.isStringLiteral(arg)) {
    return arg.text;
  }
  if (ts.isNoSubstitutionTemplateLiteral(arg)) {
    return arg.text;
  }
  // 处理 require('electron').app.getPath('userData') 模式
  // 或其他非字面量表达式
  return null;
}

// ==================== AST 扫描 ====================

function collectTypeScriptFiles(directory) {
  if (!fs.existsSync(directory)) return [];
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...collectTypeScriptFiles(entryPath));
    else if (entry.isFile() && entry.name.endsWith('.ts')) files.push(entryPath);
  }
  return files;
}

/**
 * 使用同一套生产扫描逻辑解析任意源文件，供项目检查和 Fixture 自测试复用。
 * @param {string[]} filePaths
 * @param {string} rootDir
 * @returns {{ mainResult: MainScanResult, preloadResult: PreloadScanResult }}
 */
export function scanSourceFiles(filePaths, rootDir) {
  /** @type {IpcCall[]} */
  const handles = [];
  /** @type {IpcCall[]} */
  const onListeners = [];
  /** @type {GetPathCall[]} */
  const getPathCalls = [];
  /** @type {InvokeCall[]} */
  const invokes = [];
  /** @type {InvokeCall[]} */
  const sends = [];

  for (const filePath of filePaths) {
    if (!fs.existsSync(filePath)) continue;
    const relativeFile = relPath(filePath, rootDir);
    const sourceFile = ts.createSourceFile(
      relativeFile,
      fs.readFileSync(filePath, 'utf-8'),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );

    function visit(node) {
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
        const objectExpr = node.expression.expression;
        const methodName = node.expression.name.text;
        const channel = extractStringLiteral(node.arguments[0]) ?? '<dynamic>';

        if (ts.isIdentifier(objectExpr) && objectExpr.text === 'ipcMain' && (methodName === 'handle' || methodName === 'on')) {
          const callInfo = {
            file: relativeFile,
            line: getLine(node, sourceFile),
            method: methodName,
            channel,
            topLevel: isTopLevel(node),
          };
          if (methodName === 'handle') handles.push(callInfo);
          else onListeners.push(callInfo);
        }

        if (ts.isIdentifier(objectExpr) && objectExpr.text === 'ipcRenderer' && (methodName === 'invoke' || methodName === 'send')) {
          const callInfo = {
            file: relativeFile,
            line: getLine(node, sourceFile),
            method: methodName,
            channel,
          };
          if (methodName === 'invoke') invokes.push(callInfo);
          else sends.push(callInfo);
        }

        const directAppCall = methodName === 'getPath' && ts.isIdentifier(objectExpr) && objectExpr.text === 'app';
        const propertyAppCall = methodName === 'getPath' && ts.isPropertyAccessExpression(objectExpr) && objectExpr.name.text === 'app';
        if (directAppCall || propertyAppCall) {
          getPathCalls.push({
            file: relativeFile,
            line: getLine(node, sourceFile),
            topLevel: isTopLevel(node),
          });
        }
      }
      ts.forEachChild(node, visit);
    }

    visit(sourceFile);
  }

  return {
    mainResult: { handles, onListeners, getPathCalls },
    preloadResult: { invokes, sends },
  };
}

/** 扫描主进程源文件。 */
export function scanMainFiles(rootDir) {
  const mainFiles = [
    path.join(rootDir, 'main', 'main.ts'),
    ...collectTypeScriptFiles(path.join(rootDir, 'main', 'ipc')),
  ];
  return scanSourceFiles(mainFiles, rootDir).mainResult;
}

/** 扫描 preload.ts。 */
export function scanPreloadFile(rootDir) {
  return scanSourceFiles([path.join(rootDir, 'main', 'preload.ts')], rootDir).preloadResult;
}

// ==================== 交叉校验 ====================

/**
 * 对主进程和 preload 的 IPC 通道进行交叉校验。
 *
 * 规则：
 *   E001 — 重复注册（同一 channel 出现多次）
 *   E002 — handle 缺少对应的 invoke（主进程注册了但 preload 没调用）
 *   E003 — invoke 缺少对应的 handle（preload 调用了但主进程没注册）
 *   E004 — on/send 方向不匹配（handle 配了 send，或 on 配了 invoke）
 *   E005 — 模块顶层 IPC 注册（不在函数体内）
 *   E006 — 模块顶层 app.getPath() 调用
 *   E007 — 动态 channel（非字符串字面量）
 *
 * @param {MainScanResult} mainResult
 * @param {PreloadScanResult} preloadResult
 * @returns {CheckError[]}
 */
export function crossCheck(mainResult, preloadResult) {
  /** @type {CheckError[]} */
  const errors = [];

  const { handles, onListeners, getPathCalls } = mainResult;
  const { invokes, sends } = preloadResult;

  // ---- E001: 重复注册（包括同一 channel 混用 handle/on） ----
  const registrations = [...handles, ...onListeners];
  for (const ch of [...new Set(registrations.map((call) => call.channel))]) {
    const dupeCalls = registrations.filter((call) => call.channel === ch);
    for (let i = 1; i < dupeCalls.length; i++) {
      errors.push({
        rule: 'E001',
        file: dupeCalls[i].file,
        line: dupeCalls[i].line,
        message: `重复注册 IPC 通道 '${ch}'，首次注册在 ${dupeCalls[0].file}:${dupeCalls[0].line}`,
      });
    }
  }

  // ---- E005: 模块顶层 IPC 注册 ----
  for (const h of [...handles, ...onListeners]) {
    if (h.topLevel) {
      errors.push({
        rule: 'E005',
        file: h.file,
        line: h.line,
        message: `模块顶层 ipcMain.${h.method}('${h.channel}') 调用，必须移入注册函数体内`,
      });
    }
  }

  // ---- E006: 模块顶层 app.getPath() ----
  for (const g of getPathCalls) {
    if (g.topLevel) {
      errors.push({
        rule: 'E006',
        file: g.file,
        line: g.line,
        message: `模块顶层 app.getPath() 调用，必须在 app.whenReady() 后执行`,
      });
    }
  }

  // ---- E007: 动态 channel ----
  for (const h of [...handles, ...onListeners]) {
    if (h.channel === '<dynamic>') {
      errors.push({
        rule: 'E007',
        file: h.file,
        line: h.line,
        message: `动态 IPC 通道名（非字符串字面量），无法进行契约校验`,
      });
    }
  }
  for (const inv of [...invokes, ...sends]) {
    if (inv.channel === '<dynamic>') {
      errors.push({
        rule: 'E007',
        file: inv.file,
        line: inv.line,
        message: `动态 IPC 通道名（非字符串字面量），无法进行契约校验`,
      });
    }
  }

  // ---- 构建通道集合（排除动态通道） ----
  const handleSet = new Set(handles.filter((h) => h.channel !== '<dynamic>').map((h) => h.channel));
  const onSet = new Set(onListeners.filter((o) => o.channel !== '<dynamic>').map((o) => o.channel));
  const invokeSet = new Set(invokes.filter((i) => i.channel !== '<dynamic>').map((i) => i.channel));
  const sendSet = new Set(sends.filter((s) => s.channel !== '<dynamic>').map((s) => s.channel));

  // ---- E002: handle 缺少 invoke ----
  for (const ch of handleSet) {
    if (!invokeSet.has(ch) && !sendSet.has(ch)) {
      // 找到第一个注册位置
      const h = handles.find((x) => x.channel === ch);
      errors.push({
        rule: 'E002',
        file: h.file,
        line: h.line,
        message: `主进程注册了 ipcMain.handle('${ch}')，但 preload 中未找到对应的 ipcRenderer.invoke`,
      });
    }
  }

  // ---- E003: invoke 缺少 handle ----
  for (const ch of invokeSet) {
    if (!handleSet.has(ch) && !onSet.has(ch)) {
      const inv = invokes.find((x) => x.channel === ch);
      errors.push({
        rule: 'E003',
        file: inv.file,
        line: inv.line,
        message: `preload 调用了 ipcRenderer.invoke('${ch}')，但主进程中未找到对应的 ipcMain.handle`,
      });
    }
  }

  // ---- E004: on/send 方向不匹配 ----
  // handle 不应该配 send
  for (const ch of handleSet) {
    if (sendSet.has(ch)) {
      const h = handles.find((x) => x.channel === ch);
      errors.push({
        rule: 'E004',
        file: h.file,
        line: h.line,
        message: `通道 '${ch}' 使用 ipcMain.handle 注册，但 preload 中使用 ipcRenderer.send 调用（应为 invoke）`,
      });
    }
  }
  // on 不应该配 invoke
  for (const ch of onSet) {
    if (invokeSet.has(ch)) {
      const o = onListeners.find((x) => x.channel === ch);
      errors.push({
        rule: 'E004',
        file: o.file,
        line: o.line,
        message: `通道 '${ch}' 使用 ipcMain.on 注册，但 preload 中使用 ipcRenderer.invoke 调用（应为 send）`,
      });
    }
  }
  // on 缺少 send
  for (const ch of onSet) {
    if (!sendSet.has(ch) && !invokeSet.has(ch)) {
      const o = onListeners.find((x) => x.channel === ch);
      errors.push({
        rule: 'E002',
        file: o.file,
        line: o.line,
        message: `主进程注册了 ipcMain.on('${ch}')，但 preload 中未找到对应的 ipcRenderer.send`,
      });
    }
  }
  // send 缺少 on
  for (const ch of sendSet) {
    if (!onSet.has(ch) && !handleSet.has(ch)) {
      const s = sends.find((x) => x.channel === ch);
      errors.push({
        rule: 'E003',
        file: s.file,
        line: s.line,
        message: `preload 调用了 ipcRenderer.send('${ch}')，但主进程中未找到对应的 ipcMain.on`,
      });
    }
  }

  return errors;
}
