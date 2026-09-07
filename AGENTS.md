# AGENTS.md

## 项目概览
**豆包工作室 Doubao Studio Desktop** - 面向 AI 内容创作者的多账号管理与自动化生产工作台。Electron 桌面应用，左侧多账号管理+任务调度控制台，右侧会话隔离的内嵌豆包浏览器。

## 技术栈
- **运行时**: Electron 33 + Node.js 24
- **前端**: React 18 + TypeScript 5 + Ant Design 5 + Tailwind CSS 3
- **状态管理**: Zustand 5
- **构建**: Vite 6 (渲染进程) + tsc (主进程) + electron-builder (打包)
- **包管理**: pnpm

## 项目结构
```
├── main/                    # 主进程 (Electron Main Process)
│   ├── main.ts              # 应用入口：窗口创建、IPC 注册
│   ├── preload.ts           # 预加载脚本：contextBridge 暴露 API
│   ├── core/                # TaskService、Repository、事件流等任务域核心
│   ├── cli/                 # 只读查询与受控 CSV 导入 CLI
│   ├── mcp/                 # MCP stdio 服务端与客户端
│   ├── ipc/
│   │   ├── accounts.ts      # 账号管理 IPC (CRUD + Session 隔离)
│   │   └── tasks.ts         # 任务调度 IPC (队列管理 + 状态流转)
│   └── utils/               # 持久化、启动、额度与媒体辅助逻辑
├── packages/contracts/      # 主进程/渲染进程共享的纯类型契约
├── schemas/capability/v1/   # 对外 Capability API JSON Schema
├── src/                     # 渲染进程 (React)
│   ├── index.tsx            # React 入口 + Ant Design ConfigProvider
│   ├── App.tsx              # 主布局：三栏式 + 拖拽调整宽度
│   ├── components/
│   │   ├── Toolbar.tsx      # 顶部工具栏
│   │   ├── Sidebar.tsx      # 左侧面板容器（上下分区）
│   │   ├── AccountList.tsx  # 账号列表
│   │   ├── TaskConsole.tsx  # 任务控制台
│   │   └── BrowserPanel.tsx # 内嵌浏览器（webview）
│   ├── store/
│   │   ├── useAccountStore.ts # 账号状态管理
│   │   └── useTaskStore.ts    # 任务状态管理
│   ├── types/
│   │   ├── index.ts         # 全局类型定义
│   │   └── electron.d.ts    # Electron API 类型声明
│   └── styles/
│       └── global.css       # Tailwind + 自定义组件样式
├── tests/unit/              # Node/Vitest 行为与边界测试
├── docs/                    # 架构设计、handoff 与 README 图文资产
├── examples/                # CSV 模板与适配规则示例
├── package.json
├── tsconfig.json            # 基础 TS 配置
├── tsconfig.main.json       # 主进程 TS 配置 (CommonJS)
├── tsconfig.renderer.json   # 渲染进程 TS 配置 (ESNext + JSX)
├── vite.config.ts           # Vite 配置
├── tailwind.config.js       # Tailwind 配置（品牌色系）
├── .coze                    # 沙箱构建/运行配置
└── DESIGN.md                # 设计规范
```

## 构建和运行
```bash
# 安装依赖
pnpm install

# 开发模式（启动 Vite + Electron）
pnpm run dev

# 仅编译主进程 TypeScript
pnpm run build:main

# 编译全部 + 打包 Windows .exe
pnpm run dist:win

# 完整本地/CI 门禁（类型、Lint、工程规则、测试、构建）
pnpm run validate

# 仅类型检查 / 仅 ESLint
pnpm run ts-check
pnpm run lint
```

## 核心架构决策

### Session 隔离
每个账号使用独立的 Electron session partition (`persist:doubao_<account_uuid>`)，实现 Cookie/Storage 隔离。2.3.4 启动时按单通道顺序预热全部账号；已创建的 Webview 常驻，当前账号原位交互，后台账号移到屏外保活。任务账号受前台交互租约保护，不得回收、复用其他账号 partition，或恢复 lazy-only / “切换即销毁”策略。可用性排序只能改变列表投影，不得改变账号 ID、partition 或用户置顶事实。

### 数据持久化
使用本地 JSON 文件存储（`electron.app.getPath('userData')/DoubaoStudioData/`），避免引入额外原生依赖。accounts.json 和 tasks.json 分别存储账号和任务数据。

任务域读写必须经过 `TaskService` 与 Repository。桌面运行时禁止外部进程直接编辑 `tasks.json`；唯一显式写入型 CLI `import-csv` 只能在桌面程序退出后使用，并必须显式指定真实数据文件。

### 平台写入安全

平台提交遵循“输入与控件回读 → 提交意图持久化 → 单次发送 → 平台回读”。提交结果不确定、页面控件不稳定、登录/人机验证/素材授权未处理或账号额度不可确认时必须 fail-closed，禁止自动重复发送或请求改写绕过平台限制。

Dola 当前只有账号平台字段、Session/URL 边界和 CSV 账号消歧接线，尚未完成真实端到端人工验收。任何开发或文档不得把 Dola 表述为生产可用；进入平台写入前必须重新冻结并验证登录、控件、提交、生成、产物和下载全链。

### IPC 通信
主进程通过 `ipcMain.handle` 注册处理器，渲染进程通过 `contextBridge.exposeInMainWorld` 暴露的 `window.electronAPI` 调用，严格遵循 contextIsolation + 无 nodeIntegration 的安全模式。

### 本机控制接口

- 正式 Agent 控制只使用 `--local-control`：固定监听 `127.0.0.1`、Bearer 鉴权、按项目/批次/任务 ID 定位，并复用正式调度链。
- `--local-cdp` 默认关闭，只允许开发者短时诊断或隔离验收；不得作为长期生产控制、任务归属或完成判定接口。
- 不得依赖截图坐标、跨会话 DOM/元素编号、长期 Computer Use 或任意脚本注入驱动生产。
- 任何控制输出均不得包含 Cookie、Token、完整 Session、提示词全文、素材绝对路径或内部页面 URL。详见 `docs/LOCAL_CONTROL.md`。

## 代码规范
- 所有函数参数和返回值**必须标注类型**，禁止隐式 any
- 使用 `React.FC` 类型标注函数组件
- 中文注释优先，关键逻辑必须注释
- 使用 Tailwind 工具类优先，必要时补充自定义 CSS
- Ant Design 组件通过 ConfigProvider 统一深色主题

## 设计规范
参见 [DESIGN.md](./DESIGN.md) - 深色创作者工具风格，紫色强调色系。
