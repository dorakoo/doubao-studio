/**
 * scripts/fixtures/contracts-violations.ts
 *
 * Fixture: 违规的 @doubao-studio/contracts 导入/导出
 * 预期：scanContractsImports 返回 3 个 C003 错误：
 *   1. 普通 import { X }
 *   2. 成员级 type import { type X }
 *   3. 普通 re-export { X }
 */

import { GenerationMode } from '@doubao-studio/contracts';
import { type AccountStatus } from '@doubao-studio/contracts';
export { TaskStatus } from '@doubao-studio/contracts';
