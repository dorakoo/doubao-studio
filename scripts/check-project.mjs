import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const required = [
  'main/main.ts',
  'main/preload.ts',
  'src/index.tsx',
  'src/components/BrowserPanel.tsx',
  'src/store/useTaskStore.ts',
];
const missing = required.filter((file) => !fs.existsSync(path.join(root, file)));
if (missing.length) throw new Error(`缺少关键工程文件: ${missing.join(', ')}`);

const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
if (pkg.main !== 'dist/main/main.js') throw new Error('Electron 主进程入口配置错误');
if (!/^\d+\.\d+\.\d+$/.test(pkg.version)) throw new Error('package.json 版本号必须使用 x.y.z 格式');

const ipcSources = fs.readdirSync(path.join(root, 'main/ipc'))
  .filter((file) => file.endsWith('.ts'))
  .map((file) => fs.readFileSync(path.join(root, 'main/ipc', file), 'utf8'))
  .join('\n');
const channels = [...ipcSources.matchAll(/ipcMain\.handle\(\s*['"]([^'"]+)['"]/g)].map((match) => match[1]);
const duplicates = channels.filter((channel, index) => channels.indexOf(channel) !== index);
if (duplicates.length) throw new Error(`发现重复 IPC 通道: ${[...new Set(duplicates)].join(', ')}`);

console.log(`工程结构检查通过：${required.length} 个关键文件，${channels.length} 个 IPC 通道。`);
