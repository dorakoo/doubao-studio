import React, { useState } from 'react';
import { Button, Input, Modal, Select, Space, message } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { useProjectStore } from '../store/useProjectStore';

export const ProjectSwitcher: React.FC = () => {
  const { projects, activeProjectId, selectProject, addProject } = useProjectStore();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const create = async () => {
    if (!name.trim()) return;
    if (await addProject(name.trim(), description.trim())) {
      setName(''); setDescription(''); setOpen(false); message.success('项目已创建');
    }
  };
  return (
    <>
      <Space.Compact>
        <Select
          value={activeProjectId}
          onChange={selectProject}
          style={{ width: 180 }}
          size="small"
          options={projects.filter((project) => !project.archived).map((project) => ({ value: project.id, label: project.name }))}
        />
        <Button size="small" icon={<PlusOutlined />} title="新建项目" onClick={() => setOpen(true)} />
      </Space.Compact>
      <Modal title="新建项目" open={open} onOk={() => void create()} onCancel={() => setOpen(false)} okText="创建" cancelText="取消">
        <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="项目名称" autoFocus style={{ marginBottom: 12 }} />
        <Input.TextArea value={description} onChange={(event) => setDescription(event.target.value)} placeholder="项目说明" rows={3} />
      </Modal>
    </>
  );
};
