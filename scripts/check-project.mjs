/**
 * scripts/check-project.mjs
 *
 * 工程结构 + IPC 契约检查。
 * 使用 TypeScript Compiler API 解析 AST，校验主进程与 preload 之间的 IPC 通道一致性。
 *
 * 检查规则：
 *   E001 — 重复注册（同一 channel 出现多次）
 *   E002 — 主进程注册了但 preload 未调用
 *   E003 — preload 调用了但主进程未注册
 *   E004 — handle/on 与 invoke/send 方向不匹配
 *   E005 — 模块顶层 IPC 注册（不在注册函数体内）
 *   E006 — 模块顶层 app.getPath() 调用
 *   E007 — 动态 channel（非字符串字面量）
 */

import fs from 'node:fs';
import path from 'node:path';
import { scanMainFiles, scanPreloadFile, crossCheck } from './lib/ipc-scanner.mjs';

const root = process.cwd();

// ==================== 1. 关键文件存在性检查 ====================

const required = [
  'main/main.ts',
  'main/preload.ts',
  'src/index.tsx',
  'src/components/BrowserPanel.tsx',
  'src/store/useTaskStore.ts',
];
const missing = required.filter((file) => !fs.existsSync(path.join(root, file)));
if (missing.length) throw new Error(`缺少关键工程文件: ${missing.join(', ')}`);

// ==================== 2. package.json 基本配置检查 ====================

const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
if (pkg.main !== 'dist/main/main.js') throw new Error('Electron 主进程入口配置错误');
if (!/^\d+\.\d+\.\d+$/.test(pkg.version)) throw new Error('package.json 版本号必须使用 x.y.z 格式');

// ==================== 3. AST 扫描主进程和 preload ====================

const mainResult = scanMainFiles(root);
const preloadResult = scanPreloadFile(root);

// ==================== 4. 交叉校验 ====================

const errors = crossCheck(mainResult, preloadResult);

// ==================== 5. 输出结果 ====================

if (errors.length > 0) {
  console.error('\n❌ IPC 契约检查失败，发现以下问题：\n');
  // 按规则编号排序，同规则内按文件、行号排序
  errors.sort((a, b) => {
    if (a.rule !== b.rule) return a.rule.localeCompare(b.rule);
    if (a.file !== b.file) return a.file.localeCompare(b.file);
    return a.line - b.line;
  });
  for (const err of errors) {
    console.error(`  [${err.rule}] ${err.file}:${err.line}  ${err.message}`);
  }
  console.error(`\n共 ${errors.length} 个错误。\n`);
  process.exit(1);
}

// ==================== 6. 汇总统计 ====================

const handleChannels = new Set(mainResult.handles.map((h) => h.channel));
const onChannels = new Set(mainResult.onListeners.map((o) => o.channel));

console.log(
  `工程结构检查通过：${required.length} 个关键文件，` +
  `${handleChannels.size} 个 handle/invoke 通道，` +
  `${onChannels.size} 个 on/send 通道。`
);
