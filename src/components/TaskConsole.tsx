/**
 * src/components/TaskConsole.tsx
 * 任务调度控制台
 *
 * 功能：
 * - 任务队列列表（排队中/执行中/已完成/失败）
 * - 添加任务：支持批量粘贴多行提示词，每行一个任务
 * - 任务指派：选择目标账号
 * - 任务状态筛选
 */

import React, { useState, useCallback, useMemo } from 'react';
import {
  PlusOutlined,
  DeleteOutlined,
  SendOutlined,
  FilterOutlined,
  CloseOutlined,
} from '@ant-design/icons';
import {
  Input,
  Modal,
  Select,
  Tooltip,
  Empty,
  Segmented,
} from 'antd';
import { useTaskStore } from '../store/useTaskStore';
import { useAccountStore } from '../store/useAccountStore';
import { TASK_STATUS_CONFIG } from '../types';
import type { Task, TaskStatus } from '../types';

/** 状态筛选选项 */
type FilterOption = 'all' | TaskStatus;

const FILTER_OPTIONS: { value: FilterOption; label: string }[] = [
  { value: 'all', label: '全部' },
  { value: 'queued', label: '排队' },
  { value: 'running', label: '执行' },
  { value: 'done', label: '完成' },
  { value: 'fail', label: '失败' },
];

export const TaskConsole: React.FC = () => {
  const { tasks, loading, addTasks, assignTask, deleteTask } = useTaskStore();
  const { accounts } = useAccountStore();

  // 添加任务弹窗
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [taskText, setTaskText] = useState('');
  const [adding, setAdding] = useState(false);

  // 状态筛选
  const [statusFilter, setStatusFilter] = useState<FilterOption>('all');

  // 指派弹窗
  const [assigningTaskId, setAssigningTaskId] = useState<string | null>(null);
  const [assigningAccountId, setAssigningAccountId] = useState<string | null>(null);

  // ---- 筛选后的任务列表 ----
  const filteredTasks = useMemo(() => {
    if (statusFilter === 'all') return tasks;
    return tasks.filter((t) => t.status === statusFilter);
  }, [tasks, statusFilter]);

  // 各状态数量
  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = { all: tasks.length };
    for (const t of tasks) {
      counts[t.status] = (counts[t.status] || 0) + 1;
    }
    return counts;
  }, [tasks]);

  // ---- 添加任务 ----
  const handleAddTasks = useCallback(async () => {
    if (!taskText.trim()) return;
    setAdding(true);
    const success = await addTasks(taskText);
    setAdding(false);
    if (success) {
      setTaskText('');
      setAddModalOpen(false);
    }
  }, [taskText, addTasks]);

  // ---- 指派任务 ----
  const handleAssignTask = useCallback(async () => {
    if (!assigningTaskId || !assigningAccountId) return;
    const success = await assignTask(assigningTaskId, assigningAccountId);
    if (success) {
      setAssigningTaskId(null);
      setAssigningAccountId(null);
    }
  }, [assigningTaskId, assigningAccountId, assignTask]);

  // ---- 删除任务 ----
  const handleDeleteTask = useCallback(
    async (taskId: string) => {
      await deleteTask(taskId);
    },
    [deleteTask]
  );

  // ---- 获取账号名称 ----
  const getAccountName = useCallback(
    (accountId: string | null): string => {
      if (!accountId) return '未指派';
      const account = accounts.find((a) => a.id === accountId);
      return account ? account.name : '未知账号';
    },
    [accounts]
  );

  return (
    <div className="flex flex-col h-full">
      {/* 面板标题栏 */}
      <div className="panel-header">
        <span className="panel-title">任务调度</span>
        <Tooltip title="添加任务（支持批量）">
          <button
            className="btn-ghost text-db-accent hover:!text-db-accent-light"
            onClick={() => setAddModalOpen(true)}
          >
            <PlusOutlined />
          </button>
        </Tooltip>
      </div>

      {/* 状态筛选栏 */}
      <div className="px-3 py-2 border-b border-db-border">
        <Segmented
          options={FILTER_OPTIONS.map((opt) => ({
            value: opt.value,
            label: (
              <span className="flex items-center gap-1 text-xs">
                {opt.label}
                {statusCounts[opt.value] > 0 && (
                  <span className="text-2xs opacity-60">
                    ({statusCounts[opt.value]})
                  </span>
                )}
              </span>
            ),
          }))}
          value={statusFilter}
          onChange={(val) => setStatusFilter(val as FilterOption)}
          size="small"
          block
        />
      </div>

      {/* 任务列表 */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {filteredTasks.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={
                <span className="text-db-text-muted text-xs">
                  {tasks.length === 0 ? '暂无任务，点击 + 添加' : '无匹配任务'}
                </span>
              }
            />
          </div>
        ) : (
          filteredTasks.map((task) => {
            const statusConfig = TASK_STATUS_CONFIG[task.status];

            return (
              <div
                key={task.id}
                className="group flex flex-col gap-1.5 px-3 py-2.5 rounded-db bg-db-surface hover:bg-db-surface-hover border border-transparent hover:border-db-border transition-all duration-200"
              >
                {/* 提示词文本 */}
                <div className="text-xs text-db-text-primary leading-relaxed line-clamp-2">
                  {task.prompt}
                </div>

                {/* 底部信息行 */}
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    {/* 状态标签 */}
                    <span className={`task-tag ${statusConfig.className}`}>
                      {statusConfig.label}
                    </span>

                    {/* 指派账号 */}
                    <span className="text-2xs text-db-text-muted truncate">
                      {getAccountName(task.assignedAccountId)}
                    </span>
                  </div>

                  {/* 操作按钮 */}
                  <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    {/* 指派按钮 */}
                    <Tooltip title="指派账号">
                      <button
                        className="btn-ghost w-6 h-6"
                        onClick={() => {
                          setAssigningTaskId(task.id);
                          setAssigningAccountId(task.assignedAccountId);
                        }}
                      >
                        <SendOutlined style={{ fontSize: 11 }} />
                      </button>
                    </Tooltip>

                    {/* 删除按钮 */}
                    <Tooltip title="删除任务">
                      <button
                        className="btn-ghost w-6 h-6 hover:!text-red-400"
                        onClick={() => handleDeleteTask(task.id)}
                      >
                        <DeleteOutlined style={{ fontSize: 11 }} />
                      </button>
                    </Tooltip>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* 底部统计 */}
      <div className="px-3 py-2 border-t border-db-border text-2xs text-db-text-muted flex items-center justify-between">
        <span>
          共 {tasks.length} 个任务
          {statusFilter !== 'all' && ` · 筛选 ${statusCounts[statusFilter] || 0} 个`}
        </span>
        <span>
          {statusCounts['done'] || 0} 完成 / {statusCounts['fail'] || 0} 失败
        </span>
      </div>

      {/* 添加任务弹窗 */}
      <Modal
        title="添加任务"
        open={addModalOpen}
        onOk={handleAddTasks}
        onCancel={() => {
          setAddModalOpen(false);
          setTaskText('');
        }}
        confirmLoading={adding}
        okText="添加"
        cancelText="取消"
        centered
        width={520}
      >
        <div className="py-4">
          <p className="text-xs text-db-text-secondary mb-3">
            输入提示词文本，每行一个任务，支持批量粘贴
          </p>
          <Input.TextArea
            placeholder={'示例：\n写一篇关于AI的科普文章\n帮我设计一个产品Logo\n分析这份数据报告'}
            value={taskText}
            onChange={(e) => setTaskText(e.target.value)}
            rows={8}
            autoFocus
            style={{
              backgroundColor: '#1a1a24',
              borderColor: '#2a2a3e',
              color: '#e8e8f0',
              fontSize: 13,
              lineHeight: 1.8,
              fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
            }}
          />
          <p className="text-2xs text-db-text-muted mt-2">
            当前将添加 {taskText.trim() ? taskText.split('\n').filter((l) => l.trim()).length : 0} 个任务
          </p>
        </div>
      </Modal>

      {/* 指派账号弹窗 */}
      <Modal
        title="指派账号"
        open={!!assigningTaskId}
        onOk={handleAssignTask}
        onCancel={() => {
          setAssigningTaskId(null);
          setAssigningAccountId(null);
        }}
        okText="确认指派"
        cancelText="取消"
        centered
        width={420}
        okButtonProps={{ disabled: !assigningAccountId }}
      >
        <div className="py-4">
          <p className="text-xs text-db-text-secondary mb-3">
            选择执行此任务的目标账号
          </p>
          <Select
            placeholder="选择账号"
            value={assigningAccountId}
            onChange={(val) => setAssigningAccountId(val)}
            options={accounts.map((a) => ({
              value: a.id,
              label: (
                <div className="flex items-center gap-2">
                  <span
                    className="status-dot"
                    style={{
                      backgroundColor:
                        a.status === 'idle'
                          ? '#4ade80'
                          : a.status === 'busy'
                          ? '#fbbf24'
                          : '#f87171',
                    }}
                  />
                  {a.name}
                  <span className="text-2xs text-db-text-muted">
                    ({a.status === 'idle' ? '空闲' : a.status === 'busy' ? '忙碌' : '异常'})
                  </span>
                </div>
              ),
            }))}
            style={{ width: '100%' }}
            size="large"
            allowClear
          />
        </div>
      </Modal>
    </div>
  );
};
