/**
 * src/components/Toolbar.tsx
 * 顶部工具栏
 *
 * 包含：
 * - 应用标题「豆包工作室」
 * - 窗口控制按钮（最小化/最大化/关闭）
 * - 全局操作：全部暂停/继续、批量下载产物
 */

import React from 'react';
import {
  MinusOutlined,
  BorderOutlined,
  CloseOutlined,
  PauseCircleOutlined,
  PlayCircleOutlined,
  DownloadOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
} from '@ant-design/icons';
import { Tooltip, Badge, Dropdown } from 'antd';
import type { MenuProps } from 'antd';
import { useTaskStore } from '../store/useTaskStore';

interface ToolbarProps {
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
}

export const Toolbar: React.FC<ToolbarProps> = ({ sidebarCollapsed, onToggleSidebar }) => {
  const { tasks, batchPause, getCompletedOutputs } = useTaskStore();
  const [isPaused, setIsPaused] = React.useState(false);

  // 运行中的任务数（包含 executing + generating）
  const runningCount = tasks.filter(
    (t) => t.status === 'executing' || t.status === 'generating'
  ).length;
  // 排队中的任务数
  const queuedCount = tasks.filter((t) => t.status === 'queued').length;
  // 已完成且有产物的任务数
  const completedWithOutputs = tasks.filter(
    (t) => t.status === 'done' && t.outputs.length > 0
  ).length;

  // 处理暂停/继续
  const handleTogglePause = async () => {
    if (!isPaused) {
      await batchPause();
      setIsPaused(true);
    } else {
      setIsPaused(false);
    }
  };

  // 批量下载产物
  const handleBatchDownload = async () => {
    const outputs = await getCompletedOutputs();
    if (outputs.length === 0) {
      // 无产物可下载时静默忽略
      return;
    }
    // 通知渲染进程有产物可下载
    const event = new CustomEvent('batch-download', {
      detail: outputs,
    });
    window.dispatchEvent(event);
  };

  // 更多操作菜单
  const moreMenuItems: MenuProps['items'] = [
    {
      key: 'settings',
      label: '偏好设置',
    },
    {
      key: 'about',
      label: '关于豆包工作室',
    },
  ];

  return (
    <div
      className="flex items-center justify-between h-11 px-3 bg-db-bg-secondary border-b border-db-border"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      {/* 左侧：标题 + 面板切换 */}
      <div className="flex items-center gap-3" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
        {/* 侧边栏折叠按钮 */}
        <Tooltip title={sidebarCollapsed ? '展开面板' : '折叠面板'}>
          <button className="btn-ghost" onClick={onToggleSidebar}>
            {sidebarCollapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
          </button>
        </Tooltip>

        {/* 应用标题 */}
        <div className="flex items-center gap-2">
          <span className="text-lg font-bold text-db-accent tracking-tight">
            豆包工作室
          </span>
          <span className="text-2xs text-db-text-muted bg-db-surface px-1.5 py-0.5 rounded">
            MVP
          </span>
        </div>

        {/* 任务状态指示 */}
        <div className="flex items-center gap-3 ml-4 text-xs text-db-text-secondary">
          {runningCount > 0 && (
            <span className="flex items-center gap-1">
              <span className="status-dot busy" />
              执行中 {runningCount}
            </span>
          )}
          {queuedCount > 0 && (
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-blue-400" />
              排队 {queuedCount}
            </span>
          )}
        </div>
      </div>

      {/* 中间：可拖拽区域 */}
      <div className="flex-1" />

      {/* 右侧：全局操作 + 窗口控制 */}
      <div className="flex items-center gap-1" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
        {/* 暂停/继续 */}
        <Tooltip title={isPaused ? '继续所有任务' : '暂停所有任务'}>
          <button className="btn-ghost" onClick={handleTogglePause}>
            {isPaused ? <PlayCircleOutlined /> : <PauseCircleOutlined />}
          </button>
        </Tooltip>

        {/* 批量下载 */}
        <Tooltip title={`下载已完成产物 (${completedWithOutputs})`}>
          <button
            className={`btn-ghost ${completedWithOutputs === 0 ? 'opacity-40 cursor-not-allowed' : ''}`}
            onClick={handleBatchDownload}
            disabled={completedWithOutputs === 0}
          >
            <DownloadOutlined />
          </button>
        </Tooltip>

        {/* 分隔线 */}
        <div className="w-px h-5 bg-db-border mx-1" />

        {/* 窗口控制按钮 */}
        <Tooltip title="最小化">
          <button className="btn-ghost" onClick={() => window.electronAPI?.system?.minimize()}>
            <MinusOutlined style={{ fontSize: 12 }} />
          </button>
        </Tooltip>
        <Tooltip title="最大化">
          <button className="btn-ghost" onClick={() => window.electronAPI?.system?.toggleMaximize()}>
            <BorderOutlined style={{ fontSize: 11 }} />
          </button>
        </Tooltip>
        <Tooltip title="关闭">
          <button
            className="btn-ghost hover:!bg-red-500/20 hover:!text-red-400"
            onClick={() => window.electronAPI?.system?.close()}
          >
            <CloseOutlined style={{ fontSize: 12 }} />
          </button>
        </Tooltip>
      </div>
    </div>
  );
};
