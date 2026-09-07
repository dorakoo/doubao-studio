# 豆包工作室 2.3.4 指南与控制接口说明同步交接

- 包：`DOUBAO-234-GUIDANCE-REFRESH-01`
- 基线：`origin/main@249f478103c04296a49fa9d767dca6404e7f7dc5`
- 类型：docs-only
- 状态：已收口
- candidate：`71a661ff15af2e59f0f25603df8f1e493c887a52`
- PR：[#35](https://github.com/dorakoo/doubao-studio/pull/35)
- merge/main：`efea5c2fe9c23ddfd06d0c72c21b98e556033ca1`
- PR CI：`34120595774` SUCCESS
- main CI：`34121400704` SUCCESS

## 冻结验收包

已读取总架构师治理规则与仓库 `AGENTS.md`。本包只处理三个目标：

1. 将当前版本、Webview 常驻预热和列表排序说明对齐 2.3.4；
2. 明确正式 `--local-control` 与短时 `--local-cdp` 的用途、安全边界和 Agent 使用顺序；
3. 同步当前业务使用指南并为不可变历史事故/旧 SOP 添加 supersedes 指向。

后续补充：Agent 工具降级顺序明确为“内置直接接口 → 浏览器/CDP 接口 → Computer Use”，并增加逐操作能力矩阵。

非目标：不改功能代码、Contracts、持久化数据、账号 Session、任务、产物或平台状态；不执行真实生成。

## 当前事实

- 2.3.4 功能发布基线为 `249f478`，Release 为 `v2.3.4`。
- 正式控制面只监听 `127.0.0.1`，要求短期 Bearer 令牌和项目/批次/任务完整归属。
- CDP 默认关闭，仅用于短时开发诊断；长期 Computer Use、坐标或 DOM 编号不属于正式控制协议。
- Dola 仍未完成真实端到端验收。

## 验证与纪律

已执行：

- Markdown 本地链接：PASS。
- 版本/控制面/旧禁令残留扫描：PASS；历史事故正文保留并有 supersedes 通知。
- `git diff --check`：PASS。
- `pnpm run validate`：PASS。
- TypeScript（contracts/main/renderer/test）：零错误。
- ESLint：0 error / 146 warning（低于 149 门限）。
- 工程与 Contracts 边界：PASS。
- Vitest：47 files / 991 tests，全部通过。
- Renderer/Main build：PASS。

未修改功能代码、Contracts、账号 Session、任务、产物或平台状态；未执行真实生成。实现、测试、CI、人工验收、提交、推送、合并、部署和发布分别记录，未执行项不得推断完成。
