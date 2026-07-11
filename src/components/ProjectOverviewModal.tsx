import React from 'react';
import { Button, Descriptions, Modal, Progress, Space, message } from 'antd';
import { ExportOutlined } from '@ant-design/icons';
import { useProjectStore } from '../store/useProjectStore';
import { useTaskStore } from '../store/useTaskStore';

export const ProjectOverviewModal: React.FC<{ open: boolean; onClose: () => void }> = ({ open, onClose }) => {
  const { projects, activeProjectId } = useProjectStore();
  const tasks = useTaskStore((state) => state.tasks).filter((task) => (task.projectId || 'default-project') === activeProjectId);
  const project = projects.find((item) => item.id === activeProjectId);
  const done = tasks.filter((task) => task.status === 'done').length;
  const artifacts = tasks.reduce((sum, task) => sum + (task.artifacts?.length || 0), 0);
  const batches = new Set(tasks.map((task) => task.batchId).filter(Boolean)).size;
  const exportProject = async () => {
    const result = await window.electronAPI.system.exportProject(activeProjectId);
    if (result.success) message.success(`项目包已导出：${result.filePath}`);
    else if (result.error) message.error(result.error);
  };
  return (
    <Modal title={project?.name || '项目概览'} open={open} onCancel={onClose} footer={<Button icon={<ExportOutlined />} onClick={() => void exportProject()}>导出项目包</Button>} width={620}>
      <Progress percent={tasks.length ? Math.round(done / tasks.length * 100) : 0} />
      <Descriptions column={2} style={{ marginTop: 18 }}>
        <Descriptions.Item label="项目说明" span={2}>{project?.description || '暂无说明'}</Descriptions.Item>
        <Descriptions.Item label="任务总数">{tasks.length}</Descriptions.Item>
        <Descriptions.Item label="已完成">{done}</Descriptions.Item>
        <Descriptions.Item label="任务批次">{batches}</Descriptions.Item>
        <Descriptions.Item label="历史产物">{artifacts}</Descriptions.Item>
        <Descriptions.Item label="失败任务">{tasks.filter((task) => task.status === 'fail').length}</Descriptions.Item>
        <Descriptions.Item label="运行任务">{tasks.filter((task) => ['executing', 'generating', 'waiting_verification'].includes(task.status)).length}</Descriptions.Item>
      </Descriptions>
    </Modal>
  );
};
