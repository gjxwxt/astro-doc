import { assertPublicUrl } from '@/plugins/validate';

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 JoshPortal/2.0';
const MAX_HTML_BYTES = 600_000;
const MAX_REDIRECTS = 3;
const FETCH_TIMEOUT_MS = 9_000;
const READER_TIMEOUT_MS = 35_000;
const MAX_READER_BYTES = 400_000;

export type LinkPreviewProvider = 'x' | 'douyin' | 'zhihu' | 'generic';

export interface LinkPreview {
  url: string;
  finalUrl: string;
  title: string;
  description: string;
  image: string;
  video: string;
  siteName: string;
  author: string;
  publishedAt?: string;
  articleUrl?: string;
  fallback?: boolean;
  provider: LinkPreviewProvider;
}

export class LinkPreviewError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 502,
  ) {
    super(message);
    this.name = 'LinkPreviewError';
  }
}

function decodeEntities(value: string): string {
  return value
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&mdash;', '—')
    .replaceAll('&ndash;', '–')
    .replaceAll('&hellip;', '…')
    .replaceAll('&nbsp;', ' ')
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16)));
}

function normalizeDate(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function parseAttributes(tag: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const match of tag.matchAll(/([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    attrs[match[1].toLowerCase()] = decodeEntities(match[2] ?? match[3] ?? '');
  }
  return attrs;
}

export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(?:p|div|blockquote|li)>/gi, '\n')
      .replace(/<[^>]+>/g, ''),
  )
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function parseHtmlPreview(html: string, finalUrl: string): LinkPreview {
  const meta = new Map<string, string>();
  for (const tag of html.matchAll(/<meta\b[^>]*>/gi)) {
    const attrs = parseAttributes(tag[0]);
    const key = (attrs.property || attrs.name || '').toLowerCase();
    if (key && attrs.content) meta.set(key, attrs.content.trim());
  }

  const titleTag = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '';
  const descriptionTag = html.match(
    /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i,
  )?.[1];

  let hostname = '';
  try {
    hostname = new URL(finalUrl).hostname.replace(/^www\./, '');
  } catch {
    /* keep empty */
  }

  const image = meta.get('og:image') || meta.get('og:image:url') || meta.get('twitter:image') || '';
  const video =
    meta.get('og:video:url') || meta.get('og:video') || meta.get('twitter:player:stream') || '';

  const absolute = (value: string): string => {
    if (!value) return '';
    try {
      const url = new URL(value, finalUrl);
      return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : '';
    } catch {
      return '';
    }
  };

  return {
    url: finalUrl,
    finalUrl,
    title: (meta.get('og:title') || meta.get('twitter:title') || decodeEntities(titleTag).trim()).slice(
      0,
      200,
    ),
    description: (
      meta.get('og:description') ||
      meta.get('twitter:description') ||
      (descriptionTag ? decodeEntities(descriptionTag) : '') ||
      meta.get('description') ||
      ''
    ).slice(0, 1_200),
    image: absolute(image),
    video: absolute(video),
    siteName: (meta.get('og:site_name') || hostname).slice(0, 120),
    author: (meta.get('author') || meta.get('article:author') || '').slice(0, 120),
    publishedAt: normalizeDate(meta.get('article:published_time') || meta.get('og:article:published_time')),
    provider: 'generic',
  };
}

function isXStatus(url: URL): boolean {
  return (
    ['x.com', 'www.x.com', 'twitter.com', 'www.twitter.com', 'mobile.twitter.com'].includes(
      url.hostname.toLowerCase(),
    ) && /\/status(?:es)?\/\d+/i.test(url.pathname)
  );
}

function isDouyin(url: URL): boolean {
  const host = url.hostname.toLowerCase();
  return host === 'douyin.com' || host.endsWith('.douyin.com') || host === 'iesdouyin.com';
}

function isZhihu(url: URL): boolean {
  const host = url.hostname.toLowerCase();
  return host === 'zhihu.com' || host.endsWith('.zhihu.com');
}

async function fetchHtml(target: URL): Promise<{ html: string; finalUrl: string }> {
  let current = target;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    let response: Response;
    try {
      response = await fetch(current, {
        headers: {
          accept: 'text/html,application/xhtml+xml',
          'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
          'user-agent': USER_AGENT,
        },
        redirect: 'manual',
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
    } catch {
      throw new LinkPreviewError('FETCH_FAILED', '读取这个链接超时，或对方拒绝了请求。', 504);
    }

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      if (!location) throw new LinkPreviewError('FETCH_FAILED', `目标页面返回 ${response.status}。`);
      try {
        current = assertPublicUrl(new URL(location, current).href);
      } catch {
        throw new LinkPreviewError('INVALID_URL', '链接跳转到了不允许的地址。');
      }
      continue;
    }

    if (!response.ok) {
      throw new LinkPreviewError('FETCH_FAILED', `目标页面返回 ${response.status}。`);
    }

    const finalUrl = assertPublicUrl(response.url || current.href).href;
    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.includes('text/html') && !contentType.includes('application/xhtml')) {
      throw new LinkPreviewError('NOT_HTML', '这个链接不是网页，无法读取预览信息。', 415);
    }

    const declaredLength = Number(response.headers.get('content-length') ?? 0);
    if (declaredLength > MAX_HTML_BYTES) {
      throw new LinkPreviewError('PAGE_TOO_LARGE', '页面太大，已停止读取。', 413);
    }

    const html = (await response.text()).slice(0, MAX_HTML_BYTES);
    return { html, finalUrl };
  }

  throw new LinkPreviewError('TOO_MANY_REDIRECTS', '链接跳转次数太多。');
}

interface XOembedData {
  author: string;
  text: string;
}

async function xOembed(target: URL): Promise<XOembedData | null> {
  const endpoint = new URL('https://publish.twitter.com/oembed');
  endpoint.searchParams.set('url', target.href);
  endpoint.searchParams.set('omit_script', '1');

  try {
    const response = await fetch(endpoint, {
      headers: { accept: 'application/json', 'user-agent': USER_AGENT },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    const data = (await response.json()) as {
      author_name?: string;
      html?: string;
    };
    return {
      author: (data.author_name ?? '').trim(),
      text: htmlToText(data.html ?? ''),
    };
  } catch {
    return null;
  }
}

function cleanXText(text: string): string {
  return text
    .replace(/https:\/\/t\.co\/\S+/gi, '')
    .replace(/\n?—\s+[^\n]+$/i, '')
    .replace(/[ \t]+\n/g, '\n')
    .trim();
}

function xArticleTitle(pageTitle: string): string {
  // X localizes this title ("FanXing on X: ..." / "X 上的 FanXing：...").
  // The quoted article title is the stable part.
  return pageTitle.match(/["“](.+)["”]\s*\/\s*X\s*$/)?.[1]?.trim() ?? '';
}

function xArticleUrl(html: string): string {
  return html.match(/https:\/\/x\.com\/i\/article\/\d+/)?.[0] ?? '';
}

function xAuthorFromTitle(pageTitle: string): string {
  return (
    pageTitle.match(/^(.+?) on X:/i)?.[1]?.trim() ??
    pageTitle.match(/^X 上的 (.+?)[:：]/)?.[1]?.trim() ??
    ''
  );
}

async function xPreview(target: URL): Promise<LinkPreview> {
  // X Articles only expose their real title on the page, not in oEmbed.
  // Fetch both so a blocked page still leaves us with the post text.
  const [pageResult, oembedResult] = await Promise.allSettled([
    fetchHtml(target),
    xOembed(target),
  ]);
  const pageHtml = pageResult.status === 'fulfilled' ? pageResult.value.html : '';
  const page = pageHtml
    ? {
        ...parseHtmlPreview(pageHtml, pageResult.status === 'fulfilled' ? pageResult.value.finalUrl : target.href),
        articleUrl: xArticleUrl(pageHtml),
      }
    : null;
  const oembed = oembedResult.status === 'fulfilled' ? oembedResult.value : null;

  if (!page && !oembed) {
    throw new LinkPreviewError('FETCH_FAILED', 'X 页面暂时拿不到。');
  }

  const articleTitle = page ? xArticleTitle(page.title) : '';
  const author = oembed?.author || (page ? xAuthorFromTitle(page.title) : '');
  const postText = cleanXText(oembed?.text ?? '');
  const postTitle = postText.replace(/\s+/g, ' ').trim().slice(0, 200);
  const image =
    page?.image && !page.image.includes('/profile_images/') ? page.image : '';

  return {
    url: target.href,
    finalUrl: page?.finalUrl || target.href,
    title: articleTitle || postTitle || (author ? `${author} 在 X` : page?.title || 'X 帖子'),
    description: articleTitle ? postText : postText || page?.description || '',
    image,
    video: '',
    siteName: 'X',
    author,
    publishedAt: page?.publishedAt,
    articleUrl: page?.articleUrl || undefined,
    provider: 'x',
  };
}

async function resolverPreview(
  target: URL,
  endpoint: string,
  token?: string,
): Promise<LinkPreview | null> {
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ url: target.href }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) return null;

    const data = (await response.json()) as Record<string, unknown>;
    const nested =
      data.data && typeof data.data === 'object' ? (data.data as Record<string, unknown>) : {};
    const pick = (...values: unknown[]): string => {
      for (const value of values) {
        if (typeof value === 'string' && value.trim()) return value.trim();
      }
      return '';
    };
    const title = pick(data.title, nested.title);
    const cover = pick(data.cover, data.thumbnail, nested.cover, nested.thumbnail);
    if (!title && !cover) return null;

    return {
      url: target.href,
      finalUrl: target.href,
      title: (title || '抖音链接').slice(0, 200),
      description: pick(data.desc, data.description, nested.desc, nested.description).slice(0, 1_200),
      image: cover,
      video: '',
      siteName: '抖音',
      author: pick(data.author, data.nickname, nested.author, nested.nickname).slice(0, 120),
      provider: 'douyin',
    };
  } catch {
    return null;
  }
}

function badDouyinTitle(title: string): boolean {
  return !title || /^(抖音|douyin|验证码中间页|安全验证)$/i.test(title.trim());
}

async function douyinPreview(
  target: URL,
  env: Record<string, string | undefined>,
): Promise<LinkPreview> {
  let page: LinkPreview | null = null;
  try {
    const { html, finalUrl } = await fetchHtml(target);
    const parsed = parseHtmlPreview(html, finalUrl);
    if (!badDouyinTitle(parsed.title)) page = parsed;
  } catch {
    /* anti-bot page or network failure: use the resolver/fallback below */
  }

  if (page) {
    return {
      ...page,
      title: page.title,
      description: page.description || '抖音链接，已保存。',
      siteName: '抖音',
      provider: 'douyin',
    };
  }

  const endpoint = env.MEDIA_RESOLVER_URL?.trim();
  if (endpoint) {
    const resolved = await resolverPreview(target, endpoint, env.MEDIA_RESOLVER_TOKEN?.trim());
    if (resolved) return resolved;
  }

  return {
    url: target.href,
    finalUrl: target.href,
    title: '抖音链接',
    description: '这条链接的标题和封面需要登录或解析服务，已先保存链接。可以补一句随想。',
    image: '',
    video: '',
    siteName: '抖音',
    author: '',
    provider: 'douyin',
  };
}

function badReaderTitle(title: string): boolean {
  return /安全验证|验证码|Just a moment|Attention Required|Access Denied/i.test(title);
}

function cleanReaderTitle(value: string): string {
  const title = value.trim();
  const parts = title.split(/\s+[|｜]\s+/);
  return parts.length > 1 && parts[0].trim().length >= 8 ? parts[0].trim() : title;
}

function cleanReaderText(markdown: string): string {
  const paragraphs = markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\{\{SECRET_[^}]+\}\}/g, '')
    .split(/\n{2,}/)
    .map((paragraph) =>
      paragraph
        .replace(/<[^>]+>/g, ' ')
        .replace(/^[#>*\-\s]+/gm, '')
        .replace(/[*_`]/g, '')
        .replace(/\s+/g, ' ')
        .trim(),
    )
    .filter((paragraph) => paragraph.length > 10 && !/^(?:图片|Image)\b/i.test(paragraph));

  return paragraphs.slice(0, 2).join('\n\n').slice(0, 1_200);
}

function parseReaderPreview(text: string, target: URL): LinkPreview | null {
  const title = text.match(/^Title:\s*(.+)$/m)?.[1]?.trim() ?? '';
  if (!title || badReaderTitle(title)) return null;

  const body = text.split(/^Markdown Content:\s*$/m)[1] ?? '';
  const description = cleanReaderText(body);
  if (!description) return null;

  const host = target.hostname.replace(/^www\./, '');
  return {
    url: target.href,
    finalUrl: target.href,
    title: cleanReaderTitle(title).slice(0, 200),
    description,
    image: '',
    video: '',
    siteName: host.endsWith('zhihu.com') ? '知乎' : host,
    author: '',
    provider: host.endsWith('zhihu.com') ? 'zhihu' : 'generic',
  };
}

async function readerPreview(target: URL, endpoint: string): Promise<LinkPreview | null> {
  const base = endpoint.replace(/\/+$/, '');
  const response = await fetch(`${base}/${target.href}`, {
    headers: {
      accept: 'text/plain,text/markdown;q=0.9',
      'user-agent': USER_AGENT,
      // Reader services that render client-side pages need this wait hint.
      'x-timeout': '30',
    },
    signal: AbortSignal.timeout(READER_TIMEOUT_MS),
  });
  if (!response.ok) return null;

  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('text/plain') && !contentType.includes('text/markdown')) return null;

  const text = (await response.text()).slice(0, MAX_READER_BYTES);
  return parseReaderPreview(text, target);
}

async function zhihuPreview(
  target: URL,
  env: Record<string, string | undefined>,
): Promise<LinkPreview> {
  try {
    const { html, finalUrl } = await fetchHtml(target);
    const parsed = parseHtmlPreview(html, finalUrl);
    if (parsed.title && !badReaderTitle(parsed.title)) {
      return {
        ...parsed,
        siteName: '知乎',
        provider: 'zhihu',
      };
    }
  } catch {
    /* Zhihu usually returns a 403 challenge page; use the reader below. */
  }

  const endpoint = env.LINK_READER_URL?.trim();
  if (endpoint) {
    try {
      const preview = await readerPreview(target, endpoint);
      if (preview) return preview;
    } catch {
      /* keep the transparent fallback below */
    }
  }

  return {
    url: target.href,
    finalUrl: target.href,
    title: '知乎链接',
    description: '知乎页面拒绝了匿名预览，链接已保存。可以补一句随想。',
    image: '',
    video: '',
    siteName: '知乎',
    author: '',
    fallback: true,
    provider: 'zhihu',
  };
}

function weakPageTitle(preview: LinkPreview | null, host: string): boolean {
  if (!preview?.title) return true;
  const title = preview.title.trim().toLowerCase();
  return title === host.toLowerCase() || title === preview.siteName.trim().toLowerCase();
}

async function genericPreview(
  target: URL,
  env: Record<string, string | undefined>,
): Promise<LinkPreview> {
  let page: LinkPreview | null = null;
  try {
    const { html, finalUrl } = await fetchHtml(target);
    page = parseHtmlPreview(html, finalUrl);
  } catch {
    /* Some pages block server requests; the reader below can still help. */
  }

  const host = target.hostname.replace(/^www\./, '');
  if (page && !weakPageTitle(page, host)) {
    return {
      ...page,
      title: page.title || host,
      description:
        page.description || '这个页面没有提供描述，链接和标题已经保存。',
      siteName: page.siteName || host,
      provider: 'generic',
    };
  }

  const endpoint = env.LINK_READER_URL?.trim();
  if (endpoint) {
    try {
      const preview = await readerPreview(target, endpoint);
      if (preview) {
        return {
          ...preview,
          author: page?.author || preview.author,
          siteName: preview.siteName || host,
        };
      }
    } catch {
      /* fall through to the page metadata or a transparent fallback */
    }
  }

  if (page) {
    return {
      ...page,
      title: page.title || host,
      description:
        page.description || '这个页面没有提供描述，链接和标题已经保存。',
      siteName: page.siteName || host,
      provider: 'generic',
    };
  }

  throw new LinkPreviewError('FETCH_FAILED', '目标页面拒绝了请求。', 502);
}

export async function fetchLinkPreview(
  rawUrl: string,
  env: Record<string, string | undefined> = {},
): Promise<LinkPreview> {
  let target: URL;
  try {
    target = assertPublicUrl(rawUrl);
  } catch (error) {
    throw new LinkPreviewError(
      'INVALID_URL',
      error instanceof Error ? error.message : '链接不合法。',
      400,
    );
  }

  if (isXStatus(target)) return xPreview(target);
  if (isDouyin(target)) return douyinPreview(target, env);
  if (isZhihu(target)) return zhihuPreview(target, env);

  return genericPreview(target, env);
}

export function fallbackLinkPreview(rawUrl: string): LinkPreview {
  let target: URL;
  try {
    target = new URL(rawUrl);
  } catch {
    return {
      url: rawUrl,
      finalUrl: rawUrl,
      title: '链接',
      description: '链接已保存，预览暂时不可用。',
      image: '',
      video: '',
      siteName: '',
      author: '',
      provider: 'generic',
    };
  }

  return {
    url: target.href,
    finalUrl: target.href,
    title: target.hostname.replace(/^www\./, ''),
    description: '链接已保存，预览暂时不可用。可以补一句随想。',
    image: '',
    video: '',
    siteName: target.hostname.replace(/^www\./, ''),
    author: '',
    fallback: true,
    provider: 'generic',
  };
}
