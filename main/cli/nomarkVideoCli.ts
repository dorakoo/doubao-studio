/**
 * 无印视频 CLI：供 Agent / 脚本通过命令行解析并下载豆包分享页中的无水印视频。
 *
 * 运行（编译后）：
 *   node dist/main/cli/doubaoCliEntry.js parse-video --url <thread>
 *   node dist/main/cli/doubaoCliEntry.js download-nomark-video --url <thread> --out <dir> [--index 0]
 */
import {
  downloadNomarkVideo,
  parseNomarkVideos,
  type NomarkVideo,
} from '../utils/nomarkVideo';

export interface NomarkCliOptions {
  url?: string;
  out?: string;
  index?: string;
}

/** 纯逻辑：解析 /thread/ 为 JSON 投影（不含 Cookie）。 */
export async function runParseVideoCli(options: NomarkCliOptions): Promise<{
  ok: boolean;
  error?: string;
  data?: { shareUrl: string; videoCount: number; videos: NomarkVideo[] };
}> {
  if (!options.url) return { ok: false, error: 'INVALID_ARGUMENTS' };
  const result = await parseNomarkVideos(options.url);
  if (result.status !== 'ok') {
    return { ok: false, error: result.error || result.status };
  }
  return {
    ok: true,
    data: {
      shareUrl: result.shareUrl || options.url,
      videoCount: result.videos.length,
      videos: result.videos.map((video) => ({
        vid: video.vid,
        url: video.url,
        width: video.width,
        height: video.height,
        definition: video.definition,
        duration: video.duration,
        codecType: video.codecType,
        posterUrl: video.posterUrl,
      })),
    },
  };
}

/** 纯逻辑：解析并把第 index 条（默认 0）视频写入 outDir。 */
export async function runDownloadNomarkVideoCli(options: NomarkCliOptions): Promise<{
  ok: boolean;
  error?: string;
  data?: {
    filePath: string;
    bytes: number;
    contentType: string;
    video: NomarkVideo;
  };
}> {
  if (!options.url || !options.out) return { ok: false, error: 'INVALID_ARGUMENTS' };
  const index = options.index === undefined ? 0 : Number(options.index);
  if (!Number.isInteger(index) || index < 0) return { ok: false, error: 'INVALID_ARGUMENTS' };
  const parsed = await parseNomarkVideos(options.url);
  if (parsed.status !== 'ok' || parsed.videos.length === 0) {
    return { ok: false, error: parsed.error || parsed.status };
  }
  if (index >= parsed.videos.length) {
    return { ok: false, error: 'VIDEO_INDEX_OUT_OF_RANGE' };
  }
  const video = parsed.videos[index];
  const saved = await downloadNomarkVideo(video, options.out);
  if (saved.status !== 'saved' || !saved.filePath) {
    return { ok: false, error: saved.error || saved.status };
  }
  return {
    ok: true,
    data: {
      filePath: saved.filePath,
      bytes: saved.bytes || 0,
      contentType: saved.contentType || '',
      video,
    },
  };
}
