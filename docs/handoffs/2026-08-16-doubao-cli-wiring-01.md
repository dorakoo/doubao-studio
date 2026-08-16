# DOUBAO-CLI-WIRING-01 冻结验收包 + 实施记录

- 状态：D-SPRINT-03 项 B-1（用户连续授权）；分支 `doubao-cli-mcp-boundary-01`（在 A-3 已合并代码之上继续，基于 origin/main `865c175`）。
- 目标：CLI/MCP **stdio 接线包**——把 A-3 只读边界接成可执行入口（真实 CLI + MCP stdio 服务器），零 Electron/零写入。

## P0 清单

- P0-1：`main/cli/doubaoCliEntry.ts`——CLI 可执行入口（list/task/outputs/diagnostics + help；`--tasks-file` 注入 JSON 任务文件；文件存储 replace 恒 false → 零写入；`runCli` 纯函数可测）。
- P0-2：`main/mcp/doubaoMcpServer.ts`——MCP stdio 服务器（JSON-RPC 2.0：initialize/tools/list/tools/call/ping；未知工具 isError UNKNOWN_TOOL；非 JSON 行忽略；`startMcpServer(io, tasksFile)` io 注入可测）。
- P0-3：`package.json` 新增脚本 `cli:list` / `mcp:server`（运行编译产物 dist/main/...）。
- P0-4：`tests/unit/cli-mcp-entry.test.ts`——CLI 三命令 + 零写入断言 + MCP 全协议 + 未知工具，共 5 测试。
- P0-5：门禁：专项 10/10（含 A-3 5 项）、ts-check 0、eslint 0、编译产物冒烟（CLI list 实跑）、PR CI validate。

## 允许修改文件（6 个）

- `main/cli/doubaoCliEntry.ts`、`main/mcp/doubaoMcpServer.ts`（新增）
- `tests/unit/cli-mcp-entry.test.ts`（新增）
- `package.json`（仅新增两个 scripts 行）
- `docs/handoffs/2026-08-16-doubao-cli-wiring-01.md`（本文件）

## 禁止事项

- 不改 Core 业务逻辑；不实现 MCP 客户端/分发进程（stdin 直连即可）；不部署；不启动；不触碰受保护现场。

---

# 实施记录（2026-08-16，同文件续写）

## 门禁结果

| 门禁 | 结果 |
| --- | --- |
| 专项（entry+boundary） | **10/10** |
| `pnpm run ts-check` | 0 |
| `npx eslint`（新增 3 文件） | 0 |
| `pnpm run build:main` + CLI 冒烟 | 编译成功；`node dist/main/cli/doubaoCliEntry.js list` 返回 `{"ok":true,...}` exit 0 |
| PR CI validate | 见 PR 结果 |

## 自审裁决

R0 PASS（自审）：入口纯逻辑零 Electron（tsconfig.main 覆盖、源码无 electron 引用）；CLI/MCP 只读且零写入（replace 恒 false 并有测试断言文件不变）；MCP 协议最小实现符合 2024-11-05 initialize 应答；未触碰 Core。

## 声明

未部署、未启动；受保护现场 doubao-studio-main 未触碰；Core 零修改。
