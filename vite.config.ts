import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

// Vite 配置：仅用于渲染进程（React 前端）
export default defineConfig({
  plugins: [react()],
  // 开发时 Electron 通过 loadURL 加载此地址
  base: './',
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  build: {
    outDir: 'dist/renderer',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
