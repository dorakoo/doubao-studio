# DOUBAO-STABILITY-IPC-LIFECYCLE-01

## 治理与冻结范围

已读取总架构师治理规则、项目 AGENTS.md、README、DESIGN、ROADMAP 和相关主进程源码。本包核心目标是让 IPC 注册可重入并在退出时对称释放。

- P0-1：重复初始化前替换旧 handler，不触发 Electron 重复注册异常。
- P0-2：每个注册批次返回幂等 disposer；旧 disposer 不得误删新 handler。
- P0-3：应用退出时清理 handle/on 注册；不在模块导入时访问 `app.getPath()`。

非目标：不改账号、任务和下载业务语义，不改网页自动化，不部署、不真实生成。

## 实现

- 新增 IPC 生命周期协调器，以 registry + channel owner token 管理 handler 所有权。
- 四个业务 IPC 注册器改为显式 channel 清单并返回 disposer。
- 主进程重复注册前先清理；退出时移除业务 handler、系统 handler 和窗口事件 listener。
- app 路径仍只在注册后的处理函数或实际存储调用中读取。

## 验证

- IPC 生命周期专项：4 pass / 0 fail。
- TypeScript：主进程、渲染进程、测试配置均通过。
- 全局 ESLint：0 error / 145 warnings（阈值 149，未新增清理旧债）。
- 工程与 contracts 边界：全部通过；49 个 handle/invoke 与 3 个 on/send 通道一致。
- 全量单测：16 files，498 pass / 0 fail。
- 生产构建：renderer + main 通过。
- `git diff --check`：通过。

首次全量测试在 C 盘系统 Temp 空间为 0 时因 `ENOSPC` 中止；代码门禁此前已通过。复验将 TEMP/TMP 指向 D 盘本任务专用目录后，498 项全量与构建自然通过。未删除或清理任何用户文件。

## 状态

候选门禁通过，等待提交与 CI。未部署。
