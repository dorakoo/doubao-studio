/**
 * src/components/OutputPreviewModal.tsx
 * 产物预览 Modal：显示已完成任务的产物图片，支持全选/下载
 */
import React, { useEffect, useState } from 'react';
import { Modal, Checkbox, Button, message, Empty } from 'antd';
import { DownloadOutlined } from '@ant-design/icons';

interface OutputItem {
  taskId: string;
  prompt: string;
  outputs: string[];
}

interface OutputPreviewModalProps {
  open: boolean;
  outputs: OutputItem[];
  onClose: () => void;
  onDownload: (selectedOutputs: OutputItem[]) => Promise<void>;
}

export const OutputPreviewModal: React.FC<OutputPreviewModalProps> = ({
  open,
  outputs,
  onClose,
  onDownload,
}) => {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    if (open) {
      const allIds = new Set(outputs.map((o) => o.taskId));
      setSelectedIds(allIds);
    }
  }, [open, outputs]);

  const toggleSelect = (taskId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(taskId)) {
        next.delete(taskId);
      } else {
        next.add(taskId);
      }
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === outputs.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(outputs.map((o) => o.taskId)));
    }
  };

  const handleDownload = async () => {
    const selected = outputs.filter((o) => selectedIds.has(o.taskId));
    if (selected.length === 0) {
      message.warning('请至少选择一个产物');
      return;
    }
    setDownloading(true);
    try {
      await onDownload(selected);
    } finally {
      setDownloading(false);
    }
  };

  const allSelected = selectedIds.size === outputs.length;

  return (
    <Modal
      title={`产物预览 (${outputs.length} 个任务)`}
      open={open}
      onCancel={onClose}
      footer={[
        <div
          key="footer"
          style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}
        >
          <Checkbox checked={allSelected} onChange={toggleSelectAll}>
            全选
          </Checkbox>
          <div>
            <Button style={{ marginRight: 8 }} onClick={onClose}>
              取消
            </Button>
            <Button
              type="primary"
              icon={<DownloadOutlined />}
              onClick={handleDownload}
              loading={downloading}
              disabled={selectedIds.size === 0}
            >
              下载选中 ({selectedIds.size})
            </Button>
          </div>
        </div>,
      ]}
      width={720}
      styles={{ body: { maxHeight: '60vh', overflow: 'auto' } }}
    >
      {outputs.length === 0 ? (
        <Empty description="暂无已完成产物" />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {outputs.map((item) => {
            const isSelected = selectedIds.has(item.taskId);
            const firstOutput = item.outputs[0] || '';
            return (
              <div
                key={item.taskId}
                style={{
                  display: 'flex',
                  gap: 12,
                  padding: 12,
                  border: `1px solid ${isSelected ? '#1677ff' : '#d9d9d9'}`,
                  borderRadius: 8,
                  background: isSelected ? '#e6f4ff' : '#fafafa',
                  cursor: 'pointer',
                }}
                onClick={() => toggleSelect(item.taskId)}
              >
                <Checkbox checked={isSelected} onChange={() => toggleSelect(item.taskId)} />
                {firstOutput && (
                  <img
                    src={firstOutput}
                    alt="产物"
                    style={{
                      width: 80,
                      height: 80,
                      objectFit: 'cover',
                      borderRadius: 4,
                      flexShrink: 0,
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                      setPreviewUrl(firstOutput);
                    }}
                  />
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, color: '#666', marginBottom: 4 }}>
                    {item.prompt.substring(0, 60)}
                    {item.prompt.length > 60 ? '...' : ''}
                  </div>
                  <div style={{ fontSize: 12, color: '#999' }}>
                    {item.outputs.length} 张产物
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* 图片预览 */}
      {previewUrl && (
        <Modal
          open={!!previewUrl}
          footer={null}
          onCancel={() => setPreviewUrl(null)}
          width={600}
          styles={{ body: { padding: 0 } }}
        >
          <img src={previewUrl} alt="预览" style={{ width: '100%', display: 'block' }} />
        </Modal>
      )}
    </Modal>
  );
};
