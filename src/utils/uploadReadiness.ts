export interface UploadReadinessSnapshot {
  inputFileCount: number;
  visibleAttachmentCount: number;
  matchingFileNameCount: number;
  pending: boolean;
}

/** 上传必须数量足够、无进行中标记，并连续多次保持稳定。 */
export function isUploadSnapshotReady(
  snapshot: UploadReadinessSnapshot,
  expectedCount: number,
  baselineAttachmentCount: number,
): boolean {
  const observedCount = Math.max(
    snapshot.inputFileCount,
    snapshot.matchingFileNameCount,
    Math.max(0, snapshot.visibleAttachmentCount - baselineAttachmentCount),
  );
  return expectedCount > 0 && observedCount >= expectedCount && !snapshot.pending;
}

export function nextStableUploadCount(
  previous: number,
  snapshot: UploadReadinessSnapshot,
  expectedCount: number,
  baselineAttachmentCount: number,
): number {
  return isUploadSnapshotReady(snapshot, expectedCount, baselineAttachmentCount) ? previous + 1 : 0;
}
