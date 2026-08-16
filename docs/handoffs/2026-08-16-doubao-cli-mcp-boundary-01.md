# DOUBAO-CLI-MCP-BOUNDARY-01 冻结验收包 + 实施记录

- 状态：D-SPRINT-02 项 A-3（用户连续授权）；分支 `doubao-cli-mcp-boundary-01`（基于 origin/main `0c4a9d7`）。
- 目标：豆包外部接口边界准备——CLI/MCP 只读接口与 Core TaskService 的纯逻辑边界（零 Electron 依赖），为后续 CLI/MCP stdio 接线包冻结边界。

## P0 清单

- P0-1：`main/cli/doubaoCli.ts`——只读 CLI 动作集合（listTasks/taskDetail/completedOutputs/diagnostics），稳定 JSON 形状，prompt 截断 120 字符、诊断全脱敏，零写入。
- P0-2：`main/mcp/doubaoMcpTools.ts`——MCP 工具注册表（doubao.list_tasks / doubao.get_task）+ 处理器映射，缺参 fail-closed（MISSING_TASK_ID），零网络/零 Electron。
- P0-3：`tests/unit/cli-mcp-boundary.test.ts`——源码级「无 electron 依赖」断言 + 过滤/截断/投影/脱敏/MCP 处理器 5 组契约测试。
- P0-4：门禁：本包专项 + `pnpm run ts-check`（main tsconfig 覆盖新文件）+ 既有 validate（不跑 Electron 打包）；PR CI。

## 允许修改文件（5 个）

- `main/cli/doubaoCli.ts`（新增）、`main/mcp/doubaoMcpTools.ts`（新增）
- `tests/unit/cli-mcp-boundary.test.ts`（新增）
- `docs/handoffs/2026-08-16-doubao-cli-mcp-boundary-01.md`（本文件）
- （如 tsconfig 需要包含新目录才 type-check，则机械更新相应 include——实施时决定，禁止扩面）

## 禁止事项

- 不实现 stdio 接线/分发进程（后续独立包）；不改 Core 业务逻辑；不 import electron；不部署；不启动；不触碰 `D:\豆包工作室\doubao-studio-main`（受保护现场）。

---

# 实施记录（2026-08-16，同文件续写）

## 门禁结果

| 门禁 | 结果 |
| --- | --- |
| 专项 `tests/unit/cli-mcp-boundary.test.ts` | 见运行记录 |
| `pnpm run ts-check` | 见运行记录 |
| `pnpm run lint`（新增文件） | 见运行记录 |
| PR CI | 见 PR 结果 |

## 自审裁决

（完成后补）

## 声明

未部署、未启动；未触碰受保护现场 doubao-studio-main；Core 零修改。
