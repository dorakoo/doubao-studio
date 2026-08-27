# DOUBAO-CSV-PRODUCTION-EXPERIENCE-01 交付记录

## 治理与基线

- 已读取 `D:\项目架构师\memory\INDEX.md`、`D:\项目架构师\DEVELOPMENT_EFFICIENCY_GOVERNANCE.md`、仓库 `AGENTS.md`、`DESIGN.md`、C03 异常使用报告及相关源码/测试。
- 仓库不存在 `docs/memory/INDEX.md`、`CURRENT.md`、`DEPENDENCIES.md`、`QUEUE.md`，已按实际缺失记录，未虚构读取。
- 工作树：`D:\豆包工作室\doubao-automation-closeout-01`
- 分支：`codex/doubao-startup-webview-recovery-01`
- 基线/最终 HEAD：`83a328ae576a84a1094164535526d7a1fd50b30e`（本包未提交）
- 冻结验收包：P0-1 上传/提交稳定门禁与额度安全重排；P0-2 显式写入型 CSV CLI；P0-3 CSV 拖放与 Agent 使用说明。音轨分类延期为独立包。

## 核心行为

1. 参考图片逐文件读取必须全部成功；上传后需达到预期数量、无上传进度并连续三次稳定。发送控件也需连续三次稳定才记录提交意图。超时或异常均在提交前停止，不再把超时当成功。
2. 素材授权弹窗仍由用户人工确认；确认可能触发平台提交时只回读同一运行，不补点发送。提交状态不确定仍禁止自动重发。
3. 平台明确返回 `quota_exhausted` 时，账号当日预测额度立即耗尽（剩余 0），任务先记录失败，再经既有 retry 安全恢复并选择其他可用账号；无替代账号时保留排队，等待账号恢复或次日本地 00:00 刷新。
4. 应用保持打开时会在本机时区每日 00:00 刷新额度字段并重新处理队列；不重置网页可用性探测状态。
5. 任务区支持单 CSV 拖放导入，拒绝多文件、非 CSV、空文件和超过 10MB 的文件，反馈导入/跳过/未指派数量。
6. 新增唯一显式写入 CLI `import-csv`：必须显式提供 `--csv` 和 `--tasks-file`，复用 `TaskService.importCsv()`；任务文件读取后漂移即拒绝覆盖，落盘使用同目录临时文件原子替换。查询 CLI 与 MCP 继续只读。
7. 白名单识别豆包“下载电脑版 / 使用完整功能”推广弹窗，优先原生点击“下次提醒我”，其次使用同一弹窗内关闭控件，并回读确认消失。任务开始、新对话、模式切换、上传/提交前及页面加载稳定检测均会清障；素材授权、人机验证、额度提示和未知弹窗不自动关闭。

## 本包修改范围

### tracked 修改

- `AGENT_EXECUTION_PLAN.md`
- `README.md`
- `package.json`
- `main/cli/doubaoCliEntry.ts`
- `main/ipc/accounts.ts`
- `main/ipc/tasks.ts`
- `main/preload.ts`
- `main/utils/videoQuota.ts`
- `packages/contracts/src/dto/electron-api.ts`
- `packages/contracts/src/dto/tasks.ts`
- `src/App.tsx`
- `src/components/BrowserPanel.tsx`
- `src/components/TaskConsole.tsx`
- `src/store/useAccountStore.ts`
- `src/store/useTaskStore.ts`
- `src/styles/global.css`
- `src/utils/doubaoBridge.ts`
- `tests/unit/taskService.test.ts`

### untracked 新增

- `src/utils/csvDrop.ts`
- `src/utils/dailyReset.ts`
- `src/utils/quotaRecovery.ts`
- `src/utils/promotionalPopup.ts`
- `src/utils/uploadReadiness.ts`
- `tests/unit/csvProductionExperience.test.ts`
- `docs/handoffs/2026-08-27-doubao-csv-production-experience-01.md`

上述部分 tracked 文件在开工前已有其他未提交补丁；本包只增量修改相关位置，未覆盖或清理既有改动。

## 验证

- 专项首轮：5 files / 122 tests，通过。
- Core/本包回归：2 files / 194 tests，通过。
- `pnpm run validate`：通过。
  - TypeScript：0 error。
  - ESLint：0 error / 143 warning（未超过 149 上限，且与开工全量基线一致）。
  - 工程/Contracts 边界：通过，52 个 handle/invoke、3 个 on/send。
  - 全量测试：37 files / 869 tests，通过。
  - Renderer/Main build：通过。
- `git diff --check`：通过。

## 受保护资产与未执行事项

- `data/**`、`release/**`、`scripts/**`、Cookie、Token、账号 Session、用户产物零修改。
- 未提交真实豆包任务，未消耗视频/对话额度，未操作外部平台。
- 未暂存、未提交、未推送、未创建/修改 PR、未打包安装包、未部署、未发布。
- 当前未执行真实桌面页面提交验收；需在主进程/preload 重启后使用测试 CSV 做一次人工拖放与明确额度耗尽页面验收，且不得对提交状态不确定任务盲目复测。
- 收口时尝试连接 Windows Computer Use 做受控重启烟测，运行时明确返回 `Windows Computer Use Sky runtime is unavailable`；按安全规则未使用前台脚本或强杀进程绕过。
