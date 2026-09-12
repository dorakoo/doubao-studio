/**
 * src/components/OutputPreviewModal.tsx
 * 产物预览 Modal：显示已完成任务的产物图片，支持全选/下载
 */
import React, { useEffect, useState } from 'react';
import { Modal, Checkbox, Button, message, Empty } from 'antd';
import { DownloadOutlined, VideoCameraOutlined } from '@ant-design/icons';
import type { GenerationMode } from '../types';
import { buildBatchDownloadRequest, createDownloadIntent, createInitialOutputSelection, readDownloadSelection } from '../utils/downloadSelection';
import type { BatchDownloadOutput } from '../utils/downloadSelection';

/**
 * 预览条目即下载条目：项目与批次归属必填，归属不明不允许进入下载范围。
 */
export type OutputItem = BatchDownloadOutput;

export interface OutputScopeSummary {
  projectName: string;
  batchId: string;
  taskCount: number;
  artifactCount: number;
}

interface OutputPreviewModalProps {
  open: boolean;
  outputs: OutputItem[];
  scopeSummary?: OutputScopeSummary;
  onClose: () => void;
  onDownload: (selectedOutputs: OutputItem[]) => Promise<void>;
}

export const OutputPreviewModal: React.FC<OutputPreviewModalProps> = ({
  open,
  outputs,
  scopeSummary,
  onClose,
  onDownload,
}) => {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [previewMedia, setPreviewMedia] = useState<{ url: string; mode: GenerationMode } | null>(null);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    if (open) {
      setSelectedIds(createInitialOutputSelection());
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

  const runDownload = async (selected: OutputItem[]) => {
    setDownloading(true);
    try {
      await onDownload(selected);
    } finally {
      setDownloading(false);
    }
  };

  const selectedOutputs = outputs.filter((o) => selectedIds.has(o.taskId));
  // 摘要与下载按钮读数必须随当前选择实时变化，不允许显示整个批次的静态总数。
  const selection = readDownloadSelection(selectedOutputs);
  const crossBatchSelected = selectedOutputs.length > 0
    && selection.invalidCount === 0
    && !buildBatchDownloadRequest(selectedOutputs).ok;

  const handleDownload = async () => {
    // 点击下载即“确认”决策，经过唯一 fail-closed 入口；
    // 空选择、归属缺失、零产物或非法跨批次一律零下载调用。
    const intent = createDownloadIntent(selectedOutputs, 'confirm');
    if (!intent) {
      const rejected = buildBatchDownloadRequest(selectedOutputs);
      if (selectedOutputs.length === 0) message.warning(rejected.error || '请至少选择一个产物');
      else message.error(rejected.error || '当前选择不满足下载范围要求');
      return;
    }
    await runDownload(intent.outputs);
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
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {scopeSummary && (
              <span style={{ fontSize: 12, color: '#666' }} data-testid="download-scope-summary">
                批次范围：{scopeSummary.projectName} / {scopeSummary.batchId}
                {' · '}
                已选：{selection.projectCount} 项目 / {selection.batchCount} 批次 / {selection.taskCount} 任务 / {selection.artifactCount} 产物
              </span>
            )}
            <Button style={{ marginRight: 8 }} onClick={onClose}>
              取消
            </Button>
            <Button
              type="primary"
              icon={<DownloadOutlined />}
              onClick={handleDownload}
              loading={downloading}
              disabled={!selection.downloadEnabled}
              danger={crossBatchSelected}
            >
              下载选中（{selection.artifactCount} 产物 / {selection.taskCount} 任务）
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
                <Checkbox
                  checked={isSelected}
                  onClick={(event) => event.stopPropagation()}
                  onChange={() => toggleSelect(item.taskId)}
                />
                {item.outputs.length > 0 && (
                  <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                    {item.outputs.slice(0, 3).map((url, idx) => item.mode === 'video' ? (
                      <button
                        key={idx}
                        type="button"
                        title="播放视频"
                        onClick={(event) => {
                          event.stopPropagation();
                          setPreviewMedia({ url, mode: item.mode });
                        }}
                        style={{
                          width: 80, height: 80, border: '1px solid #c7d2fe', borderRadius: 4,
                          background: '#eef2ff', color: '#4f46e5', cursor: 'pointer',
                          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 5,
                        }}
                      >
                        <VideoCameraOutlined style={{ fontSize: 24 }} />
                        <span style={{ fontSize: 11 }}>视频 {idx + 1}</span>
                      </button>
                    ) : (
                      <img
                        key={idx}
                        src={url}
                        alt={`产物-${idx}`}
                        style={{ width: 80, height: 80, objectFit: 'cover', borderRadius: 4, background: '#eee' }}
                        onClick={(event) => {
                          event.stopPropagation();
                          setPreviewMedia({ url, mode: item.mode });
                        }}
                      />
                    ))}
                    {item.outputs.length > 3 && (
                      <div style={{
                        width: 80, height: 80, display: 'flex', alignItems: 'center',
                        justifyContent: 'center', borderRadius: 4, background: '#eee',
                        fontSize: 12, color: '#999', flexShrink: 0,
                      }}>
                        +{item.outputs.length - 3}
                      </div>
                    )}
                  </div>
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, color: '#666', marginBottom: 4 }}>
                    {item.prompt.substring(0, 60)}
                    {item.prompt.length > 60 ? '...' : ''}
                  </div>
                  <div style={{ fontSize: 12, color: '#999' }}>
                    {item.outputs.length} 个产物
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* 图片预览 */}
      {previewMedia && (
        <Modal
          open={!!previewMedia}
          footer={null}
          onCancel={() => setPreviewMedia(null)}
          width={previewMedia.mode === 'video' ? 820 : 600}
          styles={{ body: { padding: 0 } }}
        >
          {previewMedia.mode === 'video' ? (
            <video src={previewMedia.url} controls autoPlay style={{ width: '100%', maxHeight: '75vh', display: 'block', background: '#000' }} />
          ) : (
            <img src={previewMedia.url} alt="预览" style={{ width: '100%', display: 'block' }} />
          )}
        </Modal>
      )}
    </Modal>
  );
};
