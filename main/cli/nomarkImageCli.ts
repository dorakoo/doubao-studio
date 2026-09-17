/**
 * 无印图片 CLI：供 Agent 通过命令行解析并下载豆包分享页原图。
 *
 * 运行（编译后）：
 *   node dist/main/cli/doubaoCliEntry.js parse-images --url <thread>
 *   node dist/main/cli/doubaoCliEntry.js download-nomark-images --url <thread> --out <dir> [--limit 10]
 */
import { downloadNomarkImage, parseNomarkImages, type NomarkImage } from '../utils/nomarkImage';

export interface NomarkImageCliOptions {
  url?: string;
  out?: string;
  limit?: string;
}

export async function runParseImagesCli(options: NomarkImageCliOptions): Promise<{
  ok: boolean;
  error?: string;
  data?: { shareUrl: string; imageCount: number; images: NomarkImage[] };
}> {
  if (!options.url) return { ok: false, error: 'INVALID_ARGUMENTS' };
  const result = await parseNomarkImages(options.url);
  if (result.status !== 'ok') {
    return { ok: false, error: result.error || result.status };
  }
  return {
    ok: true,
    data: {
      shareUrl: result.shareUrl || options.url,
      imageCount: result.images.length,
      images: result.images,
    },
  };
}

export async function runDownloadNomarkImagesCli(options: NomarkImageCliOptions): Promise<{
  ok: boolean;
  error?: string;
  data?: { files: Array<{ filePath: string; bytes: number }>; savedCount: number };
}> {
  if (!options.url || !options.out) return { ok: false, error: 'INVALID_ARGUMENTS' };
  const limit = options.limit === undefined ? 20 : Number(options.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
    return { ok: false, error: 'INVALID_ARGUMENTS' };
  }
  const parsed = await parseNomarkImages(options.url);
  if (parsed.status !== 'ok' || parsed.images.length === 0) {
    return { ok: false, error: parsed.error || parsed.status };
  }
  const files: Array<{ filePath: string; bytes: number }> = [];
  let index = 0;
  for (const image of parsed.images.slice(0, limit)) {
    index += 1;
    const saved = await downloadNomarkImage(image, options.out, `nomark-image-${String(index).padStart(3, '0')}`);
    if (saved.status === 'saved' && saved.filePath) {
      files.push({ filePath: saved.filePath, bytes: saved.bytes || 0 });
    }
  }
  if (files.length === 0) {
    return { ok: false, error: 'IMAGE_DOWNLOAD_FAILED' };
  }
  return { ok: true, data: { files, savedCount: files.length } };
}
