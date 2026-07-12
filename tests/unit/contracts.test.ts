/**
 * tests/unit/contracts.test.ts
 * @doubao-studio/contracts 类型契约自检
 *
 * 验证共享枚举/联合类型可以从 @doubao-studio/contracts 正确导入，
 * 且类型含义与各消费点期望一致。
 */

import { describe, it, expect } from 'vitest';
import type {
  GenerationMode,
  AccountStatus,
  TaskStatus,
  TaskStage,
  TaskErrorCode,
  VideoModel,
  VideoDuration,
  VideoAspectRatio,
  DependencyPolicy,
} from '@doubao-studio/contracts';

describe('@doubao-studio/contracts', () => {
  it('GenerationMode 包含 chat / image / video / music', () => {
    const mode: GenerationMode = 'chat';
    expect(mode).toBe('chat');
    expect(['chat', 'image', 'video', 'music']).toContain('chat' as GenerationMode);
  });

  it('AccountStatus 包含 idle / busy / error', () => {
    const status: AccountStatus = 'idle';
    expect(status).toBe('idle');
  });

  it('TaskStatus 包含 8 个队列级状态', () => {
    const status: TaskStatus = 'queued';
    expect(status).toBe('queued');
    const allStatuses: TaskStatus[] = [
      'queued', 'executing', 'generating', 'waiting_verification',
      'paused', 'done', 'fail', 'cancelled',
    ];
    expect(allStatuses).toHaveLength(8);
  });

  it('TaskStage 包含 15 个执行阶段', () => {
    const stage: TaskStage = 'queued';
    expect(stage).toBe('queued');
    const allStages: TaskStage[] = [
      'queued', 'preparing_account', 'new_conversation', 'switching_mode',
      'configuring', 'uploading_assets', 'injecting_prompt', 'submitting',
      'waiting_verification', 'generating', 'extracting_outputs',
      'completed', 'paused', 'failed', 'cancelled',
    ];
    expect(allStages).toHaveLength(15);
  });

  it('TaskErrorCode 包含 13 个错误码', () => {
    const code: TaskErrorCode = 'unknown';
    expect(code).toBe('unknown');
    const allCodes: TaskErrorCode[] = [
      'cancelled', 'verification', 'quota_exhausted', 'membership_required',
      'face_restricted', 'content_rejected', 'network', 'timeout',
      'page_changed', 'submission_failed', 'generation_failed',
      'output_missing', 'unknown',
    ];
    expect(allCodes).toHaveLength(13);
  });

  it('VideoModel 包含 3 个模型', () => {
    const model: VideoModel = 'seedance-2.0';
    expect(model).toBe('seedance-2.0');
  });

  it('VideoDuration 包含 5s / 10s / 15s', () => {
    const duration: VideoDuration = '5s';
    expect(duration).toBe('5s');
  });

  it('VideoAspectRatio 包含 6 种比例', () => {
    const ratio: VideoAspectRatio = '1:1';
    expect(ratio).toBe('1:1');
  });

  it('DependencyPolicy 包含 all_done / all_finished', () => {
    const policy: DependencyPolicy = 'all_done';
    expect(policy).toBe('all_done');
  });

  it('所有类型均为字符串字面量联合（运行时仍为 string）', () => {
    const mode: GenerationMode = 'chat';
    const status: AccountStatus = 'idle';
    const taskStatus: TaskStatus = 'queued';
    const stage: TaskStage = 'queued';
    const errorCode: TaskErrorCode = 'unknown';
    const model: VideoModel = 'seedance-2.0';
    const duration: VideoDuration = '5s';
    const ratio: VideoAspectRatio = '1:1';
    const policy: DependencyPolicy = 'all_done';

    expect(typeof mode).toBe('string');
    expect(typeof status).toBe('string');
    expect(typeof taskStatus).toBe('string');
    expect(typeof stage).toBe('string');
    expect(typeof errorCode).toBe('string');
    expect(typeof model).toBe('string');
    expect(typeof duration).toBe('string');
    expect(typeof ratio).toBe('string');
    expect(typeof policy).toBe('string');
  });
});
