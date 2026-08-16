# DOUBAO-MCP-CLIENT-01（2026-08-17）——分支 `doubao-mcp-client-01`

- 状态：实现 + 测试 + 提交；PR #22（CI pending）；**未合并、未部署、未启动**。
- 范围（四包合并大开发·子包 4）：豆包工作室内建 MCP stdio 客户端核心 + 配置脱敏 + 只读 CLI/审计。非目标（如实记录）：Agent MCP server（未实现，客户端就绪后接入，下一候选）、HTTP transport、未配置连接自动连接。

## 变更

- `main/mcp/mcpClientCore.ts`：JSON-RPC 2.0 stdio 客户端核心（initialize/tools/list/tools/call；id 关联；单请求超时 30s；对端关闭/主动断开 reject 全部 pending；非 JSON 行与未知 id 响应忽略）。transport（McpIo）注入，零 Electron。
- `main/mcp/mcpClient.ts`：spawn 进程适配层（唯一 spawn 位置；env 合并、stderr 诊断累积、kill 回收）；spawnImpl 注入可测。
- `main/mcp/mcpClientConfig.ts`：连接配置校验（名称/命令/args/env/超时边界 fail-closed）+ secret 脱敏（TOKEN/KEY/SECRET/PASSWORD 命名规则 + 显式 secretKeys）+ 连接文件解析。
- `main/mcp/mcpClientCli.ts`：`tools`（连接+工具列表）/`call`（显式调用，每次追加脱敏审计 JSONL）/`audit`（只读审计）；无内置连接、无自动连接。
- package.json：`mcp:client` script。

## 门禁

- 专项 12 项（`tests/unit/mcp-client.test.ts`）：自举端到端（内存 io 直连 doubaoMcpServer：initialize→tools/list→tools/call 只读回读）、超时、对端关闭、噪声帧、未知工具 isError、配置校验/脱敏/解析、CLI 错误路径。
- ts-check 0；lint 0 errors（141 warnings 在既有基线内）；全量 vitest 717/717；build 0。

## 未处理事项

- Agent MCP server：豆包客户端已就绪，Agent 侧 stdio MCP 入口（认证边界需设计，不能绕过会话体系）为下一候选。
- Electron UI 面板：本轮以 CLI 只读面板交付（冻结计划 P1-2 调整为 CLI 形态，避免扩 UI 面）；图形化连接管理面板入 backlog。
- 部署/发布：豆包桌面应用未构建安装包、未启动。
