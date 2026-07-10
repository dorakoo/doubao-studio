/**
 * src/components/Toolbar.tsx
 * 顶部工具栏
 *
 * 包含：
 * - 应用标题「豆包工作室」
 * - 窗口控制按钮（最小化/最大化/关闭）
 * - 全局操作：全部暂停/继续、批量下载产物
 */

import React from 'react';
import {
  MinusOutlined,
  BorderOutlined,
  CloseOutlined,
  PauseCircleOutlined,
  PlayCircleOutlined,
  DownloadOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  HistoryOutlined,
  MoreOutlined,
} from '@ant-design/icons';
import { Descriptions, Dropdown, message, Modal, Progress, Tooltip } from 'antd';
import type { MenuProps } from 'antd';
import { useTaskStore } from '../store/useTaskStore';
import { SettingsModal } from './SettingsModal';
import { OutputPreviewModal } from './OutputPreviewModal';
import type { OutputItem } from './OutputPreviewModal';
import { DownloadQueueModal } from './DownloadQueueModal';
import type { DownloadJob } from '../types';
import { useAccountStore } from '../store/useAccountStore';

interface ToolbarProps {
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
}

export const Toolbar: React.FC<ToolbarProps> = ({ sidebarCollapsed, onToggleSidebar }) => {
  const { tasks, schedulerPaused, batchPause, resumeAll, getCompletedOutputs } = useTaskStore();
  const accounts = useAccountStore((state) => state.accounts);
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const [previewOpen, setPreviewOpen] = React.useState(false);
  const [completedOutputs, setCompletedOutputs] = React.useState<OutputItem[]>([]);
  const [downloadQueueOpen, setDownloadQueueOpen] = React.useState(false);
  const [downloadJobs, setDownloadJobs] = React.useState<DownloadJob[]>([]);
  const [downloadJobsLoading, setDownloadJobsLoading] = React.useState(false);
  const [metricsOpen, setMetricsOpen] = React.useState(false);

  const loadDownloadJobs = React.useCallback(async () => {
    setDownloadJobsLoading(true);
    try {
      setDownloadJobs(await window.electronAPI.tasks.listDownloads());
    } finally {
      setDownloadJobsLoading(false);
    }
  }, []);

  // 监听 TaskConsole 发来的批量下载事件
  React.useEffect(() => {
    const handleBatchDownloadOutputs = (e: Event) => {
      const customEvent = e as CustomEvent;
      const outputs = customEvent.detail;
      if (outputs && outputs.length > 0) {
        setCompletedOutputs(outputs);
        setPreviewOpen(true);
      }
    };
    window.addEventListener('batch-download-outputs', handleBatchDownloadOutputs);
    return () => window.removeEventListener('batch-download-outputs', handleBatchDownloadOutputs);
  }, []);

  // 运行中的任务数（包含 executing + generating）
  const runningCount = tasks.filter(
    (t) => t.status === 'executing' || t.status === 'generating'
  ).length;
  // 排队中的任务数
  const queuedCount = tasks.filter((t) => t.status === 'queued').length;
  // 已完成且有产物的任务数
  const completedWithOutputs = tasks.filter(
    (t) => t.status === 'done' && t.outputs.length > 0
  ).length;
  const terminalTasks = tasks.filter((task) => task.status === 'done' || task.status === 'fail');
  const successRate = terminalTasks.length > 0
    ? Math.round((tasks.filter((task) => task.status === 'done').length / terminalTasks.length) * 100)
    : 0;
  const completedDurations = tasks
    .filter((task) => task.status === 'done' && task.runtime?.startedAt)
    .map((task) => new Date(task.updatedAt).getTime() - new Date(task.runtime!.startedAt).getTime())
    .filter((duration) => duration >= 0);
  const averageMinutes = completedDurations.length
    ? Math.round(completedDurations.reduce((sum, duration) => sum + duration, 0) / completedDurations.length / 60_000)
    : 0;

  // 处理暂停/继续
  const handleTogglePause = async () => {
    if (!schedulerPaused) {
      await batchPause();
    } else {
      await resumeAll();
    }
  };

  // 批量下载产物 — 打开预览 Modal
  const handleBatchDownload = async () => {
    const outputs = await getCompletedOutputs();
    if (outputs.length === 0) {
      message.info('暂无已完成产物');
      return;
    }
    setCompletedOutputs(outputs);
    setPreviewOpen(true);
  };

  // 执行下载
  const handleDoDownload = async (selectedOutputs: OutputItem[]) => {
    // 获取下载目录设置
    const settings = await window.electronAPI.settings.get();
    const saveDir = settings.downloadDir || undefined;

    const result = await window.electronAPI.tasks.downloadOutputs(selectedOutputs, saveDir);
    await loadDownloadJobs();
    if (result.success) {
      if (result.failed > 0) {
        message.warning(`已下载 ${result.count} 个，失败 ${result.failed} 个：${result.error || '地址不可用'}`);
      } else {
        message.success(`已下载 ${result.count} 个产物到 ${result.saveDir || '下载目录'}`);
        setPreviewOpen(false);
      }
    } else {
      message.error(`下载失败：${result.error || '未能获取文件'}`);
    }
  };

  const handleRetryDownload = async (job: DownloadJob) => {
    const result = await window.electronAPI.tasks.downloadOutputs([{
      taskId: job.taskId,
      prompt: '',
      outputs: [job.url],
      accountId: job.accountId,
      mode: job.mode,
    }], job.saveDir);
    await loadDownloadJobs();
    if (result.success) message.success('重新下载成功');
    else message.error(`重新下载失败：${result.error || '地址不可用'}`);
  };

  // 更多操作菜单
  const moreMenuItems: MenuProps['items'] = [
    {
      key: 'metrics',
      label: '运行统计',
      onClick: () => setMetricsOpen(true),
    },
    {
      key: 'diagnostics',
      label: '导出诊断包',
      onClick: async () => {
        const result = await window.electronAPI.tasks.exportDiagnostics();
        if (result.success) message.success(`诊断包已导出：${result.filePath}`);
        else if (result.error) message.error(`导出失败：${result.error}`);
      },
    },
    {
      key: 'settings',
      label: '偏好设置',
      onClick: () => setSettingsOpen(true),
    },
    {
      key: 'about',
      label: '关于豆包工作室',
    },
  ];

  return (
    <>
    <div
      className="flex items-center justify-between h-11 px-3 bg-db-bg-secondary border-b border-db-border"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      {/* 左侧：标题 + 面板切换 */}
      <div className="flex items-center gap-3" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
        {/* 侧边栏折叠按钮 */}
        <Tooltip title={sidebarCollapsed ? '展开面板' : '折叠面板'}>
          <button className="btn-ghost" onClick={onToggleSidebar}>
            {sidebarCollapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
          </button>
        </Tooltip>

        {/* 应用标题 */}
        <div className="flex items-center gap-2">
          <span className="text-lg font-bold text-db-accent tracking-tight">
            豆包工作室
          </span>
          <span className="text-2xs text-db-text-muted bg-db-surface px-1.5 py-0.5 rounded">
            MVP
          </span>
        </div>

        {/* 任务状态指示 */}
        <div className="flex items-center gap-3 ml-4 text-xs text-db-text-secondary">
          {runningCount > 0 && (
            <span className="flex items-center gap-1">
              <span className="status-dot busy" />
              执行中 {runningCount}
            </span>
          )}
          {queuedCount > 0 && (
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-blue-400" />
              排队 {queuedCount}
            </span>
          )}
        </div>
      </div>

      {/* 中间：可拖拽区域 */}
      <div className="flex-1" />

      {/* 右侧：全局操作 + 窗口控制 */}
      <div className="flex items-center gap-1" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
        {/* 暂停/继续 */}
        <Tooltip title={schedulerPaused ? '继续所有任务' : '暂停所有任务'}>
          <button className="btn-ghost" onClick={handleTogglePause}>
            {schedulerPaused ? <PlayCircleOutlined /> : <PauseCircleOutlined />}
          </button>
        </Tooltip>

        {/* 批量下载 */}
        <Tooltip title={`下载已完成产物 (${completedWithOutputs})`}>
          <button
            className={`btn-ghost ${completedWithOutputs === 0 ? 'opacity-40 cursor-not-allowed' : ''}`}
            onClick={handleBatchDownload}
            disabled={completedWithOutputs === 0}
          >
            <DownloadOutlined />
          </button>
        </Tooltip>

        <Tooltip title="下载记录">
          <button
            className="btn-ghost"
            onClick={() => {
              setDownloadQueueOpen(true);
              void loadDownloadJobs();
            }}
          >
            <HistoryOutlined />
          </button>
        </Tooltip>

        <Dropdown menu={{ items: moreMenuItems }} trigger={['click']}>
          <button className="btn-ghost" title="更多">
            <MoreOutlined />
          </button>
        </Dropdown>

        {/* 分隔线 */}
        <div className="w-px h-5 bg-db-border mx-1" />

        {/* 窗口控制按钮 */}
        <Tooltip title="最小化">
          <button className="btn-ghost" onClick={() => window.electronAPI?.system?.minimize()}>
            <MinusOutlined style={{ fontSize: 12 }} />
          </button>
        </Tooltip>
        <Tooltip title="最大化">
          <button className="btn-ghost" onClick={() => window.electronAPI?.system?.toggleMaximize()}>
            <BorderOutlined style={{ fontSize: 11 }} />
          </button>
        </Tooltip>
        <Tooltip title="关闭">
          <button
            className="btn-ghost hover:!bg-red-500/20 hover:!text-red-400"
            onClick={() => window.electronAPI?.system?.close()}
          >
            <CloseOutlined style={{ fontSize: 12 }} />
          </button>
        </Tooltip>
      </div>
    </div>

    {/* 设置 Modal */}
    <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />

    {/* 产物预览 Modal */}
    <OutputPreviewModal
      open={previewOpen}
      outputs={completedOutputs}
      onClose={() => setPreviewOpen(false)}
      onDownload={handleDoDownload}
    />
    <DownloadQueueModal
      open={downloadQueueOpen}
      jobs={downloadJobs}
      loading={downloadJobsLoading}
      onClose={() => setDownloadQueueOpen(false)}
      onRefresh={() => void loadDownloadJobs()}
      onRetry={handleRetryDownload}
    />
    <Modal title="运行统计" open={metricsOpen} onCancel={() => setMetricsOpen(false)} footer={null} width={560}>
      <Progress percent={successRate} status={successRate >= 80 ? 'success' : 'normal'} />
      <Descriptions column={2} size="small" style={{ marginTop: 18 }}>
        <Descriptions.Item label="任务总数">{tasks.length}</Descriptions.Item>
        <Descriptions.Item label="成功率">{successRate}%</Descriptions.Item>
        <Descriptions.Item label="平均完成时间">{averageMinutes} 分钟</Descriptions.Item>
        <Descriptions.Item label="等待人工处理">
          {tasks.filter((task) => task.status === 'waiting_verification' || task.status === 'paused').length}
        </Descriptions.Item>
        <Descriptions.Item label="失败任务">{tasks.filter((task) => task.status === 'fail').length}</Descriptions.Item>
        <Descriptions.Item label="下载失败">{downloadJobs.filter((job) => job.status === 'failed').length}</Descriptions.Item>
        <Descriptions.Item label="可用账号">
          {accounts.filter((account) => !account.seedanceQuota?.exhausted && !account.health?.verificationRequired && account.health?.loginState !== 'expired').length}
        </Descriptions.Item>
        <Descriptions.Item label="额度耗尽账号">{accounts.filter((account) => account.seedanceQuota?.exhausted).length}</Descriptions.Item>
      </Descriptions>
    </Modal>
    </>
  );
};
