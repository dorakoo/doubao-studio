export function clampSidebarWidth(width: number, min = 280, max = 500): number {
  return Math.min(max, Math.max(min, width));
}

export function calculateSidebarSplitRatio(
  pointerY: number,
  containerTop: number,
  containerHeight: number,
  min = 0.2,
  max = 0.7,
): number {
  if (!Number.isFinite(containerHeight) || containerHeight <= 0) return min;
  return Math.min(max, Math.max(min, (pointerY - containerTop) / containerHeight));
}

