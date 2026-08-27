export type VideoControlReadinessStage =
  | 'mode_entry'
  | 'model_control'
  | 'composite_control'
  | 'stable_readback'
  | 'final_readback';

export interface VideoControlProbe {
  modelReady: boolean;
  compositeReady: boolean;
}

export interface VideoControlReadinessResult {
  ready: boolean;
  failureStage?: VideoControlReadinessStage;
  attempts: number;
  elapsedMs: number;
  modelVisibleAtMs?: number;
  compositeVisibleAtMs?: number;
  stableAtMs?: number;
}

export class VideoControlReadinessError extends Error {
  readonly code: string;
  readonly diagnostic: VideoControlReadinessResult;

  constructor(stage: VideoControlReadinessStage, diagnostic: VideoControlReadinessResult) {
    const code = `video_${stage}_not_ready`;
    super(`${code}: ${stage} 未在有界等待内就绪（${diagnostic.elapsedMs}ms/${diagnostic.attempts}次），已在提交前停止`);
    this.name = 'VideoControlReadinessError';
    this.code = code;
    this.diagnostic = { ...diagnostic, ready: false, failureStage: stage };
  }
}

/** 有界指数退避；模型与组合控件需连续三次同时就绪。 */
export async function waitForVideoControlReadiness(
  probe: () => VideoControlProbe | Promise<VideoControlProbe>,
  options: {
    timeoutMs?: number;
    stableSamples?: number;
    now?: () => number;
    wait?: (ms: number) => Promise<void>;
  } = {},
): Promise<VideoControlReadinessResult> {
  const timeoutMs = options.timeoutMs ?? 30_000;
  const stableSamples = options.stableSamples ?? 3;
  const now = options.now ?? Date.now;
  const wait = options.wait ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const startedAt = now();
  let attempts = 0;
  let stable = 0;
  let modelVisibleAtMs: number | undefined;
  let compositeVisibleAtMs: number | undefined;

  while (now() - startedAt <= timeoutMs) {
    attempts += 1;
    const snapshot = await probe();
    const elapsedMs = Math.max(0, now() - startedAt);
    if (snapshot.modelReady && modelVisibleAtMs === undefined) modelVisibleAtMs = elapsedMs;
    if (snapshot.compositeReady && compositeVisibleAtMs === undefined) compositeVisibleAtMs = elapsedMs;
    stable = snapshot.modelReady && snapshot.compositeReady ? stable + 1 : 0;
    if (stable >= stableSamples) {
      return { ready: true, attempts, elapsedMs, modelVisibleAtMs, compositeVisibleAtMs, stableAtMs: elapsedMs };
    }
    const remaining = timeoutMs - elapsedMs;
    if (remaining <= 0) break;
    const delay = Math.min(2_000, 250 * (2 ** Math.min(attempts - 1, 3)), remaining);
    await wait(delay);
  }

  const elapsedMs = Math.max(0, now() - startedAt);
  const failureStage: VideoControlReadinessStage = modelVisibleAtMs === undefined
    ? 'model_control'
    : compositeVisibleAtMs === undefined
      ? 'composite_control'
      : 'stable_readback';
  return { ready: false, failureStage, attempts, elapsedMs, modelVisibleAtMs, compositeVisibleAtMs };
}
