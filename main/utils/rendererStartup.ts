import * as path from 'path';

export type RendererStartupTarget =
  | { kind: 'url'; value: string }
  | { kind: 'file'; value: string }
  | { kind: 'diagnostic'; value: string };

export function buildDevelopmentLaunchHelpUrl(): string {
  const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>豆包工作室启动提示</title>
<style>body{margin:0;background:#0f0f14;color:#eee;font:16px/1.7 system-ui;padding:64px}main{max-width:720px;margin:auto}code{background:#24242e;padding:4px 8px;border-radius:6px;color:#b8b4ff}h1{color:#b8b4ff}</style>
</head><body><main><h1>开发服务尚未启动</h1><p>当前是源码开发版，不能直接执行 <code>electron .</code>。</p><p>请关闭此窗口，在项目目录运行 <code>pnpm run dev</code>。该命令会启动 Vite、注入正确地址并创建工作室窗口。</p></main></body></html>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

export function resolveRendererStartupTarget(
  isPackaged: boolean,
  devServerUrl: string | undefined,
  compiledMainDirectory: string,
): RendererStartupTarget {
  if (isPackaged) {
    return { kind: 'file', value: path.join(compiledMainDirectory, '../renderer/index.html') };
  }
  const normalizedUrl = devServerUrl?.trim();
  if (normalizedUrl && /^https?:\/\//i.test(normalizedUrl)) {
    return { kind: 'url', value: normalizedUrl };
  }
  return { kind: 'diagnostic', value: buildDevelopmentLaunchHelpUrl() };
}
