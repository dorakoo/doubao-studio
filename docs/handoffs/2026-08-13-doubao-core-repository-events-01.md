# DOUBAO-CORE-REPOSITORY-EVENTS-01 检查报告

## 治理与冻结范围

已读取中央治理、豆包项目 AGENTS、README、ROADMAP、DESIGN、AGENT_EXECUTION_PLAN 和真实源码。

- P0-1：建立 tasks.json 单一 Repository 写入边界。
- P0-2：陈旧快照写回必须 fail-closed，不覆盖新状态。
- P0-3：建立与 Capability Schema 语义一致的进程内 v1 任务事件流。

非目标：不实现 CLI/MCP/HTTP，不迁移全部账号/下载 Repository，不改 UI/IPC DTO，不真实生成，不部署。

## 实现摘要

- `TaskRepository` 成为 tasks.json 唯一写入边界，保留既有归一化与备份行为。
- `read()` 为快照记录内容版本；`replace()` 写盘前重新读取并比较，陈旧或外来快照拒绝写入。
- 成功提交后按差异发布 created/status/stage/artifact/deleted 事件；失败写入不发布事件。
- `TaskEventStream` 提供单调 sequence、eventId、游标读取、容量上限和可撤销订阅。
- IPC channel、返回 DTO、UI Store 和实际生产数据格式不变。

## 边界

- 未触碰当前运行目录 `D:\豆包工作室\doubao-studio-main` 的未提交热更新。
- 未修改 Alice Agent、ERP、Discord、Cookie、Token、用户素材或运行数据。
- 未提交、未推送、未创建 PR、未发布、未部署。

## 验证

- 专项与相关回归：26 pass / 0 fail。
- 项目完整 `validate`：PASS。
- 全量测试：21 files / 520 pass / 0 fail。
- TypeScript：0 error。
- ESLint：0 error；142 条为冻结 warning 基线，低于 149 上限。
- 工程结构：50 个 handle/invoke、3 个 on/send，fixture 9/9 通过。
- Contracts 边界：PASS。
- Renderer/Main 生产构建：PASS。
- `git diff --check`：PASS。

## 裁决

PASS。三个 P0 均满足，可形成单一候选提交。仍未实现 CLI/MCP/HTTP；下一开发包应先建立最小 `TaskService`，不得把本阶段事件流误写为外部 API 已上线。
