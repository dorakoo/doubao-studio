import React, { useMemo } from 'react';
import { Button, Empty, Modal, Progress, Space, Table, Tag, message } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import type { Task } from '../types';
import { useTaskStore } from '../store/useTaskStore';
import { useProjectStore } from '../store/useProjectStore';

interface BatchManagerModalProps {
  open: boolean;
  onClose: () => void;
}

interface BatchRow {
  key: string;
  batchId: string;
  tasks: Task[];
  total: number;
  done: number;
  failed: number;
  running: number;
  queued: number;
}

export const BatchManagerModal: React.FC<BatchManagerModalProps> = ({ open, onClose }) => {
  const tasks = useTaskStore((state) => state.tasks);
  const retryTask = useTaskStore((state) => state.retryTask);
  const activeProjectId = useProjectStore((state) => state.activeProjectId);
  const rows = useMemo(() => {
    const groups = new Map<string, Task[]>();
    for (const task of tasks) {
      if ((task.projectId || 'default-project') !== activeProjectId) continue;
      if (!task.batchId) continue;
      groups.set(task.batchId, [...(groups.get(task.batchId) || []), task]);
    }
    return [...groups.entries()].map(([batchId, batchTasks]): BatchRow => ({
      key: batchId, batchId, tasks: batchTasks, total: batchTasks.length,
      done: batchTasks.filter((task) => task.status === 'done').length,
      failed: batchTasks.filter((task) => task.status === 'fail').length,
      running: batchTasks.filter((task) => ['executing', 'generating', 'waiting_verification'].includes(task.status)).length,
      queued: batchTasks.filter((task) => task.status === 'queued').length,
    })).sort((a, b) => b.batchId.localeCompare(a.batchId));
  }, [activeProjectId, tasks]);

  const retryFailed = async (row: BatchRow) => {
    const failedTasks = row.tasks.filter((task) => task.status === 'fail');
    for (const task of failedTasks) await retryTask(task.id);
    message.success(`已重新排队 ${failedTasks.length} 条失败任务`);
  };

  const columns: ColumnsType<BatchRow> = [
    { title: '批次', dataIndex: 'batchId', ellipsis: true },
    { title: '总数', dataIndex: 'total', width: 70 },
    {
      title: '进度', width: 220,
      render: (_, row) => <Progress percent={Math.round((row.done / Math.max(row.total, 1)) * 100)} size="small" />,
    },
    {
      title: '状态', width: 230,
      render: (_, row) => <Space size={4}><Tag color="success">完成 {row.done}</Tag><Tag color="processing">运行 {row.running}</Tag><Tag>排队 {row.queued}</Tag><Tag color="error">失败 {row.failed}</Tag></Space>,
    },
    {
      title: '操作', width: 120,
      render: (_, row) => <Button size="small" icon={<ReloadOutlined />} disabled={row.failed === 0} onClick={() => void retryFailed(row)}>重试失败</Button>,
    },
  ];

  return (
    <Modal title={`任务批次 (${rows.length})`} open={open} onCancel={onClose} footer={null} width={940}>
      {rows.length === 0 ? <Empty description="暂无 CSV 或工作流批次" /> : <Table columns={columns} dataSource={rows} size="small" pagination={{ pageSize: 10 }} />}
    </Modal>
  );
};
