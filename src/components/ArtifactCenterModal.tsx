import React, { useEffect, useMemo, useState } from 'react';
import { Button, Empty, Input, message, Modal, Select, Space, Table, Tag, Tooltip } from 'antd';
import { CloudDownloadOutlined, LinkOutlined, PlayCircleOutlined, ReloadOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import type { DownloadJob, GenerationMode, Task, TaskArtifact } from '../types';
import { useAccountStore } from '../store/useAccountStore';
import { useTaskStore } from '../store/useTaskStore';
import { useProjectStore } from '../store/useProjectStore';

interface ArtifactRecord {
  key: string;
  task: Task;
  artifact: TaskArtifact;
  localJob?: DownloadJob;
}

interface ArtifactCenterModalProps {
  open: boolean;
  onClose: () => void;
}

const VALIDATION_LABELS = {
  unknown: { label: '未验证', color: 'default' },
  valid: { label: '有效', color: 'success' },
  expired: { label: '已过期', color: 'warning' },
  invalid: { label: '不可用', color: 'error' },
} as const;

export const ArtifactCenterModal: React.FC<ArtifactCenterModalProps> = ({ open, onClose }) => {
  const tasks = useTaskStore((state) => state.tasks);
  const activeProjectId = useProjectStore((state) => state.activeProjectId);
  const loadTasks = useTaskStore((state) => state.loadTasks);
  const accounts = useAccountStore((state) => state.accounts);
  const [downloads, setDownloads] = useState<DownloadJob[]>([]);
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<GenerationMode | 'all'>('all');
  const [validity, setValidity] = useState<'all' | 'unknown' | 'valid' | 'expired' | 'invalid'>('all');
  const [checkingId, setCheckingId] = useState<string | null>(null);
  const [preview, setPreview] = useState<ArtifactRecord | null>(null);

  const refreshDownloads = async () => setDownloads(await window.electronAPI.tasks.listDownloads());
  useEffect(() => {
    if (open) void refreshDownloads();
  }, [open]);

  const records = useMemo(() => {
    const result: ArtifactRecord[] = [];
    for (const task of tasks) {
      if ((task.projectId || 'default-project') !== activeProjectId) continue;
      for (const artifact of task.artifacts || []) {
        const localJob = [...downloads].reverse().find((job) => job.taskId === task.id && job.url === artifact.url && job.status === 'done');
        result.push({ key: `${task.id}:${artifact.id}`, task, artifact, localJob });
      }
    }
    const normalizedQuery = query.trim().toLowerCase();
    return result
      .filter((record) => mode === 'all' || record.task.mode === mode)
      .filter((record) => validity === 'all' || (record.artifact.validation?.state || 'unknown') === validity)
      .filter((record) => !normalizedQuery || record.task.prompt.toLowerCase().includes(normalizedQuery) || record.task.id.includes(normalizedQuery))
      .sort((a, b) => b.artifact.discoveredAt.localeCompare(a.artifact.discoveredAt));
  }, [activeProjectId, downloads, mode, query, tasks, validity]);

  const validate = async (record: ArtifactRecord) => {
    setCheckingId(record.artifact.id);
    try {
      const result = await window.electronAPI.tasks.validateArtifact(record.task.id, record.artifact.id);
      await loadTasks();
      if (result.success) message.success('产物地址有效');
      else message.warning(result.error || '产物地址不可用或已过期');
    } finally {
      setCheckingId(null);
    }
  };

  const download = async (record: ArtifactRecord) => {
    const settings = await window.electronAPI.settings.get();
    const result = await window.electronAPI.tasks.downloadOutputs([{
      taskId: record.task.id,
      prompt: record.task.prompt,
      outputs: [record.artifact.url],
      accountId: record.task.assignedAccountId,
      mode: record.task.mode,
    }], settings.downloadDir || undefined);
    await refreshDownloads();
    if (result.success) message.success('产物下载完成');
    else message.error(result.error || '下载失败');
  };

  const columns: ColumnsType<ArtifactRecord> = [
    {
      title: '产物', width: 90,
      render: (_, record) => <Tag color={record.artifact.kind === 'video' ? 'magenta' : 'blue'}>{record.artifact.kind === 'video' ? '视频' : record.artifact.kind === 'image' ? '图片' : '文件'}</Tag>,
    },
    {
      title: '任务', ellipsis: true,
      render: (_, record) => (
        <Tooltip title={record.task.prompt}>
          <span>{record.task.prompt.slice(0, 48)}{record.task.prompt.length > 48 ? '...' : ''}</span>
        </Tooltip>
      ),
    },
    {
      title: '账号', width: 110,
      render: (_, record) => accounts.find((account) => account.id === record.task.assignedAccountId)?.name || '未指派',
    },
    {
      title: '状态', width: 105,
      render: (_, record) => {
        const validation = VALIDATION_LABELS[record.artifact.validation?.state || 'unknown'];
        return <Space size={4}><Tag color={validation.color}>{validation.label}</Tag>{record.localJob && <Tag color="green">本地</Tag>}</Space>;
      },
    },
    {
      title: '发现时间', width: 145,
      render: (_, record) => new Date(record.artifact.discoveredAt).toLocaleString('zh-CN'),
    },
    {
      title: '操作', width: 155,
      render: (_, record) => (
        <Space size={2}>
          <Tooltip title="预览"><Button size="small" icon={<PlayCircleOutlined />} onClick={() => setPreview(record)} /></Tooltip>
          <Tooltip title="验证地址"><Button size="small" loading={checkingId === record.artifact.id} icon={<ReloadOutlined />} onClick={() => void validate(record)} /></Tooltip>
          <Tooltip title="下载"><Button size="small" icon={<CloudDownloadOutlined />} onClick={() => void download(record)} /></Tooltip>
          <Tooltip title="打开原对话"><Button size="small" icon={<LinkOutlined />} disabled={!record.artifact.conversationUrl} onClick={() => window.dispatchEvent(new CustomEvent('open-task-conversation', { detail: { task: record.task } }))} /></Tooltip>
        </Space>
      ),
    },
  ];

  return (
    <>
      <Modal title={`产物中心 (${records.length})`} open={open} onCancel={onClose} footer={null} width={1120}>
        <Space style={{ marginBottom: 12 }} wrap>
          <Input.Search value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索提示词或任务 ID" style={{ width: 280 }} allowClear />
          <Select value={mode} onChange={setMode} style={{ width: 130 }} options={[
            { value: 'all', label: '全部类型' }, { value: 'image', label: '图片' }, { value: 'video', label: '视频' }, { value: 'chat', label: '对话' }, { value: 'music', label: '音乐' },
          ]} />
          <Select value={validity} onChange={setValidity} style={{ width: 130 }} options={[
            { value: 'all', label: '全部状态' }, { value: 'unknown', label: '未验证' }, { value: 'valid', label: '有效' }, { value: 'expired', label: '已过期' }, { value: 'invalid', label: '不可用' },
          ]} />
        </Space>
        {records.length === 0 ? <Empty description="没有符合条件的产物" /> : <Table columns={columns} dataSource={records} size="small" pagination={{ pageSize: 12, showSizeChanger: false }} scroll={{ x: 980 }} />}
      </Modal>
      <Modal open={!!preview} onCancel={() => setPreview(null)} footer={null} width={preview?.artifact.kind === 'video' ? 820 : 680}>
        {preview?.artifact.kind === 'video'
          ? <video src={preview.artifact.url} controls autoPlay style={{ width: '100%', maxHeight: '75vh', background: '#000' }} />
          : preview && <img src={preview.artifact.url} alt="产物预览" style={{ width: '100%', maxHeight: '75vh', objectFit: 'contain' }} />}
      </Modal>
    </>
  );
};
