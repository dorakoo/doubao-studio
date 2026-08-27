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
import { useProjectStore } from './store/useProjectStore';
import { clampSidebarWidth } from './utils/resizeMath';
import { millisecondsUntilNextLocalMidnight } from './utils/dailyReset';
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
  /** 拖动期间覆盖 webview，防止其吞掉 mouseup。 */
  const [isSidebarResizing, setIsSidebarResizing] = useState(false);

  /** 分隔线拖拽状态 */
  const sidebarRef = useRef<HTMLDivElement>(null);
  const resizerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    startX: number;
    startWidth: number;
    pendingWidth: number;
    frameId: number | null;
  } | null>(null);

  // Store
  const activeAccountId = useAccountStore((s) => s.selectedAccountId);
  const accounts = useAccountStore((s) => s.accounts);
  const activeTaskId = useTaskStore((s) => s.activeTaskId);
  const tasks = useTaskStore((s) => s.tasks);
  const loadAccounts = useAccountStore((s) => s.loadAccounts);
  const refreshDailyQuota = useAccountStore((s) => s.refreshDailyQuota);
  const loadTasks = useTaskStore((s) => s.loadTasks);
  const loadProjects = useProjectStore((s) => s.loadProjects);

  /** 当前活跃账号对象 */
  const activeAccount = accounts.find((a) => a.id === activeAccountId) || null;
  /** 当前自动化任务对象 */
  const activeTask = tasks.find((t) => t.id === activeTaskId) || null;

  // ---- 初始化加载 ----

  useEffect(() => {
    loadAccounts();
    loadProjects();
    loadTasks(true);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const scheduleMidnightRefresh = () => {
      timer = setTimeout(async () => {
        await refreshDailyQuota();
        useTaskStore.getState().processQueue();
        scheduleMidnightRefresh();
      }, millisecondsUntilNextLocalMidnight() + 250);
    };
    scheduleMidnightRefresh();
    return () => { if (timer) clearTimeout(timer); };
  }, [loadAccounts, loadProjects, loadTasks, refreshDailyQuota]);

  // ---- 面板折叠 ----

  const handleToggleCollapse = useCallback(() => {
    setCollapsed((prev) => !prev);
  }, []);

  // ---- 分隔线拖拽 ----

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsSidebarResizing(true);
    dragRef.current = { startX: e.clientX, startWidth: sidebarWidth, pendingWidth: sidebarWidth, frameId: null };

    const handleMouseMove = (ev: MouseEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      drag.pendingWidth = clampSidebarWidth(
        drag.startWidth + ev.clientX - drag.startX,
        MIN_SIDEBAR_WIDTH,
        MAX_SIDEBAR_WIDTH,
      );
      if (drag.frameId !== null) return;
      drag.frameId = requestAnimationFrame(() => {
        const current = dragRef.current;
        if (!current) return;
        current.frameId = null;
        // 拖动中只移动轻量预览线，避免每帧重排右侧所有常驻 webview。
        if (resizerRef.current) {
          resizerRef.current.style.transform = `translate3d(${current.pendingWidth - current.startWidth}px, 0, 0)`;
        }
      });
    };

    const handleMouseUp = () => {
      const drag = dragRef.current;
      if (drag?.frameId !== null && drag?.frameId !== undefined) cancelAnimationFrame(drag.frameId);
      if (drag) {
        if (sidebarRef.current) sidebarRef.current.style.width = `${drag.pendingWidth}px`;
        if (resizerRef.current) resizerRef.current.style.transform = '';
        setSidebarWidth(drag.pendingWidth);
      }
      dragRef.current = null;
      setIsSidebarResizing(false);
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
        {isSidebarResizing && <div className="resize-capture-overlay resize-capture-overlay-col" />}
        {/* 左侧面板 */}
        <div
          ref={sidebarRef}
          className={`app-sidebar ${collapsed ? 'collapsed' : ''}`}
          style={{ width: collapsed ? 0 : sidebarWidth }}
        >
          {!collapsed && <Sidebar />}
        </div>

        {/* 分隔线 */}
        {!collapsed && (
          <div
            ref={resizerRef}
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
