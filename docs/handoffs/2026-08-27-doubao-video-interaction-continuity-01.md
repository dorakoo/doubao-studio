# DOUBAO-VIDEO-INTERACTION-CONTINUITY-01 实施与验收报告

- 日期：2026-08-27
- 工作树：`D:\豆包工作室\doubao-automation-closeout-01`
- 分支：`codex/doubao-startup-webview-recovery-01`
- 基线 HEAD：`83a328ae576a84a1094164535526d7a1fd50b30e`（`origin/main`）
- 当前 HEAD：同基线（本包未提交）
- 叠加现场：同工作树内未提交的 `DOUBAO-STARTUP-WEBVIEW-RECOVERY-01`，本包未覆盖或清理其改动

## 1. 治理与冻结验收包

开工前已完整读取总架构师治理规则、豆包仓库 `AGENTS.md`、自动化收口/视频控件/提交对账相关 handoff。本包冻结三个 P0：

1. 配置、上传、注入和提交期间建立唯一前台交互账号租约，避免用户切换页面导致当前任务失去输入框。
2. 素材授权“安全确认”只检测、不代点；人工确认可能直接提交时，继续回读同一 run，禁止二次发送并保持产物绑定链。
3. 左右主分隔条及账号/任务上下分隔条改为帧级 DOM 更新，松手时才提交一次 React 状态。

红线：不自动接受素材权利承诺；不提交真实视频任务；不消耗额度；不读取或修改 Cookie、Token、账号数据和任务产物。

## 2. 根因与唯一行为变化

### P0-1 前台交互账号连续性

根因：多个账号的 webview 虽然常驻，但配置和原生输入依赖当前可见前台页面；账号列表与任务卡都能在任务处于 `injecting/submitting` 时切换页面，导致自动化继续操作隐藏或已切走的页面并报“无法识别输入框”。

整改：以 `injecting/submitting` 为唯一交互租约状态；账号列表、任务卡跳转和可用性检测入口统一阻止切到其它账号；队列在租约存在时不启动下一账号，首个任务进入 `generating` 后释放租约并继续调度。生成和产物轮询仍可在隐藏 webview 中并行。

唯一行为变化：配置/提交阶段暂时不能人工切换到其它账号；进入生成阶段立即恢复切换和下一账号调度。

### P0-2 素材授权确认与任务跟踪

新人工证据推翻旧假设：平台“确认”按钮可能直接继续提交视频，并非只解除按钮遮挡。本报告 supersedes 旧报告中“确认只解除遮挡”的事实。

整改：Bridge 永久删除自动点击，改为只读严格分类 `absent/present/blocked`。识别到完整弹窗时先持久化当前 run 的 `submittedAt` 和 `waiting_verification`，显示常驻提醒；用户人工确认后只回读同一次提交证据，成功则进入原任务生成监控与产物绑定。拒绝、异常关闭、结构不完整或超时均 fail-closed，保留提交意图并禁止补点发送。

唯一行为变化：软件不再替用户接受素材授权；人工确认不会令台账失联，也不会触发第二次提交。

### P0-3 分隔条拖拽卡顿

根因：旧实现每个 `mousemove` 都调用 React state setter，使包含账号列表、任务列表和 webview 的大组件树高频重渲染。

整改（R2）：第一轮帧级修改真实宽高虽消除了 React 高频重渲染，但人工反馈仍有可感知卡顿，根因是常驻 webview 仍随每帧尺寸变化重排。最终实现改为 mousemove 只记录位置并移动 GPU transform 预览线；真实面板尺寸和 React state 均只在 mouseup 提交一次。尺寸计算保持原边界：主侧栏 280–500px，上下比例 20%–70%。

R3 人工验收发现向右拖入豆包 webview 后，guest surface 会吞掉主 renderer 的 `mouseup`。拖拽期间现增加透明全窗捕获层，确保指针进入网页区域后仍可原位松手提交；捕获层只在拖拽期间存在，不影响正常网页交互。

## 3. 实际修改文件

### tracked 修改

- `src/App.tsx`
- `src/components/AccountList.tsx`
- `src/components/BrowserPanel.tsx`
- `src/components/Sidebar.tsx`
- `src/components/TaskConsole.tsx`
- `src/store/useTaskStore.ts`
- `src/utils/doubaoBridge.ts`
- `tests/unit/real-send-recovery.test.ts`

### untracked 新增

- `src/utils/interactiveAccount.ts`
- `src/utils/materialAuthorization.ts`
- `src/utils/resizeMath.ts`
- `tests/unit/interactionContinuity.test.ts`
- `docs/handoffs/2026-08-27-doubao-video-interaction-continuity-01.md`

### tracked 删除

- 无。

## 4. 验证结果

- 专项：`interactionContinuity + real-send-recovery + webviewLifecycle`，3 files / 42 pass / 0 fail。
- 新增连续性专项：8 pass / 0 fail，覆盖交互租约、所有切页入口、授权弹窗严格分类、确认后同 run 回读及帧级拖拽。
- TypeScript：`pnpm run ts-check`，PASS。
- 修改文件 ESLint：0 error；全量 ESLint：0 error / 143 warning，小于 149 上限。
- 工程结构与 contracts 边界：PASS。
- 全量测试：36 files / 848 pass / 0 fail。
- Renderer build：PASS；Main build：PASS。
- `git diff --check`：PASS。

Windows Computer Use 当前仍返回 `Sky runtime unavailable`，因此没有伪造可视化拖拽或真实平台提交结论。真实视频任务未执行，素材授权后的生产链需用户在开发版进行一次人工验收。

## 5. 纪律与裁决

- 三个 P0 代码实现：PASS。
- 自动化、类型、Lint、工程边界和构建门禁：PASS。
- 真实平台人工验收：待执行。
- 未暂存、未提交、未推送、未创建或修改 PR、未打包、未发布。
- 未提交任务、未上传素材、未发送消息、未消耗豆包额度。
- 未修改账号数据、任务 JSON、Cookie、Token 或用户产物。

本报告不把“已实现/自动化验证”表述为“已发布”。
