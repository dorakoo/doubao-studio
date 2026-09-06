import { describe, expect, it } from 'vitest';
import {
  applyWebviewActivationStyle,
  forceWebviewLayoutRepaint,
  getSupersededLoadingAccountIds,
  getWebviewHydrationAccountIds,
  isWebviewDocumentReady,
} from '../../src/utils/webviewHydration';

const accounts = [{ id: 'account-a' }, { id: 'account-b' }, { id: 'account-c' }];

describe('webview 按需挂载策略', () => {
  it('启动时只挂载当前账号，避免全部账号并发加载', () => {
    expect(getWebviewHydrationAccountIds(accounts, 'account-a', {})).toEqual(['account-a']);
  });

  it('切换账号时返回新的当前账号', () => {
    expect(getWebviewHydrationAccountIds(accounts, 'account-b', {})).toEqual(['account-b']);
  });

  it('并行任务账号即使在后台也会被挂载', () => {
    expect(getWebviewHydrationAccountIds(accounts, 'account-a', {
      'account-b': 'task-b',
      'account-c': 'task-c',
    })).toEqual(['account-a', 'account-b', 'account-c']);
  });

  it('忽略已删除账号与空执行记录', () => {
    expect(getWebviewHydrationAccountIds(accounts, null, {
      'account-a': '',
      missing: 'task-x',
    })).toEqual([]);
  });

  it('后台账号移出可视区，避免 Electron guest surface 串画面', () => {
    const style = { opacity: '', pointerEvents: '', transform: '', zIndex: '', visibility: '' };
    applyWebviewActivationStyle(style, false);
    expect(style).toEqual({
      opacity: '1', pointerEvents: 'none', transform: 'translate3d(-200vw, 0, 0)',
      zIndex: '-1', visibility: 'visible',
    });

    applyWebviewActivationStyle(style, true);
    expect(style).toEqual({
      opacity: '1', pointerEvents: 'auto', transform: 'translate3d(0, 0, 0)',
      zIndex: '1', visibility: 'visible',
    });
  });

  it('当前账号创建时可立即进入可绘制状态', () => {
    const style = {
      opacity: '0', pointerEvents: 'none', transform: 'translate3d(-200vw, 0, 0)',
      zIndex: '0', visibility: 'visible',
    };
    applyWebviewActivationStyle(style, true);
    expect(style.opacity).toBe('1');
    expect(style.pointerEvents).toBe('auto');
    expect(style.zIndex).toBe('1');
    expect(style.transform).toBe('translate3d(0, 0, 0)');
  });

  it('快速切换只回收无执行任务的旧加载页', () => {
    expect(getSupersededLoadingAccountIds(
      ['account-a', 'account-b', 'account-c'],
      new Set(['account-a', 'account-b', 'account-c']),
      'account-c',
      { 'account-b': 'task-b' },
    )).toEqual(['account-a']);
  });

  it('真实平台标题与 URL 可作为不读取账号数据的就绪证据', () => {
    expect(isWebviewDocumentReady(
      'https://www.doubao.com/chat/',
      '豆包 - 字节跳动旗下 AI 智能助手',
      'doubao.com',
    )).toBe(true);
    expect(isWebviewDocumentReady('https://www.doubao.com/chat/', '', 'doubao.com')).toBe(false);
    expect(isWebviewDocumentReady('https://example.com/', '豆包', 'doubao.com')).toBe(false);
  });

  it('已加载 guest 可通过一次 1px 布局变化触发首帧重绘并恢复宽度', async () => {
    const target = { style: { width: '100%' }, offsetWidth: 800 };
    const frames: Array<() => void> = [];
    const repaint = forceWebviewLayoutRepaint(target, (callback) => frames.push(callback));
    expect(target.style.width).toBe('calc(100% - 1px)');
    expect(frames).toHaveLength(1);
    frames[0]();
    await repaint;
    expect(target.style.width).toBe('100%');
  });
});
