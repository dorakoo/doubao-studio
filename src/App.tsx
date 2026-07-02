/**
 * src/App.tsx
 * 应用根组件 - 主布局
 *
 * 布局结构（三栏式）：
 * ┌──────────────────────────────────────────────────┐
 * │              顶部工具栏 (Toolbar)                  │
 * ├──────────────┬───────────────────────────────────┤
 * │  左侧面板     │                                   │
 * │  (可折叠)     │       右侧浏览器区域                │
 * │  320px       │       (BrowserPanel)               │
 * │              │                                   │
 * │  账号列表     │                                   │
 * │  (AccountList│                                   │
 * │              │                                   │
 * │  任务控制台   │                                   │
 * │  (TaskConsole│                                   │
 * │              │                                   │
 * └──────────────┴───────────────────────────────────┘
 */

import React, { useEffect, useState, useCallback, useRef } from 'react';
import { App as AntApp, message } from 'antd';
import { Toolbar } from './components/Toolbar';
import { Sidebar } from './components/Sidebar';
import { BrowserPanel } from './components/BrowserPanel';
import { useAccountStore } from './store/useAccountStore';
import { useTaskStore } from './store/useTaskStore';

const App: React.FC = () => {
  // 左侧面板折叠状态
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  // 左侧面板宽度
  const [sidebarWidth, setSidebarWidth] = useState(340);
  // 是否正在拖拽调整宽度
  const [isResizing, setIsResizing] = useState(false);

  const { loadAccounts, accounts, selectedAccountId } = useAccountStore();
  const { loadTasks } = useTaskStore();

  // 初始加载数据
  useEffect(() => {
    loadAccounts();
    loadTasks();
  }, [loadAccounts, loadTasks]);

  // ---- 拖拽调整面板宽度 ----

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
  }, []);

  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      const newWidth = Math.max(280, Math.min(500, e.clientX));
      setSidebarWidth(newWidth);
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing]);

  return (
    <AntApp>
      <div className="flex flex-col h-screen w-screen overflow-hidden bg-db-bg select-none">
        {/* 顶部工具栏 */}
        <Toolbar
          sidebarCollapsed={sidebarCollapsed}
          onToggleSidebar={() => setSidebarCollapsed(!sidebarCollapsed)}
        />

        {/* 主内容区 */}
        <div className="flex flex-1 overflow-hidden">
          {/* 左侧面板（可折叠） */}
          <div
            className={`flex-shrink-0 overflow-hidden transition-all duration-300 ${
              sidebarCollapsed ? 'w-0 border-r-0' : 'border-r border-db-border'
            }`}
            style={{ width: sidebarCollapsed ? 0 : sidebarWidth }}
          >
            <Sidebar />
          </div>

          {/* 拖拽分隔线 */}
          {!sidebarCollapsed && (
            <div
              className={`resize-handle ${isResizing ? 'bg-db-accent/50' : ''}`}
              onMouseDown={handleMouseDown}
            />
          )}

          {/* 右侧浏览器面板 */}
          <div className="flex-1 overflow-hidden">
            <BrowserPanel />
          </div>
        </div>
      </div>
    </AntApp>
  );
};

export default App;
