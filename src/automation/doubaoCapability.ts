export const DOUBAO_CAPABILITY_ADAPTER_VERSION = '2.0.0-20260731';

export type CapabilityAvailability = 'visible' | 'selectable' | 'action_required' | 'unknown';

export interface DoubaoCapabilitySnapshot {
  observed_at: string;
  account_tier: string;
  source: { kind: 'page'; url: string };
  adapter_version: string;
  status: 'observed' | 'partial' | 'unknown';
  entries: string[];
  video: {
    models: string[];
    durations: number[];
    aspect_ratios: string[];
  };
  image: {
    models: string[];
    aspect_ratios: string[];
  };
  membership: {
    availability: CapabilityAvailability;
    evidence: string[];
  };
}

export interface CapabilityObservation {
  pageUrl: string;
  bodyText: string;
  observedAt?: string;
  accountTier?: string;
  membershipDialogText?: string;
}

const VIDEO_MODELS = ['Seedance 2.5', 'Seedance 2.0 Fast', 'Seedance 2.0 Mini', 'Seedance 2.0'];
const IMAGE_MODELS = ['Seedream 5.0 Pro', 'Seedream 5.0 Lite', 'Seedream 4.5', 'Seedream 4.0'];
const VIDEO_RATIOS = ['3:4', '4:3', '9:16', '16:9', '1:1', '21:9'];
const IMAGE_RATIOS = ['9:16', '2:3', '3:4', '1:1', '4:3', '3:2', '16:9'];
const ENTRY_LABELS = ['快速', '视频生成', '图像生成', 'PPT', '写作', '翻译', '深入研究', '录音转写', '更多'];
const MEMBERSHIP_PATTERN = /购买会员|开通会员|升级会员|会员专享|仅限会员|权益不足/;

function visibleLabels(text: string, candidates: readonly string[]): string[] {
  return candidates.filter((label) => text.includes(label));
}

export function buildDoubaoCapabilitySnapshot(observation: CapabilityObservation): DoubaoCapabilitySnapshot {
  const bodyText = observation.bodyText || '';
  const dialogText = observation.membershipDialogText || '';
  const durationMatches = Array.from(bodyText.matchAll(/(?:^|\D)(1[0-5]|[4-9])\s*(?:秒|s)(?=$|\D)/gi));
  const durations = [...new Set(durationMatches.map((match) => Number(match[1])))].sort((a, b) => a - b);
  const membershipEvidence = [dialogText, bodyText]
    .filter((text) => MEMBERSHIP_PATTERN.test(text))
    .map((text) => text.match(MEMBERSHIP_PATTERN)?.[0] || '会员动作');
  const entries = visibleLabels(bodyText, ENTRY_LABELS);
  const videoModels = visibleLabels(bodyText, VIDEO_MODELS);
  const imageModels = visibleLabels(bodyText, IMAGE_MODELS);
  const videoRatios = visibleLabels(bodyText, VIDEO_RATIOS);
  const imageRatios = visibleLabels(bodyText, IMAGE_RATIOS);
  const evidenceCount = entries.length + videoModels.length + imageModels.length + durations.length;

  return {
    observed_at: observation.observedAt || new Date().toISOString(),
    account_tier: observation.accountTier?.trim() || 'unknown',
    source: { kind: 'page', url: observation.pageUrl },
    adapter_version: DOUBAO_CAPABILITY_ADAPTER_VERSION,
    status: evidenceCount === 0 ? 'unknown' : evidenceCount < 4 ? 'partial' : 'observed',
    entries,
    video: { models: videoModels, durations, aspect_ratios: videoRatios },
    image: { models: imageModels, aspect_ratios: imageRatios },
    membership: {
      availability: membershipEvidence.length > 0 ? 'action_required' : 'unknown',
      evidence: [...new Set(membershipEvidence)],
    },
  };
}

export function evaluateDryRunSelection(
  snapshot: DoubaoCapabilitySnapshot,
  requested: { model: string; duration: number; aspectRatio: string },
): { ok: boolean; code: 'ready' | 'membership_required' | 'ui_unsupported'; finalSubmit: false } {
  if (requested.duration >= 11 && snapshot.membership.availability !== 'selectable') {
    return { ok: false, code: 'membership_required', finalSubmit: false };
  }
  const known = snapshot.video.models.includes(requested.model)
    && snapshot.video.durations.includes(requested.duration)
    && snapshot.video.aspect_ratios.includes(requested.aspectRatio);
  return { ok: known, code: known ? 'ready' : 'ui_unsupported', finalSubmit: false };
}
