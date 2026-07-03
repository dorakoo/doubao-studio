/**
 * src/App.tsx
 * 主布局组件 — 三栏式 + V2 自动化任务流
 *
 * 左侧：Sidebar（账号列表 + 任务控制台）
 * 右侧：BrowserPanel（内嵌 webview + 自动化执行）
 * 拖拽分隔线可调整左右宽度
 */

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { Sidebar } from './components/Sidebar';
import BrowserPanel from './components/BrowserPanel';
import { Toolbar } from './components/Toolbar';
import { useAccountStore } from './store/useAccountStore';
import { useTaskStore } from './store/useTaskStore';
import './styles/global.css';

// ==================== 常量 ====================

const MIN_SIDEBAR_WIDTH = 280;
const MAX_SIDEBAR_WIDTH = 500;
const DEFAULT_SIDEBAR_WIDTH = 340;

// ==================== 组件 ====================

const App: React.FC = () => {
  /** 左侧面板宽度 */
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR_WIDTH);
  /** 是否折叠左侧面板 */
  const [collapsed, setCollapsed] = useState(false);

  /** 分隔线拖拽状态 */
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);

  // Store
  const activeAccountId = useAccountStore((s) => s.selectedAccountId);
  const accounts = useAccountStore((s) => s.accounts);
  const activeTaskId = useTaskStore((s) => s.activeTaskId);
  const tasks = useTaskStore((s) => s.tasks);
  const loadAccounts = useAccountStore((s) => s.loadAccounts);
  const loadTasks = useTaskStore((s) => s.loadTasks);

  /** 当前活跃账号对象 */
  const activeAccount = accounts.find((a) => a.id === activeAccountId) || null;
  /** 当前自动化任务对象 */
  const activeTask = tasks.find((t) => t.id === activeTaskId) || null;

  // ---- 初始化加载 ----

  useEffect(() => {
    loadAccounts();
    loadTasks();
  }, []);

  // ---- 面板折叠 ----

  const handleToggleCollapse = useCallback(() => {
    setCollapsed((prev) => !prev);
  }, []);

  // ---- 分隔线拖拽 ----

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragRef.current = { startX: e.clientX, startWidth: sidebarWidth };

    const handleMouseMove = (ev: MouseEvent) => {
      if (!dragRef.current) return;
      const delta = ev.clientX - dragRef.current.startX;
      const next = Math.min(
        MAX_SIDEBAR_WIDTH,
        Math.max(MIN_SIDEBAR_WIDTH, dragRef.current.startWidth + delta)
      );
      setSidebarWidth(next);
    };

    const handleMouseUp = () => {
      dragRef.current = null;
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [sidebarWidth]);

  // ==================== 渲染 ====================

  return (
    <div className="app-root">
      {/* 顶部工具栏 */}
      <Toolbar
        onToggleSidebar={handleToggleCollapse}
        sidebarCollapsed={collapsed}
      />

      {/* 主体区域 */}
      <div className="app-body">
        {/* 左侧面板 */}
        <div
          className={`app-sidebar ${collapsed ? 'collapsed' : ''}`}
          style={{ width: collapsed ? 0 : sidebarWidth }}
        >
          {!collapsed && <Sidebar />}
        </div>

        {/* 分隔线 */}
        {!collapsed && (
          <div
            className="app-resizer"
            onMouseDown={handleMouseDown}
          >
            <div className="resizer-handle" />
          </div>
        )}

        {/* 右侧浏览器 */}
        <div className="app-browser">
          <BrowserPanel
            accounts={accounts}
            activeAccount={activeAccount}
            refreshKey={0}
            
          />
        </div>
      </div>
    </div>
  );
};

export default App;
