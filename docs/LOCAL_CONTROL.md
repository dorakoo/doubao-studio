# 本机受控自动化接口

豆包工作室 2.3.7 的受控接口用于让本机 Agent 可靠控制**正在运行的正式实例**。它按项目、批次和任务 ID 定位，不依赖截图坐标、DOM 序号或跨会话元素编号。2.3.5 修复首次就绪竞态；2.3.6 确保后台账号 Webview 预热不会撤销主 Renderer 的控制桥就绪状态；2.3.7 增加视频页面分阶段就绪与受理后持久化观察，应用重启后仍沿原会话恢复且禁止不确定重发。

| 入口 | 用途 | 是否可用于正式任务 | 生命周期 |
| --- | --- | --- | --- |
| `--local-control` | 项目、批次和任务的查询与 `start/pause/cancel/retry` | 是；必须 Bearer 鉴权并先确认 `ready=true` | 随正式实例运行，最长受 8 小时令牌期限约束 |
| `--local-cdp` | Webview 加载、partition 与合成问题的开发诊断 | 否；不提供稳定业务语义 | 有人值守短时开启，用后退出应用并确认端口关闭 |
| Computer Use / 截图坐标 | 临时人工辅助 | 否 | 不得长时间持有控制宿主 |

推荐顺序固定为：**内置直接接口 → 浏览器/CDP 接口 → Computer Use**。浏览器层只补充直接接口尚未覆盖的应用 UI 能力；Computer Use 只做可见、单次、有人值守的最后兜底。详细操作矩阵见 [`USAGE_NOTICE_2.3.4.md`](USAGE_NOTICE_2.3.4.md)。

## 启动

默认不监听任何端口。仅在明确传入参数时开启：

```powershell
& '豆包工作室.exe' --local-control
```

系统默认选择一个空闲端口。需要固定端口时：

```powershell
& '豆包工作室.exe' --local-control --local-control-port=17891
```

服务只绑定 `127.0.0.1`。端口冲突、非法端口或启动失败会 fail-closed，不会改为监听其他网卡。

运行时发现文件位于 Electron `userData/DoubaoStudioControl`：

- `control-info.json`：协议版本、`127.0.0.1`、端口、PID、启动/到期时间；不含令牌。
- `control-token`：短期 Bearer 令牌，按当前操作系统用户私有权限写入；应用退出时删除。

令牌有效期为 8 小时，不会写入控制接口响应或应用日志。客户端应从文件读取，不要复制到聊天、报告或命令历史。正常退出会删除发现文件；进程被强制终止时残留文件中的令牌也会因监听器消失或到期而失效，下次启动将覆盖它。

## 协议

所有请求都必须包含 `Authorization: Bearer <token>`。写命令还必须使用唯一 `requestId`；同一请求（包括并发到达）返回同一结果，不会重复执行，复用到其他命令则返回 `REQUEST_ID_CONFLICT`。

只读端点：

- `GET /v1/health`
- `GET /v1/projects`
- `GET /v1/projects/{projectId}`
- `GET /v1/projects/{projectId}/batches`
- `GET /v1/projects/{projectId}/batches/{batchId}/tasks`
- `GET /v1/projects/{projectId}/batches/{batchId}/tasks/{taskId}`

无批次任务使用稳定批次标识 `_unbatched`。写端点：

- `POST .../tasks/{taskId}/start`
- `POST .../tasks/{taskId}/pause`
- `POST .../tasks/{taskId}/cancel`
- `POST .../tasks/{taskId}/retry`

请求体仅为：

```json
{"requestId":"调用方生成的唯一 UUID"}
```

写命令会在主进程和 Renderer 各自重新校验项目、批次、任务归属，然后调用应用现有的依赖、账号健康、额度、任务锁和防重复调度链。控制面不会直接写 `tasks.json`。

`GET /v1/health` 的 `ready` / `rendererReady` 只有在 Renderer 已注册调度桥时才为 `true`。HTTP 存活但 `ready=false` 时不得发送写命令。命令被调度门禁拒绝时返回稳定机器码，例如 `SCHEDULER_PAUSED`、`ACCOUNT_REQUIRED`、`DEPENDENCY_NOT_READY`、`QUOTA_UNAVAILABLE`、`ACCOUNT_ACTION_REQUIRED`、`ACCOUNT_BUSY`、`TASK_LOCKED` 和 `INVALID_TASK_STATUS`，不回显内部页面文案。

## Agent 使用顺序

1. 启动唯一一个带 `--local-control` 的正式实例，等待账号顺序预热；不要并行启动第二个桌面实例。
2. 读取发现文件与令牌文件，调用健康端点；只有 `ready=true` 且 `rendererReady=true` 才继续。
3. 依次列出项目、批次和任务，用返回的稳定 ID 构造完整路径；不得用显示名称代替 ID。
4. 每个写动作生成新的 UUID `requestId`；网络结果不确定时用同一 `requestId` 重试查询，不得换新 ID 盲目重发。
5. 遇到账号登录、人机验证、额度、会员、未知弹窗或提交状态不确定，保留任务状态并交由人工处理；不得通过 CDP 或坐标脚本绕过。
6. 工作结束后关闭客户端；若曾开启 CDP，退出整个应用并确认调试端口不再监听。

启动后若健康端点仍为 `ready=false`，客户端应在有限时间内继续只读轮询，不得下发写命令。2.3.5 的 Renderer 会在命令监听注册后的 5 秒启动窗口内幂等重申就绪；超过该窗口仍未就绪应视为运行故障并停止，而不是改用截图坐标绕过。

## 安全边界

接口不支持任意 JavaScript、DOM/CDP、Cookie、localStorage、请求头或账号 Session 读取。返回的任务快照不包含完整提示词、素材绝对路径、音频路径、产物 URL、会话 URL或页面内容。带非本机 Host/Origin 的请求一律拒绝，且不开放 CORS。

每次真正下发的控制命令通过现有应用日志边界记录脱敏审计：动作、结果码、requestId 与项目/批次/任务 ID；不记录提示词、素材、网页内容或平台凭据。

## 开发者短时 CDP 验收

本机受控接口仍然不提供任意 JavaScript、DOM 或 CDP 能力。为了排查 Electron
Webview 的加载、隔离分区和合成问题，2.3.4 另提供一个**默认关闭**的开发者验收入口：

```powershell
& '豆包工作室.exe' --local-cdp
```

默认端口是 `9333`；也可显式指定本机端口：

```powershell
& '豆包工作室.exe' --local-cdp --local-cdp-port=9334
```

该入口固定监听 `127.0.0.1`，不接受监听地址参数，不能暴露到局域网或公网。裸
CDP 能接触页面运行态，因此只允许在有人值守的短时开发验收中使用；禁止读取或
输出 Cookie、Token、Local Storage、完整账号 Session、提示词和素材内容。

验收完成后必须立即关闭控制客户端并退出带 CDP 参数的豆包工作室，随后确认端口
已无监听。日常运行和 Agent 调度应使用前述带令牌、按项目/批次/任务定位的本机
受控接口，不应开启 CDP。
