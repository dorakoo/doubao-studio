# DOUBAO-DOWNLOAD-RECOVERY-01

## 治理与冻结范围

已读取总架构师治理规则、项目规则、ROADMAP、稳定性 handoff 与下载源码。本包只处理下载状态写入放大和临时文件恢复。

- P0-1：下载列表纯读取，只有归一化/恢复实际变化才写盘。
- P0-2：当前失败只删除调用方持有的精确临时路径。
- P0-3：启动恢复仅清理已登记 downloading job 的安全 ID 精确后缀文件，目录边界 fail-closed。

非目标：不改下载地址解析、响应验证或保存目录，不下载真实文件，不部署。

## 实现与验证

- 移除 `tasks:listDownloads` 的无条件全量写回。
- 新增中断恢复纯函数：只扫描 job.saveDir 顶层，要求安全 job ID、精确 `.<jobId>.part` 后缀和解析后的同目录边界。
- 当前下载 catch 只删除本次明确记录的 `temporaryPath`，不再遍历删除同后缀未知文件。
- 目录不存在或 job ID 不安全时只将状态恢复为 failed，保留未知文件并记录 warning。
- 下载恢复/验证/归一化专项：101 pass / 0 fail；全量：20 files，514 pass / 0 fail。
- TypeScript、全局 ESLint（0 error / 142 warnings）、工程/contracts 边界、生产构建和 `git diff --check` 全部通过。

验证仅在 D 盘任务专用 TEMP 目录创建和删除测试文件；未读取或删除真实下载文件。系统 C 盘 Temp 空间仍为 0，未清理用户文件。

候选门禁通过，等待提交与 CI。未部署。
