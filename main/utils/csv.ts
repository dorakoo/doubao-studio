/**
 * main/utils/csv.ts
 * CSV 解析纯函数 — 不依赖 Electron/Node 运行时
 */

import type { GenerationMode } from '../ipc/tasks';

/**
 * 解析 CSV 文本为二维数组。
 * 支持：双引号包裹、转义引号（""）、逗号分隔、\r\n 和 \n 换行。
 * 空行（仅含空白）会被跳过。
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (char === '"') {
      if (quoted && text[index + 1] === '"') {
        field += '"';
        index++;
      } else {
        quoted = !quoted;
      }
    } else if (char === ',' && !quoted) {
      row.push(field.trim());
      field = '';
    } else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && text[index + 1] === '\n') index++;
      row.push(field.trim());
      field = '';
      if (row.some(Boolean)) rows.push(row);
      row = [];
    } else {
      field += char;
    }
  }
  row.push(field.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

/**
 * 将 CSV 中的模式字段值标准化为 GenerationMode。
 * 支持 image/图片、video/视频、music/音乐，其余归为 chat。
 */
export function normalizeCsvMode(value: string): GenerationMode {
  const normalized = value.trim().toLowerCase();
  if (['image', '图片'].includes(normalized)) return 'image';
  if (['video', '视频'].includes(normalized)) return 'video';
  if (['music', '音乐'].includes(normalized)) return 'music';
  return 'chat';
}
