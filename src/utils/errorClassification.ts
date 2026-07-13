/**
 * src/utils/errorClassification.ts
 * 任务错误分类纯函数 — 不依赖 DOM/React/Electron 运行时
 */

import type { TaskErrorCode, TaskErrorInfo } from '../types';

const ERROR_RULES: Array<{ code: TaskErrorCode; recoverable: boolean; pattern: RegExp }> = [
  { code: 'cancelled', recoverable: true, pattern: /取消|中止|abort/i },
  { code: 'quota_exhausted', recoverable: false, pattern: /免费次数.*用完|次数已用完|次数不足|余额不足|权益不足/ },
  // 会员限制不可恢复：同一账号同一配置重试仍会被拒绝，需更换配置或升级会员。
  { code: 'membership_required', recoverable: false, pattern: /会员专享|仅限会员|仅会员可用|开通会员|升级会员|当前模型仅限会员|暂不支持/ },
  // 同一批真人脸素材再次提交通常仍会被平台拦截，需修改素材或提示词后再重新运行。
  { code: 'face_restricted', recoverable: false, pattern: /真人脸|人脸素材|肖像保护|人物面部/ },
  { code: 'content_rejected', recoverable: true, pattern: /内容未通过|审核未通过|违规|无法生成/ },
  { code: 'verification', recoverable: true, pattern: /机器人验证|安全验证|验证码|滑块/ },
  { code: 'output_missing', recoverable: true, pattern: /产物.*超时|下载地址|可下载地址|产物尚未/ },
  { code: 'submission_failed', recoverable: true, pattern: /提交失败|提交超时|发送失败/ },
  { code: 'page_changed', recoverable: true, pattern: /未找到|配置.*失败|注入失败|切换.*失败|创建新对话失败/ },
  { code: 'network', recoverable: true, pattern: /network|fetch|连接|网络|ERR_/i },
  { code: 'timeout', recoverable: true, pattern: /超时|timeout/i },
  { code: 'generation_failed', recoverable: true, pattern: /生成失败|生成异常|豆包已停止生成/ },
];

/**
 * 根据错误消息分类任务错误类型。
 * @param message 错误消息原文
 * @param now 当前时间 ISO 字符串，默认 new Date().toISOString()，测试时可注入
 */
export function classifyTaskError(message: string, now: string = new Date().toISOString()): TaskErrorInfo {
  const matched = ERROR_RULES.find((rule) => rule.pattern.test(message));
  return {
    code: matched?.code || 'unknown',
    message,
    recoverable: matched?.recoverable ?? true,
    detectedAt: now,
  };
}
