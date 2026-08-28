import React, { useEffect, useMemo, useState } from 'react';
import { Button, Descriptions, Input, Modal, Popconfirm, Select, Space, Tag, message } from 'antd';
import { useProjectStore } from '../store/useProjectStore';
import { useTaskStore } from '../store/useTaskStore';

const DEFAULT_PROJECT_ID = 'default-project';
const RUNNING_STATUSES = new Set(['executing', 'generating', 'waiting_verification', 'waiting_generation_confirmation', 'manual_submission_observing']);

export const ProjectManagementModal: React.FC<{ open: boolean; onClose: () => void }> = ({ open, onClose }) => {
  const { projects, activeProjectId, selectProject, updateProject, deleteProject } = useProjectStore();
  const tasks = useTaskStore((state) => state.tasks);
  const [selectedId, setSelectedId] = useState(activeProjectId);
  const selected = projects.find((project) => project.id === selectedId) || projects[0];
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  useEffect(() => { if (open) setSelectedId(activeProjectId); }, [activeProjectId, open]);
  useEffect(() => {
    setName(selected?.name || '');
    setDescription(selected?.description || '');
  }, [selected]);

  const counts = useMemo(() => {
    const projectTasks = tasks.filter((task) => (task.projectId || DEFAULT_PROJECT_ID) === selected?.id);
    return {
      total: projectTasks.length,
      queued: projectTasks.filter((task) => task.status === 'queued').length,
      running: projectTasks.filter((task) => RUNNING_STATUSES.has(task.status)).length,
      done: projectTasks.filter((task) => task.status === 'done').length,
    };
  }, [selected?.id, tasks]);

  const save = async () => {
    if (!selected) return;
    const result = await updateProject(selected.id, { name, description });
    if (result.success) message.success('项目资料已更新');
    else message.error(result.error || '项目更新失败');
  };

  const toggleArchived = async () => {
    if (!selected) return;
    const result = await updateProject(selected.id, { archived: !selected.archived });
    if (result.success) message.success(selected.archived ? '项目已恢复' : '项目已归档');
    else message.error(result.error || '项目归档失败');
  };

  const remove = async () => {
    if (!selected) return;
    const result = await deleteProject(selected.id);
    if (!result.success) {
      message.error(result.taskCount ? `项目含 ${result.taskCount} 项任务，不能删除` : (result.error || '项目删除失败'));
      return;
    }
    setSelectedId(DEFAULT_PROJECT_ID);
    selectProject(DEFAULT_PROJECT_ID);
    message.success('空项目已删除，已切回默认项目');
  };

  return (
    <Modal title="管理项目" open={open} onCancel={onClose} footer={null} width={620} destroyOnClose>
      <Select
        value={selected?.id}
        onChange={setSelectedId}
        style={{ width: '100%', marginBottom: 16 }}
        options={projects.map((project) => ({ value: project.id, label: `${project.name}${project.archived ? '（已归档）' : ''}` }))}
      />
      {selected && (
        <Space direction="vertical" size={14} style={{ width: '100%' }}>
          <Descriptions size="small" column={1} bordered>
            <Descriptions.Item label="项目 ID"><span style={{ userSelect: 'text' }}>{selected.id}</span></Descriptions.Item>
            <Descriptions.Item label="任务数量">
              <Space wrap>
                <Tag>全部 {counts.total}</Tag><Tag color="gold">排队 {counts.queued}</Tag>
                <Tag color="blue">运行 {counts.running}</Tag><Tag color="green">完成 {counts.done}</Tag>
              </Space>
            </Descriptions.Item>
          </Descriptions>
          <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="项目名称" />
          <Input.TextArea value={description} onChange={(event) => setDescription(event.target.value)} placeholder="项目说明" rows={3} />
          <Space wrap>
            <Button type="primary" onClick={() => void save()}>保存名称与说明</Button>
            <Button disabled={selected.id === DEFAULT_PROJECT_ID} onClick={() => void toggleArchived()}>
              {selected.archived ? '恢复项目' : '归档项目'}
            </Button>
            <Popconfirm
              title="确认删除这个空项目？"
              description="只删除项目记录，不删除任务、素材或视频产物。"
              okText="确认删除"
              cancelText="取消"
              disabled={selected.id === DEFAULT_PROJECT_ID || counts.total > 0}
              onConfirm={() => void remove()}
            >
              <Button danger disabled={selected.id === DEFAULT_PROJECT_ID || counts.total > 0}>删除空项目</Button>
            </Popconfirm>
            {selected.id === DEFAULT_PROJECT_ID && <span>默认项目不能归档或删除</span>}
            {selected.id !== DEFAULT_PROJECT_ID && counts.total > 0 && <span>含 {counts.total} 项任务，不能删除</span>}
          </Space>
        </Space>
      )}
    </Modal>
  );
};
