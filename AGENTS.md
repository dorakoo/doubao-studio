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
│   ├── ipc/
│   │   ├── accounts.ts      # 账号管理 IPC (CRUD + Session 隔离)
│   │   └── tasks.ts         # 任务调度 IPC (队列管理 + 状态流转)
│   └── utils/
│       └── store.ts         # 本地 JSON 持久化工具
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
├── data/                    # 运行时数据目录（账号/任务 JSON 持久化）
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

# 类型检查
pnpm run lint
```

## 核心架构决策

### Session 隔离
每个账号使用独立的 Electron session partition (`persist:doubao_<account_uuid>`)，实现 Cookie/Storage 完全隔离。账号切换时销毁旧 webview，创建新 webview 并指定对应 partition。

### 数据持久化
使用本地 JSON 文件存储（`electron.app.getPath('userData')/DoubaoStudioData/`），避免引入额外原生依赖。accounts.json 和 tasks.json 分别存储账号和任务数据。

### IPC 通信
主进程通过 `ipcMain.handle` 注册处理器，渲染进程通过 `contextBridge.exposeInMainWorld` 暴露的 `window.electronAPI` 调用，严格遵循 contextIsolation + 无 nodeIntegration 的安全模式。

## 代码规范
- 所有函数参数和返回值**必须标注类型**，禁止隐式 any
- 使用 `React.FC` 类型标注函数组件
- 中文注释优先，关键逻辑必须注释
- 使用 Tailwind 工具类优先，必要时补充自定义 CSS
- Ant Design 组件通过 ConfigProvider 统一深色主题

## 设计规范
参见 [DESIGN.md](./DESIGN.md) - 深色创作者工具风格，紫色强调色系。
