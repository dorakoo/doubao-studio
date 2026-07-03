/**
 * src/components/TaskConsole.tsx
 * 任务调度控制台 — V2 自动化 UI
 *
 * 支持批量添加任务、指派账号、启动自动化执行、查看状态
 */

import React, { useState, useCallback } from 'react';
import { Button, Select, Input, Modal, Dropdown, Space } from 'antd';
import type { MenuProps } from 'antd';
import {
  PlusOutlined,
  DeleteOutlined,
  PlayCircleOutlined,
  PauseCircleOutlined,
  DownloadOutlined,
  LoadingOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  ClockCircleOutlined,
  ThunderboltOutlined,
  SyncOutlined,
} from '@ant-design/icons';
import { useTaskStore } from '../store/useTaskStore';
import { useAccountStore } from '../store/useAccountStore';
import { TASK_STATUS_CONFIG, type TaskStatus } from '../types';

const { TextArea } = Input;

// ==================== 组件 ====================

const TaskConsole: React.FC = () => {
  const {
    tasks,
    addTasks,
    assignTask,
    deleteTask,
    batchPause,
    getCompletedOutputs,
    startAutomation,
    automationState,
    accountBusy,
    clearError,
    error,
  } = useTaskStore();

  const accounts = useAccountStore((s) => s.accounts);

  const [inputText, setInputText] = useState('');
  const [addModalOpen, setAddModalOpen] = useState(false);

  // ---- 添加任务 ----

  const handleAddTasks = useCallback(async () => {
    const ok = await addTasks(inputText);
    if (ok) {
      setInputText('');
      setAddModalOpen(false);
    }
  }, [inputText, addTasks]);

  // ---- 指派账号 ----

  const handleAssign = useCallback(
    async (taskId: string, accountId: string) => {
      await assignTask(taskId, accountId);
    },
    [assignTask]
  );

  // ---- 启动自动化 ----

  const handleStartTask = useCallback(
    async (taskId: string) => {
      await clearError();
      startAutomation(taskId);
    },
    [startAutomation, clearError]
  );

  // ---- 右键菜单 ----

  const getContextMenu = (taskId: string): MenuProps['items'] => [
    {
      key: 'delete',
      label: '删除任务',
      icon: <DeleteOutlined />,
      danger: true,
      onClick: () => deleteTask(taskId),
    },
  ];

  // ---- 渲染状态标签 ----

  const renderStatusTag = (status: TaskStatus) => {
    const cfg = TASK_STATUS_CONFIG[status];
    return (
      <span className={`task-status-tag ${cfg.className}`} style={{ borderColor: cfg.color, color: cfg.color }}>
        {status === 'generating' && <SyncOutlined spin style={{ marginRight: 4 }} />}
        {status === 'executing' && <ThunderboltOutlined style={{ marginRight: 4 }} />}
        {status === 'queued' && <ClockCircleOutlined style={{ marginRight: 4 }} />}
        {status === 'done' && <CheckCircleOutlined style={{ marginRight: 4 }} />}
        {status === 'fail' && <CloseCircleOutlined style={{ marginRight: 4 }} />}
        {cfg.label}
      </span>
    );
  };

  // ---- 渲染任务项 ----

  const renderTaskItem = (task: (typeof tasks)[0]) => {
    const isActive = task.status === 'executing' || task.status === 'generating';
    const isQueued = task.status === 'queued';
    const canStart = isQueued && task.assignedAccountId && !accountBusy[task.assignedAccountId];

    return (
      <Dropdown menu={{ items: getContextMenu(task.id) }} trigger={['contextMenu']} key={task.id}>
        <div className={`task-item ${isActive ? 'task-item-active' : ''}`}>
          <div className="task-item-top">
            {renderStatusTag(task.status)}
            <span className="task-item-time">
              {new Date(task.createdAt).toLocaleTimeString('zh-CN', {
                hour: '2-digit',
                minute: '2-digit',
              })}
            </span>
          </div>
          <p className="task-item-prompt">{task.prompt}</p>
          <div className="task-item-bottom">
            <Select
              size="small"
              placeholder="指派账号"
              value={task.assignedAccountId || undefined}
              onChange={(value) => handleAssign(task.id, value)}
              style={{ width: 130 }}
              disabled={isActive}
              options={accounts
                .filter((a) => a.status !== 'error')
                .map((a) => ({
                  value: a.id,
                  label: a.name,
                }))}
            />
            <div className="task-item-actions">
              {canStart && (
                <Button
                  type="primary"
                  size="small"
                  icon={<PlayCircleOutlined />}
                  onClick={() => handleStartTask(task.id)}
                >
                  启动
                </Button>
              )}
              {isActive && (
                <span className="task-progress-text">
                  <LoadingOutlined spin /> 执行中...
                </span>
              )}
              {task.status === 'done' && task.result && (
                <a
                  className="task-result-link"
                  href={task.result}
                  target="_blank"
                  rel="noreferrer"
                  title={task.result}
                >
                  查看结果
                </a>
              )}
            </div>
          </div>
          {task.status === 'fail' && task.result && (
            <p className="task-error-text">{task.result}</p>
          )}
        </div>
      </Dropdown>
    );
  };

  // ---- 统计 ----

  const queuedCount = tasks.filter((t) => t.status === 'queued').length;
  const runningCount = tasks.filter(
    (t) => t.status === 'executing' || t.status === 'generating'
  ).length;
  const doneCount = tasks.filter((t) => t.status === 'done').length;
  const failCount = tasks.filter((t) => t.status === 'fail').length;

  return (
    <div className="task-console">
      {/* 顶部操作栏 */}
      <div className="task-console-header">
        <span className="task-console-title">任务调度</span>
        <div className="task-console-stats">
          {runningCount > 0 && (
            <span className="stat-badge running">
              <LoadingOutlined spin /> {runningCount}
            </span>
          )}
          {queuedCount > 0 && (
            <span className="stat-badge queued">
              <ClockCircleOutlined /> {queuedCount}
            </span>
          )}
          {doneCount > 0 && (
            <span className="stat-badge done">
              <CheckCircleOutlined /> {doneCount}
            </span>
          )}
          {failCount > 0 && (
            <span className="stat-badge fail">
              <CloseCircleOutlined /> {failCount}
            </span>
          )}
        </div>
        <div className="task-console-actions">
          <Button
            size="small"
            icon={<PlusOutlined />}
            onClick={() => setAddModalOpen(true)}
            type="primary"
          >
            添加任务
          </Button>
          {(runningCount > 0 || queuedCount > 0) && (
            <Button
              size="small"
              icon={<PauseCircleOutlined />}
              onClick={batchPause}
              danger
            >
              全部暂停
            </Button>
          )}
          {doneCount > 0 && (
            <Button
              size="small"
              icon={<DownloadOutlined />}
              onClick={async () => {
                const outputs = await getCompletedOutputs();
                console.log('[TaskConsole] 已完成产物:', outputs);
              }}
            >
              批量下载
            </Button>
          )}
        </div>
      </div>

      {/* 错误提示 */}
      {error && (
        <div className="task-console-error">
          <CloseCircleOutlined style={{ marginRight: 6 }} />
          {error}
        </div>
      )}

      {/* 任务列表 */}
      <div className="task-list">
        {tasks.length === 0 ? (
          <div className="task-empty">
            <p>暂无任务</p>
            <span>点击「添加任务」开始</span>
          </div>
        ) : (
          tasks.map(renderTaskItem)
        )}
      </div>

      {/* 添加任务弹窗 */}
      <Modal
        title="添加任务"
        open={addModalOpen}
        onOk={handleAddTasks}
        onCancel={() => {
          setAddModalOpen(false);
          setInputText('');
        }}
        okText="添加"
        cancelText="取消"
        width={520}
      >
        <p style={{ color: '#9898b8', marginBottom: 8, fontSize: 13 }}>
          每行一个提示词，支持批量粘贴
        </p>
        <TextArea
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          placeholder={'写一篇关于AI的科普文章\n总结2024年科技趋势\n翻译这段文本为英文'}
          rows={8}
          autoFocus
          style={{
            background: '#1a1a24',
            border: '1px solid #2a2a3e',
            color: '#e8e8f0',
            fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
            fontSize: 13,
            lineHeight: 1.8,
            borderRadius: 8,
          }}
        />
      </Modal>
    </div>
  );
};

export default TaskConsole;
