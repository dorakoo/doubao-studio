import { randomUUID } from 'crypto';

export interface TaskEvent {
  sequence: number;
  eventId: string;
  taskId: string;
  timestamp: string;
  eventType: string;
  payload?: Record<string, unknown>;
}

export type TaskEventListener = (event: TaskEvent) => void;

/**
 * 进程内 v1 任务事件流。
 *
 * 本阶段只建立 Core 事件边界，不承诺跨进程持久化。后续 CLI/API 可使用
 * after(sequence) 作为游标读取接口，而不需要观察 Zustand 或 JSON 文件。
 */
export class TaskEventStream {
  readonly version = 1;
  private sequence = 0;
  private readonly events: TaskEvent[] = [];
  private readonly listeners = new Set<TaskEventListener>();

  constructor(private readonly capacity = 2_000) {
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new Error('TaskEventStream capacity 必须为正整数');
    }
  }

  publish(taskId: string, eventType: string, payload?: Record<string, unknown>): TaskEvent {
    if (!taskId.trim() || !eventType.trim()) throw new Error('taskId 和 eventType 不能为空');
    const event: TaskEvent = {
      sequence: ++this.sequence,
      eventId: `evt_${randomUUID()}`,
      taskId,
      timestamp: new Date().toISOString(),
      eventType,
      ...(payload ? { payload } : {}),
    };
    this.events.push(event);
    if (this.events.length > this.capacity) this.events.splice(0, this.events.length - this.capacity);
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (error) {
        console.error('[TaskEventStream] 订阅者处理失败:', error);
      }
    }
    return event;
  }

  after(lastSequence = 0): TaskEvent[] {
    if (!Number.isInteger(lastSequence) || lastSequence < 0) throw new Error('lastSequence 必须为非负整数');
    return this.events.filter((event) => event.sequence > lastSequence).map((event) => structuredClone(event));
  }

  subscribe(listener: TaskEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
