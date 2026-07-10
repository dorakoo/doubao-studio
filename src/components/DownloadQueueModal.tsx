import React from 'react';
import { Button, Empty, List, Modal, Space, Tag, Tooltip } from 'antd';
import { ReloadOutlined, SyncOutlined } from '@ant-design/icons';
import type { DownloadJob } from '../types';

interface DownloadQueueModalProps {
  open: boolean;
  jobs: DownloadJob[];
  loading: boolean;
  onClose: () => void;
  onRefresh: () => void;
  onRetry: (job: DownloadJob) => Promise<void>;
}

const STATUS_LABELS: Record<DownloadJob['status'], { label: string; color: string }> = {
  queued: { label: '等待下载', color: 'blue' },
  downloading: { label: '下载中', color: 'processing' },
  done: { label: '已完成', color: 'success' },
  failed: { label: '失败', color: 'error' },
};

export const DownloadQueueModal: React.FC<DownloadQueueModalProps> = ({
  open,
  jobs,
  loading,
  onClose,
  onRefresh,
  onRetry,
}) => (
  <Modal
    title="下载记录"
    open={open}
    onCancel={onClose}
    width={760}
    footer={(
      <Space>
        <Button icon={<ReloadOutlined />} loading={loading} onClick={onRefresh}>刷新</Button>
        <Button onClick={onClose}>关闭</Button>
      </Space>
    )}
    styles={{ body: { maxHeight: '62vh', overflowY: 'auto' } }}
  >
    {jobs.length === 0 ? <Empty description="暂无下载记录" /> : (
      <List
        dataSource={[...jobs].reverse()}
        renderItem={(job) => {
          const status = STATUS_LABELS[job.status];
          return (
            <List.Item
              actions={job.status === 'failed' ? [
                <Button key="retry" size="small" icon={<ReloadOutlined />} onClick={() => onRetry(job)}>
                  重试
                </Button>,
              ] : undefined}
            >
              <List.Item.Meta
                title={(
                  <Space size={8}>
                    <Tag color={status.color}>{job.status === 'downloading' && <SyncOutlined spin />} {status.label}</Tag>
                    <span>{job.mode === 'video' ? '视频' : job.mode === 'image' ? '图片' : '文件'}</span>
                    <span style={{ color: '#888', fontSize: 12 }}>{job.taskId.slice(0, 8)}</span>
                  </Space>
                )}
                description={(
                  <div style={{ minWidth: 0 }}>
                    <Tooltip title={job.filePath || job.url}>
                      <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {job.filePath || job.url}
                      </div>
                    </Tooltip>
                    <div style={{ color: job.error ? '#fb7185' : '#888', marginTop: 4 }}>
                      {job.error || (job.bytes ? `${(job.bytes / 1024 / 1024).toFixed(1)} MB` : `尝试 ${job.attempts} 次`)}
                    </div>
                  </div>
                )}
              />
            </List.Item>
          );
        }}
      />
    )}
  </Modal>
);
