/** 距离本机下一个自然日 00:00 的毫秒数。 */
export function millisecondsUntilNextLocalMidnight(now: Date = new Date()): number {
  const next = new Date(now);
  next.setHours(24, 0, 0, 0);
  return Math.max(1, next.getTime() - now.getTime());
}
