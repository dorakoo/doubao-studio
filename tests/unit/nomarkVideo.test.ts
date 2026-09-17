import { createCipheriv, createHash, randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { decodeMainUrl, decodeQaabToken, QAAB_SALT } from '../../main/utils/qaabVideoCrypto';
import {
  buildUnwatermarkedUrl,
  downloadNomarkVideo,
  extractFallbackApis,
  isThreadShareUrl,
  parseNomarkVideos,
} from '../../main/utils/nomarkVideo';

function encryptQaab(url: string, seed: Buffer): { token: string; keySeed: string } {
  const firstDigest = createHash('sha512').update(seed.subarray(0, 32)).digest();
  const material = createHash('sha512').update(Buffer.concat([firstDigest, QAAB_SALT])).digest();
  const key = material.subarray(0, 16);
  const iv = material.subarray(16, 32);
  const payload = Buffer.from(url, 'ascii');
  const pad = 16 - (payload.length % 16 || 16);
  const padded = Buffer.concat([payload, Buffer.alloc(pad, pad)]);
  const cipher = createCipheriv('aes-128-cbc', key, iv);
  const encrypted = Buffer.concat([cipher.update(padded), cipher.final()]);
  const header = Buffer.from([0xa8, 0x00, 0x01, 0x00]);
  const body = Buffer.concat([header, encrypted]);
  // 整段 token 为 base64；魔数头 a8 00 01 00 的 base64 前缀即 "qAAB"
  return { token: body.toString('base64'), keySeed: seed.toString('base64') };
}

describe('qAAB video crypto', () => {
  it('plain http(s) URL 原样返回', () => {
    expect(decodeMainUrl('https://v.example.com/a.mp4')).toBe('https://v.example.com/a.mp4');
  });

  it('Base64 包装的 ASCII URL 可解码', () => {
    const url = 'https://v.example.com/plain.mp4';
    expect(decodeMainUrl(Buffer.from(url, 'ascii').toString('base64'))).toBe(url);
  });

  it('自造 qAAB token + key_seed 可解密为原始 URL', () => {
    const url = 'https://v.example.com/unwatermarked-video.mp4';
    const seed = randomBytes(48);
    const { token, keySeed } = encryptQaab(url, seed);
    expect(decodeQaabToken(token, keySeed)).toBe(url);
    expect(decodeMainUrl(token, keySeed)).toBe(url);
  });

  it('错误 key_seed 解密失败返回空串', () => {
    const { token } = encryptQaab('https://v.example.com/x.mp4', randomBytes(32));
    expect(decodeQaabToken(token, randomBytes(32).toString('base64'))).toBe('');
  });
});

describe('nomark share video parse', () => {
  it('只接受 doubao/dola 的 /thread/ 分享链接', () => {
    expect(isThreadShareUrl('https://www.doubao.com/thread/abc')).toBe(true);
    expect(isThreadShareUrl('https://www.dola.com/thread/xyz')).toBe(true);
    expect(isThreadShareUrl('https://www.doubao.com/chat/abc')).toBe(false);
    expect(isThreadShareUrl('https://evil.example/thread/abc')).toBe(false);
  });

  it('fallback_api 改写为无水印参数，拒绝非受信 host 与非 fplay 路径', () => {
    const rewritten = buildUnwatermarkedUrl(
      'https://v3-dy-o-abtest.snssdk.com/video/fplay/?vid=a&codec_type=1&logo_type=watermarked',
    );
    const url = new URL(rewritten);
    expect(url.searchParams.get('codec_type')).toBe('8');
    expect(url.searchParams.get('logo_type')).toBe('unwatermarked');
    expect(url.searchParams.get('vid')).toBe('a');
    expect(() => buildUnwatermarkedUrl('https://evil.example/video/fplay/?vid=a')).toThrow('UNTRUSTED_FALLBACK_API');
    expect(() => buildUnwatermarkedUrl('https://v3-dy-o-abtest.snssdk.com/other/?vid=a')).toThrow('UNTRUSTED_FALLBACK_API');
  });

  it('从 modern-run 脚本 JSON 递归提取 fallback_api', () => {
    const html = `
      <html><body>
      <script data-script-src="modern-run-window-fn" data-fn-name="mergeLoaderData" data-fn-args="{&quot;a&quot;:{&quot;fallback_api&quot;:&quot;https://v3-dy-o-abtest.snssdk.com/video/fplay/?vid=v1&quot;}}" nonce="x"></script>
      </body></html>`;
    expect(extractFallbackApis(html)).toEqual([
      'https://v3-dy-o-abtest.snssdk.com/video/fplay/?vid=v1',
    ]);
  });

  it('端到端：分享页 → 无水印 API → qAAB 解密 → 下载', async () => {
    const seed = randomBytes(48);
    const mediaUrl = 'https://cdn.example.com/video-nomark.mp4';
    const { token, keySeed } = encryptQaab(mediaUrl, seed);
    const fallback = 'https://v3-dy-o-abtest.snssdk.com/video/fplay/?vid=v1&logo_type=watermarked';
    const html = `<script data-script-src="modern-run-router-data-fn" data-fn-args="{&quot;nested&quot;:{&quot;fallback_api&quot;:&quot;${fallback}&quot;}}" nonce="n"></script>`;

    const fetchImpl = async (url: string): Promise<Response> => {
      if (url.includes('doubao.com/thread')) {
        return new Response(html, { status: 200 });
      }
      if (url.includes('/video/fplay/')) {
        const u = new URL(url);
        expect(u.searchParams.get('logo_type')).toBe('unwatermarked');
        return Response.json({
          data: {
            vid: 'v1',
            key_seed: keySeed,
            width: 1920,
            height: 1080,
            video_list: {
              '1': { main_url: token, vwidth: 1920, vheight: 1080, definition: '1080p', duration: 5 },
            },
          },
        });
      }
      if (url === mediaUrl) {
        return new Response(new Uint8Array([1, 2, 3, 4]), {
          status: 200,
          headers: { 'content-type': 'video/mp4' },
        });
      }
      throw new Error(`unexpected ${url}`);
    };

    const parsed = await parseNomarkVideos('https://www.doubao.com/thread/demo', fetchImpl);
    expect(parsed.status).toBe('ok');
    expect(parsed.videos).toHaveLength(1);
    expect(parsed.videos[0]).toMatchObject({
      vid: 'v1',
      url: mediaUrl,
      width: 1920,
      height: 1080,
      definition: '1080p',
    });

    const dir = `${process.env.TMPDIR || process.env.TEMP || '/tmp'}/doubao-nomark-test-${Date.now()}`;
    const saved = await downloadNomarkVideo(parsed.videos[0], dir, fetchImpl);
    expect(saved.status).toBe('saved');
    expect(saved.bytes).toBe(4);
    expect(saved.filePath?.endsWith('v1.mp4')).toBe(true);
  });

  it('页面无 fallback_api 时 fail-closed', async () => {
    const result = await parseNomarkVideos('https://www.doubao.com/thread/x', async () =>
      new Response('<html>no script</html>', { status: 200 }),
    );
    expect(result.status).toBe('fallback_api_missing');
    expect(result.videos).toEqual([]);
  });

  it('非法分享 URL 直接拒绝', async () => {
    const result = await parseNomarkVideos('https://evil.example/thread/x');
    expect(result.status).toBe('invalid_url');
  });
});
