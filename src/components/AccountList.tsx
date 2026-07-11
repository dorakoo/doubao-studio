/**
 * src/components/AccountList.tsx
 * 账号列表组件 — V2 实时状态 + 自动排序 + 手动置顶
 *
 * 功能：
 * - 实时显示每个账号的执行状态（空闲/注入中/生成中等）
 * - 自动排序：置顶账号 → 空闲账号 → 忙碌账号
 * - 手动置顶/取消置顶，优先级最高
 * - 添加/编辑/删除/刷新账号
 */

import React, { useState, useCallback, useMemo } from 'react';
import {
  PlusOutlined,
  UserOutlined,
  EditOutlined,
  DeleteOutlined,
  ReloadOutlined,
  MoreOutlined,
  PushpinOutlined,
  PushpinFilled,
} from '@ant-design/icons';
import { Input, Modal, Dropdown, message, Empty, Tooltip } from 'antd';
import type { MenuProps } from 'antd';
import { useAccountStore } from '../store/useAccountStore';
import { useTaskStore } from '../store/useTaskStore';
import { AUTO_STATE_DISPLAY } from '../types';
import type { Account } from '../types';
import type { AutomationState } from '../store/useTaskStore';

export const AccountList: React.FC = () => {
  const {
    accounts,
    selectedAccountId,
    loading,
    error,
    addAccount,
    updateAccount,
    deleteAccount,
    refreshAccount,
    selectAccount,
    togglePinned,
    updateScheduling,
    clearError,
  } = useAccountStore();

  // 订阅任务 store，获取实时执行状态
  const accountBusy = useTaskStore(s => s.accountBusy);
  const accountAutomationState = useTaskStore(s => s.accountAutomationState);
  const accountAutoMessage = useTaskStore(s => s.accountAutoMessage);

  // 搜索
  const [searchText, setSearchText] = useState('');

  // 添加账号弹窗
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [newAccountName, setNewAccountName] = useState('');
  const [adding, setAdding] = useState(false);

  // 编辑账号弹窗
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editingAccount, setEditingAccount] = useState<Account | null>(null);
  const [editName, setEditName] = useState('');
  const [editing, setEditing] = useState(false);

  // ---- 实时状态计算 ----
  /** 获取账号的实时展示状态 */
  const getAccountDisplay = useCallback(
    (accountId: string): { label: string; color: string; animated: boolean; detail: string } => {
      const autoState = accountAutomationState[accountId] as AutomationState | undefined;
      const account = accounts.find((item) => item.id === accountId);
      if (autoState && autoState !== 'idle') {
        const display = AUTO_STATE_DISPLAY[autoState] || AUTO_STATE_DISPLAY.idle;
        return {
          ...display,
          detail: accountAutoMessage[accountId] || '',
        };
      }
      const isBusy = accountBusy[accountId];
      if (isBusy) {
        return { label: '忙碌', color: '#fbbf24', animated: true, detail: '' };
      }
      if (account?.health?.loginState === 'expired') {
        return { label: '登录已失效', color: '#fb7185', animated: false, detail: '请重新登录' };
      }
      if (account?.scheduling?.enabled === false) {
        return { label: '已停用', color: '#94a3b8', animated: false, detail: '不参与自动调度' };
      }
      if (account?.scheduling?.manualCooldownUntil && new Date(account.scheduling.manualCooldownUntil).getTime() > Date.now()) {
        return { label: '手动冷却', color: '#94a3b8', animated: false, detail: `至 ${new Date(account.scheduling.manualCooldownUntil).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}` };
      }
      if (account?.health?.verificationRequired) {
        return { label: '需要验证', color: '#fb923c', animated: false, detail: '完成验证后恢复' };
      }
      if (account?.health?.cooldownUntil && new Date(account.health.cooldownUntil).getTime() > Date.now()) {
        return {
          label: '冷却中', color: '#94a3b8', animated: false,
          detail: `至 ${new Date(account.health.cooldownUntil).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`,
        };
      }
      return { label: '空闲', color: '#4ade80', animated: false, detail: '' };
    },
    [accounts, accountAutomationState, accountBusy, accountAutoMessage]
  );

  // ---- 排序逻辑 ----
  /** 搜索过滤 + 置顶优先 → 空闲靠前 → 忙碌靠后 */
  const sortedAccounts = useMemo(() => {
    let filtered = accounts;
    if (searchText.trim()) {
      const kw = searchText.trim().toLowerCase();
      filtered = accounts.filter(a => a.name.toLowerCase().includes(kw));
    }
    return [...filtered].sort((a, b) => {
      // 1. 不健康或冷却中的账号沉底
      const now = Date.now();
      const aUnavailable = a.health?.loginState === 'expired' || !!a.health?.verificationRequired ||
        (!!a.health?.cooldownUntil && new Date(a.health.cooldownUntil).getTime() > now);
      const bUnavailable = b.health?.loginState === 'expired' || !!b.health?.verificationRequired ||
        (!!b.health?.cooldownUntil && new Date(b.health.cooldownUntil).getTime() > now);
      if (aUnavailable !== bUnavailable) return aUnavailable ? 1 : -1;
      // 2. Seedance 今日额度用尽的账号统一沉底
      const aExhausted = !!a.seedanceQuota?.exhausted;
      const bExhausted = !!b.seedanceQuota?.exhausted;
      if (aExhausted !== bExhausted) return aExhausted ? 1 : -1;
      // 3. 置顶优先
      if (a.pinned !== b.pinned) {
        return a.pinned ? -1 : 1;
      }
      // 4. 空闲 vs 忙碌
      const aBusy = accountBusy[a.id] || false;
      const bBusy = accountBusy[b.id] || false;
      if (aBusy !== bBusy) {
        return aBusy ? 1 : -1;
      }
      // 5. 连续失败少的账号优先
      return (a.health?.consecutiveFailures || 0) - (b.health?.consecutiveFailures || 0);
    });
  }, [accounts, accountBusy, searchText]);

  // ---- 添加账号 ----
  const handleAddAccount = useCallback(async () => {
    if (!newAccountName.trim()) return;
    setAdding(true);
    const success = await addAccount(newAccountName.trim());
    setAdding(false);
    if (success) {
      setNewAccountName('');
      setAddModalOpen(false);
      message.success('账号添加成功');
    } else {
      message.error(error || '添加失败');
      clearError();
    }
  }, [newAccountName, addAccount, error, clearError]);

  // ---- 编辑账号 ----
  const handleEditAccount = useCallback(async () => {
    if (!editingAccount || !editName.trim()) return;
    setEditing(true);
    const success = await updateAccount(editingAccount.id, editName.trim());
    setEditing(false);
    if (success) {
      setEditModalOpen(false);
      setEditingAccount(null);
      message.success('账号已更新');
    }
  }, [editingAccount, editName, updateAccount]);

  // ---- 删除账号 ----
  const handleDeleteAccount = useCallback(
    async (account: Account) => {
      Modal.confirm({
        title: '确认删除',
        content: `确定要删除账号「${account.name}」吗？该账号的会话数据将被清除。`,
        okText: '删除',
        okType: 'danger',
        cancelText: '取消',
        centered: true,
        onOk: async () => {
          const success = await deleteAccount(account.id);
          if (success) {
            message.success('账号已删除');
          }
        },
      });
    },
    [deleteAccount]
  );

  // ---- 刷新账号 ----
  const handleRefreshAccount = useCallback(
    async (account: Account) => {
      const success = await refreshAccount(account.id);
      if (success) {
        message.success('账号已刷新');
      }
    },
    [refreshAccount]
  );

  // ---- 置顶/取消置顶 ----
  const handleTogglePinned = useCallback(
    async (account: Account, e?: React.MouseEvent) => {
      e?.stopPropagation();
      await togglePinned(account.id);
    },
    [togglePinned]
  );

  // ---- 右键菜单 ----
  const getContextMenuItems = useCallback(
    (account: Account): MenuProps['items'] => [
      {
        key: 'pin',
        label: account.pinned ? '取消置顶' : '置顶',
        icon: account.pinned ? <PushpinFilled /> : <PushpinOutlined />,
        onClick: () => handleTogglePinned(account),
      },
      {
        key: 'scheduling-toggle',
        label: account.scheduling?.enabled === false ? '恢复自动调度' : '暂停自动调度',
        onClick: () => updateScheduling(account.id, { enabled: account.scheduling?.enabled === false }),
      },
      {
        key: 'cooldown',
        label: '冷却 30 分钟',
        onClick: () => updateScheduling(account.id, { manualCooldownUntil: new Date(Date.now() + 30 * 60 * 1000).toISOString() }),
      },
      {
        key: 'edit',
        label: '编辑',
        icon: <EditOutlined />,
        onClick: () => {
          setEditingAccount(account);
          setEditName(account.name);
          setEditModalOpen(true);
        },
      },
      {
        key: 'refresh',
        label: '刷新会话',
        icon: <ReloadOutlined />,
        onClick: () => handleRefreshAccount(account),
      },
      { type: 'divider' },
      {
        key: 'delete',
        label: '删除',
        icon: <DeleteOutlined />,
        danger: true,
        onClick: () => handleDeleteAccount(account),
      },
    ],
    [handleDeleteAccount, handleRefreshAccount, handleTogglePinned, updateScheduling]
  );

  return (
    <div className="flex flex-col h-full">
      {/* 面板标题栏 */}
      <div className="panel-header">
        <div className="flex items-center gap-2">
          <span className="panel-title">账号列表</span>
          <span className="text-xs text-db-text-muted bg-db-surface px-1.5 py-0.5 rounded-full">
            {accounts.length}
          </span>
        </div>
        <Tooltip title="添加账号">
          <button
            className="btn-ghost text-db-accent hover:!text-db-accent-light"
            onClick={() => setAddModalOpen(true)}
          >
            <PlusOutlined />
          </button>
        </Tooltip>
      </div>

      {/* 搜索框 */}
      {accounts.length > 3 && (
        <div className="px-2 pb-1">
          <input
            type="text"
            placeholder="搜索账号..."
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            className="w-full px-2.5 py-1.5 text-xs rounded-md border border-db-border bg-db-surface text-db-text-primary placeholder-db-text-muted focus:outline-none focus:border-db-accent/50"
          />
        </div>
      )}

      {/* 账号列表 */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {sortedAccounts.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={
                <span className="text-db-text-muted text-xs">
                  暂无账号，点击 + 添加
                </span>
              }
            />
          </div>
        ) : (
          sortedAccounts.map((account) => {
            const isSelected = selectedAccountId === account.id;
            const display = getAccountDisplay(account.id);

            return (
              <Dropdown
                key={account.id}
                menu={{ items: getContextMenuItems(account) }}
                trigger={['contextMenu']}
              >
                <div
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-db cursor-pointer transition-all duration-200 border ${
                    isSelected
                      ? 'bg-db-accent/15 border-db-accent/40 shadow-sm'
                      : 'bg-db-surface hover:bg-db-surface-hover border-transparent'
                  }`}
                  onClick={() => selectAccount(account.id)}
                >
                  {/* 头像 */}
                  <div
                    className={`flex items-center justify-center w-9 h-9 rounded-full flex-shrink-0 text-white text-sm font-semibold ${
                      isSelected ? 'bg-db-accent' : 'bg-db-border'
                    }`}
                  >
                    {account.avatar ? (
                      <img
                        src={account.avatar}
                        alt={account.name}
                        className="w-full h-full rounded-full object-cover"
                      />
                    ) : (
                      account.name.charAt(0).toUpperCase()
                    )}
                  </div>

                  {/* 名称 + 实时状态 */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      {/* 置顶标记 */}
                      {account.pinned && (
                        <PushpinFilled
                          className="text-[10px] text-db-accent flex-shrink-0"
                          title="已置顶"
                        />
                      )}
                      <span className="text-sm font-medium text-db-text-primary truncate">
                        {account.name}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      {/* 状态指示点 */}
                      <span
                        className={`status-dot ${display.animated ? 'animate-pulse' : ''}`}
                        style={{ backgroundColor: display.color }}
                      />
                      <span className="text-2xs text-db-text-muted">
                        {display.label}
                      </span>
                      {/* 详细状态信息 */}
                      {display.detail && (
                        <span className="text-2xs text-db-text-muted truncate ml-1 opacity-70">
                          {display.detail}
                        </span>
                      )}
                    </div>
                    {account.seedanceQuota && (
                      <div
                        className="text-2xs mt-0.5 truncate"
                        style={{ color: account.seedanceQuota.exhausted ? '#fb7185' : '#818cf8' }}
                        title="本地预测值：Seedance 2.0 标准模型通常按 2 个单位估算"
                      >
                        {account.seedanceQuota.exhausted
                          ? 'Seedance 今日额度已用尽'
                          : `Seedance 预计剩余 ${Math.max(0, account.seedanceQuota.estimatedTotalUnits - account.seedanceQuota.usedUnits)} 单位`}
                      </div>
                    )}
                    {!!account.health && (account.health.successCount > 0 || account.health.failureCount > 0) && (
                      <div className="text-2xs mt-0.5 text-db-text-muted truncate">
                        成功 {account.health.successCount} · 失败 {account.health.failureCount}
                        {account.health.consecutiveFailures > 0 ? ` · 连续失败 ${account.health.consecutiveFailures}` : ''}
                      </div>
                    )}
                  </div>

                  {/* 置顶快捷按钮 */}
                  <Tooltip title={account.pinned ? '取消置顶' : '置顶'}>
                    <button
                      className={`btn-ghost w-6 h-6 flex-shrink-0 ${
                        account.pinned ? 'text-db-accent' : 'text-db-text-muted opacity-40 hover:opacity-100'
                      }`}
                      onClick={(e) => handleTogglePinned(account, e)}
                    >
                      {account.pinned ? (
                        <PushpinFilled style={{ fontSize: 12 }} />
                      ) : (
                        <PushpinOutlined style={{ fontSize: 12 }} />
                      )}
                    </button>
                  </Tooltip>

                  {/* 操作按钮 */}
                  <Dropdown
                    menu={{ items: getContextMenuItems(account) }}
                    trigger={['click']}
                  >
                    <button
                      className="btn-ghost w-7 h-7"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <MoreOutlined style={{ fontSize: 13 }} />
                    </button>
                  </Dropdown>
                </div>
              </Dropdown>
            );
          })
        )}
      </div>

      {/* 添加账号弹窗 */}
      <Modal
        title="添加账号"
        open={addModalOpen}
        onOk={handleAddAccount}
        onCancel={() => {
          setAddModalOpen(false);
          setNewAccountName('');
        }}
        confirmLoading={adding}
        okText="添加"
        cancelText="取消"
        centered
        width={400}
      >
        <div className="py-4">
          <Input
            placeholder="输入账号名称（如：工作号-01）"
            value={newAccountName}
            onChange={(e) => setNewAccountName(e.target.value)}
            onPressEnter={handleAddAccount}
            autoFocus
            size="large"
            prefix={<UserOutlined className="text-db-text-muted" />}
          />
        </div>
      </Modal>

      {/* 编辑账号弹窗 */}
      <Modal
        title="编辑账号"
        open={editModalOpen}
        onOk={handleEditAccount}
        onCancel={() => {
          setEditModalOpen(false);
          setEditingAccount(null);
        }}
        confirmLoading={editing}
        okText="保存"
        cancelText="取消"
        centered
        width={400}
      >
        <div className="py-4">
          <Input
            placeholder="输入新名称"
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            onPressEnter={handleEditAccount}
            autoFocus
            size="large"
          />
        </div>
      </Modal>
    </div>
  );
};
