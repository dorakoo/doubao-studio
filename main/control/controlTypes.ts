export type ControlTaskAction = 'start' | 'pause' | 'cancel' | 'retry';

export interface ControlTaskCommand {
  commandId: string;
  requestId: string;
  action: ControlTaskAction;
  projectId: string;
  batchId: string;
  taskId: string;
}

export interface ControlCommandResult {
  commandId: string;
  ok: boolean;
  code: string;
  accepted?: boolean;
}
