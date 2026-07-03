/**
 * src/components/TaskConsole.tsx
 * 任务调度控制台 — V3 多模式支持
 *
 * 支持：
 * - 批量添加任务 + 选择生成模式（对话/图片/视频/音乐）
 * - 指派账号、启动自动化、查看状态
 * - 任务列表中显示模式标签
 */

import React, { useState, useCallback } from 'react';
import { Button, Select, Input, Modal, Dropdown, Space, Segmented, Tooltip } from 'antd';
import type { MenuProps, SegmentedProps } from 'antd';
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
  PictureOutlined,
} from '@ant-design/icons';
import { useTaskStore } from '../store/useTaskStore';
import { useAccountStore } from '../store/useAccountStore';
import {
  TASK_STATUS_CONFIG,
  GENERATION_MODE_CONFIG,
  VIDEO_MODEL_LABELS,
  VIDEO_MODEL_COST,
  DEFAULT_VIDEO_CONFIG,
  type TaskStatus,
  type GenerationMode,
  type VideoModel,
  type VideoDuration,
  type VideoAspectRatio,
} from '../types';

const { TextArea } = Input;

// ==================== 模式选择组件 ====================

const ModeSelector: React.FC<{
  value: GenerationMode;
  onChange: (mode: GenerationMode) => void;
}> = ({ value, onChange }) => {
  const options = Object.entries(GENERATION_MODE_CONFIG).map(([key, cfg]) => ({
    label: (
      <div className="flex flex-col items-center py-1 px-2">
        <span className="text-lg">{cfg.icon}</span>
        <span className="text-xs mt-0.5">{cfg.label}</span>
      </div>
    ),
    value: key,
  }));

  return (
    <Segmented
      value={value}
      onChange={(val) => onChange(val as GenerationMode)}
      options={options}
      block
      style={{
        background: '#1a1a24',
        padding: '4px',
        borderRadius: 10,
      }}
    />
  );
};

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
  const [selectedMode, setSelectedMode] = useState<GenerationMode>('chat');
  const [videoConfig, setVideoConfig] = useState({ ...DEFAULT_VIDEO_CONFIG });
  const [attachments, setAttachments] = useState<string[]>([]);
  const [attachmentBase64s, setAttachmentBase64s] = useState<Record<string, string>>({});

  // ---- 添加任务 ----

  const handleAddTasks = useCallback(async () => {
    const vc = selectedMode === 'video' ? videoConfig : undefined;
    const att = (selectedMode === 'video' || selectedMode === 'image') && attachments.length > 0 ? attachments : undefined;
    const ok = await addTasks(inputText, selectedMode, vc, att);
    if (ok) {
      setInputText('');
      setAddModalOpen(false);
      setSelectedMode('chat');
      setVideoConfig({ ...DEFAULT_VIDEO_CONFIG });
      setAttachments([]);
    }
  }, [inputText, selectedMode, videoConfig, attachments, addTasks]);

  // ---- 选择参考图片 ----
  const handleSelectImages = useCallback(async () => {
    const result = await window.electronAPI.tasks.selectImages();
    if (result.success && result.filePaths && result.filePaths.length > 0) {
      setAttachments((prev) => [...prev, ...result.filePaths!]);
      // 读取文件为 base64 用于缩略图显示
      for (const filePath of result.filePaths!) {
        const base64Result = await window.electronAPI.tasks.readFileAsBase64(filePath);
        if (base64Result.success && base64Result.data) {
          setAttachmentBase64s((prev) => ({ ...prev, [filePath]: base64Result.data! }));
        }
      }
    }
  }, []);

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

  // ---- 渲染模式标签 ----

  const renderModeTag = (mode: GenerationMode) => {
    const cfg = GENERATION_MODE_CONFIG[mode] || GENERATION_MODE_CONFIG.chat;
    return (
      <Tooltip title={cfg.description}>
        <span
          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium"
          style={{
            backgroundColor: cfg.color + '18',
            color: cfg.color,
            border: `1px solid ${cfg.color}30`,
          }}
        >
          <span>{cfg.icon}</span>
          {cfg.label}
        </span>
      </Tooltip>
    );
  };

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
    const taskMode = task.mode || 'chat';

    return (
      <Dropdown menu={{ items: getContextMenu(task.id) }} trigger={['contextMenu']} key={task.id}>
        <div className={`task-item ${isActive ? 'task-item-active' : ''}`}>
          <div className="task-item-top">
            {renderStatusTag(task.status)}
            {renderModeTag(taskMode)}
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
          setSelectedMode('chat');
          setVideoConfig({ ...DEFAULT_VIDEO_CONFIG });
          setAttachments([]);
        }}
        okText="添加"
        cancelText="取消"
        width={520}
      >
        {/* 模式选择 */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ color: '#9898b8', marginBottom: 8, fontSize: 13 }}>
            选择生成模式
          </div>
          <ModeSelector value={selectedMode} onChange={setSelectedMode} />
          <div style={{ color: '#6b6b88', marginTop: 6, fontSize: 12 }}>
            {GENERATION_MODE_CONFIG[selectedMode].description}
          </div>
        </div>

        {/* 视频配置（仅视频模式） */}
        {selectedMode === 'video' && (
          <div style={{ marginBottom: 16 }}>
            {/* 模型选择 */}
            <div style={{ color: '#9898b8', marginBottom: 8, fontSize: 13 }}>视频模型</div>
            <Segmented
              value={videoConfig.model}
              onChange={(val) => setVideoConfig({ ...videoConfig, model: val as VideoModel })}
              options={Object.entries(VIDEO_MODEL_LABELS).map(([key, label]) => ({
                label: (
                  <div className="flex flex-col items-center py-1 px-2">
                    <span className="text-xs font-medium">{label}</span>
                    <span className="text-[10px] mt-0.5" style={{ color: '#6b6b88' }}>{VIDEO_MODEL_COST[key as VideoModel]}</span>
                  </div>
                ),
                value: key,
              }))}
              block
              style={{ background: '#1a1a24', padding: '4px', borderRadius: 8, marginBottom: 12 }}
            />

            {/* 时长选择 */}
            <div style={{ color: '#9898b8', marginBottom: 8, fontSize: 13 }}>视频时长</div>
            <Segmented
              value={videoConfig.duration}
              onChange={(val) => setVideoConfig({ ...videoConfig, duration: val as VideoDuration })}
              options={[
                { label: '5 秒', value: '5s' },
                { label: '10 秒', value: '10s' },
              ]}
              block
              style={{ background: '#1a1a24', padding: '4px', borderRadius: 8, marginBottom: 12 }}
            />

            {/* 比例选择 */}
            <div style={{ color: '#9898b8', marginBottom: 8, fontSize: 13 }}>画面比例</div>
            <Segmented
              value={videoConfig.aspectRatio}
              onChange={(val) => setVideoConfig({ ...videoConfig, aspectRatio: val as VideoAspectRatio })}
              options={['1:1', '3:4', '4:3', '9:16', '16:9', '21:9'].map((r) => ({
                label: r,
                value: r,
              }))}
              block
              style={{ background: '#1a1a24', padding: '4px', borderRadius: 8, marginBottom: 12 }}
            />
          </div>
        )}

        {/* 参考图片上传（视频/图片模式） */}
        {(selectedMode === 'video' || selectedMode === 'image') && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ color: '#9898b8', marginBottom: 8, fontSize: 13 }}>
              参考图片（可选，支持多张）
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {attachments.map((filePath, idx) => (
                <div
                  key={idx}
                  style={{
                    position: 'relative',
                    width: 64,
                    height: 64,
                    borderRadius: 6,
                    border: '1px solid #2a2a3e',
                    overflow: 'hidden',
                    background: '#1a1a24',
                  }}
                >
                  <img
                    src={attachmentBase64s[filePath] || ''}
                    alt={`ref-${idx}`}
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                  />
                  <button
                    onClick={() => {
                      setAttachments((prev) => prev.filter((_, i) => i !== idx));
                      setAttachmentBase64s((prev) => {
                        const next = { ...prev };
                        delete next[filePath];
                        return next;
                      });
                    }}
                    style={{
                      position: 'absolute',
                      top: 2,
                      right: 2,
                      width: 18,
                      height: 18,
                      borderRadius: '50%',
                      border: 'none',
                      background: 'rgba(0,0,0,0.6)',
                      color: '#fff',
                      fontSize: 10,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      lineHeight: 1,
                    }}
                  >
                    ×
                  </button>
                </div>
              ))}
              <button
                onClick={handleSelectImages}
                style={{
                  width: 64,
                  height: 64,
                  borderRadius: 6,
                  border: '1px dashed #3a3a5e',
                  background: 'transparent',
                  color: '#6b6b88',
                  cursor: 'pointer',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 4,
                  fontSize: 10,
                }}
              >
                <PictureOutlined style={{ fontSize: 20 }} />
                添加
              </button>
            </div>
          </div>
        )}

        {/* 提示词输入 */}
        <p style={{ color: '#9898b8', marginBottom: 8, fontSize: 13 }}>
          每行一个提示词，支持批量粘贴
        </p>
        <TextArea
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          placeholder={
            selectedMode === 'image'
              ? '一只橘色短毛猫，趴在阳光窗台上，写实摄影风格，8K高清\n赛博朋克城市夜景，霓虹灯，雨夜，16:9'
              : selectedMode === 'video'
              ? '海边日落，海浪慢动作，暖色调，电影氛围感，10秒\n女生漫步樱花树下，微笑，近景，自然光，5秒'
              : selectedMode === 'music'
              ? '轻快的钢琴曲，治愈系，30秒\n电子音乐，节奏感强，适合短视频BGM'
              : '写一篇关于AI的科普文章\n总结2024年科技趋势\n翻译这段文本为英文'
          }
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
