/**
 * @doubao-studio/contracts
 * 跨进程共享类型契约包 — 仅类型声明，不含运行时 JS。
 *
 * 消费方必须使用 `import type` 导入，禁止普通 import。
 */

export type {
  GenerationMode,
  AccountStatus,
  TaskStatus,
  TaskStage,
  TaskErrorCode,
  VideoModel,
  VideoDuration,
  VideoAspectRatio,
  DependencyPolicy,
} from './enums';
