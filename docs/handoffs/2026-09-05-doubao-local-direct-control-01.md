# DOUBAO-LOCAL-DIRECT-CONTROL-01 实施交接单

- 日期：2026-09-05
- 状态：代码已实现、自动化测试通过；未提交、未推送、未创建 PR、未合并、未部署、未发布、未人工操作真实任务
- 基线：`origin/main@4444dca3ab94f05ae616af183b02c6f32907207b`
- 分支：`codex/doubao-direct-control-01`
- 工作树：`D:\豆包工作室\doubao-direct-control-01`
- 候选源码版本：`2.3.1`（未发布）

## 治理与冻结验收包

开工前已读取总架构师治理规则、豆包工作室 `AGENTS.md`、中央开发方向、仓库 README/ROADMAP/DESIGN、现有 CLI/MCP/任务调度实现及 2026-09-05 T01/T02 窗口控制中断报告。

冻结验收包：

1. 默认关闭；仅显式参数开启且只监听 `127.0.0.1`，短期高熵令牌认证，拒绝非本机 Host/Origin。
2. 查询和命令必须通过 projectId、batchId、taskId 稳定定位；提供 health、项目/批次/任务查询及 start/pause/cancel/retry。
3. 写命令通过主进程↔Renderer 专用桥调用正在运行实例的现有调度链；不得另建 TaskService 直接覆盖任务台账。
4. requestId 防重放；响应和日志不得包含完整提示词、素材路径、产物/会话 URL、Cookie、Token 或账号 Session。
5. 不触碰正式用户数据、账号分区、生产任务或视频产物；不启动/重启正式应用。

## 实现结果

- 新增版本化本机 HTTP 控制面。动态端口或显式固定端口均只绑定 IPv4 loopback；未传 `--local-control` 时零监听。
- 运行时生成 256-bit、8 小时有效的 Bearer 令牌；发现信息和令牌分文件、私有模式写入，令牌不写日志/响应，正常退出删除。
- 路由层、Renderer 层分别执行项目/批次/任务归属校验；任一漂移均 fail-closed。
- start/retry 复用 Zustand 中现有调度方法，因此继续执行依赖、账号健康、额度、租约和防重复门禁。
- pause/cancel 对运行任务通过现有 AbortController/AutomationEngine 中止链收口；对排队或等待验证任务通过既有状态写入边界收口。
- 相同 requestId + 相同命令返回进程内缓存结果，不重复下发；同 requestId 用于不同命令返回冲突。
- 并发到达的相同 requestId 共享单一 in-flight 执行；Renderer 未完成专用桥注册时健康状态明确为 not-ready，写命令返回 503。
- 调度拒绝映射为稳定机器码且不回显内部页面文案；命令结果通过既有日志边界记录脱敏审计。
- 启动时清理上次异常退出遗留的固定发现文件；畸形 URL 编码被受控拒绝，不产生未处理 Promise。
- DTO 仅返回任务 ID、三重归属、状态、模式、阶段、尝试次数、错误码、产物数量及时间；不返回敏感内容。

## 修改文件

Tracked 修改：

- `CHANGELOG.md`
- `README.md`
- `ROADMAP.md`
- `main/ipc/tasks.ts`
- `main/main.ts`
- `main/preload.ts`
- `package.json`
- `packages/contracts/src/dto/electron-api.ts`
- `src/App.tsx`
- `src/components/BrowserPanel.tsx`
- `src/store/useTaskStore.ts`

Untracked 新增：

- `docs/LOCAL_CONTROL.md`
- `docs/handoffs/2026-09-05-doubao-local-direct-control-01.md`
- `main/control/ControlCommandBroker.ts`
- `main/control/LocalControlServer.ts`
- `main/control/controlTypes.ts`
- `src/control/handleControlCommand.ts`
- `tests/unit/controlCommandBroker.test.ts`
- `tests/unit/localControlServer.test.ts`
- `tests/unit/rendererControlCommand.test.ts`

Tracked 删除：无。

## 门禁证据

- 专项：3 files / 36 tests，通过。
- TypeScript：主进程、Renderer、测试及 contracts 零错误。
- ESLint：零 error；全仓 warning 不超过既有上限 149，新增控制面警告已消除。
- 工程/Contracts 边界检查：通过。
- 全量 Vitest：43 files / 962 tests，通过。
- Renderer build：通过。
- Main build：通过。
- `git diff --check`：通过。
- 隔离 Electron 进程烟测：`HealthOk=true`、协议 `v1`、监听地址仅 `127.0.0.1`、发现文件不含令牌、进程终止后监听端口关闭；使用独立空白 `userData`，未连接正式台账。
- `win-unpacked` 打包形态烟测：ProductVersion=`2.3.1.0`、`rendererReady=true`、只读项目查询通过；未安装、未连接正式账号或任务。

## 安全与现场声明

- 没有输出或读取 Cookie、Token、完整账号 Session；此处 Token 专指平台凭据，不包含运行时新生成且未打印的本机控制令牌。
- 没有读取或修改正式 `tasks.json`、`projects.json`、账号分区、视频文件与产物 URL。
- 没有开启裸 CDP，也没有任意 DOM/JavaScript 执行能力。
- 没有提交、推送、PR、合并、部署、安装或重启正式豆包工作室。

## 后续

完成代码复验后，提交/推送/PR/合并仍需按治理逐项授权。正式安装包部署后，使用 `豆包工作室.exe --local-control` 启动并做隔离数据的端到端人工验收；真实生产任务必须另行明确授权。
