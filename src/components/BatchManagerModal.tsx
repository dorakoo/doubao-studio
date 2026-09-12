import React, { useMemo } from 'react';
import { Button, Empty, Modal, Progress, Space, Table, Tag, Tooltip, message } from 'antd';
import { DownloadOutlined, ReloadOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import type { Task } from '../types';
import { useTaskStore, isDependencyBlockedTask } from '../store/useTaskStore';
import { useProjectStore } from '../store/useProjectStore';
import type { BatchDownloadOutput, BatchDownloadScope } from '../utils/downloadSelection';
import { buildBatchDownloadPayload } from '../utils/downloadSelection';

interface BatchManagerModalProps {
  open: boolean;
  onClose: () => void;
  onDownloadBatch: (outputs: BatchDownloadOutput[], scope: BatchDownloadScope) => void;
}

interface BatchRow {
  key: string;
  batchId: string;
  tasks: Task[];
  total: number;
  done: number;
  /** 普通平台生成失败（可重试） */
  failed: number;
  /** 依赖阻断（不可重试，不计入平台成功率） */
  dependencyBlocked: number;
  running: number;
  queued: number;
}

export const BatchManagerModal: React.FC<BatchManagerModalProps> = ({ open, onClose, onDownloadBatch }) => {
  const tasks = useTaskStore((state) => state.tasks);
  const retryTask = useTaskStore((state) => state.retryTask);
  const activeProjectId = useProjectStore((state) => state.activeProjectId);
  const activeProject = useProjectStore((state) => state.projects.find((project) => project.id === state.activeProjectId));
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
      failed: batchTasks.filter((task) => task.status === 'fail' && !isDependencyBlockedTask(task)).length,
      dependencyBlocked: batchTasks.filter((task) => isDependencyBlockedTask(task)).length,
      running: batchTasks.filter((task) => ['executing', 'generating', 'waiting_verification', 'waiting_generation_confirmation', 'manual_submission_observing'].includes(task.status)).length,
      queued: batchTasks.filter((task) => task.status === 'queued' && !isDependencyBlockedTask(task)).length,
    })).sort((a, b) => b.batchId.localeCompare(a.batchId));
  }, [activeProjectId, tasks]);

  // 批量重试只针对普通生成失败；依赖阻断必须等依赖恢复并重新评估，绝不进入批量重试。
  const retryFailed = async (row: BatchRow) => {
    const failedTasks = row.tasks.filter((task) => task.status === 'fail' && !isDependencyBlockedTask(task));
    if (failedTasks.length === 0) {
      if (row.dependencyBlocked > 0) {
        message.info(`该批次只有 ${row.dependencyBlocked} 条依赖阻断任务，请先修复依赖关系后再重新评估`);
        return;
      }
      message.info('该批次没有可重试的普通失败任务');
      return;
    }
    for (const task of failedTasks) await retryTask(task.id);
    message.success(`已重新排队 ${failedTasks.length} 条失败任务`);
  };

  const downloadBatch = (row: BatchRow) => {
    const payload = buildBatchDownloadPayload(
      row.tasks,
      activeProjectId,
      activeProject?.name || activeProjectId,
      row.batchId,
    );
    if (payload.outputs.length === 0) {
      message.info('该批次暂无已完成产物');
      return;
    }
    onDownloadBatch(payload.outputs, payload.summary);
    onClose();
  };

  const columns: ColumnsType<BatchRow> = [
    { title: '批次', dataIndex: 'batchId', ellipsis: true },
    { title: '总数', dataIndex: 'total', width: 70 },
    {
      title: '进度', width: 220,
      render: (_, row) => <Progress percent={Math.round((row.done / Math.max(row.total, 1)) * 100)} size="small" />,
    },
    {
      title: '状态', width: 300,
      render: (_, row) => (
        <Space size={4}>
          <Tag color="success">完成 {row.done}</Tag>
          <Tag color="processing">运行 {row.running}</Tag>
          <Tag>排队 {row.queued}</Tag>
          <Tag color="error">失败 {row.failed}</Tag>
          {row.dependencyBlocked > 0 && <Tag color="warning">依赖阻断 {row.dependencyBlocked}</Tag>}
        </Space>
      ),
    },
    {
      title: '操作', width: 220,
      render: (_, row) => (
        <Space size={4}>
          <Button size="small" icon={<DownloadOutlined />} disabled={row.done === 0} onClick={() => downloadBatch(row)}>下载批次</Button>
          <Tooltip title={row.dependencyBlocked > 0 ? `依赖阻断 ${row.dependencyBlocked} 条不参与批量重试，依赖恢复并重新评估后才可继续` : undefined}>
            <Button size="small" icon={<ReloadOutlined />} disabled={row.failed === 0} onClick={() => void retryFailed(row)}>重试失败</Button>
          </Tooltip>
        </Space>
      ),
    },
  ];

  return (
    <Modal title={`任务批次 (${rows.length})`} open={open} onCancel={onClose} footer={null} width={980}>
      {rows.length === 0 ? <Empty description="暂无 CSV 或工作流批次" /> : <Table columns={columns} dataSource={rows} size="small" pagination={{ pageSize: 10 }} />}
      <div style={{ marginTop: 10, fontSize: 12, color: '#888' }}>
        依赖阻断（dependency_failed / dependency_missing / dependency_cycle）属于调度阻断，不计入平台生成失败率，也不会自动重试。
      </div>
    </Modal>
  );
};
