/**
 * src/index.tsx
 * React 渲染进程入口
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import { ConfigProvider, theme } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import App from './App';
import './styles/global.css';

// ==================== Ant Design 深色主题配置 ====================

const darkTheme = {
  algorithm: theme.darkAlgorithm,
  token: {
    // 品牌色 - 紫色系
    colorPrimary: '#6c5ce7',
    colorInfo: '#6c5ce7',
    colorSuccess: '#34d399',
    colorWarning: '#fbbf24',
    colorError: '#f87171',
    // 基础色
    colorBgBase: '#0f0f14',
    colorBgContainer: '#1e1e2e',
    colorBgElevated: '#24243a',
    colorBorder: '#2a2a3e',
    colorTextBase: '#e8e8f0',
    colorTextSecondary: '#9898b8',
    // 圆角
    borderRadius: 8,
    // 字体
    fontFamily: "'Inter', 'PingFang SC', 'Microsoft YaHei', sans-serif",
  },
  components: {
    Button: {
      colorPrimary: '#6c5ce7',
      algorithm: true,
    },
    Modal: {
      colorBgElevated: '#1e1e2e',
    },
    Dropdown: {
      colorBgElevated: '#1e1e2e',
    },
    Input: {
      colorBgContainer: '#1a1a24',
    },
    Tag: {
      borderRadiusSM: 9999,
    },
  },
};

// ==================== 渲染 ====================

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ConfigProvider theme={darkTheme} locale={zhCN}>
      <App />
    </ConfigProvider>
  </React.StrictMode>
);
