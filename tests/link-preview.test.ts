import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  fetchLinkPreview,
  parseHtmlPreview,
} from '@/lib/link-preview';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('parseHtmlPreview', () => {
  it('reads Open Graph and resolves a relative image', () => {
    const preview = parseHtmlPreview(
      `
        <html>
          <head>
            <title>Fallback title</title>
            <meta property="og:title" content="真正的标题" />
            <meta property="og:description" content="一段描述" />
            <meta property="og:image" content="/cover.jpg" />
            <meta property="og:site_name" content="示例站" />
          </head>
        </html>
      `,
      'https://example.com/posts/1',
    );

    expect(preview.title).toBe('真正的标题');
    expect(preview.description).toBe('一段描述');
    expect(preview.image).toBe('https://example.com/cover.jpg');
    expect(preview.siteName).toBe('示例站');
  });
});

describe('fetchLinkPreview', () => {
  it('combines X oEmbed with page metadata', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('publish.twitter.com/oembed')) {
        return new Response(
          JSON.stringify({
            author_name: 'jack',
            html: '<blockquote><p>just setting up my twttr</p>&mdash; jack</blockquote>',
            provider_name: 'X',
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response(
        '<html><head><title>jack (@jack) on X</title><meta property="og:title" content="jack (@jack) on X"><meta property="og:description" content="just setting up my twttr"><meta property="article:published_time" content="2006-03-21T20:50:14.000Z"></head></html>',
        { status: 200, headers: { 'content-type': 'text/html' } },
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    const preview = await fetchLinkPreview('https://x.com/jack/status/20');
    expect(preview.provider).toBe('x');
    expect(preview.title).toBe('just setting up my twttr');
    expect(preview.description).toBe('just setting up my twttr');
    expect(preview.publishedAt).toBe('2006-03-21T20:50:14.000Z');
  });

  it('uses the article title from an X article page', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('publish.twitter.com/oembed')) {
        return new Response(
          JSON.stringify({
            author_name: 'FanXing',
            html: '<blockquote><p>正文随想 https://t.co/abc</p>&mdash; FanXing (@fanxing321) October 26, 2026</blockquote>',
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response(
        '<html><head><title>X 上的 FanXing：&quot;Argon &amp; Opus &amp; Astra 的区别（个人观点）&quot; / X</title>' +
          '<meta property="og:title" content="X 上的 FanXing：&quot;Argon &amp; Opus &amp; Astra 的区别（个人观点）&quot; / X">' +
          '<meta property="og:description" content="Argon &amp; Opus &amp; Astra 的区别（个人观点）">' +
          '<meta property="article:published_time" content="2026-10-26T10:39:07.000Z">' +
          '<meta property="og:image" content="https://pbs.twimg.com/profile_images/1/avatar.jpg">' +
          '<script>{"expanded_url":"https://x.com/i/article/2114591835113046016"}</script></head></html>',
        { status: 200, headers: { 'content-type': 'text/html' } },
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    const preview = await fetchLinkPreview(
      'https://x.com/fanxing321/status/2114668139887968698',
    );
    expect(preview.title).toBe('Argon & Opus & Astra 的区别（个人观点）');
    expect(preview.author).toBe('FanXing');
    expect(preview.description).toBe('正文随想');
    expect(preview.articleUrl).toBe('https://x.com/i/article/2114591835113046016');
    expect(preview.image).toBe('');
    expect(preview.publishedAt).toBe('2026-10-26T10:39:07.000Z');
  });

  it('falls back to a readable Douyin card when the page is anti-bot', async () => {
    const fetchMock = vi.fn(async () => {
      return new Response('<html><head><title>验证码中间页</title></head></html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const preview = await fetchLinkPreview('https://www.douyin.com/video/7126745726494821640');
    expect(preview.provider).toBe('douyin');
    expect(preview.siteName).toBe('抖音');
    expect(preview.title).toBe('抖音链接');
    expect(preview.description).toContain('需要登录或解析服务');
  });

  it('uses the configured reader for a blocked Zhihu article', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith('https://r.jina.ai/')) {
        return new Response(
          'Title: 我接触过的前端数据结构与算法\n\nURL Source: https://zhuanlan.zhihu.com/p/27659059\n\nMarkdown Content:\n\n我们已经讨论过了前端与计算机基础的很多话题，本篇将讨论数据结构与算法。\n',
          { status: 200, headers: { 'content-type': 'text/plain; charset=utf-8' } },
        );
      }
      return new Response('<html><body>request blocked</body></html>', {
        status: 403,
        headers: { 'content-type': 'text/html' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const preview = await fetchLinkPreview('https://zhuanlan.zhihu.com/p/27659059', {
      LINK_READER_URL: 'https://r.jina.ai/',
    });
    expect(preview.provider).toBe('zhihu');
    expect(preview.siteName).toBe('知乎');
    expect(preview.title).toBe('我接触过的前端数据结构与算法');
    expect(preview.description).toContain('前端与计算机基础');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://r.jina.ai/https://zhuanlan.zhihu.com/p/27659059',
      expect.anything(),
    );
  });

  it('keeps a transparent Zhihu fallback when no reader is configured', async () => {
    const fetchMock = vi.fn(async () => {
      return new Response('<html><body>request blocked</body></html>', {
        status: 403,
        headers: { 'content-type': 'text/html' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const preview = await fetchLinkPreview('https://zhuanlan.zhihu.com/p/27659059');
    expect(preview.title).toBe('知乎链接');
    expect(preview.siteName).toBe('知乎');
    expect(preview.description).toContain('拒绝了匿名预览');
  });

  it('uses the reader when a generic page only has a shell title', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith('https://r.jina.ai/')) {
        return new Response(
          'Title: 知识库方案选型对比 | 君哥的学习笔记\n\nURL Source: https://www.it235.com/ai/knowledge/introduce.html\n\nMarkdown Content:\n\n最近我接触到的知识库内容明显变多了。\n\n真要放到企业级环境里，涉及准确性、权限、审计和治理。\n',
          { status: 200, headers: { 'content-type': 'text/plain; charset=utf-8' } },
        );
      }
      return new Response(
        '<html><head><title></title><meta name="description" content="站点介绍"><meta name="author" content="君哥"></head><body><div id="app"></div></body></html>',
        { status: 200, headers: { 'content-type': 'text/html' } },
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    const preview = await fetchLinkPreview('https://www.it235.com/ai/knowledge/introduce.html', {
      LINK_READER_URL: 'https://r.jina.ai/',
    });
    expect(preview.title).toBe('知识库方案选型对比');
    expect(preview.author).toBe('君哥');
    expect(preview.description).toContain('知识库内容明显变多了');
  });

  it('parses a generic Open Graph page', async () => {
    const fetchMock = vi.fn(async () => {
      return new Response(
        '<html><head><meta property="og:title" content="Example Domain"><meta property="og:description" content="A domain"></head></html>',
        { status: 200, headers: { 'content-type': 'text/html' } },
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    const preview = await fetchLinkPreview('https://example.com/');
    expect(preview.provider).toBe('generic');
    expect(preview.title).toBe('Example Domain');
    expect(preview.description).toBe('A domain');
  });

  it('rejects private URLs before fetching', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchLinkPreview('http://127.0.0.1/secret')).rejects.toMatchObject({
      code: 'INVALID_URL',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
