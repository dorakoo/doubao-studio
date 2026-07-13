/**
 * src/components/TaskConsole.tsx
 * 任务调度控制台 — V3 多模式支持
 *
 * 支持：
 * - 批量添加任务 + 选择生成模式（对话/图片/视频/音乐）
 * - 指派账号、启动自动化、查看状态
 * - 任务列表中显示模式标签
 */

import React, { useState, useCallback, useEffect } from 'react';
import { Button, Select, Input, Modal, Dropdown, Space, Segmented, Tooltip, message, Switch } from 'antd';
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
  AudioOutlined,
  EyeOutlined,
  ReloadOutlined,
  EditOutlined,
  StopOutlined,
  FileExcelOutlined,
} from '@ant-design/icons';
import { useTaskStore } from '../store/useTaskStore';
import { getAccountSchedulingScore, useAccountStore } from '../store/useAccountStore';
import { useProjectStore } from '../store/useProjectStore';
import TaskDetailModal from './TaskDetailModal';
import type { Task, TaskUpdateInput } from '../types';
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
import { evaluateVideoCapability } from '../utils/videoCapability';

const { TextArea } = Input;

interface TaskTemplate {
  id: string;
  name: string;
  prompt: string;
  mode: GenerationMode;
  videoConfig?: Task['videoConfig'];
  attachments: string[];
  audioAttachment?: string;
}

function expandPromptVariables(promptText: string, rowsText: string): string {
  const rows = rowsText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (rows.length === 0) return promptText;
  const prompts = promptText.split('%%%%%%%%%%').map((item) => item.trim()).filter(Boolean);
  const expanded: string[] = [];
  for (const row of rows) {
    const values = new Map<string, string>();
    for (const pair of row.split(/[;；]/)) {
      const separator = pair.indexOf('=');
      if (separator <= 0) continue;
      values.set(pair.slice(0, separator).trim(), pair.slice(separator + 1).trim());
    }
    for (const prompt of prompts) {
      expanded.push(prompt.replace(/\{\{([^}]+)\}\}/g, (match, key) => values.get(String(key).trim()) ?? match));
    }
  }
  return expanded.join('\n%%%%%%%%%%\n');
}

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
    tasks: allTasks,
    addTasks,
    importCsv,
    assignTask,
    deleteTask,
    batchPause,
    getCompletedOutputs,
    startAutomation,
    accountBusy,
    clearError,
    error,
    updateTask,
    processQueue,
  } = useTaskStore();
  const activeProjectId = useProjectStore((state) => state.activeProjectId);
  const tasks = allTasks.filter((task) => (task.projectId || 'default-project') === activeProjectId);

  const accounts = useAccountStore((s) => s.accounts);
  const selectAccount = useAccountStore((s) => s.selectAccount);

  const [inputText, setInputText] = useState('');
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [selectedMode, setSelectedMode] = useState<GenerationMode>('chat');
  const [videoConfig, setVideoConfig] = useState({ ...DEFAULT_VIDEO_CONFIG });
  const [attachments, setAttachments] = useState<string[]>([]);
  const [attachmentBase64s, setAttachmentBase64s] = useState<Record<string, string>>({});
  const [audioAttachment, setAudioAttachment] = useState<string>('');
  const [detailModalOpen, setDetailModalOpen] = useState(false);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [autoAssign, setAutoAssign] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [editingPrompt, setEditingPrompt] = useState('');
  const [editingVideoConfig, setEditingVideoConfig] = useState({ ...DEFAULT_VIDEO_CONFIG });
  const [editingAttachments, setEditingAttachments] = useState<string[]>([]);
  const [editingAttachmentBase64s, setEditingAttachmentBase64s] = useState<Record<string, string>>({});
  const [editingAudioAttachment, setEditingAudioAttachment] = useState('');
  const [variableRows, setVariableRows] = useState('');
  const [templates, setTemplates] = useState<TaskTemplate[]>([]);
  const [templateName, setTemplateName] = useState('');
  const [templateModalOpen, setTemplateModalOpen] = useState(false);

  useEffect(() => {
    void window.electronAPI.settings.get().then((settings) => {
      setTemplates(Array.isArray(settings.taskTemplates) ? settings.taskTemplates : []);
    });
  }, []);

  const persistTemplates = async (nextTemplates: TaskTemplate[]) => {
    const settings = await window.electronAPI.settings.get();
    await window.electronAPI.settings.save({ ...settings, taskTemplates: nextTemplates });
    setTemplates(nextTemplates);
  };

  const saveCurrentTemplate = async () => {
    if (!templateName.trim()) return;
    const template: TaskTemplate = {
      id: `template-${Date.now()}`,
      name: templateName.trim(),
      prompt: inputText,
      mode: selectedMode,
      videoConfig: selectedMode === 'video' ? { ...videoConfig } : undefined,
      attachments: [...attachments],
      audioAttachment: audioAttachment || undefined,
    };
    await persistTemplates([...templates, template]);
    setTemplateName('');
    setTemplateModalOpen(false);
    message.success('任务模板已保存');
  };

  const applyTemplate = (templateId: string) => {
    const template = templates.find((item) => item.id === templateId);
    if (!template) return;
    setInputText(template.prompt);
    setSelectedMode(template.mode);
    setVideoConfig({ ...(template.videoConfig || DEFAULT_VIDEO_CONFIG) });
    setAttachments([...template.attachments]);
    setAudioAttachment(template.audioAttachment || '');
    setAttachmentBase64s({});
    for (const filePath of template.attachments) {
      void window.electronAPI.tasks.readFileAsBase64(filePath).then((result) => {
        if (result.success && result.data) {
          setAttachmentBase64s((current) => ({ ...current, [filePath]: result.data! }));
        }
      });
    }
  };

  // ---- 自动分配账号 ----
  const autoAssignTasks = useCallback(async (newTasks: Task[]) => {
    // 计算每个账号当前的负载（排队中+执行中的任务数）
    const accountLoad: Record<string, number> = {};
    accounts.filter((a) => a.status !== 'error').forEach((a) => {
      accountLoad[a.id] = allTasks.filter(
        (t) => t.assignedAccountId === a.id && (t.status === 'queued' || t.status === 'executing' || t.status === 'generating' || t.status === 'waiting_verification')
      ).length;
    });

    for (const task of newTasks) {
      const availableAccounts = accounts.filter((account) =>
        Number.isFinite(getAccountSchedulingScore(account, accountLoad[account.id] || 0, task.mode))
      );
      if (availableAccounts.length === 0) continue;
      // 综合负载、额度、连续失败、验证和登录状态选择账号。
      let bestScore = Infinity;
      let targetAccount = availableAccounts[0];
      for (const acc of availableAccounts) {
        const score = getAccountSchedulingScore(acc, accountLoad[acc.id] || 0, task.mode);
        if (score < bestScore) {
          bestScore = score;
          targetAccount = acc;
        }
      }
      accountLoad[targetAccount.id]++;
      await assignTask(task.id, targetAccount.id);
    }
  }, [accounts, allTasks, assignTask]);

  // ---- 添加任务 ----

  const handleAddTasks = useCallback(async () => {
    const vc = selectedMode === 'video' ? videoConfig : undefined;
    const att = (selectedMode === 'video' || selectedMode === 'image') && attachments.length > 0 ? attachments : undefined;
    const audioAtt = selectedMode === 'video' && audioAttachment ? audioAttachment : undefined;
    const expandedText = expandPromptVariables(inputText, variableRows);
    const newTasks = await addTasks(expandedText, selectedMode, vc, att, audioAtt);
    if (newTasks && newTasks.length > 0) {
      // 自动指派
      if (autoAssign) {
        await autoAssignTasks(newTasks);
      }
      setInputText('');
      setAddModalOpen(false);
      setSelectedMode('chat');
      setVideoConfig({ ...DEFAULT_VIDEO_CONFIG });
      setAttachments([]);
      setAudioAttachment('');
      setVariableRows('');
    }
  }, [inputText, variableRows, selectedMode, videoConfig, attachments, audioAttachment, addTasks, autoAssign, autoAssignTasks]);

  const handleImportCsv = useCallback(async () => {
    const result = await importCsv();
    if (!result) {
      if (useTaskStore.getState().error) message.error(useTaskStore.getState().error);
      return;
    }
    if (result.errors.length > 0) {
      message.warning(`已导入 ${result.imported} 条，跳过 ${result.skipped} 条；${result.errors[0]}`);
    } else {
      message.success(`已导入 ${result.imported} 条任务`);
    }
  }, [importCsv]);

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

  // ---- 选择参考音频 ----
  const handleSelectAudio = useCallback(async () => {
    const result = await window.electronAPI.tasks.selectAudio();
    if (result.success && result.filePath) {
      setAudioAttachment(result.filePath);
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
      await startAutomation(taskId);
    },
    [startAutomation, clearError]
  );

  const openEditAndRerun = (task: Task) => {
    setEditingTask(task);
    setEditingPrompt(task.prompt);
    setEditingVideoConfig({ ...(task.videoConfig || DEFAULT_VIDEO_CONFIG) });
    setEditingAttachments([...(task.attachments || [])]);
    setEditingAudioAttachment(task.audioAttachment || '');
    setEditingAttachmentBase64s({});
    for (const filePath of task.attachments || []) {
      void window.electronAPI.tasks.readFileAsBase64(filePath).then((result) => {
        if (result.success && result.data) {
          setEditingAttachmentBase64s((current) => ({ ...current, [filePath]: result.data! }));
        }
      });
    }
  };

  const resetEditingTask = () => {
    setEditingTask(null);
    setEditingPrompt('');
    setEditingVideoConfig({ ...DEFAULT_VIDEO_CONFIG });
    setEditingAttachments([]);
    setEditingAttachmentBase64s({});
    setEditingAudioAttachment('');
  };

  const handleSelectEditingImages = async () => {
    const result = await window.electronAPI.tasks.selectImages();
    if (!result.success || !result.filePaths?.length) return;
    const newPaths = result.filePaths.filter((path) => !editingAttachments.includes(path));
    setEditingAttachments((current) => [...current, ...newPaths]);
    for (const filePath of newPaths) {
      const base64Result = await window.electronAPI.tasks.readFileAsBase64(filePath);
      if (base64Result.success && base64Result.data) {
        setEditingAttachmentBase64s((current) => ({ ...current, [filePath]: base64Result.data! }));
      }
    }
  };

  const handleSelectEditingAudio = async () => {
    const result = await window.electronAPI.tasks.selectAudio();
    if (result.success && result.filePath) setEditingAudioAttachment(result.filePath);
  };

  const handleEditAndRerun = async () => {
    if (!editingTask || !editingPrompt.trim()) {
      message.warning('提示词不能为空');
      return;
    }

    const updates: TaskUpdateInput = {
      prompt: editingPrompt.trim(),
      videoConfig: editingTask.mode === 'video' ? editingVideoConfig : undefined,
      attachments: editingTask.mode === 'video' || editingTask.mode === 'image'
        ? editingAttachments
        : undefined,
      audioAttachment: editingTask.mode === 'video' ? editingAudioAttachment || undefined : undefined,
    };
    const isActive = editingTask.status === 'executing' || editingTask.status === 'generating' || editingTask.status === 'waiting_verification';
    if (isActive) {
      window.dispatchEvent(new CustomEvent('cancel-task-automation', {
        detail: { taskId: editingTask.id, restartTask: updates },
      }));
    } else {
      const updated = await updateTask(editingTask.id, updates);
      if (!updated) {
        message.error(useTaskStore.getState().error || '编辑任务失败');
        return;
      }
      processQueue();
      message.success('提示词已更新，任务已重新加入队列');
    }

    resetEditingTask();
  };

  // ---- 右键菜单 ----

  const getContextMenu = (taskId: string): MenuProps['items'] => {
    const task = tasks.find((t) => t.id === taskId);
    const canRetry = task && (task.status === 'fail' || task.status === 'done' || task.status === 'paused' || task.status === 'cancelled');

    return [
      {
        key: 'detail',
        label: '查看详情',
        icon: <EyeOutlined />,
        onClick: () => {
          setSelectedTask(task || null);
          setDetailModalOpen(true);
        },
      },
      {
        key: 'edit-rerun',
        label: '编辑提示词并重跑',
        icon: <EditOutlined />,
        onClick: () => task && openEditAndRerun(task),
      },
      ...(canRetry ? [
        {
          key: 'retry',
          label: '重新执行',
          icon: <ReloadOutlined />,
          onClick: () => useTaskStore.getState().retryTask(taskId),
        },
      ] : []),
      { type: 'divider' as const },
      {
        key: 'delete',
        label: '删除任务',
        icon: <DeleteOutlined />,
        danger: true,
        onClick: () => deleteTask(taskId),
      },
    ];
  };

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
        {status === 'waiting_verification' && <LoadingOutlined spin style={{ marginRight: 4 }} />}
        {(status === 'paused' || status === 'cancelled') && <PauseCircleOutlined style={{ marginRight: 4 }} />}
        {status === 'queued' && <ClockCircleOutlined style={{ marginRight: 4 }} />}
        {status === 'done' && <CheckCircleOutlined style={{ marginRight: 4 }} />}
        {status === 'fail' && <CloseCircleOutlined style={{ marginRight: 4 }} />}
        {cfg.label}
      </span>
    );
  };

  // ---- 点击任务跳转到对应账号 ----

  const handleTaskClick = (task: Task) => {
    if (task.assignedAccountId) {
      selectAccount(task.assignedAccountId);
    }
  };

  // ---- 渲染任务项 ----

  const renderTaskItem = (task: (typeof tasks)[0]) => {
    const isActive = task.status === 'executing' || task.status === 'generating' || task.status === 'waiting_verification';
    const isQueued = task.status === 'queued';
    const canStart = isQueued && task.assignedAccountId && !accountBusy[task.assignedAccountId];
    const taskMode = task.mode || 'chat';
    const canManualExtractVideo =
      taskMode === 'video' &&
      !!task.assignedAccountId &&
      !isActive &&
      !!task.runtime?.conversationUrl;

    return (
      <Dropdown menu={{ items: getContextMenu(task.id) }} trigger={['contextMenu']} key={task.id}>
        <div
          className={`task-item ${isActive ? 'task-item-active' : ''}`}
          style={{ cursor: 'pointer' }}
          onClick={() => handleTaskClick(task)}
        >
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
          {(task.batchId || (task.dependsOnTaskIds?.length || 0) > 0) && (
            <div className="text-2xs text-db-text-muted mb-1 truncate">
              {task.batchId ? `批次 ${task.batchId.slice(-10)}` : ''}
              {(task.dependsOnTaskIds?.length || 0) > 0 ? ` · 等待 ${task.dependsOnTaskIds!.length} 个前置任务` : ''}
            </div>
          )}
          <div className="task-item-bottom" onClick={(e) => e.stopPropagation()}>
            <Select
              size="small"
              placeholder="指派账号"
              value={task.assignedAccountId || undefined}
              onChange={(value) => handleAssign(task.id, value)}
              style={{ width: 130 }}
              disabled={isActive}
              onClick={(e) => e.stopPropagation()}
              popupMatchSelectWidth={false}
              options={accounts
                .filter((account) =>
                  Number.isFinite(getAccountSchedulingScore(account, 0, taskMode))
                )
                .map((a) => ({
                  value: a.id,
                  label: a.name,
                }))}
            />
            <div className="task-item-actions">
              <Tooltip title="编辑提示词并重新运行">
                <Button
                  size="small"
                  icon={<EditOutlined />}
                  onClick={() => openEditAndRerun(task)}
                />
              </Tooltip>
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
                <>
                  <span className="task-progress-text">
                    <LoadingOutlined spin /> {task.runtime?.message || '执行中...'}
                  </span>
                  <Button
                    size="small"
                    danger
                    icon={<StopOutlined />}
                    onClick={() => window.dispatchEvent(new CustomEvent('cancel-task-automation', {
                      detail: { taskId: task.id },
                    }))}
                  >
                    暂停任务
                  </Button>
                </>
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
              {canManualExtractVideo && (
                <Button
                  size="small"
                  icon={<DownloadOutlined />}
                  onClick={() => {
                    window.dispatchEvent(new CustomEvent('manual-extract-video-output', { detail: { task } }));
                    message.info('正在尝试提取视频地址...');
                  }}
                >
                  提取视频
                </Button>
              )}
            </div>
          </div>
          {(task.status === 'fail' || task.status === 'paused' || task.status === 'cancelled') && task.result && (
            <p className="task-error-text">{task.result}</p>
          )}
        </div>
      </Dropdown>
    );
  };

  // ---- 统计 ----

  const queuedCount = tasks.filter((t) => t.status === 'queued').length;
  const runningCount = tasks.filter(
    (t) => t.status === 'executing' || t.status === 'generating' || t.status === 'waiting_verification'
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
          <Tooltip title={autoAssign ? '自动指派：开启' : '自动指派：关闭'}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginRight: 8 }}>
              <Switch
                size="small"
                checked={autoAssign}
                onChange={setAutoAssign}
              />
              <span style={{ color: '#9898b8', fontSize: 12 }}>自动指派</span>
            </div>
          </Tooltip>
          <Button
            size="small"
            icon={<PlusOutlined />}
            onClick={() => setAddModalOpen(true)}
            type="primary"
          >
            添加任务
          </Button>
          <Tooltip title="从 CSV 导入任务批次">
            <Button size="small" icon={<FileExcelOutlined />} onClick={() => void handleImportCsv()} />
          </Tooltip>
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
                if (outputs.length === 0) {
                  message.info('暂无已完成产物');
                  return;
                }
                // 通过自定义事件通知 Toolbar 打开预览
                window.dispatchEvent(new CustomEvent('batch-download-outputs', { detail: outputs }));
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
          setVariableRows('');
        }}
        okText="添加"
        cancelText="取消"
        width={520}
      >
        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          <Select
            placeholder="应用任务模板"
            style={{ flex: 1 }}
            options={templates.map((template) => ({ value: template.id, label: template.name }))}
            onChange={applyTemplate}
            allowClear
          />
          <Button icon={<PlusOutlined />} onClick={() => setTemplateModalOpen(true)}>保存模板</Button>
          <Tooltip title="删除最近保存的模板">
            <Button
              danger
              disabled={templates.length === 0}
              icon={<DeleteOutlined />}
              onClick={() => {
                const last = templates[templates.length - 1];
                if (last) void persistTemplates(templates.filter((item) => item.id !== last.id));
              }}
            />
          </Tooltip>
        </div>
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
                { label: '15 秒', value: '15s' },
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

            {/* 视频能力预检提示（新任务仅展示风险，不阻止提交；实际执行账号可能由调度器分配） */}
            {(() => {
              const selectedAccount = useAccountStore.getState().accounts.find(a => a.id === useAccountStore.getState().selectedAccountId);
              if (!selectedAccount) return null;
              const capability = evaluateVideoCapability({
                model: videoConfig.model,
                duration: videoConfig.duration,
                aspectRatio: videoConfig.aspectRatio,
                manual15sEnabled: false,
                seedanceQuota: selectedAccount.seedanceQuota,
                health: selectedAccount.health,
                scheduling: selectedAccount.scheduling,
                accountStatus: selectedAccount.status,
              });
              if (capability.state === 'allowed') return null;
              // 新任务仅展示风险提示，不阻止提交（实际执行账号可能由调度器分配）
              return (
                <div style={{
                  padding: '8px 12px',
                  marginBottom: 12,
                  borderRadius: 8,
                  fontSize: 12,
                  background: 'rgba(250,173,20,0.1)',
                  border: '1px solid rgba(250,173,20,0.3)',
                  color: '#faad14',
                }}>
                  {`[当前选中账号：${selectedAccount.name}] ${capability.userMessage}`}
                  {capability.suggestion && (
                    <div style={{ marginTop: 4, color: '#9898b8' }}>
                      建议：{capability.suggestion.reason}
                    </div>
                  )}
                  {capability.state === 'blocked' && (
                    <div style={{ marginTop: 4, color: '#9898b8' }}>
                      提示：自动指派模式下调度器将选择可用账号执行
                    </div>
                  )}
                </div>
              );
            })()}
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

        {/* 参考音频上传（仅视频模式） */}
        {selectedMode === 'video' && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ color: '#9898b8', marginBottom: 8, fontSize: 13 }}>
              参考音频（可选，视频配音用）
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              {audioAttachment ? (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '8px 12px',
                    background: '#1a1a24',
                    border: '1px solid #2a2a3e',
                    borderRadius: 6,
                    flex: 1,
                    minWidth: 0,
                  }}
                >
                  <AudioOutlined style={{ color: '#6b6b88', fontSize: 16, flexShrink: 0 }} />
                  <span
                    style={{
                      color: '#d0d0e0',
                      fontSize: 12,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      flex: 1,
                    }}
                  >
                    {audioAttachment.split(/[/\\]/).pop()}
                  </span>
                  <button
                    onClick={() => setAudioAttachment('')}
                    style={{
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
                      flexShrink: 0,
                    }}
                  >
                    ×
                  </button>
                </div>
              ) : (
                <button
                  onClick={handleSelectAudio}
                  style={{
                    padding: '8px 16px',
                    borderRadius: 6,
                    border: '1px dashed #3a3a5e',
                    background: 'transparent',
                    color: '#6b6b88',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    fontSize: 12,
                  }}
                >
                  <AudioOutlined style={{ fontSize: 16 }} />
                  选择音频文件
                </button>
              )}
            </div>
          </div>
        )}

        {/* 提示词输入 */}
        <p style={{ color: '#9898b8', marginBottom: 8, fontSize: 13 }}>
          使用 <code style={{ color: '#f0c040', background: '#2a2a3e', padding: '2px 6px', borderRadius: 4 }}>%%%%%%%%%%</code> 分割多个任务
        </p>
        <TextArea
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          placeholder={
            selectedMode === 'image'
              ? '一只橘色短毛猫，趴在阳光窗台上，写实摄影风格，8K高清\n%%%%%%%%%%\n赛博朋克城市夜景，霓虹灯，雨夜，16:9'
              : selectedMode === 'video'
              ? '海边日落，海浪慢动作，暖色调，电影氛围感，10秒\n%%%%%%%%%%\n女生漫步樱花树下，微笑，近景，自然光，5秒'
              : selectedMode === 'music'
              ? '轻快的钢琴曲，治愈系，30秒\n%%%%%%%%%%\n电子音乐，节奏感强，适合短视频BGM'
              : '写一篇关于AI的科普文章\n%%%%%%%%%%\n总结2024年科技趋势\n%%%%%%%%%%\n翻译这段文本为英文'
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
        <div style={{ color: '#9898b8', marginTop: 14, marginBottom: 8, fontSize: 13 }}>
          批量变量（可选，每行生成一组任务）
        </div>
        <TextArea
          value={variableRows}
          onChange={(event) => setVariableRows(event.target.value)}
          rows={3}
          placeholder={'产品=保温杯;场景=客厅\n产品=咖啡杯;场景=办公室'}
          style={{ background: '#1a1a24', borderColor: '#2a2a3e', color: '#e8e8f0' }}
        />
      </Modal>

      <Modal
        title="保存任务模板"
        open={templateModalOpen}
        onOk={() => void saveCurrentTemplate()}
        onCancel={() => setTemplateModalOpen(false)}
        okText="保存"
        cancelText="取消"
      >
        <Input
          value={templateName}
          onChange={(event) => setTemplateName(event.target.value)}
          onPressEnter={() => void saveCurrentTemplate()}
          placeholder="模板名称"
          autoFocus
        />
      </Modal>

      <Modal
        title="编辑提示词并重新运行"
        open={!!editingTask}
        onOk={handleEditAndRerun}
        onCancel={resetEditingTask}
        okText="保存并重新运行"
        cancelText="取消"
        width={620}
        okButtonProps={{
          // 已绑定账号且预检 blocked 时禁用确认按钮
          disabled: (() => {
            if (!editingTask || editingTask.mode !== 'video') return false;
            const boundAccountId = editingTask.assignedAccountId;
            if (!boundAccountId) return false;
            const boundAccount = useAccountStore.getState().accounts.find(a => a.id === boundAccountId);
            if (!boundAccount) return false;
            const capability = evaluateVideoCapability({
              model: editingVideoConfig.model,
              duration: editingVideoConfig.duration,
              aspectRatio: editingVideoConfig.aspectRatio,
              manual15sEnabled: false,
              seedanceQuota: boundAccount.seedanceQuota,
              health: boundAccount.health,
              scheduling: boundAccount.scheduling,
              accountStatus: boundAccount.status,
            });
            return !capability.canSubmit;
          })(),
        }}
      >
        <div style={{ color: '#9898b8', marginBottom: 8, fontSize: 13 }}>提示词</div>
        <TextArea
          value={editingPrompt}
          onChange={(event) => setEditingPrompt(event.target.value)}
          rows={10}
          autoFocus
          placeholder="请输入提示词"
          style={{
            background: '#1a1a24',
            border: '1px solid #2a2a3e',
            color: '#e8e8f0',
            fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
            lineHeight: 1.7,
            marginBottom: 16,
          }}
        />

        {editingTask?.mode === 'video' && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ color: '#9898b8', marginBottom: 8, fontSize: 13 }}>视频模型</div>
            <Segmented
              value={editingVideoConfig.model}
              onChange={(value) => setEditingVideoConfig({ ...editingVideoConfig, model: value as VideoModel })}
              options={Object.entries(VIDEO_MODEL_LABELS).map(([key, label]) => ({
                label,
                value: key,
              }))}
              block
              style={{ background: '#1a1a24', padding: 4, marginBottom: 12 }}
            />
            <div style={{ color: '#9898b8', marginBottom: 8, fontSize: 13 }}>视频时长</div>
            <Segmented
              value={editingVideoConfig.duration}
              onChange={(value) => setEditingVideoConfig({ ...editingVideoConfig, duration: value as VideoDuration })}
              options={[
                { label: '5 秒', value: '5s' },
                { label: '10 秒', value: '10s' },
                { label: '15 秒', value: '15s' },
              ]}
              block
              style={{ background: '#1a1a24', padding: 4, marginBottom: 12 }}
            />
            <div style={{ color: '#9898b8', marginBottom: 8, fontSize: 13 }}>画面比例</div>
            <Segmented
              value={editingVideoConfig.aspectRatio}
              onChange={(value) => setEditingVideoConfig({ ...editingVideoConfig, aspectRatio: value as VideoAspectRatio })}
              options={['1:1', '3:4', '4:3', '9:16', '16:9', '21:9']}
              block
              style={{ background: '#1a1a24', padding: 4 }}
            />

            {/* 视频能力预检提示（使用任务已绑定账号，非 selectedAccountId） */}
            {(() => {
              const boundAccountId = editingTask?.assignedAccountId;
              if (!boundAccountId) {
                // 未绑定账号时仅展示风险提示
                if (editingVideoConfig.duration === '15s') {
                  return (
                    <div style={{
                      marginTop: 12,
                      padding: '8px 12px',
                      borderRadius: 8,
                      fontSize: 12,
                      background: 'rgba(250,173,20,0.1)',
                      border: '1px solid rgba(250,173,20,0.3)',
                      color: '#faad14',
                    }}>
                      15 秒时长可能受账号会员权益限制，提交后若被拒绝请更换配置重试
                    </div>
                  );
                }
                return null;
              }
              const boundAccount = useAccountStore.getState().accounts.find(a => a.id === boundAccountId);
              if (!boundAccount) return null;
              const capability = evaluateVideoCapability({
                model: editingVideoConfig.model,
                duration: editingVideoConfig.duration,
                aspectRatio: editingVideoConfig.aspectRatio,
                manual15sEnabled: false,
                seedanceQuota: boundAccount.seedanceQuota,
                health: boundAccount.health,
                scheduling: boundAccount.scheduling,
                accountStatus: boundAccount.status,
              });
              if (capability.state === 'allowed') return null;
              const isBlocked = capability.state === 'blocked';
              return (
                <div style={{
                  marginTop: 12,
                  padding: '8px 12px',
                  borderRadius: 8,
                  fontSize: 12,
                  background: isBlocked ? 'rgba(255,77,79,0.1)' : 'rgba(250,173,20,0.1)',
                  border: `1px solid ${isBlocked ? 'rgba(255,77,79,0.3)' : 'rgba(250,173,20,0.3)'}`,
                  color: isBlocked ? '#ff6b6b' : '#faad14',
                }}>
                  {`[绑定账号：${boundAccount.name}] ${capability.userMessage}`}
                  {capability.suggestion && (
                    <div style={{ marginTop: 4, color: '#9898b8' }}>
                      建议：{capability.suggestion.reason}
                    </div>
                  )}
                  {isBlocked && (
                    <div style={{ marginTop: 4, color: '#9898b8' }}>
                      该账号当前不可用，请先解决上述问题或更换绑定账号
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        )}

        {(editingTask?.mode === 'video' || editingTask?.mode === 'image') && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ color: '#9898b8', marginBottom: 8, fontSize: 13 }}>参考图片</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {editingAttachments.map((filePath) => (
                <div key={filePath} style={{ position: 'relative', width: 64, height: 64 }}>
                  <img
                    src={editingAttachmentBase64s[filePath] || ''}
                    alt="参考图片"
                    style={{ width: 64, height: 64, objectFit: 'cover', borderRadius: 6, border: '1px solid #2a2a3e' }}
                  />
                  <Button
                    size="small"
                    danger
                    shape="circle"
                    icon={<DeleteOutlined />}
                    onClick={() => setEditingAttachments((current) => current.filter((path) => path !== filePath))}
                    style={{ position: 'absolute', top: -7, right: -7, width: 22, minWidth: 22, height: 22 }}
                  />
                </div>
              ))}
              <Button
                icon={<PictureOutlined />}
                onClick={handleSelectEditingImages}
                style={{ width: 64, height: 64 }}
              >
                添加
              </Button>
            </div>
          </div>
        )}

        {editingTask?.mode === 'video' && (
          <div>
            <div style={{ color: '#9898b8', marginBottom: 8, fontSize: 13 }}>参考音频</div>
            <Space>
              <Button icon={<AudioOutlined />} onClick={handleSelectEditingAudio}>
                {editingAudioAttachment ? '更换音频' : '选择音频'}
              </Button>
              {editingAudioAttachment && (
                <>
                  <span style={{ color: '#d0d0e0', fontSize: 12 }}>
                    {editingAudioAttachment.split(/[/\\]/).pop()}
                  </span>
                  <Button size="small" danger onClick={() => setEditingAudioAttachment('')}>移除</Button>
                </>
              )}
            </Space>
          </div>
        )}
      </Modal>

      {/* 任务详情弹窗 */}
      <TaskDetailModal
        open={detailModalOpen}
        task={selectedTask}
        onEditAndRerun={openEditAndRerun}
        onClose={() => {
          setDetailModalOpen(false);
          setSelectedTask(null);
        }}
      />
    </div>
  );
};

export default TaskConsole;
