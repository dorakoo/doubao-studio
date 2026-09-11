import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { classifyGenerationConfirmationText, isGenerationConfirmationTask } from '../../src/utils/generationConfirmation';
import {
  buildVideoPageStructureVersion,
  createVideoReadinessCheckpoint,
  VideoControlReadinessError,
  waitForVideoControlReadiness,
} from '../../src/utils/videoControlReadiness';
import { matchesSubmissionConversation, requiresSubmissionReconciliation } from '../../src/utils/realSendStateMachine';

describe('视频生成参数确认独立状态', () => {
  it.each([
    ['视频生成参数确认：模型 Seedance 2.0 Fast，时长 5s，比例 9:16。确认后我再开始生成视频', 'parameter_confirmation'],
    ['请回复“确认”，我将开始生成视频', 'confirm_before_generation'],
  ])('识别平台确认语义并仅返回结构化摘要', (text, marker) => {
    const result = classifyGenerationConfirmationText(text, '2026-08-27T23:00:00.000Z');
    expect(result).toMatchObject({ state: 'present', marker });
    expect(result).not.toHaveProperty('text');
  });

  it('提取模型、时长、比例但不保存完整页面文本', () => {
    expect(classifyGenerationConfirmationText('视频生成参数确认 模型：Seedance 2.0 Fast 时长：5秒 比例：9:16 确认后开始生成视频')).toMatchObject({
      state: 'present', model: 'Seedance 2.0 Fast', duration: '5秒', aspectRatio: '9:16',
    });
  });

  it('普通提示或普通回复不会误判确认页', () => {
    expect(classifyGenerationConfirmationText('请生成一个商品视频，不需要再次询问').state).toBe('absent');
  });

  it('等待确认任务即使缺 submittedAt 也永久禁止重试发送', () => {
    const task = { status: 'waiting_generation_confirmation', errorInfo: { code: 'generation_confirmation_required' } };
    expect(isGenerationConfirmationTask(task)).toBe(true);
    expect(requiresSubmissionReconciliation(task)).toBe(true);
  });

  it('原会话匹配允许确认页作为平台回执，仍要求提示词稳定前缀', () => {
    const prompt = 'TikTok 商品视频开场，唯一成年女性数字人向镜头介绍猫抓板。';
    expect(matchesSubmissionConversation(prompt, `${prompt} 视频生成参数确认，确认后我再开始生成视频`)).toBe(true);
    expect(matchesSubmissionConversation(prompt, '另一任务 视频生成参数确认，确认后我再开始生成视频')).toBe(false);
  });
});

describe('视频参数控件有界分段等待', () => {
  it('模型与组合控件连续三次稳定后才通过', async () => {
    let now = 0;
    let attempt = 0;
    const snapshots = [
      { modelReady: false, compositeReady: false },
      { modelReady: true, compositeReady: false },
      { modelReady: true, compositeReady: true },
      { modelReady: true, compositeReady: true },
      { modelReady: true, compositeReady: true },
    ];
    const result = await waitForVideoControlReadiness(
      () => snapshots[Math.min(attempt++, snapshots.length - 1)],
      { timeoutMs: 10_000, now: () => now, wait: async (ms) => { now += ms; } },
    );
    expect(result).toMatchObject({ ready: true, attempts: 5 });
    expect(result.modelVisibleAtMs).toBeDefined();
    expect(result.compositeVisibleAtMs).toBeDefined();
    expect(result.stableAtMs).toBe(result.elapsedMs);
  });

  it('中途抖动会重置连续稳定计数', async () => {
    let now = 0;
    let attempt = 0;
    const snapshots = [true, true, false, true, true, true].map((ready) => ({ modelReady: ready, compositeReady: ready }));
    const result = await waitForVideoControlReadiness(
      () => snapshots[Math.min(attempt++, snapshots.length - 1)],
      { timeoutMs: 20_000, now: () => now, wait: async (ms) => { now += ms; } },
    );
    expect(result.ready).toBe(true);
    expect(result.attempts).toBe(6);
  });

  it.each([
    [{ modelReady: false, aspectRatioReady: true, durationReady: true }, 'model', 'model_control'],
    [{ modelReady: true, aspectRatioReady: false, durationReady: true }, 'aspect_ratio', 'aspect_ratio_control'],
    [{ modelReady: true, aspectRatioReady: true, durationReady: false }, 'duration', 'duration_control'],
  ] as const)('缺失权威控件时输出具体失败阶段', async (snapshot, failureStage, missingControl) => {
    let now = 0;
    const result = await waitForVideoControlReadiness(() => snapshot, {
      timeoutMs: 1_000, now: () => now, wait: async (ms) => { now += ms; },
    });
    expect(result).toMatchObject({ ready: false, failureStage, missingControl });
  });

  it('比例和时长必须独立就绪，组合控件不再掩盖具体缺失项', async () => {
    let now = 0;
    const result = await waitForVideoControlReadiness(
      () => ({ modelReady: true, aspectRatioReady: true, durationReady: false, pageVariant: 'composite-v2' }),
      { timeoutMs: 500, now: () => now, wait: async (ms) => { now += ms; } },
    );
    expect(result).toMatchObject({ failureStage: 'duration', pageStructureVersion: 'doubao-video-v2:composite-v2:m1r1d0' });
  });

  it('结构版本只由白名单能力位生成，不接受页面文本', () => {
    const version = buildVideoPageStructureVersion({ modelReady: true, aspectRatioReady: false, durationReady: true, pageVariant: 'composite-v2' });
    expect(version).toBe('doubao-video-v2:composite-v2:m1r0d1');
    expect(version).not.toMatch(/prompt|cookie|session|D:\\|https?:/i);
  });

  it.each(['account', 'new_conversation', 'video_entry', 'model', 'aspect_ratio', 'duration', 'assets', 'prompt', 'submission_controls'] as const)(
    '九阶段检查点 %s 使用统一 schema 且不包含业务正文', (stage) => {
      const checkpoint = createVideoReadinessCheckpoint(stage, { elapsedMs: 123, recoveryAttempts: 1 });
      expect(checkpoint).toMatchObject({ schemaVersion: 1, currentStage: stage, elapsedMs: 123, recoveryAttempts: 1 });
      expect(JSON.stringify(checkpoint)).not.toMatch(/提示词|素材路径|cookie|token|session/i);
    },
  );

  it('指数退避有上限且总等待受 timeout 约束', async () => {
    let now = 0;
    const delays: number[] = [];
    const result = await waitForVideoControlReadiness(
      () => ({ modelReady: false, compositeReady: false }),
      { timeoutMs: 5_000, now: () => now, wait: async (ms) => { delays.push(ms); now += ms; } },
    );
    expect(result.ready).toBe(false);
    expect(Math.max(...delays)).toBeLessThanOrEqual(2_000);
    expect(delays.reduce((sum, value) => sum + value, 0)).toBe(5_000);
  });

  it.each([
    ['mode_entry', 'video_mode_entry_not_ready'],
    ['model_control', 'video_model_control_not_ready'],
    ['composite_control', 'video_aspect_ratio_control_not_ready'],
    ['duration', 'video_duration_control_not_ready'],
    ['submission_controls', 'video_submission_controls_not_ready'],
    ['stable_readback', 'video_stable_readback_not_ready'],
    ['final_readback', 'video_final_readback_not_ready'],
  ] as const)(
    '错误 %s 为机器可读阶段码且明确提交前停止', (stage, code) => {
      const error = new VideoControlReadinessError(stage, { ready: false, failureStage: stage, attempts: 3, elapsedMs: 1000 });
      expect(error.code).toBe(code);
      expect(error.message).toContain('已在提交前停止');
    },
  );
});

describe('源码安全边界', () => {
  const bridge = readFileSync(resolve(__dirname, '../../src/utils/doubaoBridge.ts'), 'utf8');
  const panel = readFileSync(resolve(__dirname, '../../src/components/BrowserPanel.tsx'), 'utf8');

  it('确认检测函数只读且执行器不发送“确认”', () => {
    const start = bridge.indexOf('export async function inspectGenerationConfirmation');
    const end = bridge.indexOf('export const VIDEO_MODEL_CONTROL_SELECTOR', start);
    expect(bridge.slice(start, end)).not.toMatch(/\.click\(|sendInputEvent|type_text|回复确认/);
    expect(panel).toContain("status: 'waiting_generation_confirmation'");
    expect(panel).toContain("code: 'generation_confirmation_required'");
  });

  it('只读恢复必须持有原会话 URL，且不得调用注入或提交函数', () => {
    const start = panel.indexOf('const handleSubmissionReconcile');
    const end = panel.indexOf("window.addEventListener('reconcile-task-submission'", start);
    const body = panel.slice(start, end);
    expect(body).toContain('resolveTaskConversationTarget(task)');
    expect(body).toContain('openTaskConversation(webview, conversationTarget.url');
    expect(body).toContain('const conversationUrl = conversationTarget.url');
    expect(body).not.toContain('currentIsConcreteChat');
    expect(body).not.toContain('injectPrompt(');
    expect(body).not.toContain('submitPromptWithNativeClick(');
    expect(body).not.toContain('startNewConversation(');
  });

  it('提交前恢复严格限制一次，提交后不走配置恢复分支', () => {
    expect(panel).toContain('videoReadinessRecoveryAttempts >= 1');
    expect(panel).toContain("if (!submissionMarkedAt)");
    const recoveryStart = panel.indexOf('仅在尚未产生提交意图时允许一次页面重绘恢复');
    const submissionStart = panel.indexOf("const markSubmissionIntent", recoveryStart);
    expect(recoveryStart).toBeGreaterThan(-1);
    expect(submissionStart).toBeGreaterThan(recoveryStart);
  });

  it('提交不确定仍走安全暂停且只有明确回读才进入 generating', () => {
    expect(panel).toContain("throw new SubmissionSafetyPauseError('发送状态不确定");
    expect(panel).toContain("classifySubmissionReadback(evidence) === 'confirmed'");
    const confirmationGuard = panel.indexOf("if (!submissionConfirmed)");
    expect(confirmationGuard).toBeGreaterThan(-1);
    expect(confirmationGuard).toBeLessThan(panel.indexOf("'generating'", confirmationGuard));
  });
});
