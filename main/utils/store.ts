/**
 * main/utils/store.ts
 * 本地 JSON 文件持久化工具
 * 用于存储账号数据，替代 electron-store（避免原生依赖复杂性）
 */

import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';

/** 获取用户数据目录路径 */
function getDataDir(): string {
  const userDataPath = app.getPath('userData');
  const dataDir = path.join(userDataPath, 'DoubaoStudioData');
  // 确保目录存在
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  return dataDir;
}

/** 通用读取 JSON 文件 */
export function readJSON<T>(filename: string, fallback: T): T {
  const filePath = path.join(getDataDir(), filename);
  try {
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, 'utf-8');
      return JSON.parse(raw) as T;
    }
  } catch (err) {
    console.error(`[Store] 读取 ${filename} 失败:`, err);
  }
  return fallback;
}

/** 通用写入 JSON 文件 */
export function writeJSON<T>(filename: string, data: T): boolean {
  const filePath = path.join(getDataDir(), filename);
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
    return true;
  } catch (err) {
    console.error(`[Store] 写入 ${filename} 失败:`, err);
    return false;
  }
}

/** 删除 JSON 文件 */
export function deleteJSON(filename: string): boolean {
  const filePath = path.join(getDataDir(), filename);
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
    return true;
  } catch (err) {
    console.error(`[Store] 删除 ${filename} 失败:`, err);
    return false;
  }
}
