# DOUBAO-TASK-LEASE-HEARTBEAT-01

## 治理与冻结范围

已读取总架构师治理规则、项目规则、ROADMAP、最新 IPC 生命周期 handoff 与任务锁源码。本包只收敛任务租约所有权。

- P0-1：2 分钟短租约、30 秒续租、过期接管。
- P0-2：续租和释放必须匹配 owner，缺失/错误 owner fail-closed。
- P0-3：AutomationEngine 持锁期间心跳；续租失败时中止执行并释放本地占用。

非目标：不改队列排序和依赖策略，不运行真实生成，不迁移用户数据，不部署。

## 状态

## 实现与验证

- 纯函数租约状态机：2 分钟有效期、正确 owner 续租、过期后新租约接管。
- IPC 新增 `tasks:renewLock`，release 的 owner 改为必填且错误 owner 不写盘。
- AutomationEngine 每 30 秒续租；返回失败或 IPC 异常均中止控制器、停止心跳并释放本地占用。
- 页面重载恢复仅在快照含原 owner 时释放，不再执行无 owner 解锁。
- 租约/AutomationEngine/contracts 专项：54 pass / 0 fail。
- TypeScript：主进程、渲染进程、测试配置全部通过。
- 工程/contracts 边界：50 个 handle/invoke、3 个 on/send，全部一致。
- 全量单测：18 files，507 pass / 0 fail。
- 全局 ESLint：0 error（既有 warning 未扩项清理）。
- 生产构建与 `git diff --check`：通过。

系统 C 盘 Temp 空间为 0，本包沿用 D 盘任务专用 TEMP/TMP 完成验证；未删除用户文件。

候选门禁通过，等待提交与 CI。未部署。
