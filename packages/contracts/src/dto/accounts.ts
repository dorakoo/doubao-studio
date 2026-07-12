/**
 * @doubao-studio/contracts — 账号 IPC DTO
 *
 * 账号管理 IPC 的参数和返回值类型。
 * 复用 domain 中的领域模型，不引入运行时值。
 */

import type { Account, AccountScheduling } from '../domain';
import type { AccountStatus } from '../enums';

// ==================== 通用返回值 ====================

/** 账号操作简单结果（无数据返回） */
export interface AccountOperationResult {
  success: boolean;
  error?: string;
}

/** 账号操作结果（包含账号数据） */
export interface AccountResult {
  success: boolean;
  account?: Account;
  error?: string;
}

// ==================== IPC 参数 DTO ====================

export interface AccountAddParams {
  name: string;
}

export interface AccountUpdateParams {
  id: string;
  name: string;
}

export interface AccountIdParams {
  id: string;
}

export interface AccountSetStatusParams {
  id: string;
  status: AccountStatus;
}

export interface AccountSetPinnedParams {
  id: string;
  pinned: boolean;
}

export interface AccountUpdateSeedanceQuotaParams {
  id: string;
  action: 'consume' | 'exhausted';
  units?: number;
}

/** 账号健康状态更新动作 */
export type AccountHealthAction = 'success' | 'failure' | 'verification' | 'login_expired' | 'clear';

export interface AccountUpdateHealthParams {
  id: string;
  action: AccountHealthAction;
  /**
   * 错误码。保持 string，不收紧为 TaskErrorCode，
   * 因为历史 JSON 和 IPC 传入的值可能包含未知错误码。
   */
  errorCode?: string;
}

export interface AccountUpdateSchedulingParams {
  id: string;
  updates: Partial<AccountScheduling>;
}
