# DOUBAO-LOCAL-CONTROL-ARTIFACT-01 实施交接单

- 日期：2026-09-12（Asia/Shanghai）
- 状态：代码已实现、自动化门禁通过、免安装候选打包通过；未提交
- 基线：`origin/main@f461a7fb9fcefcf35050de5a4459bd1b94f897b3`（v2.3.7）
- 分支：`codex/doubao-local-control-artifact-01`
- 工作树：`D:\豆包工作室\doubao-local-control-artifact-01`

## 治理与冻结验收包

开工前已读取总架构师治理规则、中央 memory、豆包仓库 `AGENTS.md`、v2.3.7 当前源码与 `2026-09-11-doubao-studio-post-237-deepseek-execution-prompt-01.md`。本包冻结范围为：脱敏账号查询、只指派不启动、任务产物查询、按稳定 artifact ID 安全下载、统一 requestId 幂等及全部归属 fail-closed；不扩展视频生成、页面适配或真实平台任务。

## P0 验收结果

| 项目 | 结果 | 证据摘要 |
| --- | --- | --- |
| `GET /v1/accounts` 脱敏账号投影 | PASS | 仅稳定 ID、显示名、平台、健康/可用性、预测额度、忙碌和人工操作标志；不含 partition、Session、页面信息 |
| `POST .../assign` 只指派 | PASS | 正式出口复用 `TaskService.assign`；不经过 Renderer 调度，不 arm、不启动 |
| `GET .../artifacts` 脱敏产物投影 | PASS | 仅 artifact ID、类型、发现时间、验证状态、下载可用性 |
| `POST .../artifacts/{id}/download` | PASS | URL 来自任务台账，目录来自应用设置/默认下载目录；调用方 URL/目录被拒绝 |
| requestId 重放/并发单飞/冲突 | PASS | start/assign/download 共用同一幂等表；同命令复用结果，跨命令冲突 |
| 项目/批次/任务/账号/artifact 归属 | PASS | HTTP 层预检，正式服务出口再次回读；漂移、缺失、错配均 fail-closed |
| Dola 未验收边界 | PASS | 可在脱敏账号查询中识别平台；指派/下载返回 `PLATFORM_NOT_VERIFIED` |
| Agent 操作指南与能力矩阵 | PASS | README、`docs/LOCAL_CONTROL.md`、`docs/USAGE_NOTICE_2.3.4.md` 已同步 |

## 实现说明

1. `LocalControlServer` 新增账号、指派、产物查询和单产物下载路由；所有路由继续受 loopback Host/Origin、Bearer 和令牌期限门禁保护。
2. 写操作统一通过进程内 requestId replay/in-flight 表执行，包含异常收敛；不向响应暴露远程 URL、本地路径、Cookie、Token 或 Session。
3. 账号投影不返回可识别页面内容；产物投影会综合 URL 协议、验证状态、账号存在性和已验证平台计算下载可用性。
4. 主进程新增受控服务出口：账号只读列表、TaskService 指派、既有 Electron Session/响应验证/临时文件原子改名/下载台账链的单产物下载。
5. 下载文件名只由任务 ID、artifact ID 和验证后的扩展名组成；保存目录不可由 HTTP 调用方指定。

## 自动化门禁

- `pnpm exec vitest run tests/unit/localControlServer.test.ts tests/unit/localControlTaskActions.test.ts`：2 files / 24 tests，PASS。
- `pnpm run validate`：exit 0。
  - TypeScript：0 error。
  - ESLint：0 error / 147 warning，低于仓库上限 149，未新增本包 warning。
  - 工程边界、Contracts 边界：PASS。
  - 全量 Vitest：50 files / 1039 tests，PASS。
  - Renderer/Main/Contracts build：PASS。
- `pnpm run pack`：exit 0；候选位于 `release\win-unpacked\豆包工作室.exe`。
- `git diff --check`：PASS。

打包仍使用 Electron 默认图标且未发现签名信息；这是既有独立技术债，不在本包扩项。

## 文件范围

Tracked 修改 8 个：

1. `README.md`
2. `docs/LOCAL_CONTROL.md`
3. `docs/USAGE_NOTICE_2.3.4.md`
4. `main/control/LocalControlServer.ts`
5. `main/ipc/accounts.ts`
6. `main/ipc/tasks.ts`
7. `main/main.ts`
8. `tests/unit/localControlServer.test.ts`

Untracked 新增 2 个：

1. `tests/unit/localControlTaskActions.test.ts`
2. `docs/handoffs/2026-09-12-doubao-local-control-artifact-01.md`

Tracked 删除 0 个。

## 状态严格分离

- 代码已实现：是。
- 自动化测试：是，全部通过。
- 人工验收：未执行。
- 真实任务执行：未执行。
- 真实平台提交/素材上传/额度消费：均未发生。
- 提交：未执行。
- 推送/PR/合并：未执行。
- 安装/部署/发布：未执行。

未读取、输出或修改 Cookie、Token、账号 Session、真实任务、项目台账或视频产物；未启动或重启正式豆包工作室。

## 剩余风险与下一步

本包候选需要独立复验后方可授权提交。包 A、包 B 仍是独立提交且尚未进入 main；后续合并时必须按 A → B → C 顺序处理潜在冲突，并保留 A 的 `hold/armed` 安全语义。包四 `DOUBAO-STATUS-DOWNLOAD-CLOSEOUT-01` 尚未开工。

真实多账号视频、Dola、签名和自定义图标均不在本包自动化结论内。
