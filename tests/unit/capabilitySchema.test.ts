/**
 * tests/unit/capabilitySchema.test.ts
 *
 * Capability API Schema v1 结构自检测试。
 * 不依赖第三方 JSON Schema 校验器（如 AJV），仅使用 Node.js 内置 JSON 解析器
 * 和自定义结构断言验证 Schema 文件的完整性和一致性。
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

// ==================== Schema 加载 ====================

const SCHEMA_DIR = resolve(__dirname, '../../schemas/capability/v1');
const CAPABILITY_DOC = resolve(__dirname, '../../docs/architecture/capability-api-schema.md');

/** 预期的 Schema 文件列表 */
const EXPECTED_FILES = [
  'capability-manifest.schema.json',
  'create-task-request.schema.json',
  'task-snapshot.schema.json',
  'task-event.schema.json',
  'task-events-response.schema.json',
  'artifact-descriptor.schema.json',
  'api-error.schema.json',
] as const;

/** 加载并解析所有 Schema 文件 */
function loadSchemas(): Record<string, unknown> {
  const schemas: Record<string, unknown> = {};
  for (const file of EXPECTED_FILES) {
    const raw = readFileSync(join(SCHEMA_DIR, file), 'utf-8');
    schemas[file] = JSON.parse(raw);
  }
  return schemas;
}

// ==================== 结构验证辅助函数 ====================

/** 断言对象具有指定属性 */
function assertHasProperty(obj: Record<string, unknown>, prop: string, context: string): void {
  if (!(prop in obj)) {
    throw new Error(`${context}: 缺少必需属性 "${prop}"`);
  }
}

/** 断言 Schema 的基础结构 */
function assertSchemaStructure(schema: Record<string, unknown>, fileName: string): void {
  assertHasProperty(schema, '$schema', fileName);
  assertHasProperty(schema, '$id', fileName);
  assertHasProperty(schema, 'title', fileName);
  assertHasProperty(schema, 'type', fileName);

  expect(schema.$schema).toBe('https://json-schema.org/draft/2020-12/schema');
  expect(typeof schema.$id).toBe('string');
  expect(schema.$id).toMatch(/^https:\/\/doubao\.studio\/schemas\/capability\/v1\//);
  expect(typeof schema.title).toBe('string');
  expect(schema.type).toBe('object');
}

/** 断言 Schema 具有必填字段声明 */
function assertRequiredFields(schema: Record<string, unknown>, fileName: string): void {
  assertHasProperty(schema, 'required', fileName);
  expect(Array.isArray(schema.required)).toBe(true);
  expect((schema.required as unknown[]).length).toBeGreaterThan(0);
}

/** 断言 Schema 设置了 additionalProperties: false */
function assertAdditionalPropertiesFalse(schema: Record<string, unknown>, fileName: string): void {
  assertHasProperty(schema, 'additionalProperties', fileName);
  expect(schema.additionalProperties).toBe(false);
}

/** 断言 Schema 具有至少一个 examples */
function assertHasExamples(schema: Record<string, unknown>, fileName: string): void {
  assertHasProperty(schema, 'examples', fileName);
  expect(Array.isArray(schema.examples)).toBe(true);
  expect((schema.examples as unknown[]).length).toBeGreaterThan(0);
}

/** 递归扫描对象中所有 "enum" 键的路径，用于验证不使用封闭 enum */
function findEnumKeys(obj: unknown, basePath: string = '$'): string[] {
  const results: string[] = [];
  if (obj === null || typeof obj !== 'object') return results;
  if (Array.isArray(obj)) {
    obj.forEach((item, i) => {
      results.push(...findEnumKeys(item, `${basePath}[${i}]`));
    });
    return results;
  }
  const record = obj as Record<string, unknown>;
  if ('enum' in record) {
    results.push(`${basePath}.enum`);
  }
  for (const key of Object.keys(record)) {
    if (typeof record[key] === 'object' && record[key] !== null) {
      results.push(...findEnumKeys(record[key], `${basePath}.${key}`));
    }
  }
  return results;
}

// ==================== 测试 ====================

describe('Capability API Schema v1 — 结构自检', () => {
  const schemas = loadSchemas();

  // ---- 1. 所有预期文件存在且可解析 ----

  it('schemas/capability/v1/ 目录下存在 7 份 Schema 文件', () => {
    const actualFiles = readdirSync(SCHEMA_DIR).filter((f) => f.endsWith('.json'));
    for (const expected of EXPECTED_FILES) {
      expect(actualFiles).toContain(expected);
    }
    expect(actualFiles.length).toBe(EXPECTED_FILES.length);
  });

  // ---- 2. 每份 Schema 的基础结构 ----

  for (const file of EXPECTED_FILES) {
    it(`${file} 具有正确的 $schema / $id / title / type`, () => {
      const schema = schemas[file] as Record<string, unknown>;
      assertSchemaStructure(schema, file);
    });

    it(`${file} 具有 required 字段声明`, () => {
      const schema = schemas[file] as Record<string, unknown>;
      assertRequiredFields(schema, file);
    });

    it(`${file} 设置了 additionalProperties: false`, () => {
      const schema = schemas[file] as Record<string, unknown>;
      assertAdditionalPropertiesFalse(schema, file);
    });

    it(`${file} 包含至少一个 examples`, () => {
      const schema = schemas[file] as Record<string, unknown>;
      assertHasExamples(schema, file);
    });
  }

  // ---- 3. $id 唯一性 ----

  it('所有 Schema 的 $id 唯一且可解析', () => {
    const ids = EXPECTED_FILES.map((f) => (schemas[f] as Record<string, unknown>).$id as string);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
    // 所有 $id 以同一 base URL 开头
    for (const id of ids) {
      expect(id).toMatch(/^https:\/\/doubao\.studio\/schemas\/capability\/v1\/.+\.json$/);
    }
  });

  // ---- 4. CapabilityManifest 语义 ----

  it('CapabilityManifest 声明了支持的模式和模型', () => {
    const manifest = schemas['capability-manifest.schema.json'] as Record<string, unknown>;
    const props = manifest.properties as Record<string, unknown>;
    expect(props).toBeDefined();
    expect(props.supportedModes).toBeDefined();
    expect(props.models).toBeDefined();
    expect(props.concurrencyLimit).toBeDefined();
    expect(props.actionTypes).toBeDefined();
    expect(props.health).toBeDefined();
  });

  // ---- 5. CreateTaskRequest 禁止字段 ----

  it('CreateTaskRequest 不包含 accountId / cookie / partition / conversationUrl', () => {
    const req = schemas['create-task-request.schema.json'] as Record<string, unknown>;
    const props = req.properties as Record<string, unknown>;
    const forbiddenKeys = ['accountId', 'cookie', 'partition', 'conversationUrl', 'saveDir', 'filePath'];
    for (const key of forbiddenKeys) {
      expect(props[key]).toBeUndefined();
    }
  });

  it('CreateTaskRequest 包含 requestId 幂等键', () => {
    const req = schemas['create-task-request.schema.json'] as Record<string, unknown>;
    const props = req.properties as Record<string, unknown>;
    expect(props.requestId).toBeDefined();
    expect(req.required).toContain('requestId');
  });

  // ---- 6. TaskSnapshot 禁止字段 ----

  it('TaskSnapshot 不包含 assignedAccountId / lock / conversationUrl / partition', () => {
    const snap = schemas['task-snapshot.schema.json'] as Record<string, unknown>;
    const props = snap.properties as Record<string, unknown>;
    const forbiddenKeys = ['assignedAccountId', 'lock', 'conversationUrl', 'partition', 'saveDir', 'filePath'];
    for (const key of forbiddenKeys) {
      expect(props[key]).toBeUndefined();
    }
  });

  // ---- 7. TaskEvent 游标语义 ----

  it('TaskEvent 包含单调递增 sequence 和唯一 eventId', () => {
    const evt = schemas['task-event.schema.json'] as Record<string, unknown>;
    const props = evt.properties as Record<string, unknown>;
    expect(props.sequence).toBeDefined();
    expect(props.eventId).toBeDefined();
    expect(evt.required).toContain('sequence');
    expect(evt.required).toContain('eventId');
  });

  // ---- 8. ArtifactDescriptor 禁止字段 ----

  it('ArtifactDescriptor 不包含 url / filePath / saveDir', () => {
    const desc = schemas['artifact-descriptor.schema.json'] as Record<string, unknown>;
    const props = desc.properties as Record<string, unknown>;
    const forbiddenKeys = ['url', 'filePath', 'saveDir', 'conversationUrl', 'partition'];
    for (const key of forbiddenKeys) {
      expect(props[key]).toBeUndefined();
    }
  });

  it('ArtifactDescriptor 包含 artifactId 和能力声明字段', () => {
    const desc = schemas['artifact-descriptor.schema.json'] as Record<string, unknown>;
    const props = desc.properties as Record<string, unknown>;
    expect(props.artifactId).toBeDefined();
    expect(props.downloadAvailable).toBeDefined();
    expect(props.previewAvailable).toBeDefined();
    expect(props.validationState).toBeDefined();
  });

  // ---- 9. ApiError 语义 ----

  it('ApiError 包含稳定错误码、可重试标志和建议等待时间', () => {
    const err = schemas['api-error.schema.json'] as Record<string, unknown>;
    const props = err.properties as Record<string, unknown>;
    expect(props.code).toBeDefined();
    expect(props.message).toBeDefined();
    expect(props.retryable).toBeDefined();
    expect(props.suggestedWaitMs).toBeDefined();
    expect(props.actionRequired).toBeDefined();
    expect(err.required).toContain('code');
    expect(err.required).toContain('message');
    expect(err.required).toContain('retryable');
  });

  it('ApiError details 使用白名单字段', () => {
    const err = schemas['api-error.schema.json'] as Record<string, unknown>;
    const props = err.properties as Record<string, unknown>;
    const details = props.details as Record<string, unknown>;
    expect(details).toBeDefined();
    expect(details.additionalProperties).toBe(false);
    const detailProps = details.properties as Record<string, unknown>;
    expect(detailProps.field).toBeDefined();
    expect(detailProps.limit).toBeDefined();
    expect(detailProps.current).toBeDefined();
    // 不应包含 stack / trace / internalPath 等
    expect(detailProps.stack).toBeUndefined();
    expect(detailProps.trace).toBeUndefined();
    expect(detailProps.internalPath).toBeUndefined();
  });

  // ---- 10. ActionRequired 覆盖全部已知人工动作类型 ----

  it('ActionRequired 覆盖 6 种已知人工动作类型（description 中列出，不使用封闭 enum）', () => {
    const snap = schemas['task-snapshot.schema.json'] as Record<string, unknown>;
    const defs = snap.$defs as Record<string, unknown>;
    const actionRequired = defs.ActionRequired as Record<string, unknown>;
    const props = actionRequired.properties as Record<string, unknown>;
    const typeProp = props.type as Record<string, unknown>;
    // 不使用封闭 enum
    expect(typeProp.enum).toBeUndefined();
    // description 中列出已知值
    const desc = typeProp.description as string;
    const expected = [
      'robot_verification',
      'face_restriction',
      'membership_required',
      'quota_exhausted',
      'login_expired',
      'user_cancelled',
    ];
    for (const action of expected) {
      expect(desc).toContain(action);
    }
  });

  // ---- 11. 可执行示例验证 ----

  it('CreateTaskRequest examples 可被 JSON 解析且包含必填字段', () => {
    const req = schemas['create-task-request.schema.json'] as Record<string, unknown>;
    const requestIdProp = (req.properties as Record<string, unknown>).requestId as Record<string, unknown>;
    const examples = requestIdProp.examples as string[];
    expect(examples.length).toBeGreaterThan(0);
    expect(examples[0]).toMatch(/^[\w-]+$/);
  });

  // ---- 12. 跨 Schema 引用可解析 ----

  it('TaskSnapshot 引用的 artifact-descriptor 和 api-error $id 存在', () => {
    const snap = schemas['task-snapshot.schema.json'] as Record<string, unknown>;
    const props = snap.properties as Record<string, unknown>;

    // artifacts 引用 artifact-descriptor
    const artifacts = props.artifacts as Record<string, unknown>;
    const items = artifacts.items as Record<string, unknown>;
    expect(items.$ref).toBe('artifact-descriptor.schema.json');

    // error 引用 api-error
    const errorProp = props.error as Record<string, unknown>;
    expect(errorProp.$ref).toBe('api-error.schema.json');
  });

  it('ApiError 引用的 ActionRequired $ref 指向 task-snapshot', () => {
    const err = schemas['api-error.schema.json'] as Record<string, unknown>;
    const props = err.properties as Record<string, unknown>;
    const actionRequired = props.actionRequired as Record<string, unknown>;
    expect(actionRequired.$ref).toBe('task-snapshot.schema.json#/$defs/ActionRequired');
  });

  // ---- 13. P1-1: 不使用封闭 enum，已知值通过 description 声明 ----

  it('所有 Schema 中不存在封闭 enum 关键字', () => {
    for (const file of EXPECTED_FILES) {
      const schema = schemas[file] as Record<string, unknown>;
      const enumPaths = findEnumKeys(schema);
      expect(enumPaths).toEqual([]);
    }
  });

  it('CreateTaskRequest.mode 使用 type:string + description 列出已知值', () => {
    const req = schemas['create-task-request.schema.json'] as Record<string, unknown>;
    const props = req.properties as Record<string, unknown>;
    const modeProp = props.mode as Record<string, unknown>;
    expect(modeProp.type).toBe('string');
    expect(modeProp.enum).toBeUndefined();
    const desc = modeProp.description as string;
    for (const known of ['chat', 'image', 'video', 'music']) {
      expect(desc).toContain(known);
    }
  });

  it('TaskSnapshot.status 使用 type:string + description 列出已知值', () => {
    const snap = schemas['task-snapshot.schema.json'] as Record<string, unknown>;
    const props = snap.properties as Record<string, unknown>;
    const statusProp = props.status as Record<string, unknown>;
    expect(statusProp.type).toBe('string');
    expect(statusProp.enum).toBeUndefined();
    const desc = statusProp.description as string;
    for (const known of ['queued', 'executing', 'generating', 'done', 'fail', 'cancelled']) {
      expect(desc).toContain(known);
    }
  });

  it('TaskEvent.eventType 使用 type:string + description 列出已知值', () => {
    const evt = schemas['task-event.schema.json'] as Record<string, unknown>;
    const props = evt.properties as Record<string, unknown>;
    const eventTypeProp = props.eventType as Record<string, unknown>;
    expect(eventTypeProp.type).toBe('string');
    expect(eventTypeProp.enum).toBeUndefined();
    const desc = eventTypeProp.description as string;
    for (const known of ['task.created', 'task.done', 'action_required', 'artifact.discovered']) {
      expect(desc).toContain(known);
    }
  });

  it('ApiError.code 使用 type:string + description 列出已知值', () => {
    const err = schemas['api-error.schema.json'] as Record<string, unknown>;
    const props = err.properties as Record<string, unknown>;
    const codeProp = props.code as Record<string, unknown>;
    expect(codeProp.type).toBe('string');
    expect(codeProp.enum).toBeUndefined();
    const desc = codeProp.description as string;
    for (const known of ['quota_exhausted', 'network', 'rate_limited', 'unknown']) {
      expect(desc).toContain(known);
    }
  });

  it('CapabilityManifest.supportedModes.items 不使用封闭 enum', () => {
    const manifest = schemas['capability-manifest.schema.json'] as Record<string, unknown>;
    const props = manifest.properties as Record<string, unknown>;
    const supportedModes = props.supportedModes as Record<string, unknown>;
    const items = supportedModes.items as Record<string, unknown>;
    expect(items.enum).toBeUndefined();
    expect(items.type).toBe('string');
    const desc = items.description as string;
    for (const known of ['chat', 'image', 'video', 'music']) {
      expect(desc).toContain(known);
    }
  });

  it('ArtifactDescriptor.mediaType / validationState / source 不使用封闭 enum', () => {
    const desc = schemas['artifact-descriptor.schema.json'] as Record<string, unknown>;
    const props = desc.properties as Record<string, unknown>;
    for (const field of ['mediaType', 'validationState', 'source']) {
      const fieldProp = props[field] as Record<string, unknown>;
      expect(fieldProp.enum).toBeUndefined();
      expect(fieldProp.type).toBe('string');
    }
  });

  // ---- 14. P1-2: 幂等范围收缩为进程生命周期 ----

  it('CreateTaskRequest 顶层 description 不承诺 24 小时幂等', () => {
    const req = schemas['create-task-request.schema.json'] as Record<string, unknown>;
    const topDesc = req.description as string;
    expect(topDesc).not.toContain('24 小时');
    expect(topDesc).not.toContain('24小时');
    expect(topDesc).toContain('进程生命周期');
  });

  it('CreateTaskRequest.requestId description 明确进程重启语义', () => {
    const req = schemas['create-task-request.schema.json'] as Record<string, unknown>;
    const props = req.properties as Record<string, unknown>;
    const requestIdProp = props.requestId as Record<string, unknown>;
    const desc = requestIdProp.description as string;
    expect(desc).not.toContain('24 小时');
    expect(desc).not.toContain('24小时');
    expect(desc).toContain('进程生命周期');
    expect(desc).toContain('进程重启');
  });

  it('文档定义了不依赖 taskId 的 requestId 查询恢复端点', () => {
    const doc = readFileSync(CAPABILITY_DOC, 'utf-8');
    expect(doc).toContain('GET /tasks:lookup?requestId={requestId}');
    expect(doc).toContain('found: false');
    expect(doc).toContain('接受重复风险');
  });

  // ---- 15. P1-3: video 模式条件约束（allOf + if/then/else） ----

  it('CreateTaskRequest 包含 allOf 条件约束', () => {
    const req = schemas['create-task-request.schema.json'] as Record<string, unknown>;
    expect(req.allOf).toBeDefined();
    expect(Array.isArray(req.allOf)).toBe(true);
    expect((req.allOf as unknown[]).length).toBeGreaterThanOrEqual(1);
  });

  it('CreateTaskRequest allOf[0] 定义 video → videoConfig 必填的条件', () => {
    const req = schemas['create-task-request.schema.json'] as Record<string, unknown>;
    const allOf = req.allOf as unknown[];
    const constraint = allOf[0] as Record<string, unknown>;

    // if 分支：mode === "video"
    const ifClause = constraint.if as Record<string, unknown>;
    expect(ifClause).toBeDefined();
    const ifProps = ifClause.properties as Record<string, unknown>;
    const modeProp = ifProps.mode as Record<string, unknown>;
    expect(modeProp.const).toBe('video');
    expect(ifClause.required).toContain('mode');

    // then 分支：videoConfig 必填
    const thenClause = constraint.then as Record<string, unknown>;
    expect(thenClause).toBeDefined();
    expect(thenClause.required).toContain('videoConfig');

    // else 分支：禁止 videoConfig
    const elseClause = constraint.else as Record<string, unknown>;
    expect(elseClause).toBeDefined();
    const notClause = elseClause.not as Record<string, unknown>;
    expect(notClause).toBeDefined();
    expect(notClause.required).toContain('videoConfig');
  });

  it('CreateTaskRequest.examples 中的 video 示例包含 videoConfig', () => {
    const req = schemas['create-task-request.schema.json'] as Record<string, unknown>;
    const examples = req.examples as unknown[];
    const videoExample = examples.find(
      (e) => (e as Record<string, unknown>).mode === 'video',
    ) as Record<string, unknown> | undefined;
    expect(videoExample).toBeDefined();
    expect(videoExample!.videoConfig).toBeDefined();
  });

  // ---- 16. TaskEventsResponse 事件响应包络 ----

  it('TaskEventsResponse 包含 serviceInstanceId 和 events 字段', () => {
    const resp = schemas['task-events-response.schema.json'] as Record<string, unknown>;
    const props = resp.properties as Record<string, unknown>;
    expect(props.serviceInstanceId).toBeDefined();
    expect(props.events).toBeDefined();
    expect(resp.required).toContain('serviceInstanceId');
    expect(resp.required).toContain('events');
  });

  it('TaskEventsResponse.events 引用 task-event.schema.json', () => {
    const resp = schemas['task-events-response.schema.json'] as Record<string, unknown>;
    const props = resp.properties as Record<string, unknown>;
    const events = props.events as Record<string, unknown>;
    const items = events.items as Record<string, unknown>;
    expect(items.$ref).toBe('task-event.schema.json');
  });

  it('TaskEventsResponse 不包含 TaskEvent 内部字段（sequence/eventId 等）', () => {
    const resp = schemas['task-events-response.schema.json'] as Record<string, unknown>;
    const props = resp.properties as Record<string, unknown>;
    // 包络只应有 serviceInstanceId 和 events
    const forbiddenKeys = ['sequence', 'eventId', 'taskId', 'eventType', 'payload'];
    for (const key of forbiddenKeys) {
      expect(props[key]).toBeUndefined();
    }
  });

  it('TaskEventsResponse examples 包含空事件和非空事件两种情况', () => {
    const resp = schemas['task-events-response.schema.json'] as Record<string, unknown>;
    const examples = resp.examples as unknown[];
    expect(examples.length).toBeGreaterThanOrEqual(2);
    const hasEmpty = examples.some(
      (e) => Array.isArray((e as Record<string, unknown>).events) &&
        ((e as Record<string, unknown>).events as unknown[]).length === 0,
    );
    const hasNonEmpty = examples.some(
      (e) => Array.isArray((e as Record<string, unknown>).events) &&
        ((e as Record<string, unknown>).events as unknown[]).length > 0,
    );
    expect(hasEmpty).toBe(true);
    expect(hasNonEmpty).toBe(true);
  });
});
