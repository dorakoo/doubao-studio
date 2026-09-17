import { describe, expect, it } from 'vitest';
import {
  downloadNomarkImage,
  extractNomarkImagesFromHtml,
  parseNomarkImages,
} from '../../main/utils/nomarkImage';
import { runParseImagesCli } from '../../main/cli/nomarkImageCli';

function buildThreadHtml(imageUrl: string): string {
  const payload = JSON.stringify({
    data: {
      message_snapshot: {
        message_list: [
          {
            content_block: [
              {
                content_v2: JSON.stringify({
                  creation_block: {
                    creations: [
                      {
                        image: {
                          image_ori_raw: { url: imageUrl, width: 1024, height: 768 },
                        },
                      },
                    ],
                  },
                }),
              },
            ],
          },
        ],
      },
    },
  });
  const escaped = payload
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return `<script data-script-src="modern-run-window-fn" data-fn-args="${escaped}" nonce="n"></script>`;
}

describe('nomark image parse', () => {
  it('从 creation_block 提取 image_ori_raw 原图', () => {
    const html = buildThreadHtml('https://p3-flow-imagex-sign.byteimg.com/o/origin/img.jpg?x=1');
    const images = extractNomarkImagesFromHtml(html);
    expect(images).toHaveLength(1);
    expect(images[0]).toMatchObject({
      url: 'https://p3-flow-imagex-sign.byteimg.com/o/origin/img.jpg?x=1',
      width: 1024,
      height: 768,
    });
  });

  it('拒绝私有地址图片', () => {
    const html = buildThreadHtml('http://127.0.0.1/a.jpg');
    expect(() => extractNomarkImagesFromHtml(html)).not.toThrow();
    expect(extractNomarkImagesFromHtml(html)).toEqual([]);
  });

  it('端到端解析 + 下载 + CLI', async () => {
    const imageUrl = 'https://cdn.example.com/img-ori.png';
    const html = buildThreadHtml(imageUrl);
    const fetchImpl = async (url: string): Promise<Response> => {
      if (url.includes('doubao.com/thread')) return new Response(html, { status: 200 });
      if (url === imageUrl) {
        return new Response(new Uint8Array([137, 80, 78, 71]), {
          status: 200,
          headers: { 'content-type': 'image/png' },
        });
      }
      throw new Error(`unexpected ${url}`);
    };
    const parsed = await parseNomarkImages('https://www.doubao.com/thread/img-demo', fetchImpl);
    expect(parsed.status).toBe('ok');
    expect(parsed.images[0]?.url).toBe(imageUrl);

    const dir = `${process.env.TEMP || process.env.TMPDIR || '/tmp'}/doubao-nomark-img-${Date.now()}`;
    const saved = await downloadNomarkImage(parsed.images[0], dir, 'img-001', fetchImpl);
    expect(saved.status).toBe('saved');
    expect(saved.filePath?.endsWith('.png')).toBe(true);
    expect(saved.bytes).toBe(4);
  });

  it('CLI parse-images 缺 url 返回 INVALID_ARGUMENTS', async () => {
    const result = await runParseImagesCli({});
    expect(result).toEqual({ ok: false, error: 'INVALID_ARGUMENTS' });
  });

  it('无 modern-run 脚本时 fail-closed', async () => {
    const result = await parseNomarkImages('https://www.doubao.com/thread/x', async () =>
      new Response('<html></html>', { status: 200 }),
    );
    expect(result.status).toBe('page_data_unreadable');
  });
});
