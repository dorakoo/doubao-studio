/**
 * src/components/Sidebar.tsx
 * 左侧面板容器
 *
 * 上半部分：账号列表 (AccountList)
 * 下半部分：任务控制台 (TaskConsole)
 * 中间有拖拽调整大小的分隔线
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { AccountList } from './AccountList';
import { TaskConsole } from './TaskConsole';

export const Sidebar: React.FC = () => {
  // 上下两部分的分隔比例（0.4 = 账号区占 40%，任务区占 60%）
  const [splitRatio, setSplitRatio] = useState(0.45);
  const [isDragging, setIsDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // 拖拽分隔线
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const offsetY = e.clientY - rect.top;
      const ratio = Math.max(0.2, Math.min(0.7, offsetY / rect.height));
      setSplitRatio(ratio);
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging]);

  return (
    <div ref={containerRef} className="flex flex-col h-full bg-db-bg-secondary">
      {/* 账号列表区域 */}
      <div className="overflow-hidden" style={{ height: `${splitRatio * 100}%` }}>
        <AccountList />
      </div>

      {/* 可拖拽分隔线 */}
      <div
        className={`h-1 flex-shrink-0 cursor-row-resize transition-colors duration-150 ${
          isDragging ? 'bg-db-accent' : 'bg-db-border hover:bg-db-accent/30'
        }`}
        onMouseDown={handleMouseDown}
      />

      {/* 任务控制台区域 */}
      <div className="flex-1 overflow-hidden">
        <TaskConsole />
      </div>
    </div>
  );
};
