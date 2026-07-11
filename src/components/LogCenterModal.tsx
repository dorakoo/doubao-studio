import React, { useEffect, useMemo, useState } from 'react';
import { Button, Empty, Input, List, Modal, Select, Space, Tag, message } from 'antd';
import { DeleteOutlined, ReloadOutlined } from '@ant-design/icons';

type LogEntry = Awaited<ReturnType<typeof window.electronAPI.logs.list>>[number];

export const LogCenterModal: React.FC<{ open: boolean; onClose: () => void }> = ({ open, onClose }) => {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [level, setLevel] = useState<'all' | LogEntry['level']>('all');
  const [query, setQuery] = useState('');
  const load = async () => setLogs(await window.electronAPI.logs.list());
  useEffect(() => { if (open) void load(); }, [open]);
  const filtered = useMemo(() => logs.filter((log) => level === 'all' || log.level === level).filter((log) => !query.trim() || `${log.scope} ${log.message} ${log.taskId || ''}`.toLowerCase().includes(query.toLowerCase())).reverse(), [level, logs, query]);
  return (
    <Modal title={`运行日志 (${filtered.length})`} open={open} onCancel={onClose} width={900} footer={<Space><Button icon={<ReloadOutlined />} onClick={() => void load()}>刷新</Button><Button danger icon={<DeleteOutlined />} onClick={async () => { await window.electronAPI.logs.clear(); setLogs([]); message.success('日志已清空'); }}>清空</Button></Space>}>
      <Space style={{ marginBottom: 12 }}>
        <Input.Search value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索阶段、任务或错误" style={{ width: 320 }} allowClear />
        <Select value={level} onChange={setLevel} style={{ width: 120 }} options={[{ value: 'all', label: '全部级别' }, { value: 'info', label: '信息' }, { value: 'warn', label: '警告' }, { value: 'error', label: '错误' }]} />
      </Space>
      {filtered.length === 0 ? <Empty description="暂无日志" /> : <List size="small" dataSource={filtered.slice(0, 500)} renderItem={(log) => <List.Item><Space align="start"><Tag color={log.level === 'error' ? 'error' : log.level === 'warn' ? 'warning' : 'blue'}>{log.level.toUpperCase()}</Tag><span style={{ color: '#888', width: 145 }}>{new Date(log.createdAt).toLocaleString('zh-CN')}</span><strong style={{ width: 100 }}>{log.scope}</strong><span>{log.message}</span></Space></List.Item>} />}
    </Modal>
  );
};
