/**
 * src/components/TaskDetailModal.tsx
 * 任务详情弹窗
 *
 * 功能：
 * - 展示任务完整信息（提示词、模式、配置、附件、状态、产物）
 * - 失败任务支持重新执行
 * - 支持删除任务
 */

import React, { useState, useEffect } from 'react';
import { Modal, Button, Tag, Descriptions, Space, Divider, List, message } from 'antd';
import {
  ReloadOutlined,
  DeleteOutlined,
  PlayCircleOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  ClockCircleOutlined,
  ThunderboltOutlined,
  SyncOutlined,
  PictureOutlined,
  AudioOutlined,
  UserOutlined,
  CalendarOutlined,
  LinkOutlined,
  InfoCircleOutlined,
  DownloadOutlined,
  EditOutlined,
  StopOutlined,
} from '@ant-design/icons';
import type { Task } from '../types';
import {
  TASK_STATUS_CONFIG,
  TASK_STAGE_LABELS,
  GENERATION_MODE_CONFIG,
  VIDEO_MODEL_LABELS,
} from '../types';
import { useTaskStore } from '../store/useTaskStore';
import { useAccountStore } from '../store/useAccountStore';

// ==================== 组件 ====================

interface TaskDetailModalProps {
  open: boolean;
  task: Task | null;
  onClose: () => void;
  onEditAndRerun: (task: Task) => void;
}

const TaskDetailModal: React.FC<TaskDetailModalProps> = ({ open, task, onClose, onEditAndRerun }) => {
  const { retryTask, deleteTask, assignTask, startAutomation, accountBusy } = useTaskStore();
  const accounts = useAccountStore((s) => s.accounts);

  const [imageBase64s, setImageBase64s] = useState<Record<string, string>>({});

  // 加载参考图片缩略图
  useEffect(() => {
    if (task?.attachments && task.attachments.length > 0) {
      const loadImages = async () => {
        const map: Record<string, string> = {};
        for (const path of task.attachments!) {
          try {
            const result = await window.electronAPI.tasks.readFileAsBase64(path);
            if (result.success && result.data) {
              map[path] = result.data;
            }
          } catch (e) {
            console.warn('[TaskDetail] 读取图片失败:', path);
          }
        }
        setImageBase64s(map);
      };
      loadImages();
    } else {
      setImageBase64s({});
    }
  }, [task?.id, task?.attachments]);

  if (!task) return null;

  const modeCfg = GENERATION_MODE_CONFIG[task.mode] || GENERATION_MODE_CONFIG.chat;
  const statusCfg = TASK_STATUS_CONFIG[task.status];
  const assignedAccount = accounts.find((a) => a.id === task.assignedAccountId);

  const canRetry = task.status === 'fail' || task.status === 'done' || task.status === 'paused' || task.status === 'cancelled';
  const canStart = task.status === 'queued' && task.assignedAccountId && !accountBusy[task.assignedAccountId];
  const canAssign = task.status === 'queued' && !task.assignedAccountId;
  const canManualExtractVideo =
    task.mode === 'video' &&
    !!task.assignedAccountId &&
    task.status !== 'executing' &&
    task.status !== 'generating' &&
    task.status !== 'waiting_verification';

  // ---- 操作处理 ----

  const handleRetry = async () => {
    const ok = await retryTask(task.id);
    if (ok) {
      message.success('任务已重新加入队列');
      onClose();
    }
  };

  const handleDelete = async () => {
    Modal.confirm({
      title: '确认删除',
      content: '确定要删除这个任务吗？此操作不可撤销。',
      okText: '删除',
      cancelText: '取消',
      okButtonProps: { danger: true },
      onOk: async () => {
        const ok = await deleteTask(task.id);
        if (ok) {
          message.success('已删除');
          onClose();
        }
      },
    });
  };

  const handleStart = async () => {
    const started = await startAutomation(task.id);
    if (started) {
      message.info('任务已启动');
      onClose();
    } else {
      message.warning('任务暂未启动，请检查依赖和账号状态');
    }
  };

  const handleAssign = async (accountId: string) => {
    await assignTask(task.id, accountId);
    message.success('已指派账号');
  };

  // ---- 状态图标 ----

  const renderStatusIcon = () => {
    switch (task.status) {
      case 'queued': return <ClockCircleOutlined style={{ color: statusCfg.color }} />;
      case 'executing': return <ThunderboltOutlined style={{ color: statusCfg.color }} />;
      case 'generating': return <SyncOutlined spin style={{ color: statusCfg.color }} />;
      case 'waiting_verification': return <SyncOutlined spin style={{ color: statusCfg.color }} />;
      case 'paused': return <ClockCircleOutlined style={{ color: statusCfg.color }} />;
      case 'done': return <CheckCircleOutlined style={{ color: statusCfg.color }} />;
      case 'fail': return <CloseCircleOutlined style={{ color: statusCfg.color }} />;
      case 'cancelled': return <CloseCircleOutlined style={{ color: statusCfg.color }} />;
    }
  };

  return (
    <Modal
      title={
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span>任务详情</span>
          <Tag color={statusCfg.color} style={{ marginLeft: 8 }}>
            {statusCfg.label}
          </Tag>
          <Tag
            style={{
              backgroundColor: modeCfg.color + '18',
              color: modeCfg.color,
              borderColor: modeCfg.color + '30',
            }}
          >
            {modeCfg.icon} {modeCfg.label}
          </Tag>
        </div>
      }
      open={open}
      onCancel={onClose}
      footer={
        <Space>
          <Button danger icon={<DeleteOutlined />} onClick={handleDelete}>
            删除任务
          </Button>
          {canStart && (
            <Button type="primary" icon={<PlayCircleOutlined />} onClick={handleStart}>
              启动任务
            </Button>
          )}
          {canRetry && (
            <Button type="primary" icon={<ReloadOutlined />} onClick={handleRetry}>
              重新执行
            </Button>
          )}
          <Button
            icon={<EditOutlined />}
            onClick={() => {
              onClose();
              onEditAndRerun(task);
            }}
          >
            编辑重跑
          </Button>
          {(task.status === 'executing' || task.status === 'generating' || task.status === 'waiting_verification') && (
            <Button
              danger
              icon={<StopOutlined />}
              onClick={() => {
                window.dispatchEvent(new CustomEvent('cancel-task-automation', { detail: { taskId: task.id } }));
                onClose();
              }}
            >
              暂停任务
            </Button>
          )}
          {canManualExtractVideo && (
            <Button
              icon={<DownloadOutlined />}
              onClick={() => {
                window.dispatchEvent(new CustomEvent('manual-extract-video-output', { detail: { task } }));
                message.info('正在尝试提取视频地址...');
              }}
            >
              提取视频
            </Button>
          )}
          <Button onClick={onClose}>关闭</Button>
        </Space>
      }
      width={640}
      destroyOnClose
    >
      <div style={{ color: '#d0d0e0' }}>
        {/* 提示词 */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ color: '#9898b8', fontSize: 12, marginBottom: 6, display: 'flex', alignItems: 'center', gap: 4 }}>
            <InfoCircleOutlined /> 提示词
          </div>
          <div
            style={{
              background: '#1a1a24',
              border: '1px solid #2a2a3e',
              borderRadius: 8,
              padding: '12px 14px',
              fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
              fontSize: 13,
              lineHeight: 1.8,
              color: '#e0e0f0',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              maxHeight: 200,
              overflowY: 'auto',
            }}
          >
            {task.prompt}
          </div>
        </div>

        {/* 失败原因 */}
        {(task.status === 'fail' || task.status === 'paused' || task.status === 'cancelled') && task.result && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ color: '#fb7185', fontSize: 12, marginBottom: 6, display: 'flex', alignItems: 'center', gap: 4 }}>
              <CloseCircleOutlined /> 失败原因
            </div>
            <div
              style={{
                background: 'rgba(251,113,133,0.08)',
                border: '1px solid rgba(251,113,133,0.2)',
                borderRadius: 8,
                padding: '10px 14px',
                fontSize: 13,
                color: '#fda4af',
              }}
            >
              {task.result}
            </div>
          </div>
        )}

        {/* 配置信息 */}
        <Descriptions
          column={2}
          size="small"
          labelStyle={{ color: '#9898b8', width: 80 }}
          contentStyle={{ color: '#d0d0e0' }}
          style={{ marginBottom: 16 }}
        >
          <Descriptions.Item label="任务ID">
            <span style={{ fontFamily: 'monospace', fontSize: 12, color: '#888' }}>
              {task.id}
            </span>
          </Descriptions.Item>
          <Descriptions.Item label="指派账号">
            {assignedAccount ? (
              <Space size={4}>
                <UserOutlined />
                {assignedAccount.name}
              </Space>
            ) : canAssign ? (
              <Space size={4} style={{ color: '#fbbf24' }}>
                <span>未指派</span>
              </Space>
            ) : (
              <span style={{ color: '#6b6b88' }}>未指派</span>
            )}
          </Descriptions.Item>
          <Descriptions.Item label="创建时间">
            <Space size={4}>
              <CalendarOutlined />
              {new Date(task.createdAt).toLocaleString('zh-CN')}
            </Space>
          </Descriptions.Item>
          <Descriptions.Item label="更新时间">
            <Space size={4}>
              <ClockCircleOutlined />
              {new Date(task.updatedAt).toLocaleString('zh-CN')}
            </Space>
          </Descriptions.Item>
          {task.runtime && (
            <>
              <Descriptions.Item label="运行阶段">
                {TASK_STAGE_LABELS[task.runtime.stage] || task.runtime.stage}
              </Descriptions.Item>
              <Descriptions.Item label="运行次数">
                第 {task.runtime.attempt} 次
              </Descriptions.Item>
              <Descriptions.Item label="阶段说明" span={2}>
                {task.runtime.message}
              </Descriptions.Item>
              <Descriptions.Item label="最近心跳">
                {new Date(task.runtime.lastHeartbeatAt).toLocaleString('zh-CN')}
              </Descriptions.Item>
              <Descriptions.Item label="可恢复">
                {task.errorInfo ? (task.errorInfo.recoverable ? '可以重新执行' : '需要更换账号或配置') : '是'}
              </Descriptions.Item>
            </>
          )}
          {task.batchId && <Descriptions.Item label="任务批次">{task.batchId}</Descriptions.Item>}
          {(task.dependsOnTaskIds?.length || 0) > 0 && (
            <Descriptions.Item label="前置依赖">{task.dependsOnTaskIds!.length} 个任务</Descriptions.Item>
          )}
          {task.lock && <Descriptions.Item label="执行锁">有效至 {new Date(task.lock.expiresAt).toLocaleTimeString('zh-CN')}</Descriptions.Item>}
        </Descriptions>

        {(task.runHistory?.length || 0) > 0 && (
          <div style={{ marginBottom: 16 }}>
            <Divider orientation="left" plain>最近运行记录</Divider>
            <List
              size="small"
              dataSource={[...(task.runHistory || [])].reverse().slice(0, 8)}
              renderItem={(run) => (
                <List.Item>
                  <Space size={8} wrap>
                    <Tag color={run.outcome === 'done' ? 'success' : run.outcome === 'failed' ? 'error' : 'default'}>
                      {run.outcome === 'done' ? '完成' : run.outcome === 'failed' ? '失败' : run.outcome === 'paused' ? '暂停' : '运行中'}
                    </Tag>
                    <span>第 {run.attempt} 次</span>
                    <span style={{ color: '#888' }}>{new Date(run.startedAt).toLocaleString('zh-CN')}</span>
                    {run.durationMs !== undefined && <span style={{ color: '#888' }}>耗时 {Math.max(1, Math.round(run.durationMs / 1000))} 秒</span>}
                    {run.errorCode && <Tag>{run.errorCode}</Tag>}
                  </Space>
                </List.Item>
              )}
            />
          </div>
        )}

        {/* 视频配置 */}
        {task.mode === 'video' && task.videoConfig && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ color: '#9898b8', fontSize: 12, marginBottom: 8 }}>视频配置</div>
            <Space size={8} wrap>
              <Tag color="blue">{VIDEO_MODEL_LABELS[task.videoConfig.model] || task.videoConfig.model}</Tag>
              <Tag color="purple">{task.videoConfig.duration}</Tag>
              <Tag color="cyan">{task.videoConfig.aspectRatio}</Tag>
            </Space>
          </div>
        )}

        {/* 参考图片 */}
        {task.attachments && task.attachments.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ color: '#9898b8', fontSize: 12, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 4 }}>
              <PictureOutlined /> 参考图片（{task.attachments.length} 张）
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {task.attachments.map((path, idx) => (
                <div
                  key={idx}
                  title={path.split(/[/\\]/).pop()}
                  style={{
                    width: 56,
                    height: 56,
                    borderRadius: 4,
                    border: '1px solid #2a2a3e',
                    overflow: 'hidden',
                    background: '#1a1a24',
                  }}
                >
                  {imageBase64s[path] ? (
                    <img
                      src={imageBase64s[path]}
                      alt={`ref-${idx}`}
                      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    />
                  ) : (
                    <div
                      style={{
                        width: '100%',
                        height: '100%',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: '#4a4a68',
                        fontSize: 10,
                      }}
                    >
                      {idx + 1}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 参考音频 */}
        {(task as any).audioAttachment && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ color: '#9898b8', fontSize: 12, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 4 }}>
              <AudioOutlined /> 参考音频
            </div>
            <div
              style={{
                background: '#1a1a24',
                border: '1px solid #2a2a3e',
                borderRadius: 6,
                padding: '8px 12px',
                fontSize: 12,
                color: '#d0d0e0',
              }}
            >
              {(task as any).audioAttachment.split(/[/\\]/).pop()}
            </div>
          </div>
        )}

        {/* 产物列表 */}
        {task.outputs && task.outputs.length > 0 && (
          <div>
            <Divider style={{ margin: '12px 0', borderColor: '#2a2a3e' }} />
            <div style={{ color: '#9898b8', fontSize: 12, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 4 }}>
              <LinkOutlined /> 产物（{task.outputs.length} 个）
            </div>
            <List
              size="small"
              dataSource={task.outputs}
              style={{
                background: '#1a1a24',
                borderRadius: 6,
                border: '1px solid #2a2a3e',
              }}
              renderItem={(url, idx) => (
                <List.Item
                  style={{
                    borderBottom: idx < task.outputs!.length - 1 ? '1px solid #222232' : 'none',
                    padding: '6px 12px',
                  }}
                >
                  <a
                    href={url}
                    target="_blank"
                    rel="noreferrer"
                    style={{
                      color: '#60a5fa',
                      fontSize: 12,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      maxWidth: 480,
                      display: 'inline-block',
                    }}
                    title={url}
                  >
                    {idx + 1}. {url}
                  </a>
                </List.Item>
              )}
            />
          </div>
        )}
      </div>
    </Modal>
  );
};

export default TaskDetailModal;
