# DOUBAO-ACCEPTED-OBSERVATION-PIPELINE-01 R1 验收收口单

- 日期：2026-09-10
- 裁决：PASS after R1
- supersedes：`2026-09-10-doubao-accepted-observation-pipeline-01.md` 的“未人工验收”状态
- 基线：`origin/main@dfbb7f2028bd88caf838c52f5785e3130e594e7a`

## R1 阻断与修复

首次真实多账号验收发现：前置任务已有合法 `acceptanceObservation.outcome=observing`，跨账号 `all_accepted` 后继仍长期 queued。账号、额度、依赖关系均正常，阻断定位为启动期与软阻断状态缺少可靠调度触发。

R1 仅修复该核心承诺失败：

1. `src/App.tsx` 在账号、项目、任务加载完成后显式执行一次队列评估。
2. `src/store/useTaskStore.ts` 对 availability=unknown 的目标账号发起有界复检与退避调度，不再永久跳过。
3. 同账号串行保护扩大为任意 `acceptanceObservation.outcome=observing`，覆盖生成确认等受理后状态。

## 门禁与真实验收

- 包3全量 `pnpm run validate`：PASS，49 files / 1013 tests；TypeScript、工程/Contracts 边界、Renderer/Main build PASS。
- 包3 `pnpm run pack`：PASS。
- 包2→包3联合候选：49 files / 1030 tests；TypeScript、lint、build、pack、`git diff --check` 全 PASS。
- 单任务真实链：一次普通 5 秒视频，仅提交一次；重启后沿同一具体会话只读恢复；产物 `artifact-d46a8e96` 正确绑定；observation 最终 completed。
- 跨账号：前置任务受理并 observing 后，不同账号后继由 queued 自动进入 executing/new_conversation。
- 同账号：后继保持 queued，串行保护生效。
- 复验后两个后继均通过本机控制面立即取消，未发生额外提交或重复额度消耗。

权威证据：`D:\豆包工作室\_acceptance\p2-p3-20260910-204549\final-acceptance.json`；相关原始日志为 `p3-fix-validate.log`、`g6-result.json`、`g6e-monitor.log`。

## 文件与纪律

R1 在原 18 文件基础上新增 tracked 修改 `src/App.tsx`，并新增本收口单；本工作树提交候选共 20 项：16 tracked 修改、4 untracked 新增；无 tracked 删除。未包含验收目录、临时用户数据、Cookie、Token、Session、真实任务台账或视频产物。

## 五态声明

- 已实现：是。
- CI：尚未运行远端 CI。
- 人工/真实验收：PASS。
- 已合并：否。
- 已部署/已发布：否。

Dola 仍未验证。后续必须先合并第二包，再把本包集成到新的 main 并重跑联合门禁。
