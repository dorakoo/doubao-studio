/**
 * src/components/AccountList.tsx
 * 账号列表组件
 *
 * 功能：
 * - 展示已添加的豆包账号（头像+昵称+状态标签）
 * - 添加账号按钮
 * - 点击选中账号，右侧加载对应浏览器
 * - 右键菜单：编辑、删除、刷新
 * - 账号数据通过 IPC 持久化到本地 JSON
 */

import React, { useState, useCallback } from 'react';
import {
  PlusOutlined,
  UserOutlined,
  EditOutlined,
  DeleteOutlined,
  ReloadOutlined,
  MoreOutlined,
} from '@ant-design/icons';
import { Input, Modal, Dropdown, message, Empty, Tooltip } from 'antd';
import type { MenuProps } from 'antd';
import { useAccountStore } from '../store/useAccountStore';
import { ACCOUNT_STATUS_CONFIG } from '../types';
import type { Account } from '../types';

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
    clearError,
  } = useAccountStore();

  // 添加账号弹窗
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [newAccountName, setNewAccountName] = useState('');
  const [adding, setAdding] = useState(false);

  // 编辑账号弹窗
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editingAccount, setEditingAccount] = useState<Account | null>(null);
  const [editName, setEditName] = useState('');
  const [editing, setEditing] = useState(false);

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

  // ---- 右键菜单 ----
  const getContextMenuItems = useCallback(
    (account: Account): MenuProps['items'] => [
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
    [handleDeleteAccount, handleRefreshAccount]
  );

  return (
    <div className="flex flex-col h-full">
      {/* 面板标题栏 */}
      <div className="panel-header">
        <span className="panel-title">账号列表</span>
        <Tooltip title="添加账号">
          <button
            className="btn-ghost text-db-accent hover:!text-db-accent-light"
            onClick={() => setAddModalOpen(true)}
          >
            <PlusOutlined />
          </button>
        </Tooltip>
      </div>

      {/* 账号列表 */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {accounts.length === 0 ? (
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
          accounts.map((account) => {
            const statusConfig = ACCOUNT_STATUS_CONFIG[account.status];
            const isSelected = selectedAccountId === account.id;

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

                  {/* 名称 + 状态 */}
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-db-text-primary truncate">
                      {account.name}
                    </div>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <span
                        className="status-dot"
                        style={{
                          backgroundColor: statusConfig.color,
                        }}
                      />
                      <span className="text-2xs text-db-text-muted">
                        {statusConfig.label}
                      </span>
                    </div>
                  </div>

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
