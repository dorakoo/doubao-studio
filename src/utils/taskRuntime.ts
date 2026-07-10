import type { TaskErrorCode, TaskErrorInfo } from '../types';

const ERROR_RULES: Array<{ code: TaskErrorCode; recoverable: boolean; pattern: RegExp }> = [
  { code: 'cancelled', recoverable: true, pattern: /取消|中止|abort/i },
  { code: 'quota_exhausted', recoverable: false, pattern: /免费次数.*用完|次数已用完|次数不足|余额不足|权益不足/ },
  { code: 'membership_required', recoverable: true, pattern: /会员专享|仅限会员|开通会员|升级会员/ },
  { code: 'face_restricted', recoverable: true, pattern: /真人脸|人脸素材|肖像保护|人物面部/ },
  { code: 'content_rejected', recoverable: true, pattern: /内容未通过|审核未通过|违规|无法生成/ },
  { code: 'verification', recoverable: true, pattern: /机器人验证|安全验证|验证码|滑块/ },
  { code: 'output_missing', recoverable: true, pattern: /产物.*超时|下载地址|可下载地址|产物尚未/ },
  { code: 'submission_failed', recoverable: true, pattern: /提交失败|提交超时|发送失败/ },
  { code: 'page_changed', recoverable: true, pattern: /未找到|配置.*失败|注入失败|切换.*失败|创建新对话失败/ },
  { code: 'network', recoverable: true, pattern: /network|fetch|连接|网络|ERR_/i },
  { code: 'timeout', recoverable: true, pattern: /超时|timeout/i },
  { code: 'generation_failed', recoverable: true, pattern: /生成失败|生成异常|豆包已停止生成/ },
];

export function classifyTaskError(message: string): TaskErrorInfo {
  const matched = ERROR_RULES.find((rule) => rule.pattern.test(message));
  return {
    code: matched?.code || 'unknown',
    message,
    recoverable: matched?.recoverable ?? true,
    detectedAt: new Date().toISOString(),
  };
}
