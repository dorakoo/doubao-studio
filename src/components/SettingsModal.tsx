/**
 * src/components/SettingsModal.tsx
 * 设置 Modal：下载目录配置等
 */
import React, { useEffect, useState } from 'react';
import { Modal, Input, Button, InputNumber, Switch, message } from 'antd';
import { FolderOpenOutlined } from '@ant-design/icons';

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({ open, onClose }) => {
  const [downloadDir, setDownloadDir] = useState('');
  const [autoConfirmMaterialAuthorization, setAutoConfirmMaterialAuthorization] = useState(false);
  const [initializationConcurrency, setInitializationConcurrency] = useState(1);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open) {
      loadSettings();
    }
  }, [open]);

  const loadSettings = async () => {
    try {
      const settings = await window.electronAPI.settings.get();
      setDownloadDir(settings.downloadDir || '');
      setAutoConfirmMaterialAuthorization(settings.autoConfirmMaterialAuthorization === true);
      setInitializationConcurrency(Math.max(1, Math.min(3, Number(settings.initializationConcurrency) || 1)));
    } catch (e: any) {
      console.warn('[SettingsModal] 加载设置失败:', e.message);
    }
  };

  const handleSelectDir = async () => {
    const result = await window.electronAPI.tasks.selectSaveDir();
    if (result.success && result.dirPath) {
      setDownloadDir(result.dirPath);
    }
  };

  const handleSave = async () => {
    setLoading(true);
    try {
      const currentSettings = await window.electronAPI.settings.get();
      const result = await window.electronAPI.settings.save({
        ...currentSettings,
        downloadDir,
        autoConfirmMaterialAuthorization,
        initializationConcurrency,
      });
      if (result.success) {
        message.success('设置已保存');
        onClose();
      } else {
        message.error('保存失败：' + result.error);
      }
    } catch (e: any) {
      message.error('保存失败：' + e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      title="偏好设置"
      open={open}
      onCancel={onClose}
      footer={[
        <Button key="cancel" onClick={onClose}>
          取消
        </Button>,
        <Button key="save" type="primary" onClick={handleSave} loading={loading}>
          保存
        </Button>,
      ]}
      width={480}
    >
      <div style={{ marginBottom: 16 }}>
        <div style={{ marginBottom: 8, fontWeight: 500 }}>产物下载目录</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Input
            value={downloadDir}
            onChange={(e) => setDownloadDir(e.target.value)}
            placeholder="留空则使用默认目录（~/Downloads/豆包工作室产物）"
            style={{ flex: 1 }}
          />
          <Button icon={<FolderOpenOutlined />} onClick={handleSelectDir}>
            浏览
          </Button>
        </div>
        {!downloadDir && (
          <div style={{ marginTop: 4, fontSize: 12, color: '#888' }}>
            默认：~/Downloads/豆包工作室产物
          </div>
        )}
      </div>
      <div style={{ marginBottom: 16, padding: 12, border: '1px solid #34344a', borderRadius: 8 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16 }}>
          <div>
            <div style={{ fontWeight: 500 }}>已授权素材自动确认</div>
            <div style={{ marginTop: 4, fontSize: 12, color: '#888' }}>
              仅精确匹配“安全确认 + 素材充分授权 + 拒绝/确认”的白名单弹窗；视频生成确认、登录、验证码、支付和未知弹窗永不点击。
            </div>
          </div>
          <Switch checked={autoConfirmMaterialAuthorization} onChange={setAutoConfirmMaterialAuthorization} />
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
        <div>
          <div style={{ fontWeight: 500 }}>初始化并发数</div>
          <div style={{ marginTop: 4, fontSize: 12, color: '#888' }}>只限制建会话、配置和上传；进入生成后立即释放。</div>
        </div>
        <InputNumber min={1} max={3} value={initializationConcurrency} onChange={(value) => setInitializationConcurrency(value || 1)} />
      </div>
    </Modal>
  );
};
