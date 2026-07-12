/**
 * scripts/fixtures/contracts-valid.ts
 *
 * Fixture: 合法的 @doubao-studio/contracts 导入/导出
 * 预期：scanContractsImports 返回 0 个 C003 错误。
 */

import type { GenerationMode } from '@doubao-studio/contracts';

export type { AccountStatus } from '@doubao-studio/contracts';

export interface TestWrapper {
  mode: GenerationMode;
}
