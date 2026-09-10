import type { GenerationMode, Task, TaskRunSnapshot } from '../types';
import type { SubmissionReadback } from './realSendStateMachine';

export type AcceptanceObservation = NonNullable<TaskRunSnapshot['acceptanceObservation']>;

const DEFAULT_LEASE_MS = 60_000;

export function createAcceptedObservationBinding(input: {
  accountId: string;
  runId: string;
  conversationUrl: string;
  acceptedAt: string;
  ownerId: string;
  mode: GenerationMode;
  evidence: SubmissionReadback;
  generationStartedAt?: number;
  materialAuthorizationConfirmed?: boolean;
  leaseMs?: number;
}): AcceptanceObservation {
  const acceptedMs = new Date(input.acceptedAt).getTime();
  const leaseMs = Math.max(15_000, input.leaseMs ?? DEFAULT_LEASE_MS);
  const kind = input.materialAuthorizationConfirmed
    ? 'material_authorization_confirmed'
    : input.evidence.generationStarted
      ? 'generation_started'
      : 'prompt_published';
  return {
    schemaVersion: 1,
    accountId: input.accountId,
    runId: input.runId,
    conversationUrl: input.conversationUrl,
    acceptedAt: input.acceptedAt,
    evidence: {
      kind,
      messageCount: Math.max(0, input.evidence.messageCount),
      generationStartedAt: input.generationStartedAt && input.generationStartedAt > 0
        ? input.generationStartedAt
        : undefined,
    },
    cursor: {
      messageCount: Math.max(0, input.evidence.messageCount),
      generationStartedAt: input.generationStartedAt && input.generationStartedAt > 0
        ? input.generationStartedAt
        : undefined,
      pollCount: 0,
    },
    expectedArtifact: {
      kind: input.mode === 'video' ? 'video' : input.mode === 'image' ? 'image' : 'file',
      runId: input.runId,
    },
    lease: {
      ownerId: input.ownerId,
      acquiredAt: input.acceptedAt,
      expiresAt: new Date(acceptedMs + leaseMs).toISOString(),
      lastHeartbeatAt: input.acceptedAt,
    },
    outcome: 'observing',
  };
}

export function hasPlatformAcceptance(task: Pick<Task, 'status' | 'runtime'>): boolean {
  if (task.status === 'done') return true;
  const binding = task.runtime?.acceptanceObservation;
  return Boolean(
    binding &&
    binding.schemaVersion === 1 &&
    binding.outcome === 'observing' &&
    binding.runId === task.runtime?.runId &&
    binding.accountId &&
    binding.conversationUrl,
  );
}

export function shouldResumeAcceptedObservation(task: Pick<Task, 'status' | 'runtime'>): boolean {
  return task.status === 'generating' && hasPlatformAcceptance(task);
}

export function renewObservationLease(binding: AcceptanceObservation, now: string, ttlMs = DEFAULT_LEASE_MS): AcceptanceObservation {
  return {
    ...binding,
    cursor: { ...binding.cursor, pollCount: binding.cursor.pollCount + 1 },
    lease: {
      ...binding.lease,
      lastHeartbeatAt: now,
      expiresAt: new Date(new Date(now).getTime() + Math.max(15_000, ttlMs)).toISOString(),
    },
  };
}

export function completeAcceptedObservation(binding: AcceptanceObservation, artifactId: string, completedAt: string): AcceptanceObservation {
  return {
    ...binding,
    expectedArtifact: { ...binding.expectedArtifact, artifactId },
    lease: { ...binding.lease, lastHeartbeatAt: completedAt, expiresAt: completedAt },
    outcome: 'completed',
    completedAt,
  };
}
