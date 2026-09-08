import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

describe('本机控制主进程生命周期', () => {
  const source = readFileSync(resolve(__dirname, '../../main/main.ts'), 'utf8');
  const rendererSource = readFileSync(resolve(__dirname, '../../src/App.tsx'), 'utf8');

  it('在创建 Renderer 前初始化命令 Broker，避免首次 ready 信号丢失', () => {
    const lifecycle = source.slice(source.indexOf('app.whenReady().then'));
    const createBroker = lifecycle.indexOf('controlBroker = new ControlCommandBroker');
    const createRenderer = lifecycle.indexOf('mainWindow = createMainWindow()');

    expect(createBroker).toBeGreaterThanOrEqual(0);
    expect(createRenderer).toBeGreaterThan(createBroker);
    expect(lifecycle.indexOf('await startLocalControl(requestedControlPort)')).toBeGreaterThan(createRenderer);
  });

  it('退出时先同步删除发现文件，再等待 HTTP 服务异步停止', () => {
    const start = source.indexOf('async function stopLocalControl');
    const end = source.indexOf('\n}\n\nasync function runOneTimeWebviewNetworkRecovery', start);
    const lifecycle = source.slice(start, end);

    expect(lifecycle.indexOf('fs.unlinkSync(filePath)')).toBeGreaterThanOrEqual(0);
    expect(lifecycle.indexOf('await server.stop()')).toBeGreaterThan(lifecycle.indexOf('fs.unlinkSync(filePath)'));
  });

  it('Renderer 注册命令监听后只在启动窗口内有界重申就绪', () => {
    const start = rendererSource.indexOf("window.electronAPI.control.onCommand");
    const end = rendererSource.indexOf('\n  }, []);', start);
    const lifecycle = rendererSource.slice(start, end);

    expect(lifecycle.indexOf('const announceReady')).toBeGreaterThan(lifecycle.indexOf('onCommand'));
    expect(lifecycle).toContain('setInterval(announceReady, 250)');
    expect(lifecycle).toContain('setTimeout(() => clearInterval(readinessInterval), 5_000)');
    expect(lifecycle).toContain('clearInterval(readinessInterval)');
    expect(lifecycle).toContain('clearTimeout(readinessStop)');
  });
});
