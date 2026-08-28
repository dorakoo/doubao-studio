export interface UploadReadinessSnapshot {
  inputFileCount: number;
  visibleAttachmentCount: number;
  matchingFileNameCount: number;
  pending: boolean;
}

export type UploadReadinessFailure = 'pending' | 'count_incomplete' | 'count_mismatch' | 'unstable';

export interface UploadReadinessDiagnostic {
  attempts: number;
  elapsedMs: number;
  expectedCount: number;
  observedCount: number;
  pending: boolean;
  stableSamples: number;
  failure?: UploadReadinessFailure;
}

export function getObservedUploadCount(snapshot: UploadReadinessSnapshot, baselineAttachmentCount: number): number {
  return Math.max(
    snapshot.inputFileCount,
    snapshot.matchingFileNameCount,
    Math.max(0, snapshot.visibleAttachmentCount - baselineAttachmentCount),
  );
}

/** 上传必须数量足够、无进行中标记，并连续多次保持稳定。 */
export function isUploadSnapshotReady(
  snapshot: UploadReadinessSnapshot,
  expectedCount: number,
  baselineAttachmentCount: number,
): boolean {
  const observedCount = getObservedUploadCount(snapshot, baselineAttachmentCount);
  return expectedCount > 0 && observedCount === expectedCount && !snapshot.pending;
}

export function classifyUploadReadinessFailure(
  snapshot: UploadReadinessSnapshot,
  expectedCount: number,
  baselineAttachmentCount: number,
): UploadReadinessFailure | undefined {
  const observed = getObservedUploadCount(snapshot, baselineAttachmentCount);
  if (snapshot.pending) return 'pending';
  if (observed < expectedCount) return 'count_incomplete';
  if (observed > expectedCount) return 'count_mismatch';
  return undefined;
}

export function nextStableUploadCount(
  previous: number,
  snapshot: UploadReadinessSnapshot,
  expectedCount: number,
  baselineAttachmentCount: number,
): number {
  return isUploadSnapshotReady(snapshot, expectedCount, baselineAttachmentCount) ? previous + 1 : 0;
}
