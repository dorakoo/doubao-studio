/**
 * main/utils/version.ts
 * 版本号比较纯函数 — 不依赖 Electron/Node 运行时
 */

/**
 * 比较两个点分版本号。
 * @returns 正数表示 left > right，负数表示 left < right，0 表示相等。
 */
export function compareVersions(left: string, right: string): number {
  const a = left.split('.').map((part) => Number(part) || 0);
  const b = right.split('.').map((part) => Number(part) || 0);
  for (let index = 0; index < Math.max(a.length, b.length); index++) {
    if ((a[index] || 0) !== (b[index] || 0)) return (a[index] || 0) - (b[index] || 0);
  }
  return 0;
}
