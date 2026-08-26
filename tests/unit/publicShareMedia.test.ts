import { describe, expect, it } from 'vitest';
import {
  extractDeclaredPublicMediaUrls,
  isAllowedPublicShareUrl,
  isPublicMediaUrl,
  resolvePublicShareMedia,
  type PublicShareFetchResponse,
} from '../../main/utils/publicShareMedia';

function response(overrides: Partial<PublicShareFetchResponse> = {}): PublicShareFetchResponse {
  return {
    ok: true,
    status: 200,
    url: 'https://www.doubao.com/share/demo',
    headers: { get: () => null },
    text: async () => '',
    body: { cancel: async () => undefined },
    ...overrides,
  };
}

describe('public share media resolver', () => {
  it('只接受豆包 http(s) 分享页，不接受私有地址或凭据 URL', () => {
    expect(isAllowedPublicShareUrl('https://www.doubao.com/share/a')).toBe(true);
    expect(isAllowedPublicShareUrl('http://doubao.com/share/a')).toBe(true);
    expect(isAllowedPublicShareUrl('https://evil.example/share/a')).toBe(false);
    expect(isAllowedPublicShareUrl('https://user:pass@www.doubao.com/share/a')).toBe(false);
  });

  it('只接收页面公开声明的公网媒体 URL', () => {
    const urls = extractDeclaredPublicMediaUrls('<meta property="og:video" content="https://vod.example.com/a.mp4?x=1&amp;y=2"><video src="http://127.0.0.1/a.mp4">');
    expect(urls).toEqual(['https://vod.example.com/a.mp4?x=1&y=2']);
    expect(isPublicMediaUrl('https://10.0.0.2/a.mp4')).toBe(false);
  });

  it('公开页声明视频且 Range 探针为 video 时返回可下载媒体', async () => {
    const fetchPublic = async (url: string): Promise<PublicShareFetchResponse> => url.includes('doubao.com')
      ? response({ headers: { get: () => null }, text: async () => '<meta property="og:video" content="https://vod.example.com/a.mp4">' })
      : response({ url: 'https://vod.example.com/a.mp4', status: 206, headers: { get: (name) => name === 'content-type' ? 'video/mp4' : '2048' } });
    const result = await resolvePublicShareMedia('https://www.doubao.com/share/demo', fetchPublic);
    expect(result).toMatchObject({ status: 'resolved', sourceHost: 'vod.example.com', contentType: 'video/mp4', contentLength: 2048 });
  });

  it('只跟随豆包域名内的有限跳转，拒绝外部跳转', async () => {
    const calls: string[] = [];
    const redirected = await resolvePublicShareMedia('https://www.doubao.com/share/demo', async (url) => {
      calls.push(url);
      if (calls.length === 1) return response({ ok: false, status: 302, headers: { get: () => '/thread/public' } });
      if (calls.length === 2) return response({ text: async () => '<video src="https://vod.example.com/a.mp4">' });
      return response({ url: 'https://vod.example.com/a.mp4', status: 206, headers: { get: () => 'video/mp4' } });
    });
    expect(redirected.status).toBe('resolved');
    const external = await resolvePublicShareMedia('https://www.doubao.com/share/demo', async () => response({ ok: false, status: 302, headers: { get: () => 'https://evil.example/a' } }));
    expect(external).toMatchObject({ status: 'unsupported_source', error: '分享页跳转到了非允许域名' });
  });

  it('非公开视频页面、非视频 Content-Type 与网络错误都 fail-closed', async () => {
    const noVideo = await resolvePublicShareMedia('https://www.doubao.com/share/demo', async () => response({ text: async () => '<html>no media</html>' }));
    expect(noVideo.status).toBe('media_not_found');
    const nonVideo = await resolvePublicShareMedia('https://www.doubao.com/share/demo', async (url) => url.includes('doubao.com')
      ? response({ text: async () => '<video src="https://cdn.example.com/a.mp4">' })
      : response({ url: 'https://cdn.example.com/a.mp4', headers: { get: () => 'text/html' } }));
    expect(nonVideo.status).toBe('invalid_media');
    const offline = await resolvePublicShareMedia('https://www.doubao.com/share/demo', async () => { throw new Error('offline'); });
    expect(offline.status).toBe('network_error');
  });
});
